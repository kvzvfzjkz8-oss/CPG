import { query, withTransaction } from '../db/index.js';

/**
 * ═══════════════════════════════════════════════════════════════════
 *  DÉCOUVERT AUTORISÉ
 * ═══════════════════════════════════════════════════════════════════
 *
 * « Ce produit, lorsqu'un client le prend ou le sollicite, suit le même
 *   cours que les autres crédits. Sa différence est dans sa
 *   récupération, car il est mis directement en négation du compte :
 *   son compte n'est pas crédité mais plutôt débité — c'est un débit
 *   autorisé en fait. »
 *
 * Tout le circuit est celui d'un crédit ordinaire. Ce fichier ne porte
 * que les trois endroits où le découvert s'en écarte :
 *
 *   • l'autorisation — l'approbation n'écrit aucune écriture. Elle
 *     ouvre un droit à débit. « Le client repart avec les billets, et
 *     c'est le retrait au guichet qui met le compte en négatif, pas
 *     l'approbation » (direction, 30/10/2026). L'argent sort donc par
 *     la caisse, validé par le directeur, comme tout retrait ;
 *
 *   • l'encours — il n'est pas tenu dans une colonne, il EST le
 *     négatif du compte. Un compte à -80 000 F sous une autorisation de
 *     100 000 F doit 80 000 F, et rien ne peut désynchroniser les deux ;
 *
 *   • l'intérêt mensuel, calculé sur cet encours, donc décroissant à
 *     mesure que le compte se renfloue (décision du 30/10/2026) ;
 *
 *   • la fin : le découvert est soldé quand le compte repasse à zéro.
 *
 * Ce qui n'est PAS ici, volontairement : aucun échéancier. La collecte
 * des échéances ne prélève que sur un compte provisionné et marque
 * « en retard » sinon — un découvert aurait accumulé des retards
 * perpétuels sans qu'un franc ne bouge.
 */

/** Le solde courant d'un compte, tel que la vue le donne. */
async function soldeDuCompte(run, accountId) {
  const { rows } = await run(
    'SELECT COALESCE(balance, 0) AS balance FROM account_balances WHERE account_id = $1',
    [accountId]
  );
  return Number(rows[0]?.balance ?? 0);
}

/**
 * Ce qu'il reste dû sur un découvert : la part du négatif du compte
 * couverte par l'autorisation.
 *
 * Le plafonnement à `montantAutorise` n'est pas cosmétique. Un compte
 * descendu à -120 000 F sous une autorisation de 100 000 F doit
 * 100 000 F au titre du découvert ; les 20 000 F au-delà sont un
 * découvert SUBI, qui relève des agios et non de ce produit. Sans ce
 * plafond, l'intérêt du produit s'appliquerait à un dépassement qu'il
 * n'a jamais autorisé.
 */
export function encoursDecouvert({ solde, montantAutorise }) {
  const negatif = Math.max(0, -Number(solde));
  return Math.min(Number(montantAutorise), negatif);
}

/**
 * Les découverts en cours, avec leur encours réel et leur échéance
 * d'autorisation. `echu` dit que la durée accordée est dépassée — le
 * découvert reste dû, mais il doit se voir.
 */
export async function fetchDecouvertsEnCours() {
  const { rows } = await query(
    `SELECT c.id, c.reference, c.amount AS montant_autorise, c.duration_months,
            c.approved_at, c.user_id,
            btrim(u.full_name) AS client, u.client_number,
            a.id AS account_id,
            COALESCE(b.balance, 0) AS solde,
            pv.monthly_rate,
            (c.approved_at + (c.duration_months || ' months')::interval) AS echeance_autorisation,
            (now() > c.approved_at + (c.duration_months || ' months')::interval) AS echu,
            -- Le découvert a-t-il été tiré ? Depuis que l'approbation
            -- n'écrit plus rien, un découvert accordé mais jamais
            -- utilisé laisse le compte à zéro. Sans ce témoin, le
            -- passage quotidien le déclarerait « soldé » dès le
            -- lendemain matin — un droit à débit jamais exercé serait
            -- fermé avant que le client ait eu le temps de venir.
            --
            -- Le témoin est le RETRAIT, pas le solde négatif : la
            -- commission d'octroi de 2,5 % met déjà le compte en
            -- négatif de quelques milliers de francs, et un test sur le
            -- signe du solde déclarait donc tiré un découvert auquel le
            -- client n'avait pas touché.
            --
            -- Si le doute subsiste, l'autorisation reste ouverte : une
            -- autorisation vivante fermée par erreur prive le client de
            -- son droit, l'inverse se voit simplement à l'écran.
            EXISTS (
              SELECT 1 FROM ledger_entries le
              WHERE le.account_id = a.id AND le.type = 'retrait'
                AND le.created_at >= c.approved_at
            ) AS tire
     FROM credit_requests c
     JOIN product_versions pv ON pv.id = c.product_version_id
     JOIN credit_products p ON p.id = pv.product_id
     JOIN users u ON u.id = c.user_id
     JOIN accounts a ON a.user_id = c.user_id
     LEFT JOIN account_balances b ON b.account_id = a.id
     WHERE p.nature = 'decouvert' AND c.status = 'approuve'
     ORDER BY c.approved_at`
  );

  return rows.map((r) => ({
    id: r.id,
    reference: r.reference,
    clientId: r.user_id,
    client: r.client,
    numeroClient: r.client_number,
    accountId: r.account_id,
    montantAutorise: Number(r.montant_autorise),
    solde: Number(r.solde),
    encours: encoursDecouvert({ solde: r.solde, montantAutorise: r.montant_autorise }),
    depassement: Math.max(0, -Number(r.solde) - Number(r.montant_autorise)),
    tauxMensuel: Number(r.monthly_rate),
    dureeMois: r.duration_months,
    approuveLe: r.approved_at,
    echeanceAutorisation: r.echeance_autorisation,
    echu: r.echu,
    tire: r.tire,
  }));
}

/** Le mois en cours, au format des périodes de frais. */
function moisCourant(date = new Date()) {
  const debut = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const fin = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  return { debut: debut.toISOString().slice(0, 10), fin: fin.toISOString().slice(0, 10) };
}

/**
 * L'intérêt du mois a-t-il déjà été prélevé sur ce découvert ?
 *
 * Garde-fou indispensable : la tâche peut être relancée à la main après
 * un échec, et un intérêt prélevé deux fois est de l'argent pris au
 * client. On reconnaît l'écriture par sa référence ET son mois.
 */
async function interetDejaPreleve(run, { reference, debut, fin }) {
  const { rows } = await run(
    `SELECT id, amount FROM ledger_entries
     WHERE reference = $1 AND type = 'paiement_credit'
       AND created_at >= $2::date AND created_at < ($3::date + 1)
     LIMIT 1`,
    [reference, debut, fin]
  );
  return rows[0] ?? null;
}

/**
 * Prélève l'intérêt du mois sur un découvert, et solde le découvert si
 * le compte est déjà repassé à zéro.
 *
 * L'écriture est un `paiement_credit` comme l'intérêt d'un crédit
 * ordinaire : c'est le même produit financier, et le coffre
 * « Remboursements » l'encaisse donc sans traitement particulier.
 */
async function traiterUnDecouvert(client, { dec, actorId, debut, fin }) {
  const solde = await soldeDuCompte((sql, p) => client.query(sql, p), dec.accountId);

  // Compte revenu à flot : le découvert est éteint. On ne prélève plus
  // d'intérêt — il n'y a plus d'encours sur lequel en calculer.
  //
  // `dec.tire` est la condition qui manque à « solde >= 0 » : une
  // autorisation accordée mais pas encore utilisée laisse le compte à
  // zéro, et serait fermée avant que le client ait eu le temps de
  // passer au guichet.
  if (dec.tire && solde >= 0) {
    await client.query(
      `UPDATE credit_requests SET status = 'solde' WHERE id = $1 AND status = 'approuve'`,
      [dec.id]
    );
    return { reference: dec.reference, client: dec.client, action: 'solde', interet: 0 };
  }

  const encours = encoursDecouvert({ solde, montantAutorise: dec.montantAutorise });
  const interet = Math.round(encours * dec.tauxMensuel);
  if (interet <= 0) {
    return { reference: dec.reference, client: dec.client, action: 'rien', interet: 0 };
  }

  const deja = await interetDejaPreleve((sql, p) => client.query(sql, p), {
    reference: dec.reference, debut, fin,
  });
  if (deja) {
    return { reference: dec.reference, client: dec.client, action: 'deja_fait', interet: 0 };
  }

  await client.query(
    `INSERT INTO ledger_entries (account_id, type, amount, label, reference, created_by)
     VALUES ($1, 'paiement_credit', $2, $3, $4, $5)`,
    [
      dec.accountId, -interet,
      `Intérêt découvert ${dec.reference} — ${debut.slice(0, 7)} sur ${encours} FCFA`,
      dec.reference, actorId,
    ]
  );

  return { reference: dec.reference, client: dec.client, action: 'interet', interet, encours };
}

/**
 * Le passage mensuel sur tous les découverts en cours. Un découvert en
 * échec n'arrête pas les autres : chacun a sa transaction.
 */
export async function runInteretsDecouvert({ actorId, date } = {}) {
  const { debut, fin } = moisCourant(date);
  const decouverts = await fetchDecouvertsEnCours();

  const resultats = [];
  for (const dec of decouverts) {
    try {
      const r = await withTransaction((client) => traiterUnDecouvert(client, {
        dec, actorId, debut, fin,
      }));
      resultats.push(r);
    } catch (error) {
      resultats.push({
        reference: dec.reference, client: dec.client, action: 'echec', interet: 0,
        message: error.message,
      });
    }
  }

  return {
    periode: debut.slice(0, 7),
    resultats,
    total: resultats.reduce((s, r) => s + r.interet, 0),
    soldes: resultats.filter((r) => r.action === 'solde').length,
    echecs: resultats.filter((r) => r.action === 'echec').length,
  };
}

/**
 * Appelé après tout mouvement créditeur sur un compte : si le solde est
 * repassé à zéro, les découverts de ce client sont éteints.
 *
 * Sans cela, un découvert remboursé resterait « approuvé » jusqu'au
 * passage mensuel, et le client apparaîtrait à tort comme engagé — ce
 * qui le bloquerait au dépôt d'un dossier en commission.
 */
export async function soldeLesDecouvertsSiCompteAFlot({ accountId, externalClient = null }) {
  const apply = async (client) => {
    const solde = await soldeDuCompte((sql, p) => client.query(sql, p), accountId);
    if (solde < 0) return { soldes: 0 };

    const { rows } = await client.query(
      `UPDATE credit_requests c
       SET status = 'solde'
       WHERE c.status = 'approuve'
         AND c.product_version_id IN (
           SELECT pv.id FROM product_versions pv
           JOIN credit_products p ON p.id = pv.product_id
           WHERE p.nature = 'decouvert'
         )
         AND c.user_id = (SELECT user_id FROM accounts WHERE id = $1)
       RETURNING c.id, c.reference`,
      [accountId]
    );
    return { soldes: rows.length, references: rows.map((r) => r.reference) };
  };

  return externalClient ? apply(externalClient) : withTransaction(apply);
}

/**
 * Jusqu'où le compte a le droit d'être négatif, jour par jour.
 *
 * Deux sources, cumulées :
 *
 *   • l'AUTORISATION, à partir du jour de l'accord. Elle ne correspond
 *     à aucune écriture : l'approbation ouvre un droit, elle ne verse
 *     rien. L'horodatage compte — sans lui, un découvert accordé le 29
 *     exonérerait tout le mois, et un client débiteur de 200 000 F
 *     depuis le 1er échapperait aux agios en obtenant son autorisation
 *     la veille du prélèvement ;
 *
 *   • ce que le découvert a lui-même CHARGÉ au compte : la commission
 *     d'octroi et les intérêts mensuels, reconnus à leur référence.
 *
 * La seconde source corrige un piège que l'autorisation seule ne voyait
 * pas : sur une autorisation de 200 000 F entièrement tirée, le compte
 * est à -200 000 F, et l'intérêt du mois le descend à -210 000 F. Les
 * 10 000 F d'écart auraient été lus comme un dépassement du client et
 * auraient déclenché les agios — l'intérêt du découvert se serait taxé
 * lui-même, tous les mois.
 *
 * Cette limite sert deux fois : elle dit aux agios ce qui est autorisé,
 * et au guichet jusqu'où un retrait peut descendre. Les deux doivent
 * répondre la même chose, sinon le logiciel autorise un retrait puis
 * en facture les agios.
 *
 * Seuls les découverts « approuve » comptent : une autorisation soldée
 * est consommée, et si le compte replonge ensuite, les agios
 * s'appliquent de nouveau.
 *
 * Le calcul lui-même vit dans la vue `decouverts_autorisations_jour`
 * (migration 054) : la même limite est lue par le guichet, par sa
 * validation, par l'écran de la caissière et par les agios. Quatre
 * requêtes séparées auraient fini par diverger, et le logiciel aurait
 * autorisé un retrait puis facturé les agios dessus.
 */
export async function autorisationsDecouvert(accountId, externalClient = null) {
  const run = externalClient
    ? (sql, params) => externalClient.query(sql, params)
    : query;

  const { rows } = await run(
    `SELECT jour, montant FROM decouverts_autorisations_jour
     WHERE account_id = $1 ORDER BY jour`,
    [accountId]
  );

  return rows.map((r) => ({
    jour: r.jour instanceof Date ? r.jour.toISOString().slice(0, 10) : String(r.jour).slice(0, 10),
    montant: Number(r.montant),
  }));
}

/**
 * Le plafond de négatif autorisé sur un compte AUJOURD'HUI — somme des
 * autorisations en cours et de ce qu'elles ont déjà chargé.
 *
 * C'est ce que le guichet doit consulter avant de refuser un retrait
 * pour solde insuffisant : un client disposant d'un découvert autorisé
 * de 200 000 F peut retirer jusqu'à 200 000 F sur un compte à zéro.
 * Les frais d'octroi n'entament pas son droit de tirage — il a obtenu
 * 200 000 F, il doit pouvoir repartir avec 200 000 F.
 */
export async function plafondNegatifAutorise(accountId, externalClient = null) {
  const run = externalClient
    ? (sql, params) => externalClient.query(sql, params)
    : query;
  const { rows } = await run(
    `SELECT COALESCE(SUM(montant), 0) AS plafond FROM decouverts_autorisations_jour
     WHERE account_id = $1`,
    [accountId]
  );
  return Number(rows[0].plafond);
}

/**
 * Remonte les soldes journaliers de la part autorisée en découvert :
 * un négatif couvert par une autorisation n'est plus un solde
 * débiteur, et ne porte donc pas d'agios.
 *
 * Fonction pure, pour qu'elle se vérifie en test sans base.
 */
export function neutraliserDecouvertAutorise(dailyBalances, autorisations) {
  if (!autorisations?.length) return dailyBalances;
  return dailyBalances.map((d) => {
    const autorise = autorisations
      .filter((a) => a.jour <= d.date)
      .reduce((s, a) => s + a.montant, 0);
    return { ...d, balance: Number(d.balance) + autorise };
  });
}

/**
 * Passage quotidien : éteint les découverts dont le compte est repassé
 * à flot. Un découvert remboursé qui resterait « approuvé » ferait
 * apparaître le client comme encore engagé.
 */
export async function soldeLesDecouvertsAFlot() {
  const decouverts = await fetchDecouvertsEnCours();
  const eteints = [];
  for (const dec of decouverts) {
    // Même garde-fou que dans traiterUnDecouvert : on n'éteint que ce
    // qui a été tiré. Une autorisation jamais utilisée reste ouverte
    // jusqu'au terme de sa durée.
    if (!dec.tire || dec.solde < 0) continue;
    try {
      const r = await soldeLesDecouvertsSiCompteAFlot({ accountId: dec.accountId });
      if (r.soldes > 0) eteints.push({ reference: dec.reference, client: dec.client });
    } catch (error) {
      eteints.push({ reference: dec.reference, client: dec.client, message: error.message });
    }
  }
  return { eteints, nombre: eteints.length };
}
