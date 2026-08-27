import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ApiError } from '../middleware/errorHandler.js';
import { audit } from '../services/auditService.js';
import {
  creditAgentSalaries, creditAgentSalariesFromCsv, previewAgentSalariesFromCsv,
  runInstallmentCollection, fetchMonthlyReport, fetchTransactions, reverseTransaction,
  fetchInstallmentsByCreditReference, proposeInstallmentAdjustment,
  fetchPendingInstallmentAdjustments, decideInstallmentAdjustment, fetchSchedulerStatus,
} from '../services/operationsService.js';

const router = Router();
router.use(requireAuth);

// Fichiers de paie en mémoire, jamais écrits sur disque : ils ne
// contiennent que des identifiants et des montants, traités puis
// jetés dans la foulée. 2 Mo suffisent largement à quelques milliers
// de lignes ; c'est aussi ce que valide déjà le schéma (max 2000 lignes).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

/* ═══════════════════════════════════════════════════════════════════
   PAIE DES AGENTS
   ═══════════════════════════════════════════════════════════════════ */

const salarySchema = z.object({
  employeur: z.string().min(2).max(120),
  periode: z.string().regex(/^\d{4}-\d{2}$/, 'Format attendu : AAAA-MM'),
  lignes: z
    .array(
      z.object({
        identifiant: z.string().min(4).max(30),
        montant: z.number().int().positive(),
      })
    )
    .min(1)
    .max(2000),
});

/** POST /admin/operations/salaires — crédite les comptes d'une liste d'agents. */
router.post(
  '/salaires',
  requirePermission('operations.crediter_salaires'),
  validate(salarySchema),
  async (req, res, next) => {
    try {
      const result = await creditAgentSalaries({
        entries: req.body.lignes,
        employeur: req.body.employeur,
        periode: req.body.periode,
        actorId: req.user.id,
      });

      await audit(req, {
        action: 'operations.salaires_credites',
        entityType: 'periode',
        entityId: result.reference,
        metadata: {
          employeur: req.body.employeur, periode: req.body.periode,
          credites: result.credited.length, total: result.total,
        },
      });

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /admin/operations/salaires/apercu — première étape du flux en
 * deux temps : montre ce que l'import ferait, sans rien écrire. Même
 * fichier, mêmes champs que /salaires/import ; seule la confirmation
 * (l'appel à /salaires ci-dessus, avec les lignes à créditer telles
 * que l'aperçu les a résolues) écrit réellement.
 */
router.post(
  '/salaires/apercu',
  requirePermission('operations.crediter_salaires'),
  upload.single('fichier'),
  async (req, res, next) => {
    try {
      if (!req.file) throw new ApiError(422, 'Aucun fichier reçu (champ « fichier » attendu).');

      const { employeur, periode } = z
        .object({
          employeur: z.string().min(2).max(120),
          periode: z.string().regex(/^\d{4}-\d{2}$/, 'Format attendu : AAAA-MM'),
        })
        .parse(req.body);

      const preview = await previewAgentSalariesFromCsv({
        csvText: req.file.buffer.toString('utf8'),
        employeur, periode,
      });

      res.json(preview);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /admin/operations/salaires/import — chemin direct (import et
 * crédit en un seul appel), conservé pour un usage scripté ou un cas
 * où l'aperçu a déjà été validé côté opérateur par un autre moyen.
 * L'écran d'import du back-office utilise /apercu puis /salaires.
 */
router.post(
  '/salaires/import',
  requirePermission('operations.crediter_salaires'),
  upload.single('fichier'),
  async (req, res, next) => {
    try {
      if (!req.file) throw new ApiError(422, 'Aucun fichier reçu (champ « fichier » attendu).');

      const { employeur, periode } = z
        .object({
          employeur: z.string().min(2).max(120),
          periode: z.string().regex(/^\d{4}-\d{2}$/, 'Format attendu : AAAA-MM'),
        })
        .parse(req.body);

      const result = await creditAgentSalariesFromCsv({
        csvText: req.file.buffer.toString('utf8'),
        employeur, periode, actorId: req.user.id,
      });

      await audit(req, {
        action: 'operations.salaires_credites',
        entityType: 'periode',
        entityId: result.reference,
        metadata: {
          employeur, periode, fichier: req.file.originalname,
          credites: result.credited.length, total: result.total,
          lignesInvalides: result.lignesInvalides.length,
        },
      });

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }
);

/* ═══════════════════════════════════════════════════════════════════
   PRÉLÈVEMENT DES ÉCHÉANCES DE CRÉDIT
   ═══════════════════════════════════════════════════════════════════ */

/** POST /admin/operations/echeances/executer — prélève les échéances arrivées à terme. */
router.post(
  '/echeances/executer',
  requirePermission('operations.executer_echeances'),
  validate(z.object({ asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })),
  async (req, res, next) => {
    try {
      const result = await runInstallmentCollection({
        asOf: req.body.asOf,
        actorId: req.user.id,
      });

      await audit(req, {
        action: 'operations.echeances_prelevees',
        entityType: 'periode',
        entityId: req.body.asOf ?? new Date().toISOString().slice(0, 10),
        metadata: {
          verifiees: result.checked, payees: result.paid.length,
          retards: result.late.length, total: result.totalCollected,
        },
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

/* ═══════════════════════════════════════════════════════════════════
   RELEVÉ DE CONTRÔLE MENSUEL
   ═══════════════════════════════════════════════════════════════════ */

/** GET /admin/operations/planificateur — dernière exécution des tâches automatiques. */
router.get(
  '/planificateur',
  requirePermission('operations.lire'),
  async (req, res, next) => {
    try {
      const statut = await fetchSchedulerStatus();
      res.json(statut);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /admin/operations/releve — vérifie que tout a bien été prélevé sur la période.
 */
router.get(
  '/releve',
  requirePermission('operations.lire'),
  validate(
    z.object({
      debut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      fin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }),
    'query'
  ),
  async (req, res, next) => {
    try {
      const report = await fetchMonthlyReport({
        periodStart: req.query.debut,
        periodEnd: req.query.fin,
      });
      res.json(report);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /admin/operations/transactions — détail des écritures sur la
 * période, pour la relecture manuelle. Complète /releve : les agrégats
 * disent combien, ceci dit lesquelles, avec de quoi les annuler.
 */
router.get(
  '/transactions',
  requirePermission('operations.lire'),
  validate(
    z.object({
      debut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      fin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      type: z
        .enum(['depot', 'retrait', 'paiement_credit', 'deblocage_credit', 'frais', 'ajustement', 'salaire', 'annulation'])
        .optional(),
    }),
    'query'
  ),
  async (req, res, next) => {
    try {
      const transactions = await fetchTransactions({
        periodStart: req.query.debut,
        periodEnd: req.query.fin,
        type: req.query.type,
      });
      res.json({ transactions });
    } catch (error) {
      next(error);
    }
  }
);

/* ═══════════════════════════════════════════════════════════════════
   CORRECTIONS — annulation de transaction, ajustement d'échéance
   ═══════════════════════════════════════════════════════════════════ */

/**
 * POST /admin/operations/transactions/:id/annuler — porte une écriture
 * inverse. Ne supprime ni ne modifie jamais l'écriture d'origine.
 */
router.post(
  '/transactions/:id/annuler',
  requirePermission('operations.annuler_transaction'),
  validate(z.object({ motif: z.string().min(5).max(500) })),
  async (req, res, next) => {
    try {
      const result = await reverseTransaction({
        ledgerEntryId: req.params.id,
        motif: req.body.motif,
        actorId: req.user.id,
      });

      await audit(req, {
        action: 'operations.transaction_annulee',
        entityType: 'ledger_entry',
        entityId: result.originalId,
        metadata: { motif: req.body.motif, montant: result.montantExtourne, type: result.originalType },
      });

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /admin/operations/echeances?reference=CPG-4400 — retrouve
 * l'échéancier d'un crédit par sa référence, pour cibler l'échéance à
 * corriger sans connaître son identifiant technique.
 */
router.get(
  '/echeances',
  requirePermission('operations.lire'),
  validate(z.object({ reference: z.string().min(3).max(30) }), 'query'),
  async (req, res, next) => {
    try {
      const result = await fetchInstallmentsByCreditReference(req.query.reference);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /admin/operations/echeances/:id/proposer-correction — l'opérateur
 * propose une nouvelle date. N'applique rien : ça attend la décision
 * du directeur.
 */
router.post(
  '/echeances/:id/proposer-correction',
  requirePermission('operations.modifier_echeance'),
  validate(z.object({
    nouvelleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    motif: z.string().min(5).max(500),
  })),
  async (req, res, next) => {
    try {
      const request = await proposeInstallmentAdjustment({
        installmentId: req.params.id,
        nouvelleDate: req.body.nouvelleDate,
        motif: req.body.motif,
        actorId: req.user.id,
      });

      await audit(req, {
        action: 'operations.correction_echeance_proposee',
        entityType: 'installment', entityId: req.params.id,
        metadata: { nouvelleDate: req.body.nouvelleDate, motif: req.body.motif },
      });

      res.status(201).json(request);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /admin/operations/corrections-echeances — demandes de correction
 * en attente d'arbitrage du directeur.
 */
router.get(
  '/corrections-echeances',
  requirePermission('operations.lire'),
  async (req, res, next) => {
    try {
      const demandes = await fetchPendingInstallmentAdjustments();
      res.json({ demandes });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /admin/operations/corrections-echeances/:id/decider — le
 * directeur approuve (la correction s'applique) ou rejette (rien ne
 * change). Réservé au directeur : c'est exactement ce qui a été
 * demandé — l'opérateur propose, il ne valide jamais lui-même.
 */
router.post(
  '/corrections-echeances/:id/decider',
  requirePermission('operations.decider_correction_echeance'),
  validate(z.object({ approuver: z.boolean(), note: z.string().max(500).optional() })),
  async (req, res, next) => {
    try {
      const result = await decideInstallmentAdjustment({
        requestId: req.params.id,
        approve: req.body.approuver,
        note: req.body.note,
        actorId: req.user.id,
      });

      await audit(req, {
        action: 'operations.correction_echeance_decidee',
        entityType: 'installment_adjustment_request', entityId: req.params.id,
        metadata: { approuver: req.body.approuver, note: req.body.note },
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
