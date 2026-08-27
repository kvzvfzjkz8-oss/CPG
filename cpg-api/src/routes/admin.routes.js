import { Router } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { query, withTransaction } from '../db/index.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ApiError } from '../middleware/errorHandler.js';
import { computeSchedule, buildInstallments } from '../services/creditService.js';
import { notifyUser } from '../services/pushService.js';
import { audit } from '../services/auditService.js';

import catalogRoutes from './catalog.routes.js';
import operationsRoutes from './operations.routes.js';
import commissionRoutes from './commission.routes.js';

const router = Router();
router.use(requireAuth);

// Catalogue des produits de crédit, services annexes et agios.
router.use('/catalogue', catalogRoutes);

// Opérations mensuelles : paie des agents, échéances, relevé de contrôle.
router.use('/operations', operationsRoutes);

// Comité de crédit : programmation des séances, dépôt, décisions, double validation.
router.use('/commission', commissionRoutes);

/* ═══════════════════════════════════════════════════════════════════
   FILE DES DEMANDES — rôles Opérateur et Superviseur
   ═══════════════════════════════════════════════════════════════════ */

const listQuery = z.object({
  statut: z.enum([
    'en_verification', 'valide_niveau1', 'en_attente_commission',
    'valide_commission', 'valide_double', 'approuve', 'rejete',
  ]).optional(),
  limite: z.coerce.number().int().min(1).max(100).default(50),
});

router.get(
  '/credits',
  requirePermission('demandes.lire'),
  validate(listQuery, 'query'),
  async (req, res, next) => {
    try {
      const { statut, limite } = req.query;

      const { rows } = await query(
        `SELECT c.id, c.reference, c.amount, c.duration_months, c.status, c.created_at,
                c.level1_at, c.approved_at,
                u.full_name AS client, u.job_title, u.employer, u.client_number
         FROM credit_requests c
         JOIN users u ON u.id = c.user_id
         WHERE ($1::credit_status IS NULL OR c.status = $1)
         ORDER BY c.created_at DESC
         LIMIT $2`,
        [statut ?? null, limite]
      );

      res.json({ credits: rows });
    } catch (error) {
      next(error);
    }
  }
);

/** GET /admin/credits/:id — dossier complet avec pièces justificatives et échéancier */
router.get('/credits/:id', requirePermission('demandes.lire'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.*, u.full_name AS client, u.phone, u.job_title, u.employer, u.client_number
       FROM credit_requests c
       JOIN users u ON u.id = c.user_id
       WHERE c.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) throw new ApiError(404, 'Dossier introuvable.');

    const { rows: documents } = await query(
      'SELECT id, kind, status, verified_at FROM credit_documents WHERE credit_id = $1',
      [req.params.id]
    );

    // L'id de chaque échéance est indispensable ici : c'est par lui que
    // l'opérateur cible une échéance à corriger (PATCH /operations/echeances/:id)
    // ou une transaction liée à annuler.
    const { rows: installments } = await query(
      `SELECT id, sequence, due_date, original_due_date, amount, status, paid_at, ledger_entry_id
       FROM installments WHERE credit_id = $1 ORDER BY sequence`,
      [req.params.id]
    );

    // Consulter un dossier client est une action tracée : c'est ce qui
    // permet de détecter qu'un employé fouille des comptes sans motif.
    await audit(req, {
      action: 'credit.consultation',
      entityType: 'credit_request',
      entityId: req.params.id,
    });

    res.json({ credit: rows[0], documents, installments });
  } catch (error) {
    next(error);
  }
});

/* ── Validation de premier niveau — Opérateur ──────────────────────── */
router.post(
  '/credits/:id/valider-niveau1',
  requirePermission('demandes.valider_niveau1'),
  async (req, res, next) => {
    try {
      const { rows } = await query(
        `UPDATE credit_requests
         SET status = 'valide_niveau1', level1_by = $2, level1_at = now()
         WHERE id = $1 AND status = 'en_verification'
         RETURNING id, reference, status`,
        [req.params.id, req.user.id]
      );

      // Aucune ligne modifiée : le dossier a changé d'état entre-temps,
      // probablement traité par un collègue. On le dit plutôt que de
      // laisser croire à une réussite.
      if (!rows[0]) {
        throw new ApiError(409, 'Ce dossier a déjà été traité ou n’est plus en vérification.');
      }

      await audit(req, {
        action: 'credit.valide_niveau1',
        entityType: 'credit_request',
        entityId: rows[0].id,
      });

      res.json(rows[0]);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * ── Approbation finale — Directeur uniquement, débloque les fonds ──
 *
 * « L'opération de crédit sur les comptes se fait ensuite par une
 *   double validation de l'opérateur après commission et par
 *   l'approbation finale du Directeur. »
 * Cette route reste au même endroit, mais sa précondition a changé :
 * un dossier doit désormais avoir traversé tout le circuit — comité de
 * crédit puis double validation de l'opérateur — avant d'arriver ici.
 * Le directeur est seul à pouvoir la déclencher : ce n'est plus
 * partagé avec le gestionnaire comme avant l'introduction du comité.
 */
router.post(
  '/credits/:id/approuver',
  requirePermission('demandes.approuver_final'),
  async (req, res, next) => {
    try {
      const result = await withTransaction(async (client) => {
        const { rows } = await client.query(
          `SELECT * FROM credit_requests WHERE id = $1 FOR UPDATE`,
          [req.params.id]
        );
        const credit = rows[0];

        if (!credit) throw new ApiError(404, 'Dossier introuvable.');
        if (credit.status !== 'valide_double') {
          throw new ApiError(
            409,
            'Ce dossier doit d’abord passer en commission puis être revalidé par un opérateur avant l’approbation finale.'
          );
        }

        // Séparation des tâches : celui qui a validé au premier niveau
        // ne peut pas approuver seul. Deux paires d'yeux minimum sur
        // chaque décaissement.
        if (credit.level1_by === req.user.id) {
          throw new ApiError(
            403,
            'Vous avez validé ce dossier en premier niveau. Une personne différente doit en approuver l’octroi final.'
          );
        }
        if (credit.double_validated_by === req.user.id) {
          throw new ApiError(
            403,
            'Vous avez fait la double validation après commission. Une personne différente doit donner l’approbation finale.'
          );
        }

        const { monthlyPayment, totalDue } = computeSchedule(
          credit.amount,
          credit.duration_months,
          Number(credit.monthly_rate)
        );

        const { rows: updated } = await client.query(
          `UPDATE credit_requests
           SET status = 'approuve', approved_by = $2, approved_at = now(), monthly_payment = $3
           WHERE id = $1 RETURNING id, reference, amount, monthly_payment`,
          [credit.id, req.user.id, monthlyPayment]
        );

        const { rows: account } = await client.query(
          'SELECT id FROM accounts WHERE user_id = $1 ORDER BY created_at LIMIT 1',
          [credit.user_id]
        );
        if (!account[0]) throw new ApiError(422, 'Le client n’a pas de compte pour recevoir les fonds.');

        // Déblocage des fonds : écriture positive au journal.
        await client.query(
          `INSERT INTO ledger_entries (account_id, type, amount, label, reference, created_by)
           VALUES ($1, 'deblocage_credit', $2, $3, $4, $5)`,
          [account[0].id, credit.amount, `Déblocage crédit ${credit.reference}`, credit.reference, req.user.id]
        );

        // Génération de l'échéancier.
        const installments = buildInstallments(
          new Date(),
          credit.duration_months,
          monthlyPayment,
          totalDue
        );

        for (const inst of installments) {
          await client.query(
            `INSERT INTO installments (credit_id, sequence, due_date, amount)
             VALUES ($1, $2, $3, $4)`,
            [credit.id, inst.sequence, inst.dueDate, inst.amount]
          );
        }

        return { credit: updated[0], userId: credit.user_id };
      });

      await audit(req, {
        action: 'credit.approuve',
        entityType: 'credit_request',
        entityId: result.credit.id,
        metadata: { montant: result.credit.amount },
      });

      // La notification part après la transaction : si l'envoi échoue,
      // le crédit reste approuvé. L'inverse serait absurde.
      await notifyUser(result.userId, 'credit_approuve', {
        amount: result.credit.amount,
        reference: result.credit.reference,
      });

      res.json(result.credit);
    } catch (error) {
      next(error);
    }
  }
);

/* ── Rejet ─────────────────────────────────────────────────────────── */
router.post(
  '/credits/:id/rejeter',
  requirePermission('demandes.rejeter'),
  validate(z.object({ motif: z.string().max(500).optional() })),
  async (req, res, next) => {
    try {
      const { rows } = await query(
        `UPDATE credit_requests
         SET status = 'rejete', rejected_by = $2, rejected_at = now(), rejection_reason = $3
         WHERE id = $1 AND status IN ('en_verification', 'valide_niveau1')
         RETURNING id, reference, user_id`,
        [req.params.id, req.user.id, req.body.motif ?? null]
      );

      if (!rows[0]) throw new ApiError(409, 'Ce dossier a déjà été traité.');

      await audit(req, {
        action: 'credit.rejete',
        entityType: 'credit_request',
        entityId: rows[0].id,
        metadata: { motif: req.body.motif },
      });

      await notifyUser(rows[0].user_id, 'credit_rejete', {});

      res.json({ id: rows[0].id, reference: rows[0].reference, status: 'rejete' });
    } catch (error) {
      next(error);
    }
  }
);

/* ═══════════════════════════════════════════════════════════════════
   MESSAGERIE — Opérateur
   ═══════════════════════════════════════════════════════════════════ */

router.get('/conversations', requirePermission('messagerie.repondre'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.id, u.full_name AS client, u.client_number, c.last_message_at,
              (SELECT body FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS dernier_message,
              (SELECT count(*) FROM messages WHERE conversation_id = c.id AND read_at IS NULL AND sender_id = c.client_id) AS non_lus
       FROM conversations c
       JOIN users u ON u.id = c.client_id
       ORDER BY c.last_message_at DESC NULLS LAST
       LIMIT 100`
    );
    res.json({ conversations: rows });
  } catch (error) {
    next(error);
  }
});

/** GET /admin/conversations/:id/messages — historique complet d'une conversation. */
router.get(
  '/conversations/:id/messages',
  requirePermission('messagerie.repondre'),
  async (req, res, next) => {
    try {
      const { rows } = await query(
        `SELECT id, sender_id, body, created_at, read_at
         FROM messages WHERE conversation_id = $1
         ORDER BY created_at ASC`,
        [req.params.id]
      );
      res.json({ messages: rows });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/conversations/:id/messages',
  requirePermission('messagerie.repondre'),
  validate(z.object({ texte: z.string().min(1).max(4000) })),
  async (req, res, next) => {
    try {
      const result = await withTransaction(async (client) => {
        const { rows: conv } = await client.query(
          'SELECT client_id FROM conversations WHERE id = $1',
          [req.params.id]
        );
        if (!conv[0]) throw new ApiError(404, 'Conversation introuvable.');

        const { rows } = await client.query(
          `INSERT INTO messages (conversation_id, sender_id, body)
           VALUES ($1, $2, $3) RETURNING id, body, created_at`,
          [req.params.id, req.user.id, req.body.texte]
        );

        await client.query(
          'UPDATE conversations SET advisor_id = $2, last_message_at = now() WHERE id = $1',
          [req.params.id, req.user.id]
        );

        return { message: rows[0], clientId: conv[0].client_id };
      });

      await notifyUser(result.clientId, 'message_conseiller', {
        preview: req.body.texte.slice(0, 80),
      });

      res.status(201).json(result.message);
    } catch (error) {
      next(error);
    }
  }
);

/* ═══════════════════════════════════════════════════════════════════
   UTILISATEURS — Superviseur uniquement
   ═══════════════════════════════════════════════════════════════════ */

router.get('/utilisateurs', requirePermission('utilisateurs.gerer'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, full_name, phone, email, role, status, client_number, job_title, employer, created_at,
              (pin_hash IS NOT NULL AND role <> 'client') AS pin_backoffice_defini,
              pin_updated_at
       FROM users ORDER BY created_at DESC LIMIT 200`
    );
    res.json({ utilisateurs: rows });
  } catch (error) {
    next(error);
  }
});

const createUserSchema = z.object({
  nomComplet: z.string().min(2).max(120),
  telephone: z.string().min(8).max(20),
  email: z.string().email().optional(),
  role: z.enum(['client', 'operateur', 'superviseur']),
  motDePasse: z.string().min(12).optional(), // employés
  codePin: z.string().regex(/^\d{4,6}$/).optional(), // clients
  employeur: z.string().max(120).optional(),
  poste: z.string().max(120).optional(),
});

router.post(
  '/utilisateurs',
  requirePermission('utilisateurs.gerer'),
  validate(createUserSchema),
  async (req, res, next) => {
    try {
      const b = req.body;

      // Un compte client peut être créé sans PIN : le client
      // l'active alors lui-même depuis l'application, avec son
      // numéro de téléphone et son numéro client CPG (voir
      // POST /auth/activer-compte). Le gestionnaire peut aussi lui en
      // définir un directement s'il préfère.
      if (b.role !== 'client' && (!b.motDePasse || !b.email)) {
        throw new ApiError(422, 'Un email et un mot de passe sont requis pour un compte employé.');
      }

      const created = await withTransaction(async (client) => {
        const { rows } = await client.query(
          `INSERT INTO users (full_name, phone, email, role, employer, job_title, pin_hash, password_hash, client_number)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id, full_name, role, status, client_number`,
          [
            b.nomComplet,
            b.telephone,
            b.email?.toLowerCase() ?? null,
            b.role,
            b.employeur ?? null,
            b.poste ?? null,
            b.codePin ? await bcrypt.hash(b.codePin, 12) : null,
            b.motDePasse ? await bcrypt.hash(b.motDePasse, 12) : null,
            b.role === 'client' ? `CPG-${String(Math.floor(Math.random() * 90000) + 10000)}` : null,
          ]
        );

        // Un client sans compte ne peut rien faire : on le crée d'office.
        if (b.role === 'client') {
          await client.query('INSERT INTO accounts (user_id) VALUES ($1)', [rows[0].id]);
        }

        return rows[0];
      });

      await audit(req, {
        action: 'utilisateur.cree',
        entityType: 'user',
        entityId: created.id,
        metadata: { role: b.role },
      });

      res.status(201).json(created);
    } catch (error) {
      next(error);
    }
  }
);

router.patch(
  '/utilisateurs/:id/statut',
  requirePermission('utilisateurs.gerer'),
  validate(z.object({ statut: z.enum(['actif', 'suspendu', 'ferme']) })),
  async (req, res, next) => {
    try {
      // Se suspendre soi-même verrouillerait le back-office si c'est le
      // seul gestionnaire connecté.
      if (req.params.id === req.user.id) {
        throw new ApiError(400, 'Vous ne pouvez pas modifier votre propre statut.');
      }

      const { rows } = await query(
        'UPDATE users SET status = $2 WHERE id = $1 RETURNING id, full_name, status',
        [req.params.id, req.body.statut]
      );
      if (!rows[0]) throw new ApiError(404, 'Utilisateur introuvable.');

      // Un compte suspendu doit perdre ses sessions immédiatement, sinon
      // son jeton reste valide jusqu'à expiration.
      if (req.body.statut !== 'actif') {
        await query(
          'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
          [req.params.id]
        );
      }

      await audit(req, {
        action: 'utilisateur.statut_modifie',
        entityType: 'user',
        entityId: rows[0].id,
        metadata: { nouveauStatut: req.body.statut },
      });

      res.json(rows[0]);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /admin/utilisateurs/:id/pin — définit ou remplace le code PIN
 * back-office (8 chiffres) d'un employé. Réservé au directeur : « Seul
 * le Directeur pourra modifier, supprimer ou mettre à jour un pin. »
 * Un employé ne choisit jamais son propre code — ce n'est pas un
 * self-service, c'est une attribution.
 */
router.put(
  '/utilisateurs/:id/pin',
  requirePermission('utilisateurs.gerer_pin'),
  validate(z.object({ pin: z.string().regex(/^\d{8}$/, 'Le code PIN doit contenir exactement 8 chiffres.') })),
  async (req, res, next) => {
    try {
      const { rows: existing } = await query(
        `SELECT id, role FROM users WHERE id = $1`,
        [req.params.id]
      );
      if (!existing[0]) throw new ApiError(404, 'Utilisateur introuvable.');
      if (existing[0].role === 'client') {
        throw new ApiError(422, 'Le code PIN back-office ne concerne pas les comptes clients.');
      }

      const pinHash = await bcrypt.hash(req.body.pin, 12);
      const { rows } = await query(
        `UPDATE users
         SET pin_hash = $2, pin_updated_by = $3, pin_updated_at = now(),
             failed_attempts = 0, locked_until = NULL
         WHERE id = $1
         RETURNING id, full_name, role`,
        [req.params.id, pinHash, req.user.id]
      );

      // Un nouveau PIN doit invalider les sessions ouvertes avec
      // l'ancien : sinon un vol de session en cours survit au reset.
      await query(
        'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
        [req.params.id]
      );

      await audit(req, {
        action: 'utilisateur.pin_defini',
        entityType: 'user',
        entityId: rows[0].id,
      });

      res.json({ id: rows[0].id, fullName: rows[0].full_name, pinBackofficeDefini: true });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /admin/utilisateurs/:id/pin — retire le code PIN back-office
 * d'un employé (l'accès par mot de passe, s'il existe, reste inchangé).
 * Réservé au directeur, comme la définition et la mise à jour.
 */
router.delete(
  '/utilisateurs/:id/pin',
  requirePermission('utilisateurs.gerer_pin'),
  async (req, res, next) => {
    try {
      const { rows } = await query(
        `UPDATE users
         SET pin_hash = NULL, pin_updated_by = $2, pin_updated_at = now()
         WHERE id = $1 AND role <> 'client'
         RETURNING id, full_name`,
        [req.params.id, req.user.id]
      );
      if (!rows[0]) throw new ApiError(404, 'Utilisateur introuvable.');

      // Le PIN supprimé ne doit plus ouvrir de nouvelle session, mais
      // en plus il faut couper celles déjà ouvertes avec — sinon le
      // retrait reste cosmétique tant que le jeton n'a pas expiré.
      await query(
        'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
        [req.params.id]
      );

      await audit(req, {
        action: 'utilisateur.pin_supprime',
        entityType: 'user',
        entityId: rows[0].id,
      });

      res.json({ id: rows[0].id, fullName: rows[0].full_name, pinBackofficeDefini: false });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /admin/utilisateurs/:id/reinitialiser-pin-client — efface le PIN
 * d'un client qui l'a oublié, pour qu'il puisse en créer un nouveau
 * lui-même (voir POST /auth/activer-compte). Contrairement au PIN
 * back-office (réservé au directeur), c'est une opération courante de
 * gestion de compte client : la même permission que la création de
 * compte suffit — pas besoin du directeur pour ça.
 */
router.post(
  '/utilisateurs/:id/reinitialiser-pin-client',
  requirePermission('utilisateurs.gerer'),
  async (req, res, next) => {
    try {
      const { rows } = await query(
        `UPDATE users
         SET pin_hash = NULL
         WHERE id = $1 AND role = 'client'
         RETURNING id, full_name, client_number`,
        [req.params.id]
      );
      if (!rows[0]) throw new ApiError(404, 'Client introuvable.');

      await query(
        'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
        [req.params.id]
      );

      await audit(req, {
        action: 'utilisateur.pin_client_reinitialise',
        entityType: 'user',
        entityId: rows[0].id,
      });

      res.json({
        id: rows[0].id, fullName: rows[0].full_name, clientNumber: rows[0].client_number,
        pinDefini: false,
      });
    } catch (error) {
      next(error);
    }
  }
);

/* ═══════════════════════════════════════════════════════════════════
   SUPERVISION MOBILE MONEY
   ═══════════════════════════════════════════════════════════════════ */

router.get('/momo', requirePermission('momo.superviser'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT t.reference, t.operator, t.direction, t.amount, t.status,
              t.failure_reason, t.created_at, t.confirmed_at,
              u.full_name AS client, u.client_number
       FROM momo_transactions t
       JOIN users u ON u.id = t.user_id
       ORDER BY t.created_at DESC
       LIMIT 200`
    );
    res.json({ transactions: rows });
  } catch (error) {
    next(error);
  }
});

/* ═══════════════════════════════════════════════════════════════════
   STATISTIQUES
   ═══════════════════════════════════════════════════════════════════ */

router.get('/statistiques', requirePermission('statistiques.lire'), async (req, res, next) => {
  try {
    const [kpis, parMois, segments] = await Promise.all([
      query(`
        SELECT
          count(*) FILTER (WHERE status = 'approuve') AS credits_actifs,
          COALESCE(sum(amount) FILTER (WHERE status = 'approuve'), 0) AS encours_total,
          count(*) FILTER (WHERE status IN ('en_verification', 'valide_niveau1')) AS en_attente
        FROM credit_requests
      `),
      query(`
        SELECT to_char(date_trunc('month', approved_at), 'YYYY-MM') AS mois,
               count(*) AS credits
        FROM credit_requests
        WHERE status = 'approuve' AND approved_at > now() - interval '6 months'
        GROUP BY 1 ORDER BY 1
      `),
      query(`
        SELECT COALESCE(employer, 'Autres') AS segment, count(*) AS clients
        FROM users WHERE role = 'client'
        GROUP BY 1 ORDER BY 2 DESC LIMIT 6
      `),
    ]);

    const { rows: retards } = await query(`
      SELECT count(*) AS en_retard FROM installments
      WHERE status <> 'payee' AND due_date < CURRENT_DATE
    `);

    res.json({
      kpis: { ...kpis.rows[0], echeances_en_retard: Number(retards[0].en_retard) },
      creditsParMois: parMois.rows,
      segments: segments.rows,
    });
  } catch (error) {
    next(error);
  }
});

/* ═══════════════════════════════════════════════════════════════════
   JOURNAL D'AUDIT — consultation seule, jamais de suppression
   ═══════════════════════════════════════════════════════════════════ */

router.get('/audit', requirePermission('audit.lire'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT a.id, a.action, a.entity_type, a.entity_id, a.metadata, a.ip_address, a.created_at,
              u.full_name AS acteur, a.actor_role
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.actor_id
       ORDER BY a.created_at DESC
       LIMIT 200`
    );
    res.json({ entrees: rows });
  } catch (error) {
    next(error);
  }
});

export default router;
