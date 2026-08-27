import { query, withTransaction } from '../db/index.js';
import { ApiError } from '../middleware/errorHandler.js';

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
export async function scheduleSession({ scheduledFor, actorId }) {
  try {
    const { rows } = await query(
      `INSERT INTO commission_sessions (scheduled_for, scheduled_by)
       VALUES ($1, $2)
       RETURNING id, scheduled_for, status, scheduled_by`,
      [scheduledFor, actorId]
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

/** La séance actuellement programmée, s'il y en a une. */
export async function fetchPlannedSession() {
  const { rows } = await query(
    `SELECT id, scheduled_for, status, scheduled_by, note, created_at
     FROM commission_sessions WHERE status = 'planifiee' LIMIT 1`
  );
  return rows[0] ?? null;
}

/**
 * Dépose un dossier validé en premier niveau dans la file d'attente de
 * la prochaine commission. C'est ici que se vérifie la règle du crédit
 * en cours : un client qui a déjà un crédit actif ne peut être déposé
 * à nouveau sans autorisation d'exception du directeur, consommée au
 * passage.
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

    // Un client avec un crédit actif ne repasse en commission qu'avec
    // une autorisation d'exception du directeur, non encore consommée.
    const { rows: activeCredit } = await client.query(
      `SELECT 1 FROM credit_requests WHERE user_id = $1 AND status = 'approuve' LIMIT 1`,
      [credit.user_id]
    );
    let consumedAuthorizationId = null;
    if (activeCredit[0]) {
      const { rows: authorization } = await client.query(
        `SELECT id FROM commission_exception_authorizations
         WHERE client_user_id = $1 AND used_at IS NULL
         ORDER BY granted_at LIMIT 1 FOR UPDATE`,
        [credit.user_id]
      );
      if (!authorization[0]) {
        throw new ApiError(
          403,
          'Ce client a déjà un crédit en cours : une autorisation spéciale du directeur est requise avant de déposer un nouveau dossier en commission.'
        );
      }
      consumedAuthorizationId = authorization[0].id;
      await client.query(
        `UPDATE commission_exception_authorizations
         SET used_at = now(), used_for_credit_id = $2 WHERE id = $1`,
        [authorization[0].id, credit.id]
      );
    }

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
            u.full_name AS client, u.employer, u.job_title
     FROM credit_requests c
     JOIN users u ON u.id = c.user_id
     WHERE c.commission_session_id = $1 AND c.status = 'en_attente_commission'
     ORDER BY c.created_at`,
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

    const { rows: late } = await client.query(
      `SELECT count(*) AS nombre FROM installments WHERE credit_id = $1 AND status = 'en_retard'`,
      [creditId]
    );
    if (Number(late[0].nombre) === 0) {
      throw new ApiError(
        422,
        'Ce dossier n’a aucune échéance en retard : rien ne justifie un passage en commission pour difficulté.'
      );
    }

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
     ORDER BY i.deposited_at`,
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
           RETURNING id, type, titre, status`,
          [entry.itemId, entry.decision, actorId, entry.note ?? null]
        );
        resultats.push({ kind: 'item', ...updated[0] });
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
     ORDER BY a.granted_at DESC`
  );
  return rows;
}
