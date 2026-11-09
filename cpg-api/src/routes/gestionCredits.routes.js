import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../middleware/auth.js';
import { can } from '../utils/permissions.js';
import { ApiError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import { audit } from '../services/auditService.js';
import {
  proposerModification, donnerAccord, refuserModification,
  validerModification, listerModifications,
} from '../services/creditModificationService.js';

/**
 * ═══════════════════════════════════════════════════════════════════
 *  GESTION DES CRÉDITS — LES TROIS MAILLONS, UN PAR ROUTE
 * ═══════════════════════════════════════════════════════════════════
 *
 * Une route par étape, et une permission par route : le gestionnaire
 * propose, l'opérateur accorde, le directeur valide. Aucune route ne
 * permet de sauter une étape — c'est le service qui refuse, et la base
 * derrière lui (migration 061).
 */
const router = Router();

const NATURES = ['dates_echeances', 'prelevement_supplementaire', 'report_echeance', 'taux', 'montant'];

/** GET /admin/gestion-credits — les demandes, filtrables par état. */
router.get(
  '/',
  requirePermission('credits.lire_modifications'),
  async (req, res, next) => {
    try {
      const demandes = await listerModifications({
        status: req.query.statut ?? null,
        creditId: req.query.creditId ?? null,
      });
      res.json({ demandes });
    } catch (error) {
      next(error);
    }
  }
);

/** POST /admin/gestion-credits — le gestionnaire dépose une demande. */
router.post(
  '/',
  requirePermission('credits.proposer_modification'),
  validate(z.object({
    creditId: z.string().uuid(),
    nature: z.enum(NATURES),
    motif: z.string().min(5).max(500),
    // Un seul des champs ci-dessous selon la nature ; le service
    // vérifie lequel et renvoie un message clair s'il manque.
    jour: z.number().int().min(1).max(28).optional(),
    installmentId: z.string().uuid().optional(),
    mois: z.number().int().min(1).max(3).optional(),
    tauxMensuel: z.number().positive().optional(),
    montantDepose: z.number().positive().optional(),
  })),
  async (req, res, next) => {
    try {
      const demande = await proposerModification({
        creditId: req.body.creditId,
        kind: req.body.nature,
        details: req.body,
        motif: req.body.motif,
        actorId: req.user.id,
      });

      await audit(req, {
        action: 'credits.modification_proposee',
        entityType: 'credit_modification_request',
        entityId: demande.id,
        metadata: { nature: req.body.nature, reference: demande.reference },
      });

      res.status(201).json(demande);
    } catch (error) {
      next(error);
    }
  }
);

/** POST /admin/gestion-credits/:id/accord — l'opérateur donne son accord. */
router.post(
  '/:id/accord',
  requirePermission('credits.accorder_modification'),
  validate(z.object({ note: z.string().max(500).optional() })),
  async (req, res, next) => {
    try {
      const r = await donnerAccord({
        requestId: req.params.id, note: req.body.note, actorId: req.user.id,
      });
      await audit(req, {
        action: 'credits.modification_accordee',
        entityType: 'credit_modification_request',
        entityId: r.id,
        metadata: { nature: r.kind },
      });
      res.json(r);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /admin/gestion-credits/:id/valider — le directeur valide, et
 * c'est seulement là que le dossier bouge.
 */
router.post(
  '/:id/valider',
  requirePermission('credits.decider_modification'),
  validate(z.object({ note: z.string().max(500).optional() })),
  async (req, res, next) => {
    try {
      const r = await validerModification({
        requestId: req.params.id, note: req.body.note, actorId: req.user.id,
      });
      await audit(req, {
        action: 'credits.modification_validee',
        entityType: 'credit_modification_request',
        entityId: r.id,
        metadata: { nature: r.kind, reference: r.reference, effet: r.effet },
      });
      res.json(r);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /admin/gestion-credits/:id/refuser — refus, à l'une ou l'autre
 * étape. Rien n'a bougé sur le dossier, il n'y a donc rien à défaire :
 * c'est tout l'intérêt de ne jamais appliquer avant la validation.
 */
router.post(
  '/:id/refuser',
  (req, _res, next) => {
    // Les deux maillons peuvent refuser : l'opérateur à son étape, le
    // directeur à la sienne. On accepte donc l'une ou l'autre
    // permission, plutôt que deux routes qui feraient la même chose.
    if (!req.user) return next(new ApiError(401, 'Authentification requise.'));
    if (can(req.user.role, 'credits.accorder_modification')
        || can(req.user.role, 'credits.decider_modification')) {
      return next();
    }
    return next(new ApiError(403, 'Votre poste ne donne pas accès à cette action.'));
  },
  validate(z.object({ note: z.string().min(5).max(500) })),
  async (req, res, next) => {
    try {
      const r = await refuserModification({
        requestId: req.params.id, note: req.body.note, actorId: req.user.id,
      });
      await audit(req, {
        action: 'credits.modification_refusee',
        entityType: 'credit_modification_request',
        entityId: r.id,
        metadata: { nature: r.kind },
      });
      res.json(r);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
