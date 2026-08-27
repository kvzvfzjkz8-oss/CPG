import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/index.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ApiError } from '../middleware/errorHandler.js';
import { audit } from '../services/auditService.js';
import {
  listAllProducts, listActiveProducts, getProductHistory, createProduct,
  requestScaleChange, decideChangeRequest, setProductStatus, applyNewVersion,
} from '../services/productService.js';
import {
  listAllFees, listActiveFees, getFeeHistory, createFee,
  requestFeeScaleChange, applyFeeVersion, setFeeStatus, runAgiosBatch,
} from '../services/feeService.js';

const router = Router();
router.use(requireAuth);

/* ═══════════════════════════════════════════════════════════════════
   PRODUITS DE CRÉDIT
   ═══════════════════════════════════════════════════════════════════ */

const scaleSchema = z.object({
  monthlyRate: z.number().min(0).max(1),
  minAmount: z.number().int().positive(),
  maxAmount: z.number().int().positive(),
  minDuration: z.number().int().min(1).max(120),
  maxDuration: z.number().int().min(1).max(120),
  fileFeeFixed: z.number().int().min(0).default(0),
  fileFeeRate: z.number().min(0).max(1).default(0),
  latePenaltyRate: z.number().min(0).max(1).default(0),
});

/** GET /admin/catalogue/produits — catalogue complet, brouillons inclus */
router.get('/produits', requirePermission('catalogue.lire'), async (req, res, next) => {
  try {
    res.json({ produits: await listAllProducts() });
  } catch (error) {
    next(error);
  }
});

/** GET /admin/catalogue/produits/actifs — ce que voient les clients */
router.get('/produits/actifs', requirePermission('catalogue.lire_public'), async (req, res, next) => {
  try {
    res.json({ produits: await listActiveProducts() });
  } catch (error) {
    next(error);
  }
});

/** GET /admin/catalogue/produits/:id/historique — tous les barèmes passés */
router.get('/produits/:id/historique', requirePermission('catalogue.lire'), async (req, res, next) => {
  try {
    res.json({ versions: await getProductHistory(req.params.id) });
  } catch (error) {
    next(error);
  }
});

/** POST /admin/catalogue/produits — création par le gestionnaire */
const createProductSchema = z.object({
  code: z.string().regex(/^[A-Z0-9_]{3,30}$/, 'Code en majuscules, chiffres et tirets bas.'),
  nom: z.string().min(3).max(120),
  description: z.string().max(500).optional(),
  bareme: scaleSchema,
});

router.post(
  '/produits',
  requirePermission('catalogue.creer'),
  validate(createProductSchema),
  async (req, res, next) => {
    try {
      const result = await createProduct({
        code: req.body.code,
        name: req.body.nom,
        description: req.body.description,
        scale: req.body.bareme,
        actorId: req.user.id,
      });

      await audit(req, {
        action: 'catalogue.produit_cree',
        entityType: 'credit_product',
        entityId: result.product.id,
        metadata: { code: req.body.code, taux: req.body.bareme.monthlyRate },
      });

      res.status(201).json({
        ...result,
        message: 'Produit créé en brouillon. Il doit être activé par le directeur pour être proposé aux clients.',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /admin/catalogue/produits/:id/bareme — ajustement du taux
 *
 * Selon le rôle et l'ampleur du changement, le nouveau barème est
 * appliqué directement ou transformé en demande soumise au directeur.
 * La réponse indique lequel des deux, pour que l'interface puisse le
 * dire clairement au gestionnaire.
 */
router.put(
  '/produits/:id/bareme',
  requirePermission('catalogue.ajuster_dans_marge'),
  validate(z.object({ bareme: scaleSchema, motif: z.string().min(5).max(500) })),
  async (req, res, next) => {
    try {
      const result = await requestScaleChange({
        productId: req.params.id,
        scale: req.body.bareme,
        actor: req.user,
        reason: req.body.motif,
      });

      await audit(req, {
        action: result.statut === 'applique' ? 'catalogue.bareme_modifie' : 'catalogue.bareme_propose',
        entityType: 'credit_product',
        entityId: req.params.id,
        metadata: { nouveauTaux: req.body.bareme.monthlyRate, motif: req.body.motif },
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

/** PATCH /admin/catalogue/produits/:id/statut — activation, réservée au directeur */
router.patch(
  '/produits/:id/statut',
  requirePermission('catalogue.activer'),
  validate(z.object({ statut: z.enum(['brouillon', 'actif', 'suspendu', 'archive']) })),
  async (req, res, next) => {
    try {
      const product = await setProductStatus({
        productId: req.params.id,
        status: req.body.statut,
        actorId: req.user.id,
      });

      await audit(req, {
        action: 'catalogue.produit_statut',
        entityType: 'credit_product',
        entityId: product.id,
        metadata: { statut: req.body.statut },
      });

      res.json(product);
    } catch (error) {
      next(error);
    }
  }
);

/* ═══════════════════════════════════════════════════════════════════
   SERVICES ANNEXES ET AGIOS
   ═══════════════════════════════════════════════════════════════════ */

const feeScaleSchema = z.object({
  amount: z.number().int().min(0).default(0),
  rate: z.number().min(0).max(1).default(0),
  minAmount: z.number().int().min(0).default(0),
  maxAmount: z.number().int().min(0).nullable().default(null),
  exemptBelow: z.number().int().min(0).default(0),
});

router.get('/services', requirePermission('catalogue.lire'), async (req, res, next) => {
  try {
    res.json({ services: await listAllFees() });
  } catch (error) {
    next(error);
  }
});

router.get('/services/actifs', requirePermission('catalogue.lire_public'), async (req, res, next) => {
  try {
    res.json({ services: await listActiveFees() });
  } catch (error) {
    next(error);
  }
});

router.get('/services/:id/historique', requirePermission('catalogue.lire'), async (req, res, next) => {
  try {
    res.json({ versions: await getFeeHistory(req.params.id) });
  } catch (error) {
    next(error);
  }
});

const createFeeSchema = z.object({
  code: z.string().regex(/^[A-Z0-9_]{3,30}$/),
  nom: z.string().min(3).max(120),
  description: z.string().max(500).optional(),
  base: z.enum(['fixe', 'pourcentage', 'journalier_solde']),
  declencheur: z.enum([
    'retrait', 'depot', 'transfert_momo', 'tenue_compte',
    'solde_debiteur', 'retard_echeance', 'manuel',
  ]),
  bareme: feeScaleSchema,
});

router.post(
  '/services',
  requirePermission('catalogue.creer'),
  validate(createFeeSchema),
  async (req, res, next) => {
    try {
      // Cohérence base / déclencheur : des agios ne peuvent être que
      // journaliers, et un frais journalier ne s'applique qu'au solde.
      if (req.body.declencheur === 'solde_debiteur' && req.body.base !== 'journalier_solde') {
        throw new ApiError(422, 'Les agios sur solde débiteur doivent utiliser une base journalière.');
      }
      if (req.body.base === 'journalier_solde' && req.body.declencheur !== 'solde_debiteur') {
        throw new ApiError(422, 'Une base journalière ne s’applique qu’au solde débiteur.');
      }

      const result = await createFee({
        code: req.body.code,
        name: req.body.nom,
        description: req.body.description,
        basis: req.body.base,
        triggerOn: req.body.declencheur,
        scale: req.body.bareme,
        actorId: req.user.id,
      });

      await audit(req, {
        action: 'catalogue.service_cree',
        entityType: 'fee_definition',
        entityId: result.fee.id,
        metadata: { code: req.body.code, base: req.body.base },
      });

      res.status(201).json({
        ...result,
        message: 'Service créé en brouillon. Il doit être activé par le directeur.',
      });
    } catch (error) {
      next(error);
    }
  }
);

router.put(
  '/services/:id/bareme',
  requirePermission('catalogue.ajuster_dans_marge'),
  validate(z.object({ bareme: feeScaleSchema, motif: z.string().min(5).max(500) })),
  async (req, res, next) => {
    try {
      const result = await requestFeeScaleChange({
        feeId: req.params.id,
        scale: req.body.bareme,
        actor: req.user,
        reason: req.body.motif,
      });

      await audit(req, {
        action: result.statut === 'applique' ? 'catalogue.service_modifie' : 'catalogue.service_propose',
        entityType: 'fee_definition',
        entityId: req.params.id,
        metadata: { bareme: req.body.bareme, motif: req.body.motif },
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.patch(
  '/services/:id/statut',
  requirePermission('catalogue.activer'),
  validate(z.object({ statut: z.enum(['brouillon', 'actif', 'suspendu', 'archive']) })),
  async (req, res, next) => {
    try {
      const fee = await setFeeStatus({
        feeId: req.params.id,
        status: req.body.statut,
        actorId: req.user.id,
      });

      await audit(req, {
        action: 'catalogue.service_statut',
        entityType: 'fee_definition',
        entityId: fee.id,
        metadata: { statut: req.body.statut },
      });

      res.json(fee);
    } catch (error) {
      next(error);
    }
  }
);

/* ═══════════════════════════════════════════════════════════════════
   DEMANDES DE CHANGEMENT DE BARÈME — arbitrage du directeur
   ═══════════════════════════════════════════════════════════════════ */

router.get('/changements', requirePermission('catalogue.lire'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT r.id, r.target_type, r.target_id, r.payload, r.reason, r.status,
              r.requested_at, r.decided_at, r.decision_note,
              u.full_name AS demandeur, d.full_name AS decideur,
              COALESCE(p.name, f.name) AS cible
       FROM rate_change_requests r
       JOIN users u ON u.id = r.requested_by
       LEFT JOIN users d ON d.id = r.decided_by
       LEFT JOIN credit_products p ON p.id = r.target_id AND r.target_type = 'produit'
       LEFT JOIN fee_definitions f ON f.id = r.target_id AND r.target_type = 'service'
       ORDER BY r.requested_at DESC
       LIMIT 100`
    );
    res.json({ changements: rows });
  } catch (error) {
    next(error);
  }
});

router.post(
  '/changements/:id/decider',
  requirePermission('catalogue.decider_changement'),
  validate(z.object({ approuver: z.boolean(), note: z.string().max(500).optional() })),
  async (req, res, next) => {
    try {
      const decision = await decideChangeRequest({
        requestId: req.params.id,
        approve: req.body.approuver,
        actor: req.user,
        note: req.body.note,
      });

      // Approuvé : on applique enfin le barème proposé, en créant une
      // nouvelle version. C'est la décision du directeur qui déclenche
      // le changement, jamais la proposition seule.
      //
      // L'aiguillage selon le type de cible est indispensable : une
      // demande portant sur un service annexe ne doit pas être passée
      // au versionneur de produits de crédit, qui chercherait un
      // barème de crédit inexistant.
      if (decision.statut === 'approuve') {
        if (decision.targetType === 'produit') {
          await applyNewVersion({
            productId: decision.targetId,
            scale: decision.payload,
            actorId: req.user.id,
            approvedBy: req.user.id,
            note: req.body.note ?? 'Validé par la direction',
          });
        } else {
          await applyFeeVersion({
            feeId: decision.targetId,
            scale: decision.payload,
            actorId: req.user.id,
            approvedBy: req.user.id,
            note: req.body.note ?? 'Validé par la direction',
          });
        }
      }

      await audit(req, {
        action: req.body.approuver ? 'catalogue.changement_approuve' : 'catalogue.changement_rejete',
        entityType: 'rate_change_request',
        entityId: req.params.id,
        metadata: { note: req.body.note },
      });

      res.json(decision);
    } catch (error) {
      next(error);
    }
  }
);

/* ═══════════════════════════════════════════════════════════════════
   PLAFONDS RÉGLEMENTAIRES
   ═══════════════════════════════════════════════════════════════════ */

router.get('/plafonds', requirePermission('catalogue.lire'), async (req, res, next) => {
  try {
    const { rows } = await query('SELECT scope, max_rate, note, updated_at FROM rate_ceilings ORDER BY scope');
    res.json({ plafonds: rows });
  } catch (error) {
    next(error);
  }
});

router.put(
  '/plafonds/:scope',
  requirePermission('plafonds.gerer'),
  validate(z.object({ maxRate: z.number().min(0).max(1), note: z.string().max(500).optional() })),
  async (req, res, next) => {
    try {
      const { rows } = await query(
        `UPDATE rate_ceilings SET max_rate = $2, note = COALESCE($3, note), updated_by = $4, updated_at = now()
         WHERE scope = $1 RETURNING *`,
        [req.params.scope, req.body.maxRate, req.body.note ?? null, req.user.id]
      );
      if (!rows[0]) throw new ApiError(404, 'Plafond introuvable.');

      // Modifier un plafond réglementaire est la décision la plus
      // lourde du système : elle relâche le garde-fou de tout le reste.
      await audit(req, {
        action: 'plafond.modifie',
        entityType: 'rate_ceiling',
        entityId: req.params.scope,
        metadata: { nouveauPlafond: req.body.maxRate, note: req.body.note },
      });

      res.json(rows[0]);
    } catch (error) {
      next(error);
    }
  }
);

/* ═══════════════════════════════════════════════════════════════════
   PRÉLÈVEMENT DES AGIOS
   ═══════════════════════════════════════════════════════════════════ */

router.post(
  '/agios/executer',
  requirePermission('frais.appliquer'),
  validate(
    z.object({
      debut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      fin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
  ),
  async (req, res, next) => {
    try {
      const result = await runAgiosBatch({
        periodStart: req.body.debut,
        periodEnd: req.body.fin,
      });

      await audit(req, {
        action: 'agios.preleves',
        entityType: 'periode',
        entityId: `${req.body.debut}_${req.body.fin}`,
        metadata: { comptes: result.applied, total: result.total },
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.get('/frais-preleves', requirePermission('catalogue.lire'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT af.id, af.amount, af.basis_detail, af.period_start, af.period_end, af.created_at,
              f.name AS service, u.full_name AS client, u.client_number
       FROM applied_fees af
       JOIN fee_versions fv ON fv.id = af.fee_version_id
       JOIN fee_definitions f ON f.id = fv.fee_id
       JOIN accounts a ON a.id = af.account_id
       JOIN users u ON u.id = a.user_id
       ORDER BY af.created_at DESC LIMIT 200`
    );
    res.json({ frais: rows });
  } catch (error) {
    next(error);
  }
});

export default router;
