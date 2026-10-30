import { query, withTransaction } from '../db/index.js';
import { ApiError } from '../middleware/errorHandler.js';

/**
 * Les trois coffres de l'entreprise :
 *   - frais_agios     : frais de tenue de compte + agios sur solde
 *                        débiteur — même compte, comme demandé.
 *   - remboursements  : capital et intérêts reçus des clients,
 *                        ensemble (pas de séparation pour l'instant).
 *   - frais_dossier   : commission prélevée au déblocage de chaque
 *                        crédit accordé.
 *
 * Chaque solde se lit directement depuis applied_fees / ledger_entries
 * — jamais désynchronisé, pas de double écriture à chaque prélèvement
 * existant. Seuls les transferts (entre coffres, ou vers la caisse
 * principale) sont enregistrés, car eux ne se déduisent pas déjà d'une
 * autre table.
 *
 * Clôture mensuelle : le directeur peut, d'un clic, archiver le solde
 * courant d'un coffre (table coffre_clotures) — le solde affiché
 * repart alors de zéro, car le calcul du solde courant ne compte plus
 * que ce qui est arrivé APRÈS la dernière clôture. Aucune ligne
 * source n'est jamais modifiée ni supprimée ; l'historique complet
 * reste consultable via fetchCoffreClotures().
 */

const TYPES_VALIDES = ['frais_agios', 'remboursements', 'frais_dossier'];
const CODES_FRAIS_AGIOS = ['AGIOS_DECOUVERT', 'FRAIS_TENUE'];
const CODE_FRAIS_DOSSIER = 'COMM_CREDIT';

async function dernierePeriodeDebut(run, coffre) {
  const { rows } = await run(
    `SELECT periode_fin FROM coffre_clotures WHERE coffre = $1::coffre_type ORDER BY periode_fin DESC LIMIT 1`,
    [coffre]
  );
  return rows[0]?.periode_fin ?? null;
}

async function totalCollecte(run, coffre, depuis) {
  if (coffre === 'remboursements') {
    // paiement_credit est écrit en négatif côté compte client (débit —
    // voir la convention de signe de ledger_entries, migration 001) :
    // l'argent sort de son solde pour rembourser le crédit. Vu du
    // coffre de l'entreprise c'est l'inverse, une entrée — d'où le
    // -SUM(amount), sans quoi le coffre affichait un solde négatif
    // alors que de l'argent a bien été encaissé.
    const { rows } = await run(
      `SELECT COALESCE(SUM(-amount), 0) AS total FROM ledger_entries
       WHERE type = 'paiement_credit' AND ($1::timestamptz IS NULL OR created_at > $1)`,
      [depuis]
    );
    return Number(rows[0].total);
  }

  const codes = coffre === 'frais_dossier' ? [CODE_FRAIS_DOSSIER] : CODES_FRAIS_AGIOS;
  const { rows } = await run(
    `SELECT COALESCE(SUM(af.amount), 0) AS total
     FROM applied_fees af
     JOIN fee_versions fv ON fv.id = af.fee_version_id
     JOIN fee_definitions f ON f.id = fv.fee_id
     WHERE f.code = ANY($1::text[]) AND ($2::timestamptz IS NULL OR af.created_at > $2)`,
    [codes, depuis]
  );
  return Number(rows[0].total);
}

async function totalTransferts(run, coffre, depuis) {
  const { rows } = await run(
    `SELECT
       COALESCE(SUM(CASE WHEN coffre_source = $1::coffre_type THEN montant ELSE 0 END), 0) AS sorti,
       COALESCE(SUM(CASE WHEN destination = $1::text THEN montant ELSE 0 END), 0) AS entre
     FROM coffre_transferts
     WHERE (coffre_source = $1::coffre_type OR destination = $1::text)
       AND ($2::timestamptz IS NULL OR created_at > $2)`,
    [coffre, depuis]
  );
  return { sorti: Number(rows[0].sorti), entre: Number(rows[0].entre) };
}

/** Solde (depuis la dernière clôture) et derniers mouvements des trois coffres. */
export async function fetchCoffres() {
  const coffres = [];
  for (const type of TYPES_VALIDES) {
    const depuis = await dernierePeriodeDebut(query, type);
    const collecte = await totalCollecte(query, type, depuis);
    const { sorti, entre } = await totalTransferts(query, type, depuis);
    coffres.push({ type, solde: collecte - sorti + entre, collecte, sorti, entre, periodeDepuis: depuis });
  }

  const { rows: mouvements } = await query(
    `SELECT t.id, t.coffre_source, t.destination, t.montant, t.motif, t.created_at,
            u.full_name AS cree_par
     FROM coffre_transferts t
     JOIN users u ON u.id = t.cree_par
     ORDER BY t.created_at DESC
     LIMIT 30`
  );

  return { coffres, mouvements };
}

/**
 * Transfert d'un coffre vers un autre coffre, ou vers la caisse
 * principale — réservé au directeur. Refusé si le coffre source n'a
 * pas assez pour couvrir le montant (solde depuis sa dernière
 * clôture).
 */
export async function transfererDepuisCoffre({ coffreSource, destination, montant, motif, actorId }) {
  if (!TYPES_VALIDES.includes(coffreSource)) {
    throw new ApiError(422, 'Coffre source invalide.');
  }
  if (destination !== 'caisse_principale' && !TYPES_VALIDES.includes(destination)) {
    throw new ApiError(422, 'Destination invalide.');
  }
  if (destination === coffreSource) {
    throw new ApiError(422, 'La source et la destination doivent être différentes.');
  }
  if (!Number.isInteger(montant) || montant <= 0) {
    throw new ApiError(422, 'Montant invalide.');
  }

  return withTransaction(async (client) => {
    const run = client.query.bind(client);
    // Verrouille implicitement via une lecture cohérente dans la même
    // transaction : le solde est recalculé juste avant d'écrire.
    const depuis = await dernierePeriodeDebut(run, coffreSource);
    const collecte = await totalCollecte(run, coffreSource, depuis);
    const { sorti, entre } = await totalTransferts(run, coffreSource, depuis);
    const solde = collecte - sorti + entre;
    if (montant > solde) {
      throw new ApiError(422, `Solde insuffisant dans ce coffre (${solde} F disponibles).`);
    }

    const { rows: created } = await client.query(
      `INSERT INTO coffre_transferts (coffre_source, destination, montant, motif, cree_par)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [coffreSource, destination, montant, motif ?? null, actorId]
    );

    if (destination === 'caisse_principale') {
      await client.query(
        `INSERT INTO caisse_principale_mouvements (type, montant, motif, cree_par)
         VALUES ('alimentation_depuis_coffre', $1, $2, $3)`,
        [montant, motif ?? `Transfert depuis le coffre ${coffreSource}`, actorId]
      );
    }

    return { id: created[0].id, coffreSource, destination, montant };
  });
}

/**
 * Clôture mensuelle d'un coffre — réservé au directeur. Archive le
 * solde constaté (depuis la clôture précédente, ou depuis l'origine
 * s'il n'y en a jamais eu) dans coffre_clotures, ce qui fait
 * automatiquement repartir le solde courant à zéro pour la période
 * suivante — le calcul du solde ne compte plus que ce qui arrive
 * après cette nouvelle clôture.
 */
export async function cloturerCoffre({ coffre, actorId }) {
  if (!TYPES_VALIDES.includes(coffre)) {
    throw new ApiError(422, 'Coffre invalide.');
  }

  return withTransaction(async (client) => {
    const run = client.query.bind(client);
    const { rows: dejaVerrou } = await client.query(
      `SELECT periode_fin FROM coffre_clotures WHERE coffre = $1::coffre_type
       ORDER BY periode_fin DESC LIMIT 1 FOR UPDATE`,
      [coffre]
    );
    const depuis = dejaVerrou[0]?.periode_fin ?? null;

    const collecte = await totalCollecte(run, coffre, depuis);
    const { sorti, entre } = await totalTransferts(run, coffre, depuis);
    const solde = collecte - sorti + entre;
    const maintenant = new Date();

    // periode_debut : juste après la clôture précédente, ou le tout
    // début (epoch) s'il n'y en a jamais eu — purement informatif.
    const periodeDebut = depuis ?? new Date(0);

    const { rows: created } = await client.query(
      `INSERT INTO coffre_clotures (coffre, montant, periode_debut, periode_fin, cloturee_par)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, periode_debut, periode_fin`,
      [coffre, solde, periodeDebut, maintenant, actorId]
    );

    return { id: created[0].id, coffre, montant: solde, periodeDebut: created[0].periode_debut, periodeFin: created[0].periode_fin };
  });
}

/**
 * Détail mois par mois d'un coffre — même montant global que
 * fetchCoffres() (depuis la dernière clôture), mais réparti par mois
 * calendaire pour que le directeur voie clairement quelle part a été
 * encaissée quand, plutôt qu'un seul chiffre agrégé. Les 12 derniers
 * mois avec au moins un mouvement, les plus récents en premier.
 */
export async function fetchCoffreParMois(coffre) {
  if (!TYPES_VALIDES.includes(coffre)) {
    throw new ApiError(422, 'Coffre invalide.');
  }
  const depuis = await dernierePeriodeDebut(query, coffre);

  let rows;
  if (coffre === 'remboursements') {
    ({ rows } = await query(
      `SELECT to_char(created_at, 'YYYY-MM') AS mois,
              COALESCE(SUM(-amount), 0) AS total,
              count(*) AS nombre
       FROM ledger_entries
       WHERE type = 'paiement_credit' AND ($1::timestamptz IS NULL OR created_at > $1)
       GROUP BY 1
       ORDER BY 1 DESC
       LIMIT 12`,
      [depuis]
    ));
  } else {
    const codes = coffre === 'frais_dossier' ? [CODE_FRAIS_DOSSIER] : CODES_FRAIS_AGIOS;
    ({ rows } = await query(
      `SELECT to_char(af.created_at, 'YYYY-MM') AS mois,
              COALESCE(SUM(af.amount), 0) AS total,
              count(*) AS nombre
       FROM applied_fees af
       JOIN fee_versions fv ON fv.id = af.fee_version_id
       JOIN fee_definitions f ON f.id = fv.fee_id
       WHERE f.code = ANY($1::text[]) AND ($2::timestamptz IS NULL OR af.created_at > $2)
       GROUP BY 1
       ORDER BY 1 DESC
       LIMIT 12`,
      [codes, depuis]
    ));
  }

  const total = await totalCollecte(query, coffre, depuis);

  return {
    coffre,
    total,
    periodeDepuis: depuis,
    parMois: rows.map((r) => ({ mois: r.mois, total: Number(r.total), nombre: Number(r.nombre) })),
  };
}

/**
 * Le détail ligne à ligne d'un coffre — « j'aimerais que dans l'onglet
 * coffre, pour ce qui est des remboursements collectés, tu puisses
 * détailler les remboursements lorsqu'on clique sur le chiffre ».
 *
 * fetchCoffreParMois() donne la répartition par mois ; ici on descend
 * d'un cran : qui a payé, combien, quand, sur quel crédit et quelle
 * échéance. Sans ce niveau, un total de plusieurs millions ne se
 * vérifie pas — il se croit.
 *
 * `mois` est facultatif : absent, on liste toute la période depuis la
 * dernière clôture du coffre, le plus récent en premier.
 *
 * Toutes les écritures ne sont pas rattachables à une échéance : au
 * 27/10/2026, 79 des 210 remboursements le sont. Les autres viennent
 * des crédits repris du fichier d'import, dont les échéances n'ont
 * jamais existé dans le logiciel. On les affiche quand même, avec leur
 * libellé — les taire ferait un détail dont la somme ne tombe pas sur
 * le total.
 */
export async function fetchCoffreMouvements(coffre, { mois, limite = 300 } = {}) {
  if (!TYPES_VALIDES.includes(coffre)) {
    throw new ApiError(422, 'Coffre invalide.');
  }
  if (mois && !/^\d{4}-\d{2}$/.test(mois)) {
    throw new ApiError(422, 'Mois invalide (format attendu : AAAA-MM).');
  }
  const depuis = await dernierePeriodeDebut(query, coffre);

  let rows;
  if (coffre === 'remboursements') {
    // -le.amount pour la meme raison que dans totalCollecte() : un
    // paiement_credit est un debit chez le client, donc une entree vue
    // du coffre.
    ({ rows } = await query(
      // Une ligne par ECRITURE, jamais par echeance : un meme
      // prelevement peut couvrir plusieurs echeances d'un client (c'est
      // ce que fait l'operateur quand il en coche deux), et une
      // jointure directe dupliquait alors l'ecriture. Le detail
      // totalisait 5 645 902 F la ou le coffre en comptait 3 826 102 —
      // un ecran de verification qui invente 1 819 800 F ne verifie
      // plus rien. D'ou les sous-requetes scalaires : elles decrivent
      // l'ecriture sans la multiplier.
      `SELECT le.id, le.created_at, (-le.amount)::bigint AS montant, le.label,
              btrim(u.full_name) AS client, u.client_number,
              (SELECT string_agg(DISTINCT cr.reference, ', ')
                 FROM installments i
                 JOIN credit_requests cr ON cr.id = i.credit_id
                WHERE i.ledger_entry_id = le.id) AS credit,
              (SELECT string_agg(i.sequence::text, ', ' ORDER BY i.sequence)
                 FROM installments i
                WHERE i.ledger_entry_id = le.id) AS echeances
       FROM ledger_entries le
       JOIN accounts a ON a.id = le.account_id
       JOIN users u ON u.id = a.user_id
       WHERE le.type = 'paiement_credit'
         AND ($1::timestamptz IS NULL OR le.created_at > $1)
         AND ($2::text IS NULL OR to_char(le.created_at, 'YYYY-MM') = $2)
       ORDER BY le.created_at DESC
       LIMIT $3`,
      [depuis, mois ?? null, limite]
    ));
  } else {
    const codes = coffre === 'frais_dossier' ? [CODE_FRAIS_DOSSIER] : CODES_FRAIS_AGIOS;
    ({ rows } = await query(
      `SELECT af.id, af.created_at, af.amount::bigint AS montant,
              f.code AS label,
              btrim(u.full_name) AS client, u.client_number,
              NULL::text AS credit, NULL::text AS echeances
       FROM applied_fees af
       JOIN fee_versions fv ON fv.id = af.fee_version_id
       JOIN fee_definitions f ON f.id = fv.fee_id
       JOIN accounts a ON a.id = af.account_id
       JOIN users u ON u.id = a.user_id
       WHERE f.code = ANY($1::text[])
         AND ($2::timestamptz IS NULL OR af.created_at > $2)
         AND ($3::text IS NULL OR to_char(af.created_at, 'YYYY-MM') = $3)
       ORDER BY af.created_at DESC
       LIMIT $4`,
      [codes, depuis, mois ?? null, limite]
    ));
  }

  // Le total porte sur TOUTE la periode demandee, pas sur les lignes
  // renvoyees : au-dela de la limite, le detail est tronque mais la
  // somme affichee reste la vraie. L'ecran le dit a l'utilisateur.
  const { rows: somme } = coffre === 'remboursements'
    ? await query(
      `SELECT COALESCE(SUM(-amount), 0) AS total, count(*)::int AS nombre
       FROM ledger_entries
       WHERE type = 'paiement_credit'
         AND ($1::timestamptz IS NULL OR created_at > $1)
         AND ($2::text IS NULL OR to_char(created_at, 'YYYY-MM') = $2)`,
      [depuis, mois ?? null]
    )
    : await query(
      `SELECT COALESCE(SUM(af.amount), 0) AS total, count(*)::int AS nombre
       FROM applied_fees af
       JOIN fee_versions fv ON fv.id = af.fee_version_id
       JOIN fee_definitions f ON f.id = fv.fee_id
       WHERE f.code = ANY($1::text[])
         AND ($2::timestamptz IS NULL OR af.created_at > $2)
         AND ($3::text IS NULL OR to_char(af.created_at, 'YYYY-MM') = $3)`,
      [coffre === 'frais_dossier' ? [CODE_FRAIS_DOSSIER] : CODES_FRAIS_AGIOS, depuis, mois ?? null]
    );

  return {
    coffre,
    mois: mois ?? null,
    periodeDepuis: depuis,
    total: Number(somme[0].total),
    nombre: somme[0].nombre,
    tronque: somme[0].nombre > rows.length,
    mouvements: rows.map((r) => ({
      id: r.id,
      date: r.created_at,
      montant: Number(r.montant),
      libelle: r.label,
      client: r.client,
      numeroClient: r.client_number,
      credit: r.credit,
      // Les echeances couvertes par cette ecriture, en texte : « 1 » le
      // plus souvent, « 1, 2 » quand un prelevement en a soldé deux.
      echeances: r.echeances,
    })),
  };
}

/**
 * Montant attendu sur les échéances de crédit pas encore prélevées
 * pour un mois donné — sert à mettre en regard, dans le coffre
 * « Remboursements », ce qui a déjà été encaissé et ce qui reste
 * attendu sur le mois en cours (ou un autre mois, au choix). Par
 * défaut, le mois en cours au moment de l'appel.
 */
export async function fetchEcheancesAttendues({ mois } = {}) {
  // `mois` au format 'AAAA-MM' ; on prend le mois en cours si absent.
  const base = mois ? new Date(`${mois}-01T00:00:00Z`) : new Date();
  if (Number.isNaN(base.getTime())) {
    throw new ApiError(422, 'Mois invalide (format attendu : AAAA-MM).');
  }
  const debut = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1));
  const fin = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 1));

  const { rows } = await query(
    `SELECT COALESCE(SUM(i.amount), 0) AS total, count(*) AS nombre
     FROM installments i
     WHERE i.status = 'a_venir' AND i.due_date >= $1 AND i.due_date < $2`,
    [debut, fin]
  );

  const { rows: detail } = await query(
    `SELECT i.id, i.sequence, i.due_date, i.amount, c.reference,
            u.full_name AS client
     FROM installments i
     JOIN credit_requests c ON c.id = i.credit_id
     JOIN users u ON u.id = c.user_id
     WHERE i.status = 'a_venir' AND i.due_date >= $1 AND i.due_date < $2
     ORDER BY i.due_date ASC`,
    [debut, fin]
  );

  return {
    mois: `${debut.getUTCFullYear()}-${String(debut.getUTCMonth() + 1).padStart(2, '0')}`,
    total: Number(rows[0].total),
    nombre: Number(rows[0].nombre),
    echeances: detail.map((r) => ({
      id: r.id,
      sequence: r.sequence,
      dueDate: r.due_date,
      amount: Number(r.amount),
      reference: r.reference,
      client: r.client,
    })),
  };
}

/** Historique des clôtures — tous coffres confondus, plus récentes d'abord. */
export async function fetchCoffreClotures() {
  const { rows } = await query(
    `SELECT c.id, c.coffre, c.montant, c.periode_debut, c.periode_fin, c.cloturee_le,
            u.full_name AS cloturee_par
     FROM coffre_clotures c
     JOIN users u ON u.id = c.cloturee_par
     ORDER BY c.cloturee_le DESC
     LIMIT 100`
  );
  return rows;
}
