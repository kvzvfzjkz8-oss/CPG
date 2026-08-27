import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { audit } from '../services/auditService.js';
import {
  scheduleSession, cancelSession, fetchPlannedSession, depositToCommission,
  withdrawFromCommission, fetchCommissionQueue, holdSession, doubleValidateCredit,
  grantExceptionAuthorization, fetchUnusedExceptionAuthorizations,
  depositDifficultyCase, depositExceptionalRequest, withdrawCommissionItem, fetchCommissionItems,
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

/** GET /admin/commission/items/:sessionId — dossiers en difficulté et demandes exceptionnelles d'une séance. */
router.get(
  '/items/:sessionId',
  requirePermission('commission.lire'),
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
