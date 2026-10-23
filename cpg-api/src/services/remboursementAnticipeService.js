import { query, withTransaction } from '../db/index.js';
import { ApiError } from '../middleware/errorHandler.js';
import { DEFAULT_MONTHLY_RATE } from './creditService.js';

/**
 * ═══════════════════════════════════════════════════════════════════
 *  REMBOURSEMENT ANTICIPÉ D'UN CRÉDIT
 * ═══════════════════════════════════════════════════════════════════
 *
 * « Possibilité de rachat d'un crédit. Il faut regarder comment on peut
 *   le faire. »
 *
 * Le rachat — un nouveau crédit qui solde l'ancien — se pose sur cette
 * brique : solder un crédit avant son terme. Elle est utile seule, un
 * agent qui veut solder avec son propre argent n'avait aucun moyen de
 * le faire.
 *
 * ─── LE CALCUL, ET POURQUOI IL N'EST PAS FIGÉ ─────────────────────
 *
 * Les intérêts de CPG sont en INTÉRÊT SIMPLE, posés d'avance sur toute
 * la durée : total = capital × (1 + taux × durée). Chaque mensualité
 * porte donc capital/n + intérêt/n. Après k échéances payées sur n :
 *
 *     capital restant    = capital × (n − k) / n
 *     intérêts non courus = intérêt × (n − k) / n
 *     reste des mensualités = les deux additionnés
 *
 * Faire payer les intérêts non courus, c'est facturer des mois que le
 * client n'utilisera pas. Dans un rachat, il les paierait DEUX FOIS :
 * une fois sur l'ancien crédit, une fois sur le nouveau qui couvre la
 * même période.
 *
 * Le choix entre les deux bases engage l'établissement sur des années
 * et appartient à la direction. Il est donc lu dans
 * remboursement_anticipe_regles, versionné, et AUCUNE règle n'existe
 * par défaut : tant que la direction n'en a pas posé une, rien ne peut
 * être soldé et le message le dit.
 */

/** La règle en vigueur, ou null si la direction n'en a pas encore posé. */
export async function fetchRegleEnVigueur() {
  const { rows } = await query(
    `SELECT r.id, r.base, r.indemnite_mois, r.echeances_minimum, r.note,
            r.definie_le, btrim(u.full_name) AS definie_par_nom
     FROM remboursement_anticipe_regles r
     JOIN users u ON u.id = r.definie_par
     WHERE r.remplacee_le IS NULL`
  );
  return rows[0] ?? null;
}

/** L'historique des règles, la plus récente d'abord — la trace des décisions. */
export async function fetchHistoriqueRegles() {
  const { rows } = await query(
    `SELECT r.id, r.base, r.indemnite_mois, r.echeances_minimum, r.note,
            r.definie_le, r.remplacee_le, btrim(u.full_name) AS definie_par_nom
     FROM remboursement_anticipe_regles r
     JOIN users u ON u.id = r.definie_par
     ORDER BY r.definie_le DESC
     LIMIT 50`
  );
  return rows;
}

/**
 * Pose une nouvelle règle. L'ancienne est datée, jamais écrasée : un
 * client contestant un solde doit pouvoir se voir opposer la règle qui
 * s'appliquait ce jour-là.
 */
export async function definirRegle({ base, indemniteMois = 0, echeancesMinimum = 1, note, actorId }) {
  if (!['capital_restant', 'reste_mensualites'].includes(base)) {
    throw new ApiError(422, 'Base inconnue : « capital_restant » ou « reste_mensualites » attendu.');
  }
  if (base === 'reste_mensualites' && Number(indemniteMois) !== 0) {
    throw new ApiError(
      422,
      'Une indemnité par-dessus le reste des mensualités serait comptée deux fois : cette base '
      + 'contient déjà la totalité des intérêts, y compris ceux des mois non utilisés.'
    );
  }

  return withTransaction(async (client) => {
    await client.query(
      `UPDATE remboursement_anticipe_regles SET remplacee_le = now() WHERE remplacee_le IS NULL`
    );
    const { rows } = await client.query(
      `INSERT INTO remboursement_anticipe_regles
         (base, indemnite_mois, echeances_minimum, note, definie_par)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, base, indemnite_mois, echeances_minimum, note, definie_le`,
      [base, indemniteMois, echeancesMinimum, note ?? null, actorId]
    );
    return rows[0];
  });
}

/**
 * Retire la règle en vigueur, sans en poser de nouvelle.
 *
 * Suspendre les remboursements anticipés est une décision en soi : la
 * direction peut vouloir fermer la porte le temps de revoir sa
 * politique, plutôt que de laisser courir une règle qu'elle ne veut
 * plus. Après ça, plus aucun crédit n'est soldable et le logiciel le
 * dit — comme avant toute première décision.
 *
 * La règle retirée reste dans l'historique avec sa date : on ne perd
 * jamais la trace de ce qui s'appliquait.
 */
export async function retirerRegle() {
  const { rows } = await query(
    `UPDATE remboursement_anticipe_regles SET remplacee_le = now()
     WHERE remplacee_le IS NULL
     RETURNING id, base`
  );
  if (!rows[0]) throw new ApiError(409, 'Aucune règle n’est en vigueur — rien à retirer.');
  return rows[0];
}

/**
 * Ce qu'il faudrait payer aujourd'hui pour solder ce crédit, et le
 * détail du calcul.
 *
 * On renvoie TOUJOURS les deux bases, pas seulement celle retenue :
 * le comité doit voir ce qu'il réclame et ce à quoi il renonce. Un
 * montant seul ne permet pas de décider.
 */
export async function calculerSolde({ creditId, client: externalClient }) {
  const runner = externalClient ?? { query };

  const { rows } = await runner.query(
    `SELECT c.id, c.reference, c.amount, c.duration_months, c.monthly_rate, c.status::text,
            c.user_id, btrim(u.full_name) AS client_nom, u.client_number,
            (SELECT count(*)::int FROM installments i WHERE i.credit_id = c.id) AS echeances_total,
            (SELECT count(*)::int FROM installments i
             WHERE i.credit_id = c.id AND i.status = 'payee') AS echeances_payees,
            COALESCE((SELECT SUM(i.amount) FROM installments i
                      WHERE i.credit_id = c.id AND i.status <> 'payee'), 0)::bigint AS reste_mensualites,
            COALESCE(b.balance, 0)::bigint AS solde_client
     FROM credit_requests c
     JOIN users u ON u.id = c.user_id
     LEFT JOIN accounts a ON a.user_id = u.id
     LEFT JOIN account_balances b ON b.account_id = a.id
     WHERE c.id = $1`,
    [creditId]
  );
  const credit = rows[0];
  if (!credit) throw new ApiError(404, 'Crédit introuvable.');
  if (credit.status !== 'approuve') {
    throw new ApiError(
      409,
      credit.status === 'solde'
        ? 'Ce crédit est déjà soldé.'
        : `Seul un crédit en cours peut être soldé par anticipation (celui-ci est « ${credit.status} »).`
    );
  }

  const n = Number(credit.echeances_total);
  const k = Number(credit.echeances_payees);
  if (n === 0) throw new ApiError(422, 'Ce crédit n’a pas d’échéancier — rien à solder.');
  if (k >= n) throw new ApiError(409, 'Toutes les échéances sont déjà payées.');

  const capital = Number(credit.amount);
  const taux = Number(credit.monthly_rate ?? DEFAULT_MONTHLY_RATE);
  const resteMensualites = Number(credit.reste_mensualites);

  // Intérêt simple : la part de capital est linéaire sur les échéances.
  const capitalRestant = Math.round((capital * (n - k)) / n);
  // Ce que CPG abandonnerait en soldant sur le capital seul.
  const interetsNonCourus = Math.max(0, resteMensualites - capitalRestant);

  const regle = await fetchRegleEnVigueur();
  if (!regle) {
    throw new ApiError(
      422,
      'Aucune règle de remboursement anticipé n’est en vigueur. La direction doit d’abord '
      + 'choisir la base du calcul — capital restant, ou reste des mensualités — avant qu’un '
      + 'crédit puisse être soldé en avance.'
    );
  }

  const indemnite = regle.base === 'capital_restant'
    ? Math.round(capitalRestant * taux * Number(regle.indemnite_mois))
    : 0;
  const assiette = regle.base === 'capital_restant' ? capitalRestant : resteMensualites;
  const montant = assiette + indemnite;

  const echeancesManquantes = Math.max(0, Number(regle.echeances_minimum) - k);

  return {
    credit: {
      id: credit.id,
      reference: credit.reference,
      client: credit.client_nom,
      clientNumber: credit.client_number,
      capital,
      tauxMensuel: taux,
      echeancesPayees: k,
      echeancesTotal: n,
    },
    regle: {
      id: regle.id,
      base: regle.base,
      indemniteMois: Number(regle.indemnite_mois),
      echeancesMinimum: Number(regle.echeances_minimum),
      definieLe: regle.definie_le,
      definiePar: regle.definie_par_nom,
    },
    // Les deux lectures, toujours : c'est ce qui permet de décider.
    capitalRestant,
    resteMensualites,
    interetsNonCourus,
    indemnite,
    montant,
    soldeClient: Number(credit.solde_client),
    // Le client peut-il solder avec son propre argent, maintenant ?
    couvertParLeSolde: Number(credit.solde_client) >= montant,
    // Bloquant : pas assez d'échéances payées pour que la règle l'autorise.
    echeancesManquantes,
    possible: echeancesManquantes === 0,
  };
}

/**
 * Solde réellement le crédit.
 *
 * Trois écritures de principe, et aucune de plus :
 *
 *   • un « paiement_credit » du montant calculé, qui débite le client ;
 *   • les échéances restantes passent « payee », rattachées à cette
 *     écriture — jamais supprimées ;
 *   • le crédit passe « solde », avec la trace de l'anticipation : la
 *     date, l'auteur, le montant, la règle appliquée, et le crédit
 *     ayant financé l'opération s'il s'agit d'un rachat.
 *
 * `rachatParCreditId` distingue les deux cas : le client solde avec son
 * propre argent (null), ou un nouveau crédit finance le solde. Dans le
 * second cas on ne vérifie pas le solde du compte avant le débit :
 * c'est le déblocage du nouveau crédit qui vient de l'approvisionner,
 * dans la même transaction.
 */
export async function soldeParAnticipation({
  creditId, actorId, rachatParCreditId = null, client: externalClient,
}) {
  const executer = async (client) => {
    const calcul = await calculerSolde({ creditId, client });

    if (!calcul.possible) {
      throw new ApiError(
        422,
        `La règle en vigueur exige ${calcul.regle.echeancesMinimum} échéance(s) payée(s) avant un `
        + `solde anticipé ; il en manque ${calcul.echeancesManquantes}.`
      );
    }

    const { rows: compte } = await client.query(
      `SELECT a.id AS account_id, COALESCE(b.balance, 0) AS balance
       FROM accounts a
       LEFT JOIN account_balances b ON b.account_id = a.id
       WHERE a.user_id = (SELECT user_id FROM credit_requests WHERE id = $1)
       ORDER BY a.created_at LIMIT 1
       FOR UPDATE OF a`,
      [creditId]
    );
    if (!compte[0]) throw new ApiError(404, 'Compte du client introuvable.');

    // Un solde payé par le client doit être couvert. Un rachat, non :
    // le nouveau crédit vient d'approvisionner le compte juste avant,
    // dans cette même transaction.
    if (!rachatParCreditId && Number(compte[0].balance) < calcul.montant) {
      throw new ApiError(
        422,
        `Le solde de ${calcul.credit.client} est de ${Number(compte[0].balance)} FCFA — insuffisant `
        + `pour solder ${calcul.montant} FCFA.`
      );
    }

    const libelle = rachatParCreditId
      ? `Solde anticipé — crédit ${calcul.credit.reference} racheté`
      : `Solde anticipé — crédit ${calcul.credit.reference}`;

    const { rows: ecriture } = await client.query(
      `INSERT INTO ledger_entries (account_id, type, amount, label, reference, created_by)
       VALUES ($1, 'paiement_credit', $2, $3, $4, $5)
       RETURNING id`,
      [compte[0].account_id, -calcul.montant, libelle, calcul.credit.reference, actorId]
    );

    // Les échéances restantes sont réglées par cette écriture. On les
    // rattache toutes à elle : c'est ce qui permet, des mois plus tard,
    // de retrouver par quoi elles ont été payées.
    const { rowCount: echeancesSoldees } = await client.query(
      `UPDATE installments
       SET status = 'payee', paid_at = now(), ledger_entry_id = $2
       WHERE credit_id = $1 AND status <> 'payee'`,
      [creditId, ecriture[0].id]
    );

    await client.query(
      `UPDATE credit_requests
       SET status = 'solde',
           solde_par_anticipation_le = now(),
           solde_par_anticipation_par = $2,
           solde_par_anticipation_montant = $3,
           solde_par_anticipation_regle = $4,
           rachete_par_credit_id = $5
       WHERE id = $1`,
      [creditId, actorId, calcul.montant, calcul.regle.id, rachatParCreditId]
    );

    return {
      reference: calcul.credit.reference,
      client: calcul.credit.client,
      montant: calcul.montant,
      capitalRestant: calcul.capitalRestant,
      interetsAbandonnes: calcul.regle.base === 'capital_restant' ? calcul.interetsNonCourus : 0,
      indemnite: calcul.indemnite,
      echeancesSoldees,
      ledgerEntryId: ecriture[0].id,
      rachat: Boolean(rachatParCreditId),
    };
  };

  return externalClient ? executer(externalClient) : withTransaction(executer);
}
