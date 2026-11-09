import { query, withTransaction } from '../db/index.js';
import { ApiError } from '../middleware/errorHandler.js';
import { collectInstallments } from './operationsService.js';
import { computeSchedule } from './creditService.js';
import { getCeiling } from './productService.js';

/**
 * ═══════════════════════════════════════════════════════════════════
 *  GESTION DES CRÉDITS — TROIS SIGNATURES POUR TOUCHER UN DOSSIER
 * ═══════════════════════════════════════════════════════════════════
 *
 * « Le gestionnaire aura la possibilité de modifier un crédit : changer
 *   les dates de prélèvements avec accord préalable de l'opérateur puis
 *   validation du directeur, demander un prélèvement supplémentaire
 *   avec validation de l'opérateur puis du directeur. »
 *   « À ajouter aussi la modification des taux pour certains crédits en
 *   cours, ou sauter un mois de prélèvement pour certains clients étant
 *   en difficulté. » (direction, 09/11/2026)
 *
 * Le gestionnaire connaît le client et propose ; l'opérateur vérifie
 * que c'est tenable au guichet et donne son accord ; le directeur
 * engage la maison. Aucune des trois étapes ne s'applique seule, et
 * personne ne signe deux fois — la base l'impose (migration 061), pas
 * seulement ces fonctions.
 *
 * Rien ne bouge sur le dossier avant la validation du directeur. Une
 * demande en attente ne touche ni l'échéancier, ni le compte, ni le
 * grand livre : c'est tout l'intérêt du circuit, et c'est ce qui permet
 * de refuser sans avoir à défaire.
 */

const JOUR_DE_PRELEVEMENT_PAR_DEFAUT = 4;

/** Le `jour` du mois, n mois après une date — borné à la fin des mois courts. */
function auJour(depuis, n, jour) {
  const d = new Date(`${depuis}T12:00:00Z`);
  const annee = d.getUTCFullYear();
  const mois = d.getUTCMonth() + n;
  const dernier = new Date(Date.UTC(annee, mois + 1, 0)).getUTCDate();
  return new Date(Date.UTC(annee, mois, Math.min(jour, dernier), 12))
    .toISOString().slice(0, 10);
}

/**
 * Dépose une demande. Elle part en attente de l'accord de l'opérateur.
 */
export async function proposerModification({ creditId, kind, details, motif, actorId }) {
  if (!motif || motif.trim().length < 5) {
    throw new ApiError(422, 'Un motif est requis (5 caractères minimum) : c’est ce que liront l’opérateur et le directeur.');
  }

  const { rows: credit } = await query(
    `SELECT c.id, c.reference, c.status::text AS statut, btrim(u.full_name) AS client
     FROM credit_requests c JOIN users u ON u.id = c.user_id
     WHERE c.id = $1`,
    [creditId]
  );
  if (!credit[0]) throw new ApiError(404, 'Crédit introuvable.');
  if (credit[0].statut !== 'approuve') {
    throw new ApiError(422, `Ce crédit est « ${credit[0].statut} » : il n’y a rien à modifier dessus.`);
  }

  // Validation du contenu, avant la base : un message utile vaut mieux
  // qu'une violation de contrainte remontée telle quelle.
  const corps = {};
  if (kind === 'dates_echeances') {
    const jour = details?.jour ?? JOUR_DE_PRELEVEMENT_PAR_DEFAUT;
    if (!Number.isInteger(jour) || jour < 1 || jour > 28) {
      throw new ApiError(422, 'Le jour de prélèvement doit être un entier entre 1 et 28, pour exister dans tous les mois.');
    }
    corps.jour = jour;
  } else if (kind === 'prelevement_supplementaire') {
    const { rows: ech } = await query(
      `SELECT id, sequence, amount, status::text AS statut FROM installments
       WHERE id = $1 AND credit_id = $2`,
      [details?.installmentId ?? null, creditId]
    );
    if (!ech[0]) throw new ApiError(422, 'Cette échéance n’appartient pas à ce crédit.');
    if (ech[0].statut === 'payee') throw new ApiError(422, `L’échéance ${ech[0].sequence} est déjà réglée.`);
    corps.installment_id = ech[0].id;
  } else if (kind === 'report_echeance') {
    const mois = details?.mois ?? 1;
    if (!Number.isInteger(mois) || mois < 1 || mois > 3) {
      throw new ApiError(422, 'Un report se compte en mois entiers, de 1 à 3. Au-delà, c’est un réaménagement du crédit, pas un report.');
    }
    corps.mois = mois;
  } else if (kind === 'montant') {
    const montant = Number(details?.montantDepose);
    if (!Number.isFinite(montant) || montant <= 0) {
      throw new ApiError(422, 'Le montant déposé doit être un nombre strictement positif.');
    }
    const { rows: du } = await query(
      `SELECT COALESCE(SUM(amount), 0)::bigint AS reste,
              (SELECT COALESCE(b.balance, 0)::bigint FROM accounts a
                LEFT JOIN account_balances b ON b.account_id = a.id
                JOIN credit_requests c2 ON c2.user_id = a.user_id
               WHERE c2.id = $1 LIMIT 1) AS solde
       FROM installments WHERE credit_id = $1 AND status <> 'payee'`,
      [creditId]
    );
    if (Number(du[0].reste) === 0) {
      throw new ApiError(422, 'Ce crédit n’a plus d’échéance à venir : il n’y a rien à anticiper.');
    }
    if (montant > Number(du[0].reste)) {
      throw new ApiError(
        422,
        `Le dépôt (${montant} F) dépasse ce qui reste dû (${du[0].reste} F). `
        + 'Pour éteindre le crédit, passez par le remboursement anticipé, qui applique la formule de rachat.'
      );
    }
    if (montant > Number(du[0].solde)) {
      throw new ApiError(
        422,
        `Le compte du client ne porte que ${du[0].solde} F : le dépôt de ${montant} F n’y est pas. `
        + 'Faites-le encaisser au guichet avant de déposer la demande.'
      );
    }
    corps.montant_depose = montant;
  } else if (kind === 'taux') {
    const taux = Number(details?.tauxMensuel);
    if (!Number.isFinite(taux) || taux <= 0) {
      throw new ApiError(422, 'Le taux mensuel doit être un nombre strictement positif (0,05 pour 5 %).');
    }
    const plafond = await getCeiling('credit_monthly');
    if (plafond !== null && taux > plafond) {
      throw new ApiError(
        422,
        `Le plafond réglementaire est de ${(plafond * 100).toFixed(2)} %/mois : `
        + `${(taux * 100).toFixed(2)} % le dépasse.`
      );
    }
    corps.taux_mensuel = taux;
  } else {
    throw new ApiError(422, `Nature de demande inconnue : « ${kind} ».`);
  }

  try {
    const { rows } = await query(
      `INSERT INTO credit_modification_requests (credit_id, kind, motif, details, requested_by)
       VALUES ($1, $2::credit_modification_kind, $3, $4::jsonb, $5)
       RETURNING id, status::text AS status`,
      [creditId, kind, motif.trim(), JSON.stringify(corps), actorId]
    );
    return { ...rows[0], reference: credit[0].reference, client: credit[0].client };
  } catch (error) {
    if (error.code === '23505' || error.code === '23P01') {
      throw new ApiError(
        409,
        'Une demande de même nature est déjà en cours sur ce dossier. '
        + 'Faites-la trancher avant d’en déposer une autre.'
      );
    }
    throw error;
  }
}

/** L'accord de l'opérateur : deuxième maillon, rien ne s'applique encore. */
export async function donnerAccord({ requestId, note, actorId }) {
  const { rows } = await query(
    `UPDATE credit_modification_requests
     SET status = 'en_attente_directeur', accord_par = $2, accord_le = now(), accord_note = $3
     WHERE id = $1 AND status = 'en_attente_operateur'
     RETURNING id, credit_id, kind::text AS kind, status::text AS status`,
    [requestId, actorId, note?.trim() || null]
  ).catch((error) => {
    if (error.constraint === 'no_self_accord_modif') {
      throw new ApiError(422, 'Vous avez déposé cette demande : un autre agent doit donner l’accord.');
    }
    throw error;
  });
  if (!rows[0]) {
    throw new ApiError(409, 'Cette demande n’attend pas l’accord de l’opérateur — elle est déjà passée ou tranchée.');
  }
  return rows[0];
}

/** Refus, à l'une ou l'autre étape. Rien n'a bougé, il n'y a rien à défaire. */
export async function refuserModification({ requestId, note, actorId }) {
  if (!note || note.trim().length < 5) {
    throw new ApiError(422, 'Un motif de refus est requis (5 caractères minimum) : le gestionnaire doit savoir pourquoi.');
  }
  const { rows } = await query(
    `UPDATE credit_modification_requests
     SET status = 'rejete', decided_by = $2, decided_at = now(), decision_note = $3,
         accord_le = COALESCE(accord_le, now()),
         accord_par = COALESCE(accord_par, $2)
     WHERE id = $1 AND status IN ('en_attente_operateur', 'en_attente_directeur')
     RETURNING id, kind::text AS kind, status::text AS status`,
    [requestId, actorId, note.trim()]
  ).catch((error) => {
    if (error.constraint === 'no_self_decision_modif' || error.constraint === 'no_self_accord_modif') {
      throw new ApiError(422, 'Vous avez déposé cette demande : un autre agent doit la trancher.');
    }
    throw error;
  });
  if (!rows[0]) throw new ApiError(409, 'Cette demande est déjà tranchée.');
  return rows[0];
}

/**
 * La validation du directeur, et l'effet. L'effet est calculé ici et
 * consigné dans la colonne `effet` : savoir qu'une demande a été
 * approuvée sans savoir ce qu'elle a produit ne sert à rien six mois
 * plus tard.
 */
export async function validerModification({ requestId, note, actorId }) {
  const { rows: demandes } = await query(
    `SELECT m.id, m.credit_id, m.kind::text AS kind, m.details, m.status::text AS statut,
            m.requested_by, c.reference
     FROM credit_modification_requests m
     JOIN credit_requests c ON c.id = m.credit_id
     WHERE m.id = $1`,
    [requestId]
  );
  const demande = demandes[0];
  if (!demande) throw new ApiError(404, 'Demande introuvable.');
  if (demande.statut !== 'en_attente_directeur') {
    throw new ApiError(
      409,
      demande.statut === 'en_attente_operateur'
        ? 'L’opérateur n’a pas encore donné son accord sur cette demande.'
        : 'Cette demande est déjà tranchée.'
    );
  }
  if (demande.requested_by === actorId) {
    throw new ApiError(422, 'Vous avez déposé cette demande : un autre agent doit la valider.');
  }

  let effet;

  if (demande.kind === 'dates_echeances') {
    const jour = demande.details.jour ?? JOUR_DE_PRELEVEMENT_PAR_DEFAUT;
    effet = await withTransaction(async (client) => {
      const { rows: restantes } = await client.query(
        `SELECT id, sequence, to_char(due_date, 'YYYY-MM-DD') AS due
         FROM installments
         WHERE credit_id = $1 AND status <> 'payee'
         ORDER BY sequence
         FOR UPDATE`,
        [demande.credit_id]
      );
      if (!restantes.length) {
        throw new ApiError(422, 'Ce crédit n’a plus d’échéance à venir : il n’y a pas de date à changer.');
      }
      // On part du mois de la première échéance restante, pour ne pas
      // avancer ni reculer le dossier d'un mois en changeant son jour.
      const depart = restantes[0].due;
      const avant = restantes.map((r) => ({ sequence: r.sequence, due: r.due }));
      const apres = [];
      for (let i = 0; i < restantes.length; i += 1) {
        const cible = auJour(depart, i, jour);
        await client.query(
          `UPDATE installments SET due_date = $1::date WHERE id = $2`,
          [cible, restantes[i].id]
        );
        apres.push({ sequence: restantes[i].sequence, due: cible });
      }
      return { jour, echeances_redatees: restantes.length, avant, apres };
    });
  } else if (demande.kind === 'prelevement_supplementaire') {
    // `forcer` passe outre « un salaire paie une mensualité ». C'est le
    // seul endroit du logiciel qui le pose, et il a fallu trois
    // signatures pour y arriver.
    const r = await collectInstallments({
      echeanceIds: [demande.details.installment_id],
      actorId,
      forcer: true,
    });
    if (!r.preleves.length) {
      throw new ApiError(
        422,
        `Le prélèvement n’a pas pu passer : ${r.echecs[0]?.motif ?? 'motif inconnu'}. `
        + 'La demande reste en attente, rien n’a été écrit.'
      );
    }
    effet = {
      preleve: Number(r.preleves[0].amount),
      sequence: r.preleves[0].sequence,
      decouvert: Boolean(r.preleves[0].decouvert),
      solde_apres: r.preleves[0].soldeApres ?? null,
    };
  } else if (demande.kind === 'report_echeance') {
    // SAUTER UN MOIS, POUR UN CLIENT EN DIFFICULTÉ
    //
    // Les échéances restantes reculent toutes du même nombre de mois,
    // en gardant leur jour. Les MONTANTS ne changent pas : le report
    // est un pur décalage, sans intérêt supplémentaire. C'est la
    // lecture humaine de « client en difficulté » — on lui donne du
    // temps, on ne lui vend pas du temps. Si la direction veut faire
    // porter l'intérêt du mois sauté, c'est le seul endroit à changer,
    // et l'effet consigne `interets_ajoutes` pour que la question
    // reste visible dans l'historique.
    const mois = demande.details.mois ?? 1;
    effet = await withTransaction(async (client) => {
      const { rows: restantes } = await client.query(
        `SELECT id, sequence, to_char(due_date, 'YYYY-MM-DD') AS due
         FROM installments
         WHERE credit_id = $1 AND status <> 'payee'
         ORDER BY sequence
         FOR UPDATE`,
        [demande.credit_id]
      );
      if (!restantes.length) {
        throw new ApiError(422, 'Ce crédit n’a plus d’échéance à venir : il n’y a rien à reporter.');
      }
      const avant = restantes.map((r) => ({ sequence: r.sequence, due: r.due }));
      const apres = [];
      for (const r of restantes) {
        const d = new Date(`${r.due}T12:00:00Z`);
        const cible = auJour(r.due, mois, d.getUTCDate());
        await client.query(
          `UPDATE installments SET due_date = $1::date, status = 'a_venir' WHERE id = $2`,
          [cible, r.id]
        );
        apres.push({ sequence: r.sequence, due: cible });
      }
      return { mois, echeances_reportees: restantes.length, interets_ajoutes: 0, avant, apres };
    });
  } else if (demande.kind === 'taux') {
    // RÉVISER LE TAUX D'UN CRÉDIT EN COURS
    //
    // Le passé ne se refait pas : la révision ne porte que sur les
    // échéances restantes. Le capital restant se lit avec la même
    // formule que le rachat — capital × (n − k) / n — pour que les deux
    // écrans ne donnent jamais deux chiffres différents du même encours.
    // Puis `computeSchedule` recalcule la mensualité sur ce capital, le
    // nombre d'échéances restantes et le nouveau taux.
    const nouveauTaux = Number(demande.details.taux_mensuel);
    effet = await withTransaction(async (client) => {
      const { rows: credit } = await client.query(
        `SELECT amount::bigint AS capital, duration_months AS n,
                monthly_rate, monthly_payment::bigint AS mensualite,
                (SELECT count(*)::int FROM installments i
                  WHERE i.credit_id = $1 AND i.status = 'payee') AS payees
         FROM credit_requests WHERE id = $1 FOR UPDATE`,
        [demande.credit_id]
      );
      const c = credit[0];
      const restantes = c.n - c.payees;
      if (restantes <= 0) {
        throw new ApiError(422, 'Ce crédit n’a plus d’échéance à venir : son taux n’a plus d’effet.');
      }

      const capitalRestant = Math.round((Number(c.capital) * restantes) / c.n);
      const { monthlyPayment, totalDue } = computeSchedule(capitalRestant, restantes, nouveauTaux);

      const { rows: lignes } = await client.query(
        `SELECT id, sequence FROM installments
         WHERE credit_id = $1 AND status <> 'payee' ORDER BY sequence FOR UPDATE`,
        [demande.credit_id]
      );
      // La dernière échéance absorbe l'arrondi, comme partout ailleurs :
      // sans cela le client resterait débiteur de quelques francs après
      // son dernier paiement.
      let reste = totalDue;
      for (let i = 0; i < lignes.length; i += 1) {
        const montant = i === lignes.length - 1 ? reste : monthlyPayment;
        reste -= montant;
        await client.query('UPDATE installments SET amount = $1 WHERE id = $2', [montant, lignes[i].id]);
      }

      await client.query(
        `UPDATE credit_requests SET monthly_rate = $1, monthly_payment = $2, updated_at = now()
         WHERE id = $3`,
        [nouveauTaux, monthlyPayment, demande.credit_id]
      );

      return {
        ancien_taux: Number(c.monthly_rate),
        nouveau_taux: nouveauTaux,
        capital_restant: capitalRestant,
        echeances_restantes: restantes,
        ancienne_mensualite: Number(c.mensualite),
        nouvelle_mensualite: monthlyPayment,
        total_restant_du: totalDue,
      };
    });
  } else if (demande.kind === 'montant') {
    // REMBOURSEMENT ANTICIPÉ PARTIEL
    //
    // « Le capital baisse sans toucher aux intérêts, car le logiciel a
    //   déjà calculé ce qu'il attend. » (direction, 09/11/2026)
    //
    // Donc aucune remise : CPG garde l'intégralité des intérêts
    // calculés à l'octroi, et le dépôt s'impute franc pour franc sur ce
    // qui reste dû. C'est l'inverse du rachat (migration 051), qui
    // abandonne 65 % des intérêts restants — le rachat éteint le
    // crédit, celui-ci l'allège seulement.
    //
    // Et il FAUT encaisser : réduire la dette sans débiter le compte
    // ferait perdre à la maison le montant du dépôt. L'argent déposé
    // est donc prélevé par une écriture `paiement_credit`, puis imputé
    // sur les échéances LES PLUS PROCHES — « le client a anticipé sur
    // la prochaine échéance », ce sont celles-là qu'il veut solder.
    const montant = Number(demande.details.montant_depose);
    effet = await withTransaction(async (client) => {
      const { rows: compte } = await client.query(
        `SELECT a.id AS account_id, COALESCE(b.balance, 0)::bigint AS solde
         FROM credit_requests c
         JOIN accounts a ON a.user_id = c.user_id
         LEFT JOIN account_balances b ON b.account_id = a.id
         WHERE c.id = $1
         ORDER BY a.created_at LIMIT 1
         FOR UPDATE OF a`,
        [demande.credit_id]
      );
      if (!compte[0]) throw new ApiError(422, 'Ce client n’a pas de compte.');
      if (Number(compte[0].solde) < montant) {
        throw new ApiError(
          422,
          `Le compte ne porte plus que ${compte[0].solde} F : le dépôt de ${montant} F n’y est plus. `
          + 'Rien n’a été écrit.'
        );
      }

      const { rows: ecriture } = await client.query(
        `INSERT INTO ledger_entries (account_id, type, amount, label, reference, created_by)
         VALUES ($1, 'paiement_credit', $2, $3, $4, $5)
         RETURNING id`,
        [compte[0].account_id, -montant,
         `Remboursement anticipé partiel — crédit ${demande.reference}`,
         demande.reference, actorId]
      );

      const { rows: lignes } = await client.query(
        `SELECT id, sequence, amount::bigint AS amount FROM installments
         WHERE credit_id = $1 AND status <> 'payee' ORDER BY sequence FOR UPDATE`,
        [demande.credit_id]
      );

      let reste = montant;
      const soldees = [];
      let allegee = null;
      for (const l of lignes) {
        if (reste <= 0) break;
        if (reste >= Number(l.amount)) {
          await client.query(
            `UPDATE installments SET status = 'payee', paid_at = now(), ledger_entry_id = $1
             WHERE id = $2`,
            [ecriture[0].id, l.id]
          );
          reste -= Number(l.amount);
          soldees.push({ sequence: l.sequence, montant: Number(l.amount) });
        } else {
          const nouveau = Number(l.amount) - reste;
          await client.query('UPDATE installments SET amount = $1 WHERE id = $2', [nouveau, l.id]);
          allegee = { sequence: l.sequence, avant: Number(l.amount), apres: nouveau, impute: reste };
          reste = 0;
        }
      }

      // Plus rien à payer : le crédit se solde, comme à la dernière
      // échéance d'un amortissement normal.
      const { rows: encore } = await client.query(
        `SELECT count(*)::int AS n FROM installments
         WHERE credit_id = $1 AND status <> 'payee'`,
        [demande.credit_id]
      );
      let solde = false;
      if (encore[0].n === 0) {
        await client.query(
          `UPDATE credit_requests SET status = 'solde', updated_at = now() WHERE id = $1`,
          [demande.credit_id]
        );
        solde = true;
      }

      return {
        montant_impute: montant,
        interets_remis: 0,
        echeances_soldees: soldees,
        echeance_allegee: allegee,
        echeances_restantes: encore[0].n,
        credit_solde: solde,
        solde_compte_apres: Number(compte[0].solde) - montant,
      };
    });
  } else {
    throw new ApiError(422, `Nature de demande non applicable : « ${demande.kind} ».`);
  }

  const { rows } = await query(
    `UPDATE credit_modification_requests
     SET status = 'approuve', decided_by = $2, decided_at = now(),
         decision_note = $3, effet = $4::jsonb
     WHERE id = $1 AND status = 'en_attente_directeur'
     RETURNING id, kind::text AS kind, status::text AS status, effet`,
    [requestId, actorId, note?.trim() || null, JSON.stringify(effet)]
  );
  if (!rows[0]) throw new ApiError(409, 'Cette demande vient d’être tranchée par quelqu’un d’autre.');
  return { ...rows[0], reference: demande.reference };
}

/**
 * Les demandes, pour les écrans. `status` filtre ; sans lui, on renvoie
 * tout ce qui est en cours, les deux étapes confondues — c'est la vue
 * dont le gestionnaire a besoin pour suivre ce qu'il a déposé.
 */
export async function listerModifications({ status = null, creditId = null, limite = 200 } = {}) {
  const { rows } = await query(
    `SELECT m.id, m.kind::text AS kind, m.status::text AS status, m.motif,
            m.details, m.effet,
            to_char(m.requested_at, 'YYYY-MM-DD HH24:MI') AS demande_le,
            btrim(dem.full_name) AS demande_par,
            to_char(m.accord_le, 'YYYY-MM-DD HH24:MI') AS accord_le,
            btrim(acc.full_name) AS accord_par, m.accord_note,
            to_char(m.decided_at, 'YYYY-MM-DD HH24:MI') AS decide_le,
            btrim(dec.full_name) AS decide_par, m.decision_note,
            c.id AS credit_id, c.reference, c.amount::bigint AS capital,
            c.monthly_payment::bigint AS mensualite,
            btrim(u.full_name) AS client, u.client_number,
            btrim(COALESCE(u.employer, '—')) AS employeur,
            COALESCE(b.balance, 0)::bigint AS solde,
            (SELECT count(*)::int FROM installments i
              WHERE i.credit_id = c.id AND i.status <> 'payee') AS echeances_restantes,
            (SELECT to_char(min(i.due_date), 'YYYY-MM-DD') FROM installments i
              WHERE i.credit_id = c.id AND i.status <> 'payee') AS prochaine_echeance
     FROM credit_modification_requests m
     JOIN credit_requests c ON c.id = m.credit_id
     JOIN users u ON u.id = c.user_id
     JOIN accounts a ON a.user_id = u.id
     LEFT JOIN account_balances b ON b.account_id = a.id
     JOIN users dem ON dem.id = m.requested_by
     LEFT JOIN users acc ON acc.id = m.accord_par
     LEFT JOIN users dec ON dec.id = m.decided_by
     WHERE ($1::text IS NULL OR m.status::text = $1)
       AND ($2::uuid IS NULL OR m.credit_id = $2)
     ORDER BY m.requested_at DESC
     LIMIT $3`,
    [status, creditId, limite]
  );
  return rows;
}
