import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db/index.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ApiError } from '../middleware/errorHandler.js';
import {
  computeSchedule, computeTotalCost, computeFileFee,
  generateReference, DEFAULT_MONTHLY_RATE,
} from '../services/creditService.js';
import { listActiveProducts, getActiveScale } from '../services/productService.js';
import { validateAgainstScale } from '../utils/rateVersioning.js';
import { initiateTransaction } from '../services/mobileMoneyService.js';
import { notifyUser } from '../services/pushService.js';
import { audit } from '../services/auditService.js';

const router = Router();
router.use(requireAuth);

/* ═══════════════════════════════════════════════════════════════════
   COMPTE ET TRANSACTIONS — cahier des charges §2.1
   ═══════════════════════════════════════════════════════════════════ */

/** GET /client/compte — solde et informations du compte principal */
router.get('/compte', requirePermission('compte.lire_le_sien'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT a.id, a.label, a.currency, b.balance
       FROM accounts a
       JOIN account_balances b ON b.account_id = a.id
       WHERE a.user_id = $1
       ORDER BY a.created_at
       LIMIT 1`,
      [req.user.id]
    );

    if (!rows[0]) throw new ApiError(404, 'Aucun compte associé à ce profil.');

    res.json({
      account: rows[0],
      holder: {
        fullName: req.user.full_name,
        clientNumber: req.user.client_number,
        jobTitle: req.user.job_title,
        memberSince: req.user.created_at,
      },
    });
  } catch (error) {
    next(error);
  }
});

/** GET /client/transactions — historique paginé */
const historyQuery = z.object({
  limite: z.coerce.number().int().min(1).max(100).default(20),
  avant: z.string().datetime().optional(), // pagination par curseur
});

router.get(
  '/transactions',
  requirePermission('compte.lire_le_sien'),
  validate(historyQuery, 'query'),
  async (req, res, next) => {
    try {
      const { limite, avant } = req.query;

      // Pagination par curseur et non par OFFSET : avec OFFSET, une
      // nouvelle transaction pendant que l'utilisateur fait défiler
      // décale la liste et lui fait voir deux fois la même ligne.
      const { rows } = await query(
        `SELECT le.id, le.type, le.amount, le.label, le.reference, le.created_at
         FROM ledger_entries le
         JOIN accounts a ON a.id = le.account_id
         WHERE a.user_id = $1
           AND ($2::timestamptz IS NULL OR le.created_at < $2)
         ORDER BY le.created_at DESC
         LIMIT $3`,
        [req.user.id, avant ?? null, limite]
      );

      res.json({
        transactions: rows,
        nextCursor: rows.length === limite ? rows[rows.length - 1].created_at : null,
      });
    } catch (error) {
      next(error);
    }
  }
);

/* ═══════════════════════════════════════════════════════════════════
   CRÉDITS — cahier des charges §2.3
   ═══════════════════════════════════════════════════════════════════ */

/** GET /client/produits — types de crédit proposés */
router.get('/produits', requirePermission('catalogue.lire_public'), async (req, res, next) => {
  try {
    const produits = await listActiveProducts();
    res.json({
      produits: produits.map((p) => ({
        id: p.product_id,
        code: p.code,
        nom: p.name,
        tauxMensuel: Number(p.monthly_rate),
        montantMin: p.min_amount,
        montantMax: p.max_amount,
        dureeMin: p.min_duration,
        dureeMax: p.max_duration,
      })),
    });
  } catch (error) {
    next(error);
  }
});

/** POST /client/credits/simulation — aucun enregistrement, calcul pur */
const simulationSchema = z.object({
  produitId: z.string().uuid().optional(),
  montant: z.number().int().min(10000).max(50000000),
  duree: z.number().int().min(1).max(120),
});

router.post(
  '/credits/simulation',
  requirePermission('credits.simuler'),
  validate(simulationSchema),
  async (req, res, next) => {
    try {
      const { montant, duree, produitId } = req.body;

      // Sans produit précisé, on retombe sur le barème historique.
      // Cela garde l'API compatible avec les clients déjà déployés.
      let scale = null;
      if (produitId) {
        scale = await getActiveScale(produitId);
        if (!scale) throw new ApiError(404, 'Produit indisponible.');
        validateAgainstScale(montant, duree, scale);
      }

      const rate = scale ? Number(scale.monthly_rate) : DEFAULT_MONTHLY_RATE;
      const feeScale = scale
        ? { fileFeeFixed: Number(scale.file_fee_fixed), fileFeeRate: Number(scale.file_fee_rate) }
        : {};

      const result = computeTotalCost(montant, duree, rate, feeScale);

      // On annonce le coût total et le net reçu, pas seulement la
      // mensualité : laisser le client découvrir les frais de dossier
      // à la signature est la première source de litige.
      res.json({
        produit: scale ? { id: scale.product_id, nom: scale.name, code: scale.code } : null,
        montant,
        duree,
        tauxMensuel: rate,
        ...result,
        avertissement: "Simulation indicative, sous réserve d'étude du dossier.",
      });
    } catch (error) {
      next(error);
    }
  }
);

/** POST /client/credits — soumission d'une demande */
const requestSchema = z.object({
  produitId: z.string().uuid().optional(),
  montant: z.number().int().min(10000).max(50000000),
  duree: z.number().int().min(1).max(120),
  motif: z.string().max(500).optional(),
});

router.post(
  '/credits',
  requirePermission('credits.demander'),
  validate(requestSchema),
  async (req, res, next) => {
    try {
      const { montant, duree, motif, produitId } = req.body;

      // Un client ne peut pas empiler les demandes : cela encombre les
      // conseillers et fausse l'analyse de solvabilité.
      const { rows: pending } = await query(
        `SELECT 1 FROM credit_requests
         WHERE user_id = $1 AND status IN ('en_verification', 'valide_niveau1')`,
        [req.user.id]
      );
      if (pending.length > 0) {
        throw new ApiError(409, 'Une demande est déjà en cours de traitement.');
      }

      // On fige la VERSION du barème, pas seulement le taux : c'est ce
      // qui garantit que ce crédit gardera ses conditions si la
      // direction change le barème le mois prochain.
      let scale = null;
      if (produitId) {
        scale = await getActiveScale(produitId);
        if (!scale) throw new ApiError(404, 'Produit indisponible.');
        validateAgainstScale(montant, duree, scale);
      }

      const rate = scale ? Number(scale.monthly_rate) : DEFAULT_MONTHLY_RATE;
      const fileFee = scale
        ? computeFileFee(montant, {
            fileFeeFixed: Number(scale.file_fee_fixed),
            fileFeeRate: Number(scale.file_fee_rate),
          })
        : 0;

      const { rows } = await query(
        `INSERT INTO credit_requests
           (reference, user_id, amount, duration_months, monthly_rate, purpose,
            product_version_id, file_fee)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, reference, amount, duration_months, status, file_fee, created_at`,
        [
          generateReference(), req.user.id, montant, duree, rate, motif ?? null,
          scale?.version_id ?? null, fileFee,
        ]
      );

      await audit(req, {
        action: 'credit.demande',
        entityType: 'credit_request',
        entityId: rows[0].id,
        metadata: { montant, duree },
      });

      res.status(201).json(rows[0]);
    } catch (error) {
      next(error);
    }
  }
);

/** GET /client/credits — crédits du client, avec échéancier */
router.get('/credits', requirePermission('credits.lire_les_siens'), async (req, res, next) => {
  try {
    const { rows: credits } = await query(
      `SELECT id, reference, amount, duration_months, monthly_payment, status, created_at, approved_at
       FROM credit_requests WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    );

    const active = credits.find((c) => c.status === 'approuve');
    let installments = [];

    if (active) {
      const { rows } = await query(
        `SELECT id, sequence, due_date, amount, status, paid_at
         FROM installments WHERE credit_id = $1 ORDER BY sequence`,
        [active.id]
      );
      installments = rows;
    }

    const paid = installments.filter((i) => i.status === 'payee').length;
    const remaining = installments
      .filter((i) => i.status !== 'payee')
      .reduce((sum, i) => sum + i.amount, 0);

    res.json({
      credits,
      activeCredit: active
        ? { ...active, installments, paidMonths: paid, remainingAmount: remaining }
        : null,
    });
  } catch (error) {
    next(error);
  }
});

/* ═══════════════════════════════════════════════════════════════════
   MOBILE MONEY — cahier des charges §2.2
   ═══════════════════════════════════════════════════════════════════ */

const momoSchema = z.object({
  operateur: z.enum(['airtel', 'moov']),
  sens: z.enum(['entrant', 'sortant']),
  montant: z.number().int().min(500).max(2000000),
  telephone: z.string().min(8).max(20),
  cleIdempotence: z.string().uuid().optional(),
});

router.post(
  '/momo',
  requirePermission('momo.initier'),
  validate(momoSchema),
  async (req, res, next) => {
    try {
      const { operateur, sens, montant, telephone, cleIdempotence } = req.body;

      const { rows } = await query(
        'SELECT id FROM accounts WHERE user_id = $1 ORDER BY created_at LIMIT 1',
        [req.user.id]
      );
      if (!rows[0]) throw new ApiError(404, 'Aucun compte associé à ce profil.');

      const transaction = await initiateTransaction({
        userId: req.user.id,
        accountId: rows[0].id,
        operator: operateur,
        direction: sens,
        amount: montant,
        phone: telephone,
        idempotencyKey: cleIdempotence,
      });

      await audit(req, {
        action: 'momo.initiee',
        entityType: 'momo_transaction',
        entityId: transaction.id,
        metadata: { operateur, sens, montant },
      });

      res.status(202).json({
        reference: transaction.reference,
        statut: transaction.status,
        message: 'Confirmez l’opération sur votre téléphone.',
      });
    } catch (error) {
      next(error);
    }
  }
);

/** GET /client/momo/:reference — suivi d'une opération */
router.get('/momo/:reference', requirePermission('momo.initier'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT reference, operator, direction, amount, status, failure_reason, created_at, confirmed_at
       FROM momo_transactions WHERE reference = $1 AND user_id = $2`,
      [req.params.reference, req.user.id]
    );
    if (!rows[0]) throw new ApiError(404, 'Transaction introuvable.');
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

/* ═══════════════════════════════════════════════════════════════════
   MESSAGERIE — cahier des charges §2.4
   ═══════════════════════════════════════════════════════════════════ */

router.get('/messages', requirePermission('messagerie.ecrire'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT m.id, m.body, m.created_at, m.sender_id,
              (m.sender_id = $1) AS mine
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.client_id = $1
       ORDER BY m.created_at ASC
       LIMIT 200`,
      [req.user.id]
    );
    res.json({ messages: rows });
  } catch (error) {
    next(error);
  }
});

router.post(
  '/messages',
  requirePermission('messagerie.ecrire'),
  validate(z.object({ texte: z.string().min(1).max(4000) })),
  async (req, res, next) => {
    try {
      const message = await withTransaction(async (client) => {
        // `xmax = 0` distingue un vrai INSERT d'un UPDATE déclenché par
        // le ON CONFLICT : c'est ce qui nous dit si cette conversation
        // vient tout juste d'être créée (premier message du client),
        // sans avoir besoin d'une requête SELECT séparée avant.
        const { rows: conv } = await client.query(
          `INSERT INTO conversations (client_id, last_message_at)
           VALUES ($1, now())
           ON CONFLICT (client_id) DO UPDATE SET last_message_at = now()
           RETURNING id, (xmax = 0) AS nouvelle_conversation`,
          [req.user.id]
        );
        const estNouvelle = conv[0].nouvelle_conversation;

        const { rows } = await client.query(
          `INSERT INTO messages (conversation_id, sender_id, body)
           VALUES ($1, $2, $3) RETURNING id, body, created_at`,
          [conv[0].id, req.user.id, req.body.texte]
        );

        // Une seule réponse automatique, uniquement à la toute première
        // prise de contact — pas à chaque message. Les échanges suivants
        // attendent une vraie réponse d'un conseiller (voir la
        // notification au gestionnaire, gérée séparément).
        if (estNouvelle) {
          const { rows: conseiller } = await client.query(
            `SELECT id FROM users WHERE role = 'operateur' AND status = 'actif'
             ORDER BY created_at LIMIT 1`
          );
          if (conseiller[0]) {
            await client.query(
              `UPDATE conversations SET advisor_id = $2 WHERE id = $1`,
              [conv[0].id, conseiller[0].id]
            );
            await client.query(
              `INSERT INTO messages (conversation_id, sender_id, body)
               VALUES ($1, $2, $3)`,
              [
                conv[0].id, conseiller[0].id,
                'Merci pour votre message, un conseiller CPG vous répondra rapidement.',
              ]
            );
          }
        }

        return rows[0];
      });

      res.status(201).json(message);
    } catch (error) {
      next(error);
    }
  }
);

/* ═══════════════════════════════════════════════════════════════════
   APPAREILS — enregistrement du token push
   ═══════════════════════════════════════════════════════════════════ */

const deviceSchema = z.object({
  pushToken: z.string().min(10).max(200),
  plateforme: z.enum(['ios', 'android']),
});

router.post(
  '/appareils',
  requirePermission('appareils.enregistrer'),
  validate(deviceSchema),
  async (req, res, next) => {
    try {
      // ON CONFLICT : un téléphone qui se reconnecte met à jour sa ligne
      // au lieu d'en créer une nouvelle, sinon chaque alerte arrive en
      // double sur le même appareil.
      await query(
        `INSERT INTO devices (user_id, push_token, platform, last_seen_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (user_id, push_token)
         DO UPDATE SET last_seen_at = now(), platform = EXCLUDED.platform`,
        [req.user.id, req.body.pushToken, req.body.plateforme]
      );

      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }
);

router.delete('/appareils/:token', async (req, res, next) => {
  try {
    await query('DELETE FROM devices WHERE user_id = $1 AND push_token = $2', [
      req.user.id,
      req.params.token,
    ]);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

/** GET /client/notifications — historique des alertes reçues */
router.get('/notifications', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, type, title, body, data, read_at, created_at
       FROM notifications WHERE user_id = $1
       ORDER BY created_at DESC LIMIT 50`,
      [req.user.id]
    );
    res.json({ notifications: rows });
  } catch (error) {
    next(error);
  }
});

export default router;
