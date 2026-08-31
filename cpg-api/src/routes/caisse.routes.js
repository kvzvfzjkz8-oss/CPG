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
        `SELECT COALESCE(SUM(montant), 0)::BIGINT AS total, count(*)::INT AS nombre
         FROM caisse_operations
         WHERE caissier_id = $1 AND type = 'retrait_client' AND statut = 'validee'
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
        retraitsAujourdhui: bilanJour[0],
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

const retraitSchema = z.object({
  clientId: z.string().uuid(),
  montant: z.number().int().min(500).max(5000000),
  motif: z.string().max(500).optional(),
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
        `INSERT INTO caisse_operations (caissier_id, type, montant, client_id, motif)
         VALUES ($1, 'retrait_client', $2, $3, $4)
         RETURNING id, montant, statut, demandee_le`,
        [req.user.id, req.body.montant, req.body.clientId, req.body.motif ?? null]
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
