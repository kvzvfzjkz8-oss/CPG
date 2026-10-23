import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { query } from '../db/index.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ApiError } from '../middleware/errorHandler.js';
import { audit } from '../services/auditService.js';
import {
  creditAgentSalaries, creditAgentSalariesFromCsv, previewAgentSalaries, previewAgentSalariesFromCsv,
  runInstallmentCollection, fetchMonthlyReport, fetchTransactions, reverseTransaction,
  cancelActiveCreditInError, suspendActiveCredit, reactivateSuspendedCredit,
  cancelCreditAwaitingDoubleValidation,
  proposeCreditDeletionRequest, fetchPendingCreditDeletionRequests, decideCreditDeletionRequest,
  fetchInstallmentsByCreditReference, proposeInstallmentAdjustment,
  fetchPendingInstallmentAdjustments, decideInstallmentAdjustment, fetchSchedulerStatus,
  fetchOverdueInstallments, fetchAccountBalances, zeroOutAccountBalances,
  fetchMonthInstallments, collectInstallments, fetchClientsDouteux,
} from '../services/operationsService.js';
import { previewFraisPonctuel } from '../services/feeService.js';
import {
  fetchRegleEnVigueur, fetchHistoriqueRegles, definirRegle, retirerRegle,
  calculerSolde, soldeParAnticipation,
} from '../services/remboursementAnticipeService.js';

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

      // Les frais de tenue ne suivent plus la paie.
      //
      // Ils se prélevaient autrefois dans la foulée de chaque import,
      // pour profiter de comptes approvisionnés. Mais une entreprise
      // peut verser plusieurs fois dans le mois, et chaque versement
      // relançait le prélèvement sur TOUS les clients : le 14/10/2026,
      // une paie d'un seul agent a fait payer 189 comptes une seconde
      // fois, 1 228 500 F.
      //
      // Décision de la direction : une seule date, le 25 de chaque
      // mois, quand les salaires sont arrivés (voir le planificateur).
      // Le directeur garde le bouton manuel pour un rattrapage.
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
 * ═══════════════════════════════════════════════════════════════════
 *  RETRAIT PONCTUEL SUR LE COMPTE D'UN CLIENT
 * ═══════════════════════════════════════════════════════════════════
 *
 * POST /admin/operations/retraits-ponctuels
 *
 * L'opérateur a parfois besoin de débiter un compte en dehors de tout
 * circuit prévu : récupérer un trop-perçu de paie, appliquer une
 * décision de la direction, ou faire remettre une somme au guichet.
 * Jusqu'ici cela ne se faisait que par intervention directe en base.
 *
 * Deux destinations, à préciser à chaque fois :
 *   • « cpg »    : la somme revient à l'entreprise et alimente la
 *                  caisse principale. Aucun guichet n'est impliqué.
 *   • « client » : la somme lui est remise en espèces. Il faut alors
 *                  désigner la caissière qui la servira, sinon son
 *                  tiroir se viderait sans qu'elle le sache.
 *
 * Le motif est obligatoire : les écritures « fonds non justifiés » de
 * septembre nous ont coûté des jours d'enquête faute d'avoir dit
 * pourquoi.
 *
 * L'opérateur DEMANDE seulement. Rien ne bouge avant la validation du
 * directeur — même règle que pour un retrait de caisse, et c'est lui
 * qui vérifie à ce moment-là que le solde du client y suffit.
 */
const retraitPonctuelSchema = z
  .object({
    clientId: z.string().uuid(),
    montant: z.coerce.number().int().min(500).max(5000000),
    motif: z.string().trim().min(5).max(500),
    destination: z.enum(['cpg', 'client']),
    caissierId: z.string().uuid().optional(),
  })
  .refine((b) => b.destination === 'cpg' || Boolean(b.caissierId), {
    message: 'Une remise au client doit désigner la caissière qui la servira.',
    path: ['caissierId'],
  })
  .refine((b) => b.destination === 'client' || !b.caissierId, {
    message: "Une récupération par CPG ne passe par aucun guichet : pas de caissière à désigner.",
    path: ['caissierId'],
  });

router.post(
  '/retraits-ponctuels',
  requirePermission('operations.demander_retrait_ponctuel'),
  validate(retraitPonctuelSchema),
  async (req, res, next) => {
    try {
      const { rows: client } = await query(
        `SELECT u.id, btrim(u.full_name) AS nom, COALESCE(b.balance, 0) AS solde
         FROM users u
         JOIN accounts a ON a.user_id = u.id
         LEFT JOIN account_balances b ON b.account_id = a.id
         WHERE u.id = $1 AND u.role = 'client' AND u.status <> 'supprime'`,
        [req.body.clientId]
      );
      if (!client[0]) throw new ApiError(404, 'Client introuvable.');

      // Refus a la demande si le solde n'y suffit pas : inutile de
      // faire remonter au directeur une operation qu'il devra rejeter.
      // Il revalidera de toute facon au moment de valider.
      if (Number(client[0].solde) < req.body.montant) {
        throw new ApiError(
          422,
          `Le solde de ${client[0].nom} est de ${Number(client[0].solde)} FCFA — insuffisant pour un retrait de ${req.body.montant} FCFA.`
        );
      }

      if (req.body.caissierId) {
        const { rows: caissier } = await query(
          `SELECT id FROM users WHERE id = $1 AND role = 'caissier' AND status = 'actif'`,
          [req.body.caissierId]
        );
        if (!caissier[0]) throw new ApiError(422, 'Caissière introuvable ou inactive.');
      }

      const { rows } = await query(
        `INSERT INTO caisse_operations
           (caissier_id, demandeur_id, type, montant, client_id, motif, destination)
         VALUES ($1, $2, 'retrait_ponctuel', $3, $4, $5, $6)
         RETURNING id, montant, statut, demandee_le, destination, motif`,
        [
          req.body.caissierId ?? null, req.user.id, req.body.montant,
          req.body.clientId, req.body.motif, req.body.destination,
        ]
      );

      await audit(req, {
        action: 'operations.retrait_ponctuel_demande',
        entityType: 'caisse_operation',
        entityId: rows[0].id,
        metadata: {
          client: client[0].nom, montant: req.body.montant,
          destination: req.body.destination, motif: req.body.motif,
        },
      });

      res.status(201).json({ ...rows[0], client: client[0].nom, soldeClient: Number(client[0].solde) });
    } catch (error) {
      next(error);
    }
  }
);

/* ═══════════════════════════════════════════════════════════════════
   REMBOURSEMENT ANTICIPÉ D'UN CRÉDIT
   ═══════════════════════════════════════════════════════════════════

   Solder un crédit avant son terme. C'est utile seul — un agent qui
   veut solder avec son propre argent n'avait aucun moyen de le faire —
   et c'est la brique sur laquelle le rachat se posera.

   Le montant n'est JAMAIS saisi : il est calculé depuis la règle en
   vigueur. Et tant que la direction n'a pas posé cette règle, rien ne
   peut être soldé : le choix de la base engage l'établissement sur des
   années, le logiciel ne le prend pas à sa place. */

/** GET /admin/operations/remboursement-anticipe/regle — la règle en vigueur. */
router.get(
  '/remboursement-anticipe/regle',
  requirePermission('operations.lire'),
  async (req, res, next) => {
    try {
      const [regle, historique] = await Promise.all([
        fetchRegleEnVigueur(),
        fetchHistoriqueRegles(),
      ]);
      res.json({ regle, historique });
    } catch (error) {
      next(error);
    }
  }
);

/** PUT /admin/operations/remboursement-anticipe/regle — la direction la pose. */
router.put(
  '/remboursement-anticipe/regle',
  requirePermission('credits.definir_regle_remboursement_anticipe'),
  validate(z.object({
    // La formule de la direction : capital restant + part × intérêts
    // restants + pénalité × intérêt d'une mensualité. Les deux taux
    // sont des fractions (0,35 pour 35 %).
    partInteretsRestants: z.coerce.number().min(0).max(1),
    penaliteInteretMensualite: z.coerce.number().min(0).max(1).default(0),
    echeancesMinimum: z.coerce.number().int().min(0).max(60).default(1),
    note: z.string().trim().max(500).optional(),
  })),
  async (req, res, next) => {
    try {
      const regle = await definirRegle({ ...req.body, actorId: req.user.id });
      await audit(req, {
        action: 'credits.regle_remboursement_anticipe_definie',
        entityType: 'remboursement_anticipe_regle',
        entityId: regle.id,
        metadata: {
          partInteretsRestants: regle.part_interets_restants,
          penaliteInteretMensualite: regle.penalite_interet_mensualite,
          echeancesMinimum: regle.echeances_minimum,
        },
      });
      res.json(regle);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /admin/operations/remboursement-anticipe/regle — suspend les
 * remboursements anticipés.
 *
 * Fermer la porte est une décision en soi : la direction peut vouloir
 * revoir sa politique sans laisser courir la précédente. La règle
 * retirée reste dans l'historique.
 */
router.delete(
  '/remboursement-anticipe/regle',
  requirePermission('credits.definir_regle_remboursement_anticipe'),
  async (req, res, next) => {
    try {
      const retiree = await retirerRegle();
      await audit(req, {
        action: 'credits.regle_remboursement_anticipe_retiree',
        entityType: 'remboursement_anticipe_regle',
        entityId: retiree.id,
        metadata: { regle: retiree.id },
      });
      res.json({ retiree: true, ...retiree });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /admin/operations/credits/:id/solde-anticipe — ce qu'il faudrait
 * payer aujourd'hui, et le détail du calcul.
 *
 * Renvoie les DEUX bases, pas seulement celle retenue : on doit voir ce
 * qu'on réclame et ce à quoi on renonce. Aucune écriture.
 */
router.get(
  '/credits/:id/solde-anticipe',
  requirePermission('operations.lire'),
  async (req, res, next) => {
    try {
      res.json(await calculerSolde({ creditId: req.params.id }));
    } catch (error) {
      next(error);
    }
  }
);

/** POST /admin/operations/credits/:id/solder — exécute le solde anticipé. */
router.post(
  '/credits/:id/solder',
  requirePermission('credits.solder_par_anticipation'),
  async (req, res, next) => {
    try {
      const resultat = await soldeParAnticipation({
        creditId: req.params.id,
        actorId: req.user.id,
      });
      await audit(req, {
        action: 'credits.solde_par_anticipation',
        entityType: 'credit_request',
        entityId: req.params.id,
        metadata: {
          client: resultat.client,
          montant: resultat.montant,
          capitalRestant: resultat.capitalRestant,
          partInterets: resultat.partInterets,
          penalite: resultat.penalite,
          interetsAbandonnes: resultat.interetsAbandonnes,
          echeancesSoldees: resultat.echeancesSoldees,
        },
      });
      res.json(resultat);
    } catch (error) {
      next(error);
    }
  }
);

/* ═══════════════════════════════════════════════════════════════════
   FRAIS DE TENUE OU AGIOS PRÉLEVÉS PONCTUELLEMENT
   ═══════════════════════════════════════════════════════════════════

   Le prélèvement automatique passe le 25 de chaque mois. Il manque
   forcément les agents crédités après cette date, et ceux créés entre
   deux passages — la caisse l'a signalé plusieurs fois. L'opératrice
   doit pouvoir rattraper un compte, y compris sur un mois déjà écoulé.

   Trois choses qu'elle NE peut pas faire, par construction :

     • inventer un montant. Il vient du barème en vigueur, calculé par
       le même code que le prélèvement automatique.
     • prélever deux fois le même mois. Vérifié ici dès la demande, et
       re-vérifié en base à la validation (unicité de applied_fees).
     • prélever elle-même. La demande attend le directeur.

   Le solde, en revanche, n'est volontairement pas vérifié : un frais
   est dû dès qu'il est constaté, et c'est la seule dette autorisée à
   mettre un compte au rouge. */

const fraisPonctuelSchema = z.object({
  clientId: z.string().uuid(),
  nature: z.enum(['frais_tenue', 'agios']),
  // Le MOIS à rattraper, pas forcément le mois courant.
  periode: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'Format attendu : AAAA-MM')
    // On rattrape le passé, jamais l'avenir. Un frais de décembre
    // prélevé en octobre serait dû avant d'être exigible, et l'agio
    // d'un mois non écoulé se calculerait sur des jours qui n'ont pas
    // encore eu lieu.
    .refine((v) => v <= new Date().toISOString().slice(0, 7), {
      message: 'Ce mois n’est pas encore écoulé : un frais ne se prélève pas à l’avance.',
    }),
  motif: z.string().trim().min(5).max(500),
});

/** Le compte principal d'un client actif, avec son nom et son solde. */
async function compteDuClient(clientId) {
  const { rows } = await query(
    `SELECT u.id, btrim(u.full_name) AS nom, a.id AS account_id,
            COALESCE(b.balance, 0) AS solde
     FROM users u
     JOIN accounts a ON a.user_id = u.id
     LEFT JOIN account_balances b ON b.account_id = a.id
     WHERE u.id = $1 AND u.role = 'client' AND u.status <> 'supprime'
     ORDER BY a.created_at
     LIMIT 1`,
    [clientId]
  );
  if (!rows[0]) throw new ApiError(404, 'Client introuvable.');
  return rows[0];
}

/**
 * POST /admin/operations/frais-ponctuels/apercu — ce qui serait
 * prélevé, sans rien écrire. L'opératrice voit le montant du barème et
 * apprend tout de suite si le mois a déjà été réglé.
 */
router.post(
  '/frais-ponctuels/apercu',
  requirePermission('operations.demander_frais_ponctuel'),
  validate(fraisPonctuelSchema.omit({ motif: true })),
  async (req, res, next) => {
    try {
      const client = await compteDuClient(req.body.clientId);
      const apercu = await previewFraisPonctuel({
        accountId: client.account_id,
        nature: req.body.nature,
        periode: req.body.periode,
      });
      res.json({ ...apercu, client: client.nom, soldeClient: Number(client.solde) });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/frais-ponctuels',
  requirePermission('operations.demander_frais_ponctuel'),
  validate(fraisPonctuelSchema),
  async (req, res, next) => {
    try {
      const client = await compteDuClient(req.body.clientId);
      const apercu = await previewFraisPonctuel({
        accountId: client.account_id,
        nature: req.body.nature,
        periode: req.body.periode,
      });

      // Déjà réglé : on le dit maintenant, pas après un aller-retour
      // chez le directeur.
      if (apercu.dejaPreleve) {
        throw new ApiError(
          409,
          `${client.nom} a déjà été prélevé de ${apercu.dejaPreleve.montant} FCFA pour ${req.body.periode} — rien à rattraper.`
        );
      }
      if (apercu.montant <= 0) {
        throw new ApiError(
          422,
          req.body.nature === 'agios'
            ? `Aucun agio dû à ${client.nom} sur ${req.body.periode} : son compte n'est pas resté débiteur.`
            : 'Le barème donne un montant nul — rien à prélever.'
        );
      }

      // Une demande identique déjà en attente ferait prélever deux fois
      // si le directeur validait les deux.
      const { rows: enCours } = await query(
        `SELECT id FROM caisse_operations
         WHERE type = 'frais_ponctuel' AND statut = 'en_attente'
           AND client_id = $1 AND nature_frais = $2 AND periode_frais = $3::date`,
        [req.body.clientId, req.body.nature, apercu.periodStart]
      );
      if (enCours[0]) {
        throw new ApiError(
          409,
          `Une demande de ce frais pour ${req.body.periode} attend déjà la validation du directeur.`
        );
      }

      const { rows } = await query(
        `INSERT INTO caisse_operations
           (caissier_id, demandeur_id, type, montant, client_id, motif, destination,
            nature_frais, periode_frais)
         VALUES (NULL, $1, 'frais_ponctuel', $2, $3, $4, 'cpg', $5, $6::date)
         RETURNING id, montant, statut, demandee_le, motif, nature_frais, periode_frais`,
        [
          req.user.id, apercu.montant, req.body.clientId, req.body.motif,
          req.body.nature, apercu.periodStart,
        ]
      );

      await audit(req, {
        action: 'operations.frais_ponctuel_demande',
        entityType: 'caisse_operation',
        entityId: rows[0].id,
        metadata: {
          client: client.nom, nature: req.body.nature, periode: req.body.periode,
          montant: apercu.montant, motif: req.body.motif,
        },
      });

      res.status(201).json({
        ...rows[0],
        client: client.nom,
        soldeClient: Number(client.solde),
        bareme: apercu.bareme,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /admin/operations/caissieres — pour désigner qui servira une
 * remise au guichet. L'opérateur n'a pas accès au détail des caisses
 * (c'est une prérogative du directeur) : on ne renvoie que le nom,
 * juste de quoi remplir une liste déroulante.
 */
router.get(
  '/caissieres',
  requirePermission('operations.demander_retrait_ponctuel'),
  async (req, res, next) => {
    try {
      const { rows } = await query(
        `SELECT id, btrim(full_name) AS nom
         FROM users WHERE role = 'caissier' AND status = 'actif'
         ORDER BY full_name`
      );
      res.json({ caissieres: rows });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /admin/operations/clients/rechercher?q=... — aide à la saisie
 * manuelle d'une paie.
 *
 * Les noms de ce portefeuille s'écrivent de plusieurs façons d'un
 * document à l'autre — MOUNDELET/MOUDELET, TCHIBINDA/TCHIBINGA — et
 * l'opératrice tape celui que l'employeur lui a transmis. Plutôt que
 * de la laisser deviner, on lui propose les clients approchants : elle
 * choisit, et c'est le numéro client qui part dans la ligne de paie.
 * Un identifiant exact vaut mieux qu'un nom qu'il faudra rapprocher.
 *
 * Recherche volontairement indulgente (mêmes trigrammes qu'au
 * guichet), comptes supprimés exclus : créditer un doublon supprimé,
 * c'est payer dans le vide.
 */
router.get(
  '/clients/rechercher',
  requirePermission('operations.crediter_salaires'),
  async (req, res, next) => {
    try {
      const q = String(req.query.q ?? '').trim();
      if (q.length < 2) return res.json({ resultats: [] });

      const { rows } = await query(
        `SELECT u.id, btrim(u.full_name) AS nom, u.client_number, u.employer, u.phone,
                (u.full_name ILIKE $1 OR u.client_number ILIKE $1) AS exact
         FROM users u
         WHERE u.role = 'client'
           AND u.status <> 'supprime'
           AND (
             u.full_name ILIKE $1
             OR u.client_number ILIKE $1
             OR word_similarity(unaccent($2), unaccent(u.full_name)) > 0.45
           )
         ORDER BY exact DESC, word_similarity(unaccent($2), unaccent(u.full_name)) DESC, u.full_name
         LIMIT 8`,
        [`%${q}%`, q]
      );
      res.json({ resultats: rows });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /admin/operations/salaires/apercu-lignes — le meme aperçu, mais
 * pour une paie saisie à la main.
 *
 * Tous les employeurs n'envoient pas de fichier : il arrive qu'un agent
 * ait été oublié d'une liste, ou qu'une petite entreprise communique
 * deux ou trois montants par téléphone. L'opérateur devait jusqu'ici
 * fabriquer un CSV pour les saisir.
 *
 * La saisie manuelle passe par les mêmes deux temps que l'import : on
 * montre d'abord qui serait crédité et ce qui serait écarté, on
 * n'écrit qu'à la confirmation. Un virement de salaire mérite le même
 * filet qu'il vienne d'un fichier ou d'un clavier.
 */
router.post(
  '/salaires/apercu-lignes',
  requirePermission('operations.crediter_salaires'),
  validate(salarySchema),
  async (req, res, next) => {
    try {
      const preview = await previewAgentSalaries({
        entries: req.body.lignes,
        employeur: req.body.employeur,
        periode: req.body.periode,
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
   PRÉLÈVEMENTS DU MOIS — PILOTÉS PAR L'OPÉRATEUR
   ═══════════════════════════════════════════════════════════════════
   Le prélèvement global passe sur tout le monde d'un coup. Ces deux
   routes permettent à l'opérateur de cibler : voir qui est prélevable
   ce mois-ci (en cherchant par client ou par entreprise) et lancer les
   prélèvements au fur et à mesure que les salaires tombent. */

/** GET /admin/operations/echeances/du-mois — échéances à prélever ce mois-ci, filtrables. */
router.get(
  '/echeances/du-mois',
  requirePermission('operations.lire'),
  validate(z.object({
    recherche: z.string().max(100).optional(),
    asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }), 'query'),
  async (req, res, next) => {
    try {
      const result = await fetchMonthInstallments({
        recherche: req.query.recherche,
        asOf: req.query.asOf,
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

/** POST /admin/operations/echeances/prelever — prélève les échéances désignées. */
router.post(
  '/echeances/prelever',
  requirePermission('operations.executer_echeances'),
  validate(z.object({
    echeanceIds: z.array(z.string().uuid()).min(1).max(200),
  })),
  async (req, res, next) => {
    try {
      const result = await collectInstallments({
        echeanceIds: req.body.echeanceIds,
        actorId: req.user.id,
      });

      await audit(req, {
        action: 'operations.echeances_prelevees_ciblees',
        entityType: 'echeance',
        entityId: req.body.echeanceIds.length === 1 ? req.body.echeanceIds[0] : 'lot',
        metadata: {
          demandees: req.body.echeanceIds.length,
          prelevees: result.preleves.length,
          echecs: result.echecs.length,
          total: result.totalPreleve,
        },
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /admin/operations/clients-douteux — clients dont le compte est
 * négatif sans interruption depuis au moins 40 jours, soit plus d'un
 * cycle de paie. Leur paie ne les a pas régularisés : c'est le signal
 * que la direction veut voir remonter en premier.
 */
router.get(
  '/clients-douteux',
  requirePermission('demandes.lire'),
  validate(z.object({ jours: z.coerce.number().int().min(1).max(365).optional() }), 'query'),
  async (req, res, next) => {
    try {
      res.json(await fetchClientsDouteux({ jours: req.query.jours }));
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
 * POST /admin/operations/credits/:id/supprimer — supprime un crédit
 * actif créé en excès. Réservé au directeur seul.
 */
router.post(
  '/credits/:id/supprimer',
  requirePermission('credits.supprimer_actif'),
  validate(z.object({ motif: z.string().min(5).max(500) })),
  async (req, res, next) => {
    try {
      const result = await cancelActiveCreditInError({
        creditId: req.params.id,
        motif: req.body.motif,
        actorId: req.user.id,
      });

      await audit(req, {
        action: 'credit.annule_en_erreur',
        entityType: 'credit_request',
        entityId: result.creditId,
        metadata: { motif: req.body.motif, reference: result.reference },
      });

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /admin/operations/credits/:id/suspendre — met un crédit
 * suspect de côté, sans rien toucher financièrement. Réversible.
 * Gestionnaire ou directeur.
 */
router.post(
  '/credits/:id/suspendre',
  requirePermission('credits.suspendre'),
  validate(z.object({ motif: z.string().min(5).max(500) })),
  async (req, res, next) => {
    try {
      const result = await suspendActiveCredit({
        creditId: req.params.id,
        motif: req.body.motif,
        actorId: req.user.id,
      });

      await audit(req, {
        action: 'credit.suspendu',
        entityType: 'credit_request',
        entityId: result.id,
        metadata: { motif: req.body.motif, reference: result.reference },
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /admin/operations/credits/:id/reactiver — annule une
 * suspension, remet le crédit comme s'il n'avait jamais été suspendu.
 * Gestionnaire ou directeur.
 */
router.post(
  '/credits/:id/reactiver',
  requirePermission('credits.suspendre'),
  async (req, res, next) => {
    try {
      const result = await reactivateSuspendedCredit({ creditId: req.params.id });

      await audit(req, {
        action: 'credit.reactive',
        entityType: 'credit_request',
        entityId: result.id,
        metadata: { reference: result.reference },
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /admin/operations/credits/:id/supprimer-double-validation —
 * l'opérateur supprime un dossier qui lui arrive en double
 * validation. Rien n'est débloqué à ce stade, donc rien à extourner —
 * mais chaque suppression génère un rapport pour le directeur.
 */
router.post(
  '/credits/:id/supprimer-double-validation',
  requirePermission('credits.supprimer_double_validation'),
  validate(z.object({ motif: z.string().min(5).max(500) })),
  async (req, res, next) => {
    try {
      const result = await cancelCreditAwaitingDoubleValidation({
        creditId: req.params.id,
        motif: req.body.motif,
        actorId: req.user.id,
      });

      await audit(req, {
        action: 'credit.supprime_double_validation',
        entityType: 'credit_request',
        entityId: result.creditId,
        metadata: { motif: req.body.motif, reference: result.reference },
      });

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /admin/operations/credits/:id/proposer-suppression-double-validation
 * — l'opérateur propose la suppression d'un dossier en attente de
 * double validation ou d'approbation finale. Rien n'est supprimé tant
 * que le directeur n'a pas confirmé (voir
 * /suppressions-double-validation/:id/decider ci-dessous).
 */
router.post(
  '/credits/:id/proposer-suppression-double-validation',
  requirePermission('credits.proposer_suppression_double_validation'),
  validate(z.object({ motif: z.string().min(5).max(500) })),
  async (req, res, next) => {
    try {
      const result = await proposeCreditDeletionRequest({
        creditId: req.params.id,
        motif: req.body.motif,
        actorId: req.user.id,
      });

      await audit(req, {
        action: 'credit.suppression_double_validation_proposee',
        entityType: 'credit_request',
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
 * GET /admin/operations/suppressions-double-validation — demandes de
 * suppression de crédit en attente d'arbitrage du directeur.
 */
router.get(
  '/suppressions-double-validation',
  requirePermission('operations.lire'),
  async (req, res, next) => {
    try {
      const demandes = await fetchPendingCreditDeletionRequests();
      res.json({ demandes });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /admin/operations/suppressions-double-validation/:id/decider —
 * le directeur confirme (le dossier est réellement annulé, un rapport
 * est ajouté à la corbeille) ou rejette (rien ne change) une demande
 * de suppression posée par l'opérateur. Réservé au directeur — c'est
 * exactement ce qui a été demandé : la suppression doit être confirmée
 * par lui.
 */
router.post(
  '/suppressions-double-validation/:id/decider',
  requirePermission('credits.decider_suppression_double_validation'),
  validate(z.object({ approuver: z.boolean(), note: z.string().max(500).optional() })),
  async (req, res, next) => {
    try {
      const result = await decideCreditDeletionRequest({
        requestId: req.params.id,
        approve: req.body.approuver,
        note: req.body.note,
        actorId: req.user.id,
      });

      await audit(req, {
        action: 'credit.suppression_double_validation_decidee',
        entityType: 'credit_deletion_request',
        entityId: req.params.id,
        metadata: { approuver: req.body.approuver, note: req.body.note },
      });

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /admin/operations/echeances/en-retard — toutes les échéances
 * dépassées, tous clients confondus, pour la page principale de
 * l'opérateur : plus besoin de connaître une référence à l'avance
 * pour repérer et organiser les relances.
 */
router.get(
  '/echeances/en-retard',
  requirePermission('operations.lire'),
  async (req, res, next) => {
    try {
      const installments = await fetchOverdueInstallments();
      res.json({ installments });
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

/* ═══════════════════════════════════════════════════════════════════
   COMPTES CLIENTS — remise à zéro (directeur uniquement)
   ═══════════════════════════════════════════════════════════════════
   Les aggios quotidiens font dériver certains soldes, positifs comme
   négatifs. Le directeur filtre (par solde, par nom) puis choisit lui-
   même, compte par compte ou en groupe, lesquels remettre à 0 — jamais
   une remise à zéro globale et automatique. */

/**
 * GET /admin/operations/comptes — liste les comptes clients avec leur
 * solde courant, filtrable par signe du solde et par recherche nom/numéro.
 */
router.get(
  '/comptes',
  requirePermission('comptes.remettre_a_zero'),
  validate(
    z.object({
      recherche: z.string().max(120).optional(),
      solde: z.enum(['positif', 'negatif', 'non_nul']).optional(),
    }),
    'query'
  ),
  async (req, res, next) => {
    try {
      const comptes = await fetchAccountBalances({
        recherche: req.query.recherche,
        filtreSolde: req.query.solde,
      });
      res.json({ comptes });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /admin/operations/comptes/remettre-a-zero — remet à 0 le solde
 * des comptes sélectionnés (un ou plusieurs), via une écriture
 * d'ajustement compensatoire. Réservé au directeur.
 */
router.post(
  '/comptes/remettre-a-zero',
  requirePermission('comptes.remettre_a_zero'),
  validate(z.object({
    accountIds: z.array(z.string().uuid()).min(1),
    motif: z.string().min(5).max(500),
  })),
  async (req, res, next) => {
    try {
      const result = await zeroOutAccountBalances({
        accountIds: req.body.accountIds,
        motif: req.body.motif,
        actorId: req.user.id,
      });

      await audit(req, {
        action: 'comptes.remis_a_zero',
        entityType: 'account_balance',
        entityId: req.user.id,
        metadata: { motif: req.body.motif, comptesAjustes: result.comptesAjustes, comptesSelectionnes: result.comptesSelectionnes },
      });

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
