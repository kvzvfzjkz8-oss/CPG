import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db/index.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ApiError } from '../middleware/errorHandler.js';
import { notifyUser } from '../services/pushService.js';
import { audit } from '../services/auditService.js';

/**
 * ═══════════════════════════════════════════════════════════════════
 *  LA CAISSE — retraits guichet et réapprovisionnement
 * ═══════════════════════════════════════════════════════════════════
 *
 * La caissière ne débite jamais un compte de sa seule initiative :
 * elle DÉPOSE une demande (retrait client ou réappro de sa caisse), le
 * directeur VALIDE ou REJETTE. L'argent ne bouge — chez le client
 * comme dans la caisse elle-même — qu'au moment de la validation.
 * Même principe que le circuit des crédits : jamais de guichet qui
 * agit seul sur de l'argent réel.
 */

const router = Router();
router.use(requireAuth);

/** GET /caisse/rechercher-client?q=... — nom ou numéro de compte. */
router.get(
  '/rechercher-client',
  requirePermission('caisse.consulter_solde_client'),
  async (req, res, next) => {
    try {
      const q = String(req.query.q ?? '').trim();
      if (q.length < 2) return res.json({ resultats: [] });

      const { rows } = await query(
        `SELECT u.id, u.full_name, u.client_number, u.phone, b.balance
         FROM users u
         JOIN accounts a ON a.user_id = u.id
         JOIN account_balances b ON b.account_id = a.id
         WHERE u.role = 'client'
           AND (u.full_name ILIKE $1 OR u.client_number ILIKE $1)
         ORDER BY u.full_name
         LIMIT 10`,
        [`%${q}%`]
      );
      res.json({ resultats: rows });
    } catch (error) {
      next(error);
    }
  }
);

/** GET /caisse/rib/:clientId — nom, numéro de compte, gestionnaire. */
router.get(
  '/rib/:clientId',
  requirePermission('caisse.imprimer_rib'),
  async (req, res, next) => {
    try {
      const { rows } = await query(
        `SELECT u.full_name, u.client_number, u.phone,
                g.full_name AS gestionnaire
         FROM users u
         LEFT JOIN users g ON g.id = u.created_by
         WHERE u.id = $1 AND u.role = 'client'`,
        [req.params.clientId]
      );
      if (!rows[0]) throw new ApiError(404, 'Client introuvable.');
      res.json(rows[0]);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * ── Caisse principale ────────────────────────────────────────────
 *
 * La réserve centrale de l'entreprise : le directeur l'alimente
 * (retrait bancaire apporté au bureau, apport personnel...), et c'est
 * elle seule qui finance les réapprovisionnements des caissières —
 * jamais d'argent créé de nulle part au moment d'un « appro ».
 */

/** GET /caisse/principale — solde et derniers mouvements. */
router.get(
  '/principale',
  requirePermission('caisse.gerer_principale'),
  async (req, res, next) => {
    try {
      const { rows: solde } = await query('SELECT solde FROM caisse_principale_solde');
      const { rows: mouvements } = await query(
        `SELECT m.id, m.type, m.montant, m.motif, m.created_at,
                c.full_name AS caissier
         FROM caisse_principale_mouvements m
         LEFT JOIN users c ON c.id = m.caissier_id
         ORDER BY m.created_at DESC
         LIMIT 50`
      );
      res.json({ solde: solde[0]?.solde ?? 0, mouvements });
    } catch (error) {
      next(error);
    }
  }
);

const alimentationSchema = z.object({
  montant: z.number().int().min(1000).max(50000000),
  motif: z.string().min(1).max(500),
});

/**
 * POST /caisse/principale/alimenter — le directeur y injecte des
 * fonds. Immédiat, sans étape de validation supplémentaire : c'est
 * déjà l'autorité qui valide tout le reste dans ce circuit, inutile
 * de lui faire approuver sa propre décision.
 */
router.post(
  '/principale/alimenter',
  requirePermission('caisse.gerer_principale'),
  validate(alimentationSchema),
  async (req, res, next) => {
    try {
      const { rows } = await query(
        `INSERT INTO caisse_principale_mouvements (type, montant, motif, cree_par)
         VALUES ('alimentation', $1, $2, $3)
         RETURNING id, montant, created_at`,
        [req.body.montant, req.body.motif, req.user.id]
      );

      await audit(req, {
        action: 'caisse.principale_alimentee',
        entityType: 'caisse_principale_mouvement',
        entityId: rows[0].id,
        metadata: { montant: req.body.montant },
      });

      res.status(201).json(rows[0]);
    } catch (error) {
      next(error);
    }
  }
);

/** GET /caisse/ma-caisse — solde courant + bilan du jour. */
router.get(
  '/ma-caisse',
  requirePermission('caisse.consulter_sa_caisse'),
  async (req, res, next) => {
    try {
      const { rows: solde } = await query(
        'SELECT solde FROM caisse_soldes WHERE caissier_id = $1',
        [req.user.id]
      );

      const { rows: bilanJour } = await query(
        `SELECT
           COALESCE(SUM(CASE WHEN type = 'retrait_client' THEN montant ELSE 0 END), 0)::BIGINT AS retraits,
           COALESCE(SUM(CASE WHEN type = 'depense' THEN montant ELSE 0 END), 0)::BIGINT AS depenses,
           COALESCE(SUM(CASE WHEN type = 'encaissement_client' THEN montant ELSE 0 END), 0)::BIGINT AS encaissements,
           count(*) FILTER (WHERE type IN ('retrait_client', 'depense'))::INT AS nombre_sorties
         FROM caisse_operations
         WHERE caissier_id = $1 AND statut = 'validee'
           AND decidee_le >= date_trunc('day', now())`,
        [req.user.id]
      );

      const { rows: enAttente } = await query(
        `SELECT count(*)::INT AS nombre FROM caisse_operations
         WHERE caissier_id = $1 AND statut = 'en_attente'`,
        [req.user.id]
      );

      res.json({
        solde: solde[0]?.solde ?? 0,
        bilanJour: bilanJour[0],
        demandesEnAttente: enAttente[0].nombre,
      });
    } catch (error) {
      next(error);
    }
  }
);

/** GET /caisse/mes-operations — historique de ses propres demandes. */
router.get(
  '/mes-operations',
  requirePermission('caisse.consulter_sa_caisse'),
  async (req, res, next) => {
    try {
      const { rows } = await query(
        `SELECT co.id, co.type, co.montant, co.statut, co.motif, co.motif_rejet,
                co.demandee_le, co.decidee_le,
                cl.full_name AS client, cl.client_number
         FROM caisse_operations co
         LEFT JOIN users cl ON cl.id = co.client_id
         WHERE co.caissier_id = $1
         ORDER BY co.demandee_le DESC
         LIMIT 100`,
        [req.user.id]
      );
      res.json({ operations: rows });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * ── Clôture quotidienne ──────────────────────────────────────────
 *
 * Chaque caisse a un montant de base : 200 000 FCFA. Rien n'empêche
 * une caissière de demander un appro important en cours de journée
 * pour payer un crédit, un salaire ou une prestation — cette règle ne
 * s'applique qu'à la clôture de fin de journée : au-delà de 200 000
 * FCFA restants, l'excédent doit repartir vers la caisse principale
 * avant que la journée puisse être close.
 */
const MONTANT_BASE_CAISSE = 200000;

/** GET /caisse/cloture-du-jour — a-t-elle déjà clôturé aujourd'hui ? */
router.get(
  '/cloture-du-jour',
  requirePermission('caisse.consulter_sa_caisse'),
  async (req, res, next) => {
    try {
      const { rows } = await query(
        `SELECT id, solde_avant, excedent_renvoye, cloturee_le
         FROM caisse_clotures
         WHERE caissier_id = $1 AND jour_cloture = (now() AT TIME ZONE 'UTC')::date`,
        [req.user.id]
      );
      res.json({ montantBase: MONTANT_BASE_CAISSE, cloture: rows[0] ?? null });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /caisse/clore — clôture la journée. Si le solde dépasse le
 * montant de base, renvoie automatiquement l'excédent vers la caisse
 * principale avant de clôturer. Une seule clôture par jour (contrainte
 * d'unicité en base) : la seconde tentative échoue proprement.
 */
router.post(
  '/clore',
  requirePermission('caisse.cloturer'),
  async (req, res, next) => {
    try {
      const result = await withTransaction(async (client) => {
        const { rows: solde } = await client.query(
          'SELECT solde FROM caisse_soldes WHERE caissier_id = $1',
          [req.user.id]
        );
        const soldeActuel = solde[0]?.solde ?? 0;
        const excedent = Math.max(0, soldeActuel - MONTANT_BASE_CAISSE);

        if (excedent > 0) {
          await client.query(
            `INSERT INTO caisse_operations (caissier_id, type, montant, motif, statut, decidee_le, decidee_par)
             VALUES ($1, 'retour_excedent', $2, 'Excédent renvoyé à la clôture', 'validee', now(), $1)`,
            [req.user.id, excedent]
          );
          await client.query(
            `INSERT INTO caisse_principale_mouvements (type, montant, caissier_id, motif, cree_par)
             VALUES ('alimentation', $1, $2, 'Excédent renvoyé — clôture de caisse', $2)`,
            [excedent, req.user.id]
          );
        }

        const { rows: cloture } = await client.query(
          `INSERT INTO caisse_clotures (caissier_id, solde_avant, excedent_renvoye)
           VALUES ($1, $2, $3)
           RETURNING id, solde_avant, excedent_renvoye, cloturee_le`,
          [req.user.id, soldeActuel, excedent]
        );

        return cloture[0];
      });

      await audit(req, {
        action: 'caisse.journee_cloturee',
        entityType: 'caisse_cloture',
        entityId: result.id,
        metadata: { excedent: result.excedent_renvoye },
      });

      res.status(201).json(result);
    } catch (error) {
      if (error.code === '23505') {
        return next(new ApiError(409, 'La caisse a déjà été clôturée aujourd\'hui.'));
      }
      next(error);
    }
  }
);

const retraitSchema = z
  .object({
    clientId: z.string().uuid(),
    montant: z.number().int().min(500).max(5000000),
    motif: z.string().max(500).optional(),
    modePaiement: z.enum(['especes', 'airtel', 'moov']).default('especes'),
    telephonePaiement: z.string().min(8).max(20).optional(),
  })
  .refine((b) => b.modePaiement === 'especes' || Boolean(b.telephonePaiement), {
    message: 'Le numéro de téléphone est requis pour un paiement Mobile Money.',
    path: ['telephonePaiement'],
  });

/** POST /caisse/retraits — dépose une demande de retrait guichet. */
router.post(
  '/retraits',
  requirePermission('caisse.demander_retrait'),
  validate(retraitSchema),
  async (req, res, next) => {
    try {
      const { rows: client } = await query(
        `SELECT b.balance FROM users u
         JOIN accounts a ON a.user_id = u.id
         JOIN account_balances b ON b.account_id = a.id
         WHERE u.id = $1 AND u.role = 'client'`,
        [req.body.clientId]
      );
      if (!client[0]) throw new ApiError(404, 'Client introuvable.');
      if (client[0].balance < req.body.montant) {
        throw new ApiError(422, 'Le solde du client est insuffisant pour ce retrait.');
      }

      const { rows } = await query(
        `INSERT INTO caisse_operations
           (caissier_id, type, montant, client_id, motif, mode_paiement, telephone_paiement)
         VALUES ($1, 'retrait_client', $2, $3, $4, $5, $6)
         RETURNING id, montant, statut, demandee_le, mode_paiement`,
        [
          req.user.id, req.body.montant, req.body.clientId, req.body.motif ?? null,
          req.body.modePaiement, req.body.telephonePaiement ?? null,
        ]
      );

      await audit(req, {
        action: 'caisse.retrait_demande',
        entityType: 'caisse_operation',
        entityId: rows[0].id,
        metadata: { montant: req.body.montant, clientId: req.body.clientId },
      });

      res.status(201).json(rows[0]);
    } catch (error) {
      next(error);
    }
  }
);

const depenseSchema = z.object({
  montant: z.number().int().min(500).max(2000000),
  motif: z.string().min(1).max(500),
});

/**
 * POST /caisse/depenses — sortie de fonds pour un besoin de
 * fonctionnement (pas un client) : fournitures, petite réparation...
 * Soumis à validation du directeur, exactement comme un retrait
 * client — c'est de l'argent qui sort réellement de la caisse.
 */
router.post(
  '/depenses',
  requirePermission('caisse.demander_depense'),
  validate(depenseSchema),
  async (req, res, next) => {
    try {
      const { rows } = await query(
        `INSERT INTO caisse_operations (caissier_id, type, montant, motif)
         VALUES ($1, 'depense', $2, $3)
         RETURNING id, montant, statut, demandee_le`,
        [req.user.id, req.body.montant, req.body.motif]
      );

      await audit(req, {
        action: 'caisse.depense_demandee',
        entityType: 'caisse_operation',
        entityId: rows[0].id,
        metadata: { montant: req.body.montant },
      });

      res.status(201).json(rows[0]);
    } catch (error) {
      next(error);
    }
  }
);

const encaissementSchema = z.object({
  clientId: z.string().uuid(),
  montant: z.number().int().min(500).max(5000000),
  motif: z.string().max(500).optional(),
});

/**
 * POST /caisse/encaissements — un client remet des espèces au
 * guichet pour les déposer sur son compte. S'applique immédiatement,
 * sans passer par le directeur : contrairement à une sortie de fonds,
 * le risque n'est pas le même (de l'argent qui rentre, adossé à des
 * espèces réellement en main) — faire attendre un dépôt client au
 * guichet n'aurait pas de sens en pratique.
 */
router.post(
  '/encaissements',
  requirePermission('caisse.encaisser_client'),
  validate(encaissementSchema),
  async (req, res, next) => {
    try {
      const result = await withTransaction(async (client) => {
        const { rows: compte } = await client.query(
          `SELECT a.id AS account_id FROM users u
           JOIN accounts a ON a.user_id = u.id
           WHERE u.id = $1 AND u.role = 'client'`,
          [req.body.clientId]
        );
        if (!compte[0]) throw new ApiError(404, 'Client introuvable.');

        const { rows: entry } = await client.query(
          `INSERT INTO ledger_entries (account_id, type, amount, label, reference, created_by)
           VALUES ($1, 'depot', $2, 'Dépôt guichet', $3, $4)
           RETURNING id`,
          [compte[0].account_id, req.body.montant, `CAISSE-ENC-${Date.now()}`, req.user.id]
        );

        const { rows: operation } = await client.query(
          `INSERT INTO caisse_operations
             (caissier_id, type, montant, client_id, motif, statut, decidee_le, decidee_par, ledger_entry_id)
           VALUES ($1, 'encaissement_client', $2, $3, $4, 'validee', now(), $1, $5)
           RETURNING id, montant, statut, demandee_le`,
          [req.user.id, req.body.montant, req.body.clientId, req.body.motif ?? null, entry[0].id]
        );

        return operation[0];
      });

      await audit(req, {
        action: 'caisse.encaissement_client',
        entityType: 'caisse_operation',
        entityId: result.id,
        metadata: { montant: req.body.montant, clientId: req.body.clientId },
      });

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }
);

const approSchema = z.object({
  montant: z.number().int().min(1000).max(20000000),
  motif: z.string().max(500).optional(),
});

/** POST /caisse/appro — demande de réapprovisionnement de sa caisse. */
router.post(
  '/appro',
  requirePermission('caisse.demander_appro'),
  validate(approSchema),
  async (req, res, next) => {
    try {
      const { rows } = await query(
        `INSERT INTO caisse_operations (caissier_id, type, montant, motif)
         VALUES ($1, 'appro', $2, $3)
         RETURNING id, montant, statut, demandee_le`,
        [req.user.id, req.body.montant, req.body.motif ?? null]
      );

      await audit(req, {
        action: 'caisse.appro_demandee',
        entityType: 'caisse_operation',
        entityId: rows[0].id,
        metadata: { montant: req.body.montant },
      });

      res.status(201).json(rows[0]);
    } catch (error) {
      next(error);
    }
  }
);

/* ═══════════════════════════════════════════════════════════════════
   CÔTÉ DIRECTEUR — validation
   ═══════════════════════════════════════════════════════════════════ */

/** GET /caisse/demandes-en-attente — toutes caissières confondues. */
router.get(
  '/demandes-en-attente',
  requirePermission('caisse.valider'),
  async (req, res, next) => {
    try {
      const { rows } = await query(
        `SELECT co.id, co.type, co.montant, co.motif, co.demandee_le,
                ca.full_name AS caissier,
                cl.full_name AS client, cl.client_number
         FROM caisse_operations co
         JOIN users ca ON ca.id = co.caissier_id
         LEFT JOIN users cl ON cl.id = co.client_id
         WHERE co.statut = 'en_attente'
         ORDER BY co.demandee_le ASC`
      );
      res.json({ demandes: rows });
    } catch (error) {
      next(error);
    }
  }
);

/** POST /caisse/operations/:id/valider — débite réellement si retrait. */
router.post(
  '/operations/:id/valider',
  requirePermission('caisse.valider'),
  async (req, res, next) => {
    try {
      const result = await withTransaction(async (client) => {
        const { rows } = await client.query(
          `SELECT * FROM caisse_operations WHERE id = $1 FOR UPDATE`,
          [req.params.id]
        );
        const operation = rows[0];
        if (!operation) throw new ApiError(404, 'Demande introuvable.');
        if (operation.statut !== 'en_attente') {
          throw new ApiError(409, 'Cette demande a déjà été traitée.');
        }

        let ledgerEntryId = null;

        if (operation.type === 'retrait_client') {
          const { rows: compte } = await client.query(
            `SELECT a.id AS account_id, b.balance FROM accounts a
             JOIN account_balances b ON b.account_id = a.id
             WHERE a.user_id = $1`,
            [operation.client_id]
          );
          if (!compte[0]) throw new ApiError(404, 'Compte du client introuvable.');
          if (compte[0].balance < operation.montant) {
            throw new ApiError(422, 'Le solde du client ne couvre plus ce retrait — à rejeter.');
          }

          const { rows: entry } = await client.query(
            `INSERT INTO ledger_entries (account_id, type, amount, label, reference, created_by)
             VALUES ($1, 'retrait', $2, 'Retrait guichet', $3, $4)
             RETURNING id`,
            [compte[0].account_id, -operation.montant, `CAISSE-${operation.id.slice(0, 8)}`, req.user.id]
          );
          ledgerEntryId = entry[0].id;

          // Le paiement peut se faire en espèces ou par Mobile Money
          // vers le numéro du client — dans les deux cas, sa caisse en
          // porte la responsabilité. Le débit du compte client est
          // déjà fait ci-dessus (immédiat, comme en espèces) : cette
          // transaction Mobile Money sert de trace du canal utilisé et
          // apparaît dans la supervision, sans attendre une
          // confirmation Airtel qui n'est pas encore branchée.
          if (operation.mode_paiement !== 'especes') {
            const reference = `TX-${Math.floor(1000 + Math.random() * 9000)}`;
            const { rows: momo } = await client.query(
              `INSERT INTO momo_transactions
                 (reference, user_id, account_id, operator, direction, amount, phone, status)
               VALUES ($1, $2, $3, $4, 'sortant', $5, $6, 'confirmee')
               RETURNING id`,
              [
                reference, operation.client_id, compte[0].account_id, operation.mode_paiement,
                operation.montant, operation.telephone_paiement,
              ]
            );
            await client.query('UPDATE caisse_operations SET momo_transaction_id = $2 WHERE id = $1', [
              operation.id, momo[0].id,
            ]);
          }
        }

        if (operation.type === 'appro') {
          // Impossible de transférer plus que ce que la caisse
          // principale contient réellement — sinon on créerait de
          // l'argent de nulle part.
          const { rows: principale } = await client.query(
            'SELECT solde FROM caisse_principale_solde'
          );
          const soldePrincipale = principale[0]?.solde ?? 0;
          if (soldePrincipale < operation.montant) {
            throw new ApiError(
              422,
              `La caisse principale ne contient que ${soldePrincipale} FCFA — insuffisant pour ce transfert de ${operation.montant} FCFA. Alimentez-la d'abord.`
            );
          }

          await client.query(
            `INSERT INTO caisse_principale_mouvements (type, montant, caissier_id, operation_id, cree_par)
             VALUES ('transfert_vers_caissiere', $1, $2, $3, $4)`,
            [operation.montant, operation.caissier_id, operation.id, req.user.id]
          );
        }

        const { rows: updated } = await client.query(
          `UPDATE caisse_operations
           SET statut = 'validee', decidee_le = now(), decidee_par = $2, ledger_entry_id = $3
           WHERE id = $1 RETURNING *`,
          [operation.id, req.user.id, ledgerEntryId]
        );

        return { operation: updated[0], clientId: operation.client_id, montant: operation.montant };
      });

      await audit(req, {
        action: 'caisse.operation_validee',
        entityType: 'caisse_operation',
        entityId: result.operation.id,
      });

      if (result.clientId) {
        // Une notification qui échoue ne doit jamais faire croire que
        // le retrait lui-même a échoué : l'argent a déjà bougé avant
        // ce point, c'est irréversible et réussi. On journalise sans
        // renvoyer d'erreur au directeur qui vient de valider.
        try {
          await notifyUser(result.clientId, 'retrait_caisse', { amount: result.montant });
        } catch (notifError) {
          req.log?.error({ err: notifError }, 'Notification retrait_caisse non envoyée');
        }
      }

      res.json(result.operation);
    } catch (error) {
      next(error);
    }
  }
);

/** POST /caisse/operations/:id/rejeter */
router.post(
  '/operations/:id/rejeter',
  requirePermission('caisse.valider'),
  validate(z.object({ motif: z.string().min(1).max(500) })),
  async (req, res, next) => {
    try {
      const { rows } = await query(
        `UPDATE caisse_operations
         SET statut = 'rejetee', decidee_le = now(), decidee_par = $2, motif_rejet = $3
         WHERE id = $1 AND statut = 'en_attente'
         RETURNING *`,
        [req.params.id, req.user.id, req.body.motif]
      );
      if (!rows[0]) throw new ApiError(404, 'Demande introuvable ou déjà traitée.');

      await audit(req, {
        action: 'caisse.operation_rejetee',
        entityType: 'caisse_operation',
        entityId: rows[0].id,
      });

      res.json(rows[0]);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
