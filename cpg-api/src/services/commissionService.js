import { query, withTransaction } from '../db/index.js';
import { ApiError } from '../middleware/errorHandler.js';
import { validateAgainstScale } from '../utils/rateVersioning.js';
import { computeSchedule, computeFileFee, DEFAULT_MONTHLY_RATE } from './creditService.js';

/**
 * ═══════════════════════════════════════════════════════════════════
 *  COMITÉ DE CRÉDIT ("COMMISSION")
 * ═══════════════════════════════════════════════════════════════════
 *
 * Tous les dossiers validés en premier niveau doivent passer devant le
 * comité avant tout octroi. Circuit complet :
 *
 *   en_verification → (opérateur) valide_niveau1
 *     → (gestionnaire dépose + annote) en_attente_commission
 *     → (séance tenue, décision par dossier) valide_commission | rejete
 *     → (opérateur, double validation) valide_double
 *     → (directeur, approbation finale — route existante /approuver) approuve
 *
 * Le gestionnaire programme les séances (une seule à la fois — voir
 * l'index unique en base) et dépose les dossiers prêts ; le comité
 * tranche en séance ; l'opérateur revalide après coup ; le directeur
 * seul déclenche l'octroi effectif des fonds.
 */

/**
 * Programme une nouvelle séance. Une seule séance « planifiee » peut
 * exister à la fois (contrainte en base) : il faut tenir ou annuler la
 * séance en cours avant d'en programmer une autre — ça force la
 * cadence hebdomadaire plutôt que de laisser s'empiler des séances
 * fantômes jamais tenues.
 */
export async function scheduleSession({ scheduledFor, actorId, plafond = null }) {
  try {
    const { rows } = await query(
      // Le plafond peut être posé dès la programmation quand c'est le
      // directeur qui programme ; sinon il le fixera après, et la
      // séance reste sans enveloppe en attendant.
      `INSERT INTO commission_sessions (scheduled_for, scheduled_by, plafond, plafond_par, plafond_le)
       VALUES ($1, $2, $3, CASE WHEN $3::bigint IS NULL THEN NULL ELSE $2::uuid END,
               CASE WHEN $3::bigint IS NULL THEN NULL ELSE now() END)
       RETURNING id, scheduled_for, status, scheduled_by, plafond`,
      [scheduledFor, actorId, plafond]
    );
    return rows[0];
  } catch (error) {
    if (error.code === '23505') {
      throw new ApiError(
        409,
        'Une commission est déjà programmée. Tenez-la ou annulez-la avant d’en programmer une nouvelle.'
      );
    }
    throw error;
  }
}

/** Annule une séance programmée (pas encore tenue) — libère le créneau pour en reprogrammer une autre. */
export async function cancelSession({ sessionId }) {
  const { rows } = await query(
    `UPDATE commission_sessions SET status = 'annulee'
     WHERE id = $1 AND status = 'planifiee'
     RETURNING id, status`,
    [sessionId]
  );
  if (!rows[0]) throw new ApiError(409, 'Cette séance ne peut plus être annulée (déjà tenue ou introuvable).');
  return rows[0];
}

/** Change la date d'une séance déjà programmée, sans avoir à l'annuler puis en reprogrammer une autre. */
export async function rescheduleSession({ sessionId, scheduledFor }) {
  const { rows } = await query(
    `UPDATE commission_sessions SET scheduled_for = $2
     WHERE id = $1 AND status = 'planifiee'
     RETURNING id, scheduled_for, status`,
    [sessionId, scheduledFor]
  );
  if (!rows[0]) throw new ApiError(409, 'Cette séance ne peut plus être modifiée (déjà tenue ou introuvable).');
  return rows[0];
}

/**
 * Fixe (ou corrige) l'enveloppe d'une séance. Réservé au directeur —
 * le gestionnaire programme la séance et y dépose les dossiers, mais
 * le montant engageable n'est pas à sa main.
 *
 * Modifiable tant que la séance n'est pas tenue : une enveloppe est une
 * décision de trésorerie, elle peut évoluer jusqu'au dernier moment.
 * Après la tenue, elle est figée — c'est la trace de ce qui a autorisé
 * les octrois de cette séance.
 */
export async function definirPlafondSession({ sessionId, plafond, actorId }) {
  if (plafond !== null && (!Number.isInteger(plafond) || plafond <= 0)) {
    throw new ApiError(422, 'Le plafond doit être un montant positif, ou vide pour retirer l’enveloppe.');
  }

  const { rows } = await query(
    `UPDATE commission_sessions
     SET plafond = $2,
         plafond_par = CASE WHEN $2::bigint IS NULL THEN NULL ELSE $3::uuid END,
         plafond_le  = CASE WHEN $2::bigint IS NULL THEN NULL ELSE now() END
     WHERE id = $1 AND status = 'planifiee'
     RETURNING id, plafond`,
    [sessionId, plafond, actorId]
  );
  if (!rows[0]) {
    throw new ApiError(409, 'Cette séance est déjà tenue ou annulée — son enveloppe ne peut plus changer.');
  }

  // On renvoie l'enveloppe recalculée : le directeur doit voir
  // immédiatement si ce qu'il vient de fixer couvre déjà les dépôts.
  return { ...rows[0], enveloppe: await fetchEnveloppe(sessionId) };
}

/**
 * Les trois chiffres de l'enveloppe d'une séance : autorisé, déposé,
 * reste. Lus dans la vue, donc toujours cohérents avec les dépôts
 * réels — jamais un compteur stocké qui pourrait dériver.
 *
 * `depassement` dit de combien les dépôts excèdent l'enveloppe. Il
 * n'empêche rien au dépôt : c'est en séance que la limite s'applique.
 */
export async function fetchEnveloppe(sessionId) {
  const { rows } = await query(
    `SELECT plafond, depose, valide, reste, dossiers_deposes
     FROM commission_enveloppes WHERE session_id = $1`,
    [sessionId]
  );
  const e = rows[0];
  if (!e) return null;
  const plafond = e.plafond === null ? null : Number(e.plafond);
  const depose = Number(e.depose);
  return {
    plafond,
    depose,
    valide: Number(e.valide),
    reste: plafond === null ? null : plafond - depose,
    depassement: plafond === null ? 0 : Math.max(0, depose - plafond),
    dossiersDeposes: e.dossiers_deposes,
  };
}

/** La séance actuellement programmée, s'il y en a une. */
export async function fetchPlannedSession() {
  const { rows } = await query(
    `SELECT s.id, s.scheduled_for, s.status, s.scheduled_by, u.full_name AS scheduled_by_name,
            s.note, s.created_at, s.plafond, s.plafond_le,
            p.full_name AS plafond_par_name
     FROM commission_sessions s
     LEFT JOIN users u ON u.id = s.scheduled_by
     LEFT JOIN users p ON p.id = s.plafond_par
     WHERE s.status = 'planifiee' LIMIT 1`
  );
  if (!rows[0]) return null;
  return { ...rows[0], enveloppe: await fetchEnveloppe(rows[0].id) };
}

/**
 * Dépose un dossier validé en premier niveau dans la file d'attente de
 * la prochaine commission.
 *
 * Un crédit déjà en cours ne bloque PLUS le dépôt (décision du
 * 23/10/2026) : le gestionnaire dépose librement, et c'est au comité de
 * trancher en voyant la situation complète du client — crédits en
 * cours, reste à payer, retards, découverts. Voir fetchCommissionQueue,
 * qui construit ce signalement.
 */
export async function depositToCommission({ creditId, note, actorId }) {
  return withTransaction(async (client) => {
    const { rows: session } = await client.query(
      `SELECT id FROM commission_sessions WHERE status = 'planifiee' LIMIT 1 FOR UPDATE`
    );
    if (!session[0]) {
      throw new ApiError(
        422,
        'Aucune commission n’est programmée. Programmez une commission avant de déposer un dossier.'
      );
    }

    const { rows: creditRows } = await client.query(
      `SELECT * FROM credit_requests WHERE id = $1 FOR UPDATE`,
      [creditId]
    );
    const credit = creditRows[0];
    if (!credit) throw new ApiError(404, 'Dossier introuvable.');
    if (credit.status !== 'valide_niveau1') {
      throw new ApiError(409, 'Seul un dossier validé en premier niveau peut être déposé en commission.');
    }

    // ─────────────────────────────────────────────────────────────────
    // UN CRÉDIT EN COURS NE BLOQUE PLUS LE DÉPÔT.
    //
    // Décision de la direction du 23/10/2026 : le gestionnaire dépose
    // librement, y compris pour un client qui a déjà un crédit. Le
    // verrou qui exigeait une autorisation d'exception du directeur
    // retenait des dossiers en attente pour une formalité, alors que
    // c'est le comité qui tranche de toute façon.
    //
    // Le contrôle ne disparaît pas, il CHANGE DE PLACE : au lieu
    // d'interdire le dépôt, on documente la situation du client pour
    // que le comité décide en connaissance de cause. L'ordre du jour
    // affiche désormais, pour chaque dossier, les crédits déjà en cours
    // avec leur reste à payer, les échéances en retard, et les
    // découverts des trois derniers mois (voir fetchCommissionQueue).
    //
    // Les autorisations d'exception restent accordables et tracées,
    // mais elles ne conditionnent plus rien et ne sont plus consommées
    // à l'insu de personne.
    const consumedAuthorizationId = null;

    const { rows: updated } = await client.query(
      `UPDATE credit_requests
       SET status = 'en_attente_commission', commission_session_id = $2, commission_note = $3
       WHERE id = $1
       RETURNING id, reference, status, commission_session_id`,
      [creditId, session[0].id, note ?? null]
    );

    return { ...updated[0], authorizationConsumed: consumedAuthorizationId };
  });
}

/**
 * Ajuste le montant et/ou la durée d'un dossier avant qu'il soit
 * tranché en séance.
 *
 * Un comité qui ne peut pas réduire un montant n'a que deux réponses :
 * tout accorder ou tout refuser. Avec une enveloppe plafonnée, cela
 * conduirait à écarter de bons dossiers faute de place. Ajuster est la
 * troisième voie, et c'est celle que le cahier des charges prévoyait
 * dès la création du comité (migration 010) : « le gestionnaire dépose
 * les demandes afin que le superviseur analyse et fasse des
 * modifications avant que la commission ne se tienne ».
 *
 * Trois garde-fous :
 *
 *   • le dossier doit être EN ATTENTE de décision. Une fois tranché,
 *     plus rien ne bouge : le montant validé est celui qui engage.
 *
 *   • le nouveau montant reste soumis au BARÈME DU PRODUIT — celui
 *     sous lequel le dossier a été créé, pas celui du jour. C'est la
 *     doctrine de versionnement de ce logiciel : on oppose au client le
 *     barème applicable au moment de sa demande. Sans ce contrôle, le
 *     comité pourrait accorder au-delà de ce que le produit autorise.
 *
 *   • la demande d'origine est conservée (amount_initial), et
 *     uniquement au premier ajustement : plusieurs retouches ne doivent
 *     pas écraser la demande du client par l'avant-dernière version.
 *
 * Les frais de dossier, assis sur le montant, sont recalculés. La
 * mensualité ne l'est pas : elle se fixe à l'approbation finale, sur le
 * montant qui sera alors en base. On en renvoie seulement l'aperçu,
 * pour que le comité voie ce qu'il décide.
 */
export async function ajusterDossierEnCommission({ creditId, montant, duree, actorId, motif }) {
  return withTransaction(async (client) => {
    const { rows: creditRows } = await client.query(
      `SELECT c.*, btrim(u.full_name) AS client_nom
       FROM credit_requests c JOIN users u ON u.id = c.user_id
       WHERE c.id = $1 FOR UPDATE OF c`,
      [creditId]
    );
    const credit = creditRows[0];
    if (!credit) throw new ApiError(404, 'Dossier introuvable.');
    if (credit.status !== 'en_attente_commission') {
      throw new ApiError(
        409,
        credit.commission_decision_by
          ? 'Ce dossier a déjà été tranché en séance — son montant n’est plus modifiable.'
          : 'Seul un dossier déposé en commission et non encore tranché peut être ajusté.'
      );
    }

    const nouveauMontant = montant ?? Number(credit.amount);
    const nouvelleDuree = duree ?? Number(credit.duration_months);

    if (nouveauMontant === Number(credit.amount) && nouvelleDuree === Number(credit.duration_months)) {
      throw new ApiError(422, 'Aucun changement : le montant et la durée sont déjà ceux-là.');
    }

    // Le barème sous lequel le dossier a été créé, pas celui du jour.
    let fraisDossier = Number(credit.file_fee ?? 0);
    if (credit.product_version_id) {
      const { rows: version } = await client.query(
        `SELECT min_amount, max_amount, min_duration, max_duration,
                file_fee_fixed, file_fee_rate
         FROM product_versions WHERE id = $1`,
        [credit.product_version_id]
      );
      if (version[0]) {
        validateAgainstScale(nouveauMontant, nouvelleDuree, version[0]);
        fraisDossier = computeFileFee(nouveauMontant, {
          fileFeeFixed: Number(version[0].file_fee_fixed),
          fileFeeRate: Number(version[0].file_fee_rate),
        });
      }
    }

    const { rows: maj } = await client.query(
      `UPDATE credit_requests
       SET amount = $2,
           duration_months = $3,
           file_fee = $4,
           -- Premier ajustement seulement : la demande du client ne doit
           -- pas être écrasée par une retouche intermédiaire.
           amount_initial   = COALESCE(amount_initial, amount),
           duration_initial = COALESCE(duration_initial, duration_months),
           ajuste_par = $5,
           ajuste_le  = now(),
           commission_note = CASE
             WHEN $6::text IS NULL OR btrim($6::text) = '' THEN commission_note
             WHEN commission_note IS NULL OR btrim(commission_note) = '' THEN $6::text
             ELSE commission_note || E'\\n' || $6::text
           END
       WHERE id = $1
       RETURNING id, reference, amount, duration_months, file_fee,
                 amount_initial, duration_initial, monthly_rate, commission_note`,
      [creditId, nouveauMontant, nouvelleDuree, fraisDossier, actorId, motif ?? null]
    );

    const d = maj[0];
    const apercu = computeSchedule(
      Number(d.amount),
      Number(d.duration_months),
      Number(d.monthly_rate ?? DEFAULT_MONTHLY_RATE)
    );

    return {
      ...d,
      client: credit.client_nom,
      mensualiteApercu: apercu.monthlyPayment,
      totalDuApercu: apercu.totalDue,
    };
  });
}

/** Retire un dossier de la file d'attente avant la séance — revient à « valide_niveau1 ». */
export async function withdrawFromCommission({ creditId }) {
  const { rows } = await query(
    `UPDATE credit_requests
     SET status = 'valide_niveau1', commission_session_id = NULL, commission_note = NULL
     WHERE id = $1 AND status = 'en_attente_commission'
     RETURNING id, reference, status`,
    [creditId]
  );
  if (!rows[0]) throw new ApiError(409, 'Ce dossier n’est pas en attente de commission.');
  return rows[0];
}

/** Dossiers en attente pour une séance donnée. */
export async function fetchCommissionQueue({ sessionId }) {
  const { rows } = await query(
    `SELECT c.id, c.reference, c.amount, c.duration_months, c.monthly_rate, c.commission_note,
            -- Ce que le client avait demandé, si le comité l'a ajusté :
            -- sans ça, un dossier réduit devient indistinguable d'un
            -- dossier accordé tel quel.
            c.amount_initial, c.duration_initial, c.ajuste_le,
            aj.full_name AS ajuste_par_nom,
            u.full_name AS client, u.employer, u.job_title, u.client_number,

            -- ─────────────────────────────────────────────────────────
            -- LA SITUATION DU CLIENT
            --
            -- Depuis le 23/10/2026, un crédit en cours ne bloque plus
            -- le dépôt. Le contrôle est donc ici : le comité doit voir
            -- d'un coup d'œil s'il s'apprête à accorder un second
            -- crédit à quelqu'un qui n'a pas fini le premier, et
            -- comment celui-ci se comporte.
            COALESCE(b.balance, 0)::bigint AS solde_actuel,
            COALESCE(enc.nombre, 0)::int   AS credits_en_cours,
            COALESCE(enc.reste, 0)::bigint AS reste_a_payer,
            COALESCE(enc.mensualites, 0)::bigint AS mensualites_en_cours,
            COALESCE(enc.en_retard, 0)::int AS echeances_en_retard,
            enc.details                    AS details_credits_en_cours,
            -- Découverts des 90 derniers jours : le solde le plus bas
            -- atteint, et combien de jours il est resté négatif. Un
            -- agent qui plonge chaque mois n'est pas dans la même
            -- situation qu'un agent à l'équilibre.
            COALESCE(dec.solde_min, 0)::bigint AS solde_min_90j,
            COALESCE(dec.jours_negatifs, 0)::int AS jours_negatifs_90j
     FROM credit_requests c
     JOIN users u ON u.id = c.user_id
     LEFT JOIN users aj ON aj.id = c.ajuste_par
     LEFT JOIN accounts a ON a.user_id = u.id
     LEFT JOIN account_balances b ON b.account_id = a.id

     -- Les crédits déjà approuvés de ce client, avec leur reste réel.
     LEFT JOIN LATERAL (
       SELECT count(*)::int nombre,
              SUM(x.reste) reste,
              SUM(x.mensualite) mensualites,
              SUM(x.en_retard)::int en_retard,
              json_agg(json_build_object(
                'reference', x.reference,
                'montant', x.montant,
                'mensualite', x.mensualite,
                'echeances_payees', x.payees,
                'echeances_total', x.total,
                'reste', x.reste,
                'en_retard', x.en_retard
              ) ORDER BY x.reference) details
       FROM (
         SELECT ac.reference, ac.amount montant, COALESCE(ac.monthly_payment, 0) mensualite,
                (SELECT count(*)::int FROM installments i WHERE i.credit_id = ac.id AND i.status = 'payee') payees,
                (SELECT count(*)::int FROM installments i WHERE i.credit_id = ac.id) total,
                COALESCE((SELECT SUM(i.amount) FROM installments i
                          WHERE i.credit_id = ac.id AND i.status <> 'payee'), 0) reste,
                (SELECT count(*)::int FROM installments i
                 WHERE i.credit_id = ac.id AND i.status = 'en_retard') en_retard
         FROM credit_requests ac
         WHERE ac.user_id = u.id AND ac.status = 'approuve'
       ) x
     ) enc ON TRUE

     -- Historique du solde : somme glissante sur TOUTES les écritures
     -- (pour que le solde soit juste), puis on ne regarde que les 90
     -- derniers jours.
     LEFT JOIN LATERAL (
       SELECT min(h.solde_courant)::bigint solde_min,
              count(DISTINCT h.jour) FILTER (WHERE h.solde_courant < 0)::int jours_negatifs
       FROM (
         SELECT SUM(le.amount) OVER (ORDER BY le.created_at, le.id) solde_courant,
                le.created_at::date jour, le.created_at
         FROM ledger_entries le
         WHERE le.account_id = a.id
       ) h
       WHERE h.created_at >= now() - interval '90 days'
     ) dec ON TRUE

     WHERE c.commission_session_id = $1 AND c.status = 'en_attente_commission'
     ORDER BY u.full_name`,
    [sessionId]
  );
  return rows;
}

/**
 * Dépose un crédit ACTIF en difficulté devant le comité — pas une
 * nouvelle demande, un dossier déjà octroyé qui pose problème
 * (retard de paiement notamment). « Cette commission statue sur tous
 * les types de crédits [...] dossiers en difficultés » : la décision
 * du comité est enregistrée ici ; l'action concrète qui en découle
 * (décaler une échéance, par exemple) passe ensuite par les outils
 * déjà en place, sur la base de cette décision.
 */
export async function depositDifficultyCase({ creditId, note, actorId }) {
  return withTransaction(async (client) => {
    const { rows: session } = await client.query(
      `SELECT id FROM commission_sessions WHERE status = 'planifiee' LIMIT 1 FOR UPDATE`
    );
    if (!session[0]) {
      throw new ApiError(422, 'Aucune commission n’est programmée. Programmez une commission avant de déposer un dossier.');
    }

    const { rows: creditRows } = await client.query(
      `SELECT c.id, c.reference, c.user_id, u.full_name
       FROM credit_requests c JOIN users u ON u.id = c.user_id
       WHERE c.id = $1`,
      [creditId]
    );
    const credit = creditRows[0];
    if (!credit) throw new ApiError(404, 'Dossier introuvable.');

    const { rows: created } = await client.query(
      `INSERT INTO commission_items (session_id, type, credit_id, client_id, titre, note, deposited_by)
       VALUES ($1, 'dossier_difficulte', $2, $3, $4, $5, $6)
       RETURNING id, session_id, type, credit_id, client_id, titre, status`,
      [
        session[0].id, creditId, credit.user_id,
        `Dossier en difficulté — ${credit.reference} (${credit.full_name})`,
        note ?? null, actorId,
      ]
    );
    return created[0];
  });
}

/**
 * Dépose une demande exceptionnelle devant le comité — pas
 * nécessairement liée à un crédit précis, mais toujours rattachée à un
 * client : une demande d'exception sans personne concernée n'a rien à
 * faire devant ce comité (c'est la contrainte imposée en base).
 */
export async function depositExceptionalRequest({ clientId, titre, note, actorId }) {
  if (!titre || titre.trim().length < 3) {
    throw new ApiError(422, 'Un titre est requis pour une demande exceptionnelle.');
  }
  if (!clientId) {
    throw new ApiError(422, 'Une demande exceptionnelle doit être rattachée à un client.');
  }

  return withTransaction(async (client) => {
    const { rows: session } = await client.query(
      `SELECT id FROM commission_sessions WHERE status = 'planifiee' LIMIT 1 FOR UPDATE`
    );
    if (!session[0]) {
      throw new ApiError(422, 'Aucune commission n’est programmée. Programmez une commission avant de déposer une demande.');
    }

    const { rows: clientRows } = await client.query(
      `SELECT id FROM users WHERE id = $1 AND role = 'client'`,
      [clientId]
    );
    if (!clientRows[0]) throw new ApiError(404, 'Client introuvable.');

    const { rows: created } = await client.query(
      `INSERT INTO commission_items (session_id, type, client_id, titre, note, deposited_by)
       VALUES ($1, 'demande_exceptionnelle', $2, $3, $4, $5)
       RETURNING id, session_id, type, client_id, titre, status`,
      [session[0].id, clientId, titre.trim(), note ?? null, actorId]
    );
    return created[0];
  });
}

/** Retire un point de l'ordre du jour avant la séance (dossier en difficulté ou demande exceptionnelle). */
export async function withdrawCommissionItem({ itemId }) {
  const { rows } = await query(
    `DELETE FROM commission_items WHERE id = $1 AND status = 'en_attente' RETURNING id`,
    [itemId]
  );
  if (!rows[0]) throw new ApiError(409, 'Ce point n’est pas en attente de commission.');
  return rows[0];
}

/** Points de l'ordre du jour (difficultés, demandes exceptionnelles) pour une séance donnée. */
export async function fetchCommissionItems({ sessionId }) {
  const { rows } = await query(
    `SELECT i.id, i.type, i.titre, i.note, i.status, i.credit_id,
            c.reference AS credit_reference,
            u.full_name AS client
     FROM commission_items i
     LEFT JOIN credit_requests c ON c.id = i.credit_id
     LEFT JOIN users u ON u.id = i.client_id
     WHERE i.session_id = $1 AND i.status = 'en_attente'
     ORDER BY u.full_name`,
    [sessionId]
  );
  return rows;
}

/**
 * Tient la séance : enregistre une décision pour chaque point à
 * l'ordre du jour — nouveaux crédits, dossiers en difficulté et
 * demandes exceptionnelles confondus. Toutes les demandes doivent
 * être décidées — une commission qui statue laisse l'ordre du jour
 * vide derrière elle, jamais des points en suspens.
 *
 * `decisions` mélange les deux natures de points, distingués par
 * `kind` : 'credit' pour un nouveau dossier de crédit (creditId),
 * 'item' pour un dossier en difficulté ou une demande exceptionnelle
 * (itemId).
 */
export async function holdSession({ sessionId, decisions, actorId }) {
  if (!Array.isArray(decisions) || decisions.length === 0) {
    throw new ApiError(422, 'Aucune décision fournie.');
  }

  return withTransaction(async (client) => {
    const { rows: sessionRows } = await client.query(
      `SELECT * FROM commission_sessions WHERE id = $1 FOR UPDATE`,
      [sessionId]
    );
    const session = sessionRows[0];
    if (!session) throw new ApiError(404, 'Séance introuvable.');
    if (session.status !== 'planifiee') throw new ApiError(409, 'Cette séance a déjà été tenue ou annulée.');

    const { rows: queuedCredits } = await client.query(
      `SELECT id FROM credit_requests WHERE commission_session_id = $1 AND status = 'en_attente_commission'`,
      [sessionId]
    );
    const { rows: queuedItems } = await client.query(
      `SELECT id FROM commission_items WHERE session_id = $1 AND status = 'en_attente'`,
      [sessionId]
    );
    const queuedCreditIds = new Set(queuedCredits.map((r) => r.id));
    const queuedItemIds = new Set(queuedItems.map((r) => r.id));

    const decidedCreditIds = new Set(
      decisions.filter((d) => (d.kind ?? (d.creditId ? 'credit' : 'item')) === 'credit').map((d) => d.creditId)
    );
    const decidedItemIds = new Set(
      decisions.filter((d) => (d.kind ?? (d.creditId ? 'credit' : 'item')) === 'item').map((d) => d.itemId)
    );

    const manquants = [
      ...[...queuedCreditIds].filter((id) => !decidedCreditIds.has(id)),
      ...[...queuedItemIds].filter((id) => !decidedItemIds.has(id)),
    ];
    if (manquants.length > 0) {
      throw new ApiError(
        422,
        `${manquants.length} point(s) de l’ordre du jour n’ont pas de décision. Chaque point déposé doit être tranché.`
      );
    }

    // ─────────────────────────────────────────────────────────────────
    // L'ENVELOPPE DE LA SÉANCE
    //
    // « Durant la tenue de la séance, les noms et les montants qui vont
    //   être validés ne doivent pas dépasser ce montant. »
    //
    // Le dépôt, lui, peut dépasser librement : déposer n'engage rien.
    // C'est ici, au moment où les octrois deviennent réels, que la
    // limite s'applique — et elle est refusée en bloc, avant la
    // moindre écriture, pour que la séance soit à reprendre entière
    // plutôt qu'à moitié enregistrée.
    //
    // Seuls les dossiers de crédit comptent : ce sont eux que la caisse
    // paiera. Les points « difficulté » et « demande exceptionnelle »
    // ne décaissent rien par eux-mêmes.
    //
    // Une séance sans plafond ne bloque rien : la direction n'a pas
    // encore fixé d'enveloppe, on ne lui impose pas une limite qu'elle
    // n'a pas donnée.
    if (session.plafond !== null && session.plafond !== undefined) {
      const aValider = decisions
        .filter((d) => (d.kind ?? (d.creditId ? 'credit' : 'item')) === 'credit')
        .filter((d) => d.decision === 'valide')
        .map((d) => d.creditId);

      if (aValider.length > 0) {
        const { rows: montants } = await client.query(
          `SELECT c.id, c.reference, c.amount, btrim(u.full_name) AS client
           FROM credit_requests c JOIN users u ON u.id = c.user_id
           WHERE c.id = ANY($1::uuid[])
           ORDER BY c.amount DESC`,
          [aValider]
        );
        const total = montants.reduce((s, r) => s + Number(r.amount), 0);
        const plafond = Number(session.plafond);

        if (total > plafond) {
          const excedent = total - plafond;
          // On nomme les dossiers, du plus gros au plus petit : le
          // directeur doit pouvoir décider lesquels retirer de la file
          // sans aller rouvrir chaque dossier.
          const liste = montants
            .map((r) => `${r.client} ${r.reference} (${Number(r.amount)} F)`)
            .join(', ');
          throw new ApiError(
            422,
            `Les ${montants.length} dossiers à valider totalisent ${total} FCFA, `
            + `soit ${excedent} FCFA au-dessus de l’enveloppe de ${plafond} FCFA fixée pour cette séance. `
            + `Retirez des dossiers de la file (ils reviendront disponibles pour une prochaine séance) `
            + `ou relevez l’enveloppe avant de tenir la séance. Dossiers concernés, du plus élevé au plus faible : ${liste}.`
          );
        }
      }
    }

    const resultats = [];

    for (const entry of decisions) {
      const kind = entry.kind ?? (entry.creditId ? 'credit' : 'item');

      if (entry.decision !== 'valide' && entry.decision !== 'rejete') {
        throw new ApiError(422, 'Décision invalide : « valide » ou « rejete » attendu.');
      }

      if (kind === 'credit') {
        if (!queuedCreditIds.has(entry.creditId)) {
          throw new ApiError(422, `Le dossier ${entry.creditId} n’est pas dans la file d’attente de cette séance.`);
        }
        const nouveauStatut = entry.decision === 'valide' ? 'valide_commission' : 'rejete';
        const { rows: updated } = await client.query(
          `UPDATE credit_requests
           SET status = $2, commission_decision_by = $3, commission_decided_at = now(), commission_decision_note = $4
           WHERE id = $1
           RETURNING id, reference, status`,
          [entry.creditId, nouveauStatut, actorId, entry.note ?? null]
        );
        resultats.push({ kind: 'credit', ...updated[0] });
      } else if (kind === 'item') {
        if (!queuedItemIds.has(entry.itemId)) {
          throw new ApiError(422, `Le point ${entry.itemId} n’est pas dans l’ordre du jour de cette séance.`);
        }
        const { rows: updated } = await client.query(
          `UPDATE commission_items
           SET status = $2, decision_by = $3, decided_at = now(), decision_note = $4
           WHERE id = $1
           RETURNING id, type, titre, status, client_id`,
          [entry.itemId, entry.decision, actorId, entry.note ?? null]
        );
        const item = updated[0];

        // Une demande exceptionnelle validée en séance EST l'autorisation
        // du directeur : elle ouvre immédiatement le droit de déposer un
        // nouveau dossier pour ce client, même s'il a déjà un crédit en
        // cours. Sans cette ligne, la demande était validée puis ne
        // produisait rien — le dossier restait bloqué en « validé niveau
        // 1 », refusé au dépôt par depositToCommission, et la demande
        // elle-même disparaissait de tous les écrans.
        if (item.type === 'demande_exceptionnelle' && entry.decision === 'valide' && item.client_id) {
          await client.query(
            `INSERT INTO commission_exception_authorizations (client_user_id, motif, granted_by)
             VALUES ($1, $2, $3)`,
            [
              item.client_id,
              `Demande exceptionnelle validée en séance du ${new Date(session.scheduled_for).toISOString().slice(0, 10)} — ${item.titre}`,
              actorId,
            ]
          );
        }

        resultats.push({ kind: 'item', ...item });
      } else {
        throw new ApiError(422, `Type de décision invalide : « kind » doit être « credit » ou « item ».`);
      }
    }

    await client.query(
      `UPDATE commission_sessions SET status = 'tenue', held_by = $2, held_at = now() WHERE id = $1`,
      [sessionId, actorId]
    );

    return { sessionId, resultats };
  });
}

/**
 * Double validation par l'opérateur, une fois le comité passé. Ne
 * débloque rien : c'est l'étape suivante — l'approbation finale du
 * directeur, sur la route /credits/:id/approuver déjà en place — qui
 * crédite le compte.
 */
export async function doubleValidateCredit({ creditId, actorId }) {
  const { rows } = await query(
    `UPDATE credit_requests
     SET status = 'valide_double', double_validated_by = $2, double_validated_at = now()
     WHERE id = $1 AND status = 'valide_commission'
     RETURNING id, reference, status`,
    [creditId, actorId]
  );
  if (!rows[0]) {
    throw new ApiError(409, 'Ce dossier doit d’abord être validé par le comité de crédit.');
  }
  return rows[0];
}

/*
 * Les points de l'ordre du jour — dossiers en difficulté comme
 * demandes exceptionnelles — ne passent plus par une double validation
 * de l'opérateur : la décision du directeur en séance est définitive.
 *
 * Elle l'était déjà en pratique. Pour une demande exceptionnelle, le
 * directeur est seul détenteur de « commission.autoriser_exception » :
 * rien à confirmer après lui. Pour un dossier en difficulté, la séance
 * arrête une orientation et les actions concrètes (décaler une
 * échéance, par exemple) se font ensuite avec les outils dédiés, qui
 * ont leurs propres contrôles. L'étape intermédiaire n'ajoutait aucun
 * contrôle réel et faisait sortir le point de tous les écrans sans
 * aucune suite — c'est elle qui avait bloqué 5 dossiers.
 *
 * doubleValidateCommissionItem et fetchItemsAwaitingDoubleValidation
 * ont donc été retirées. Le statut 'valide_double' reste dans l'énum
 * (migration 030) et dans les flux de suppression, qui couvrent les
 * points déjà passés par l'ancien circuit.
 */

/* ═══════════════════════════════════════════════════════════════════
   HISTORIQUE DES SÉANCES
   ═══════════════════════════════════════════════════════════════════

   Jusqu'ici, seule la séance « planifiee » était consultable : une fois
   tenue, elle et ses décisions n'étaient plus lisibles nulle part.

   La décision prise sur un crédit n'est pas stockée telle quelle — il
   n'y a pas de colonne « décision », seulement le statut qui a continué
   d'évoluer après la séance. Elle se déduit de façon fiable :

     • commission_decision_by renseigné + status = 'rejete'  → refusé
     • commission_decision_by renseigné + tout autre statut  → validé
     • commission_decision_by vide                           → déposé,
       jamais tranché (séance annulée avant d'être tenue)

   Un dossier rejeté AVANT la commission ne peut pas être confondu avec
   un refus en séance : il n'a pas de commission_session_id. Et 'rejete'
   est terminal, donc un dossier validé en séance ne peut pas y tomber
   ensuite.

   Pour un point de l'ordre du jour, le statut porte directement la
   décision ('valide'/'valide_double' validé, 'rejete' refusé,
   'annule' supprimé après coup, 'en_attente' jamais tranché). */

/** Toutes les séances, la plus récente d'abord, avec le décompte des décisions. */
export async function fetchAllSessions({ limite = 100 } = {}) {
  const { rows } = await query(
    `SELECT s.id, s.scheduled_for, s.status, s.held_at, s.note, s.created_at,
            s.plafond,
            programmeur.full_name AS programmee_par,
            president.full_name   AS tenue_par,
            (SELECT count(*) FROM credit_requests c
              WHERE c.commission_session_id = s.id
                AND c.commission_decision_by IS NOT NULL
                AND c.status <> 'rejete')::int AS credits_valides,
            (SELECT count(*) FROM credit_requests c
              WHERE c.commission_session_id = s.id
                AND c.commission_decision_by IS NOT NULL
                AND c.status = 'rejete')::int AS credits_refuses,
            (SELECT count(*) FROM credit_requests c
              WHERE c.commission_session_id = s.id
                AND c.commission_decision_by IS NULL)::int AS credits_non_tranches,
            (SELECT count(*) FROM commission_items i
              WHERE i.session_id = s.id
                AND i.status IN ('valide', 'valide_double'))::int AS points_valides,
            (SELECT count(*) FROM commission_items i
              WHERE i.session_id = s.id AND i.status = 'rejete')::int AS points_refuses,
            (SELECT count(*) FROM commission_items i
              WHERE i.session_id = s.id AND i.status = 'en_attente')::int AS points_non_tranches,
            (SELECT count(*) FROM commission_items i
              WHERE i.session_id = s.id AND i.status = 'annule')::int AS points_supprimes
     FROM commission_sessions s
     JOIN users programmeur ON programmeur.id = s.scheduled_by
     LEFT JOIN users president ON president.id = s.held_by
     ORDER BY s.scheduled_for DESC
     LIMIT $1`,
    [limite]
  );
  return rows;
}

/**
 * Détail d'une séance : les dossiers de crédit et les points de l'ordre
 * du jour, avec la décision prise sur chacun et son statut actuel —
 * celui-ci a pu évoluer depuis (approuvé, soldé, annulé).
 */
export async function fetchSessionDetail({ sessionId }) {
  const { rows: sessionRows } = await query(
    `SELECT s.id, s.scheduled_for, s.status, s.held_at, s.note, s.created_at,
            s.plafond, s.plafond_le, plafonneur.full_name AS plafond_par_name,
            programmeur.full_name AS programmee_par,
            president.full_name   AS tenue_par
     FROM commission_sessions s
     LEFT JOIN users plafonneur ON plafonneur.id = s.plafond_par
     JOIN users programmeur ON programmeur.id = s.scheduled_by
     LEFT JOIN users president ON president.id = s.held_by
     WHERE s.id = $1`,
    [sessionId]
  );
  if (!sessionRows[0]) throw new ApiError(404, 'Séance introuvable.');

  const { rows: credits } = await query(
    `SELECT c.id, c.reference, c.amount, c.duration_months, c.status AS statut_actuel,
            c.commission_note, c.commission_decision_note, c.commission_decided_at,
            u.full_name AS client, u.employer, u.job_title,
            decideur.full_name AS decide_par,
            CASE
              WHEN c.commission_decision_by IS NULL THEN 'non_tranche'
              WHEN c.status = 'rejete'              THEN 'refuse'
              ELSE 'valide'
            END AS decision
     FROM credit_requests c
     JOIN users u ON u.id = c.user_id
     LEFT JOIN users decideur ON decideur.id = c.commission_decision_by
     WHERE c.commission_session_id = $1
     ORDER BY u.full_name`,
    [sessionId]
  );

  const { rows: points } = await query(
    `SELECT i.id, i.type, i.titre, i.note, i.status, i.decision_note, i.decided_at,
            ref.reference AS credit_reference,
            u.full_name AS client,
            decideur.full_name AS decide_par,
            CASE i.status
              WHEN 'rejete'     THEN 'refuse'
              WHEN 'en_attente' THEN 'non_tranche'
              WHEN 'annule'     THEN 'supprime'
              ELSE 'valide'
            END AS decision
     FROM commission_items i
     LEFT JOIN credit_requests ref ON ref.id = i.credit_id
     LEFT JOIN users u ON u.id = i.client_id
     LEFT JOIN users decideur ON decideur.id = i.decision_by
     WHERE i.session_id = $1
     ORDER BY u.full_name`,
    [sessionId]
  );

  return { seance: sessionRows[0], credits, points };
}

/**
 * Autorisation d'exception : permet à un client qui a déjà un crédit
 * actif de repasser en commission pour un second dossier. Réservée au
 * directeur, se consomme une fois (voir depositToCommission).
 */
export async function grantExceptionAuthorization({ clientUserId, motif, actorId }) {
  if (!motif || motif.trim().length < 5) {
    throw new ApiError(422, 'Un motif est requis pour accorder une autorisation d’exception.');
  }
  const { rows: clientRows } = await query(
    `SELECT id, full_name FROM users WHERE id = $1 AND role = 'client'`,
    [clientUserId]
  );
  if (!clientRows[0]) throw new ApiError(404, 'Client introuvable.');

  const { rows } = await query(
    `INSERT INTO commission_exception_authorizations (client_user_id, motif, granted_by)
     VALUES ($1, $2, $3)
     RETURNING id, client_user_id, motif, granted_at`,
    [clientUserId, motif.trim(), actorId]
  );
  return { ...rows[0], client: clientRows[0].full_name };
}

/** Autorisations d'exception non encore consommées, pour vérification. */
export async function fetchUnusedExceptionAuthorizations() {
  const { rows } = await query(
    `SELECT a.id, a.motif, a.granted_at, u.full_name AS client, granter.full_name AS accordee_par
     FROM commission_exception_authorizations a
     JOIN users u ON u.id = a.client_user_id
     JOIN users granter ON granter.id = a.granted_by
     WHERE a.used_at IS NULL
     ORDER BY u.full_name`
  );
  return rows;
}

/**
 * Suppression directe par le directeur — même principe que
 * cancelCreditAwaitingDoubleValidation côté crédits : le directeur n'a
 * besoin d'aucune confirmation puisqu'il est lui-même celui qui aurait
 * eu à confirmer une demande de l'opérateur. Couvre un point à
 * n'importe quel stade de validation, quelle que soit son origine
 * (dossier en difficulté ou demande exceptionnelle).
 */
export async function cancelCommissionItemDirectly({ itemId, motif, actorId }) {
  if (!motif || motif.trim().length < 5) {
    throw new ApiError(422, 'Un motif est requis (5 caractères minimum).');
  }

  return withTransaction(async (client) => {
    const { rows: itemRows } = await client.query(
      `SELECT i.id, i.type, i.titre, i.status, u.full_name AS client_name
       FROM commission_items i
       LEFT JOIN users u ON u.id = i.client_id
       WHERE i.id = $1 FOR UPDATE`,
      [itemId]
    );
    const item = itemRows[0];
    if (!item) throw new ApiError(404, 'Point introuvable.');
    const statutAvant = item.status;

    const { rows: updated } = await client.query(
      `UPDATE commission_items SET status = 'annule'
       WHERE id = $1 AND status IN ('en_attente', 'valide', 'valide_double')
       RETURNING id`,
      [itemId]
    );
    if (!updated[0]) {
      throw new ApiError(409, 'Ce point n’est plus en attente de validation — il est déjà rejeté ou supprimé.');
    }

    await client.query(
      `INSERT INTO commission_item_deletion_reports (item_type, titre, client_name, motif, deleted_by, previous_status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [item.type, item.titre, item.client_name, motif.trim(), actorId, statutAvant]
    );

    return { itemId, statut: 'annule' };
  });
}

/**
 * Propose la suppression d'un dossier en difficulté / demande
 * exceptionnelle en attente de double validation — même circuit que
 * pour un crédit (voir proposeCreditDeletionRequest dans
 * operationsService.js) : l'opérateur propose, seul le directeur
 * confirme (decideCommissionItemDeletionRequest).
 */
export async function proposeCommissionItemDeletionRequest({ itemId, motif, actorId }) {
  if (!motif || motif.trim().length < 5) {
    throw new ApiError(422, 'Un motif est requis (5 caractères minimum).');
  }

  return withTransaction(async (client) => {
    const { rows: itemRows } = await client.query(
      `SELECT id, status FROM commission_items WHERE id = $1 FOR UPDATE`,
      [itemId]
    );
    const item = itemRows[0];
    if (!item) throw new ApiError(404, 'Point introuvable.');
    if (!['en_attente', 'valide', 'valide_double'].includes(item.status)) {
      throw new ApiError(409, 'Ce point n’est plus en attente de validation — il est déjà rejeté ou supprimé.');
    }

    const { rows: existing } = await client.query(
      `SELECT 1 FROM commission_item_deletion_requests WHERE item_id = $1 AND status = 'en_attente'`,
      [itemId]
    );
    if (existing[0]) {
      throw new ApiError(409, 'Une demande de suppression est déjà en attente pour ce point.');
    }

    const { rows: created } = await client.query(
      `INSERT INTO commission_item_deletion_requests (item_id, motif, requested_by)
       VALUES ($1, $2, $3)
       RETURNING id, item_id, motif, status, requested_at`,
      [itemId, motif.trim(), actorId]
    );

    return created[0];
  });
}

/** Demandes de suppression de point (difficulté/exceptionnel) en attente d'arbitrage du directeur. */
export async function fetchPendingCommissionItemDeletionRequests() {
  const { rows } = await query(
    `SELECT r.id, r.motif, r.requested_at, r.item_id,
            i.type, i.titre, i.credit_id, i.client_id,
            c.reference AS credit_reference,
            u.full_name AS client,
            demandeur.full_name AS demandeur
     FROM commission_item_deletion_requests r
     JOIN commission_items i ON i.id = r.item_id
     LEFT JOIN credit_requests c ON c.id = i.credit_id
     LEFT JOIN users u ON u.id = i.client_id
     JOIN users demandeur ON demandeur.id = r.requested_by
     WHERE r.status = 'en_attente'
     ORDER BY r.requested_at`
  );
  return rows;
}

/**
 * Le directeur tranche une demande de suppression de point : approuver
 * marque le point 'annule' et archive un rapport (même principe que
 * credit_deletion_reports), rejeter l'écarte sans y toucher. Le
 * proposant ne peut pas décider sa propre demande (contrainte
 * no_self_decision_suppression_item imposée en base également).
 */
export async function decideCommissionItemDeletionRequest({ requestId, approve, note, actorId }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM commission_item_deletion_requests WHERE id = $1 FOR UPDATE`,
      [requestId]
    );
    const request = rows[0];
    if (!request) throw new ApiError(404, 'Demande de suppression introuvable.');
    if (request.status !== 'en_attente') {
      throw new ApiError(409, 'Cette demande a déjà été traitée.');
    }
    if (request.requested_by === actorId) {
      throw new ApiError(403, 'Qui a proposé la suppression ne peut pas la valider lui-même.');
    }

    let resultat = null;
    if (approve) {
      const { rows: itemRows } = await client.query(
        `SELECT i.id, i.type, i.titre, i.status, u.full_name AS client_name
         FROM commission_items i
         LEFT JOIN users u ON u.id = i.client_id
         WHERE i.id = $1 FOR UPDATE`,
        [request.item_id]
      );
      const item = itemRows[0];
      if (!item) throw new ApiError(404, 'Point introuvable.');
      const statutAvant = item.status;

      const { rows: updated } = await client.query(
        `UPDATE commission_items SET status = 'annule'
         WHERE id = $1 AND status IN ('en_attente', 'valide', 'valide_double')
         RETURNING id`,
        [item.id]
      );
      if (!updated[0]) {
        throw new ApiError(409, 'Ce point n’est plus dans un état permettant sa suppression (déjà traité entre-temps).');
      }

      await client.query(
        `INSERT INTO commission_item_deletion_reports (item_type, titre, client_name, motif, deleted_by, previous_status)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [item.type, item.titre, item.client_name, request.motif, actorId, statutAvant]
      );

      resultat = { itemId: item.id, statut: 'annule' };
    }

    await client.query(
      `UPDATE commission_item_deletion_requests
       SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4
       WHERE id = $1`,
      [requestId, approve ? 'approuve' : 'rejete', actorId, note ?? null]
    );

    return { statut: approve ? 'approuve' : 'rejete', resultat };
  });
}
