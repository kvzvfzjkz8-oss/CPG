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
    const { rows } = await run(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM ledger_entries
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
