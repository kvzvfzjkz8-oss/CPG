import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { audit } from '../services/auditService.js';
import {
  scheduleSession, cancelSession, rescheduleSession, fetchPlannedSession, depositToCommission,
  withdrawFromCommission, fetchCommissionQueue, holdSession, doubleValidateCredit,
  grantExceptionAuthorization, fetchUnusedExceptionAuthorizations,
  depositDifficultyCase, depositExceptionalRequest, withdrawCommissionItem, fetchCommissionItems,
  proposeCommissionItemDeletionRequest, fetchPendingCommissionItemDeletionRequests,
  decideCommissionItemDeletionRequest, cancelCommissionItemDirectly,
} from '../services/commissionService.js';

const router = Router();
router.use(requireAuth);

/* ═══════════════════════════════════════════════════════════════════
   SÉANCES DE COMMISSION
   ═══════════════════════════════════════════════════════════════════ */

/** GET /admin/commission/seance — la séance actuellement programmée, s'il y en a une. */
router.get('/seance', requirePermission('commission.lire'), async (req, res, next) => {
  try {
    const session = await fetchPlannedSession();
    res.json({ seance: session });
  } catch (error) {
    next(error);
  }
});

/** POST /admin/commission/seance — programme la prochaine commission. */
router.post(
  '/seance',
  requirePermission('commission.programmer'),
  validate(z.object({
    dateHeure: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, 'Format attendu : AAAA-MM-JJTHH:MM'),
  })),
  async (req, res, next) => {
    try {
      const session = await scheduleSession({ scheduledFor: req.body.dateHeure, actorId: req.user.id });
      await audit(req, { action: 'commission.programmee', entityType: 'commission_session', entityId: session.id });
      res.status(201).json(session);
    } catch (error) {
      next(error);
    }
  }
);

/** DELETE /admin/commission/seance/:id — annule une séance pas encore tenue. */
router.delete(
  '/seance/:id',
  requirePermission('commission.programmer'),
  async (req, res, next) => {
    try {
      const session = await cancelSession({ sessionId: req.params.id });
      await audit(req, { action: 'commission.annulee', entityType: 'commission_session', entityId: session.id });
      res.json(session);
    } catch (error) {
      next(error);
    }
  }
);

/** PATCH /admin/commission/seance/:id — change la date d'une séance déjà programmée. */
router.patch(
  '/seance/:id',
  requirePermission('commission.programmer'),
  validate(z.object({
    dateHeure: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, 'Format attendu : AAAA-MM-JJTHH:MM'),
  })),
  async (req, res, next) => {
    try {
      const session = await rescheduleSession({ sessionId: req.params.id, scheduledFor: req.body.dateHeure });
      await audit(req, { action: 'commission.reprogrammee', entityType: 'commission_session', entityId: session.id });
      res.json(session);
    } catch (error) {
      next(error);
    }
  }
);

/* ═══════════════════════════════════════════════════════════════════
   DÉPÔT DES DOSSIERS
   ═══════════════════════════════════════════════════════════════════ */

/** POST /admin/commission/credits/:id/deposer — dépose un dossier validé niveau 1 dans la file. */
router.post(
  '/credits/:id/deposer',
  requirePermission('commission.deposer'),
  validate(z.object({ note: z.string().max(1000).optional() })),
  async (req, res, next) => {
    try {
      const result = await depositToCommission({
        creditId: req.params.id, note: req.body.note, actorId: req.user.id,
      });
      await audit(req, {
        action: 'commission.dossier_depose', entityType: 'credit_request', entityId: result.id,
        metadata: { autorisationConsommee: result.authorizationConsumed },
      });
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }
);

/** POST /admin/commission/credits/:id/retirer — retire un dossier de la file avant la séance. */
router.post(
  '/credits/:id/retirer',
  requirePermission('commission.deposer'),
  async (req, res, next) => {
    try {
      const result = await withdrawFromCommission({ creditId: req.params.id });
      await audit(req, { action: 'commission.dossier_retire', entityType: 'credit_request', entityId: result.id });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

/** GET /admin/commission/file-attente/:sessionId — dossiers déposés pour une séance. */
router.get(
  '/file-attente/:sessionId',
  requirePermission('commission.lire'),
  validate(z.object({ sessionId: z.string().uuid() }), 'params'),
  async (req, res, next) => {
    try {
      const dossiers = await fetchCommissionQueue({ sessionId: req.params.sessionId });
      res.json({ dossiers });
    } catch (error) {
      next(error);
    }
  }
);

/* ═══════════════════════════════════════════════════════════════════
   DOSSIERS EN DIFFICULTÉ ET DEMANDES EXCEPTIONNELLES
   ═══════════════════════════════════════════════════════════════════
   « Cette commission statue sur tous les types de crédits. Dossiers
     en difficultés ou demande exceptionnelle, etc. »
   Même séance, même circuit de décision (holdSession) que les
   nouveaux crédits — seul le dépôt diffère dans sa nature. */

/** POST /admin/commission/credits/:id/deposer-difficulte — dépose un crédit actif en difficulté. */
router.post(
  '/credits/:id/deposer-difficulte',
  requirePermission('commission.deposer'),
  validate(z.object({ note: z.string().max(1000).optional() })),
  async (req, res, next) => {
    try {
      const result = await depositDifficultyCase({
        creditId: req.params.id, note: req.body.note, actorId: req.user.id,
      });
      await audit(req, {
        action: 'commission.difficulte_deposee', entityType: 'commission_item', entityId: result.id,
        metadata: { creditId: req.params.id },
      });
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }
);

/** POST /admin/commission/demandes-exceptionnelles — dépose une demande exceptionnelle. */
router.post(
  '/demandes-exceptionnelles',
  requirePermission('commission.deposer'),
  validate(z.object({
    clientId: z.string().uuid(),
    titre: z.string().min(3).max(200),
    note: z.string().max(1000).optional(),
  })),
  async (req, res, next) => {
    try {
      const result = await depositExceptionalRequest({
        clientId: req.body.clientId, titre: req.body.titre, note: req.body.note, actorId: req.user.id,
      });
      await audit(req, {
        action: 'commission.demande_exceptionnelle_deposee', entityType: 'commission_item', entityId: result.id,
        metadata: { titre: req.body.titre },
      });
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }
);

/** POST /admin/commission/items/:id/retirer — retire un point (difficulté ou demande) avant la séance. */
router.post(
  '/items/:id/retirer',
  requirePermission('commission.deposer'),
  async (req, res, next) => {
    try {
      const result = await withdrawCommissionItem({ itemId: req.params.id });
      await audit(req, { action: 'commission.item_retire', entityType: 'commission_item', entityId: result.id });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /admin/commission/items/:sessionId — dossiers en difficulté et
 * demandes exceptionnelles d'une séance.
 *
 * L'identifiant est validé ici : sans ce contrôle, une URL qui n'est
 * pas un UUID descend jusqu'à PostgreSQL et remonte en erreur 500
 * (« invalid input syntax for type uuid ») au lieu d'un refus propre.
 */
router.get(
  '/items/:sessionId',
  requirePermission('commission.lire'),
  validate(z.object({ sessionId: z.string().uuid() }), 'params'),
  async (req, res, next) => {
    try {
      const points = await fetchCommissionItems({ sessionId: req.params.sessionId });
      res.json({ points });
    } catch (error) {
      next(error);
    }
  }
);

/* ═══════════════════════════════════════════════════════════════════
   TENUE DE LA SÉANCE
   ═══════════════════════════════════════════════════════════════════ */

/** POST /admin/commission/seance/:id/tenir — enregistre les décisions et clôt la séance. */
router.post(
  '/seance/:id/tenir',
  requirePermission('commission.tenir'),
  validate(z.object({
    decisions: z.array(z.object({
      kind: z.enum(['credit', 'item']).optional(),
      creditId: z.string().uuid().optional(),
      itemId: z.string().uuid().optional(),
      decision: z.enum(['valide', 'rejete']),
      note: z.string().max(1000).optional(),
    }).refine((d) => d.creditId || d.itemId, {
      message: 'Chaque décision doit porter soit creditId, soit itemId.',
    })).min(1),
  })),
  async (req, res, next) => {
    try {
      const result = await holdSession({
        sessionId: req.params.id, decisions: req.body.decisions, actorId: req.user.id,
      });
      await audit(req, {
        action: 'commission.seance_tenue', entityType: 'commission_session', entityId: req.params.id,
        metadata: { dossiers: result.resultats.length },
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

/* ═══════════════════════════════════════════════════════════════════
   DOUBLE VALIDATION — OPÉRATEUR, APRÈS COMMISSION
   ═══════════════════════════════════════════════════════════════════ */

/** POST /admin/commission/credits/:id/valider-double — revalidation par l'opérateur après commission. */
router.post(
  '/credits/:id/valider-double',
  requirePermission('demandes.valider_double'),
  async (req, res, next) => {
    try {
      const result = await doubleValidateCredit({ creditId: req.params.id, actorId: req.user.id });
      await audit(req, { action: 'commission.double_validation', entityType: 'credit_request', entityId: result.id });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

/* Un point de l'ordre du jour (dossier en difficulté ou demande
   exceptionnelle) ne passe plus par la double validation : la décision
   du directeur en séance est définitive. Voir commissionService.js. */

/* ═══════════════════════════════════════════════════════════════════
   SUPPRESSION D'UN POINT EN DOUBLE VALIDATION — propose puis confirme
   ═══════════════════════════════════════════════════════════════════
   Même circuit que pour les crédits (voir operations.routes.js) :
   l'opérateur ne supprime jamais lui-même un dossier en difficulté ou
   une demande exceptionnelle arrivé en double validation — il propose,
   et seul le directeur confirme. */

/**
 * POST /admin/commission/items/:id/supprimer-double-validation — le
 * directeur supprime directement un point (difficulté/exceptionnel), à
 * n'importe quel stade de validation. Aucune confirmation requise :
 * c'est déjà le directeur qui agit.
 */
router.post(
  '/items/:id/supprimer-double-validation',
  requirePermission('commission.supprimer_double_validation'),
  validate(z.object({ motif: z.string().min(5).max(500) })),
  async (req, res, next) => {
    try {
      const result = await cancelCommissionItemDirectly({
        itemId: req.params.id,
        motif: req.body.motif,
        actorId: req.user.id,
      });

      await audit(req, {
        action: 'commission.item_supprime_double_validation',
        entityType: 'commission_item',
        entityId: req.params.id,
        metadata: { motif: req.body.motif },
      });

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /admin/commission/items/:id/proposer-suppression-double-validation
 * — l'opérateur propose la suppression d'un point en attente de double
 * validation. Rien n'est supprimé tant que le directeur n'a pas confirmé.
 */
router.post(
  '/items/:id/proposer-suppression-double-validation',
  requirePermission('commission.proposer_suppression_double_validation'),
  validate(z.object({ motif: z.string().min(5).max(500) })),
  async (req, res, next) => {
    try {
      const result = await proposeCommissionItemDeletionRequest({
        itemId: req.params.id,
        motif: req.body.motif,
        actorId: req.user.id,
      });

      await audit(req, {
        action: 'commission.item_suppression_double_validation_proposee',
        entityType: 'commission_item',
        entityId: req.params.id,
        metadata: { motif: req.body.motif },
      });

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /admin/commission/suppressions-double-validation-items — demandes
 * de suppression d'un point (difficulté / exceptionnelle) en attente
 * d'arbitrage du directeur. Doit précéder /items/:sessionId, mais comme
 * ce chemin est distinct (« suppressions-... » et non « items/... »),
 * aucune ambiguïté avec les routes /items/* ci-dessus.
 */
router.get(
  '/suppressions-double-validation-items',
  requirePermission('commission.lire'),
  async (req, res, next) => {
    try {
      const demandes = await fetchPendingCommissionItemDeletionRequests();
      res.json({ demandes });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /admin/commission/suppressions-double-validation-items/:id/decider
 * — le directeur confirme (le point est annulé, un rapport est ajouté à
 * la corbeille) ou rejette (rien ne change) une demande de suppression
 * posée par l'opérateur.
 */
router.post(
  '/suppressions-double-validation-items/:id/decider',
  requirePermission('commission.decider_suppression_double_validation'),
  validate(z.object({ approuver: z.boolean(), note: z.string().max(500).optional() })),
  async (req, res, next) => {
    try {
      const result = await decideCommissionItemDeletionRequest({
        requestId: req.params.id,
        approve: req.body.approuver,
        note: req.body.note,
        actorId: req.user.id,
      });

      await audit(req, {
        action: 'commission.item_suppression_double_validation_decidee',
        entityType: 'commission_item_deletion_request',
        entityId: req.params.id,
        metadata: { approuver: req.body.approuver, note: req.body.note },
      });

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }
);

/* ═══════════════════════════════════════════════════════════════════
   AUTORISATIONS D'EXCEPTION — DIRECTEUR
   ═══════════════════════════════════════════════════════════════════ */

/** POST /admin/commission/autorisations — le directeur autorise un second dossier pour un client déjà en crédit. */
router.post(
  '/autorisations',
  requirePermission('commission.autoriser_exception'),
  validate(z.object({ clientId: z.string().uuid(), motif: z.string().min(5).max(500) })),
  async (req, res, next) => {
    try {
      const authorization = await grantExceptionAuthorization({
        clientUserId: req.body.clientId, motif: req.body.motif, actorId: req.user.id,
      });
      await audit(req, {
        action: 'commission.autorisation_exception_accordee', entityType: 'user', entityId: req.body.clientId,
        metadata: { motif: req.body.motif },
      });
      res.status(201).json(authorization);
    } catch (error) {
      next(error);
    }
  }
);

/** GET /admin/commission/autorisations — autorisations d'exception non consommées. */
router.get(
  '/autorisations',
  requirePermission('commission.lire'),
  async (req, res, next) => {
    try {
      const autorisations = await fetchUnusedExceptionAuthorizations();
      res.json({ autorisations });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
