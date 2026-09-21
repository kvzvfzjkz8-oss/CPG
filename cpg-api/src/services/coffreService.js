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
 */

const CODES_FRAIS_AGIOS = ['AGIOS_DECOUVERT', 'FRAIS_TENUE'];
const CODE_FRAIS_DOSSIER = 'COMM_CREDIT';

async function totalCollecte(coffre) {
  if (coffre === 'remboursements') {
    const { rows } = await query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM ledger_entries WHERE type = 'paiement_credit'`
    );
    return Number(rows[0].total);
  }

  const codes = coffre === 'frais_dossier' ? [CODE_FRAIS_DOSSIER] : CODES_FRAIS_AGIOS;
  const { rows } = await query(
    `SELECT COALESCE(SUM(af.amount), 0) AS total
     FROM applied_fees af
     JOIN fee_versions fv ON fv.id = af.fee_version_id
     JOIN fee_definitions f ON f.id = fv.fee_id
     WHERE f.code = ANY($1::text[])`,
    [codes]
  );
  return Number(rows[0].total);
}

async function totalTransferts(coffre) {
  const { rows } = await query(
    `SELECT
       COALESCE(SUM(CASE WHEN coffre_source = $1::coffre_type THEN montant ELSE 0 END), 0) AS sorti,
       COALESCE(SUM(CASE WHEN destination = $1::text THEN montant ELSE 0 END), 0) AS entre
     FROM coffre_transferts`,
    [coffre]
  );
  return { sorti: Number(rows[0].sorti), entre: Number(rows[0].entre) };
}

/** Solde et derniers mouvements des trois coffres. */
export async function fetchCoffres() {
  const types = ['frais_agios', 'remboursements', 'frais_dossier'];
  const coffres = [];
  for (const type of types) {
    const collecte = await totalCollecte(type);
    const { sorti, entre } = await totalTransferts(type);
    coffres.push({ type, solde: collecte - sorti + entre, collecte, sorti, entre });
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
 * pas assez pour couvrir le montant.
 */
export async function transfererDepuisCoffre({ coffreSource, destination, montant, motif, actorId }) {
  const typesValides = ['frais_agios', 'remboursements', 'frais_dossier'];
  if (!typesValides.includes(coffreSource)) {
    throw new ApiError(422, 'Coffre source invalide.');
  }
  if (destination !== 'caisse_principale' && !typesValides.includes(destination)) {
    throw new ApiError(422, 'Destination invalide.');
  }
  if (destination === coffreSource) {
    throw new ApiError(422, 'La source et la destination doivent être différentes.');
  }
  if (!Number.isInteger(montant) || montant <= 0) {
    throw new ApiError(422, 'Montant invalide.');
  }

  return withTransaction(async (client) => {
    // Verrouille implicitement via une lecture cohérente dans la même
    // transaction : le solde est recalculé juste avant d'écrire.
    const collecte = await totalCollecte(coffreSource);
    const { rows: transfertRows } = await client.query(
      `SELECT
         COALESCE(SUM(CASE WHEN coffre_source = $1::coffre_type THEN montant ELSE 0 END), 0) AS sorti,
         COALESCE(SUM(CASE WHEN destination = $1::text THEN montant ELSE 0 END), 0) AS entre
       FROM coffre_transferts WHERE coffre_source = $1::coffre_type OR destination = $1::text`,
      [coffreSource]
    );
    const solde = collecte - Number(transfertRows[0]?.sorti ?? 0) + Number(transfertRows[0]?.entre ?? 0);
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
