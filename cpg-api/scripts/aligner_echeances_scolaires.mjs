// ═══════════════════════════════════════════════════════════════════
//  Réalignement des échéances des crédits "rentrée scolaire"
// ═══════════════════════════════════════════════════════════════════
//
//  Demande du directeur : pour TOUS les crédits du produit "Crédit
//  scolaire" (SCOLAIRE), pour TOUS les clients, les 3 échéances
//  doivent tomber le 25/01/2027, le 24/02/2027 et le 25/03/2027.
//
//  Seules les échéances pas encore payées (status = 'a_venir') sont
//  déplacées — une échéance déjà réglée n'est jamais touchée. Chaque
//  échéance est identifiée par son numéro (1, 2 ou 3), pas par sa
//  position dans une liste, donc un crédit dont la 1ère échéance est
//  déjà payée verra uniquement ses échéances 2 et 3 alignées sur les
//  bonnes dates.
//
//  Rejouable sans risque : un crédit déjà sur les bonnes dates est
//  laissé tel quel.
//
//  Usage :
//    DATABASE_URL=postgresql://... node aligner_echeances_scolaires.mjs
// ═══════════════════════════════════════════════════════════════════
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

// Échéance n°1 → 25/01/2027, n°2 → 24/02/2027, n°3 → 25/03/2027.
const DATES_CIBLES = {
  1: '2027-01-25',
  2: '2027-02-24',
  3: '2027-03-25',
};

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const { rows: directeurs } = await pool.query(
    `SELECT id, full_name FROM users WHERE role = 'directeur' AND status = 'actif' ORDER BY created_at LIMIT 1`
  );
  const directeur = directeurs[0];
  if (!directeur) throw new Error('Aucun compte directeur actif trouvé.');
  console.log(`Exécuté au nom de : ${directeur.full_name} (${directeur.id})`);

  const { rows: credits } = await pool.query(
    `SELECT c.id, c.reference, c.status, u.full_name AS client
     FROM credit_requests c
     JOIN product_versions pv ON pv.id = c.product_version_id
     JOIN credit_products p ON p.id = pv.product_id
     JOIN users u ON u.id = c.user_id
     WHERE p.code = 'SCOLAIRE' AND c.status IN ('approuve', 'suspendu')
     ORDER BY c.reference`
  );
  console.log(`Dossiers scolaires actifs trouvés (échéancier généré) : ${credits.length}`);

  let alignes = 0;
  let dejaFaits = 0;
  let sansEcheanceImpayee = 0;
  let echeancesDeplacees = 0;
  const erreurs = [];

  for (const credit of credits) {
    try {
      const resultat = await withTransaction(async (client) => {
        const { rows: installments } = await client.query(
          `SELECT id, sequence, due_date FROM installments
           WHERE credit_id = $1 AND status = 'a_venir'
           ORDER BY sequence FOR UPDATE`,
          [credit.id]
        );
        if (installments.length === 0) return { skip: 'aucune' };

        let deplacees = 0;
        for (const inst of installments) {
          const cible = DATES_CIBLES[inst.sequence];
          if (!cible) {
            console.warn(`  !  ${credit.reference} — échéance n°${inst.sequence} inattendue (crédit scolaire à 3 mensualités), ignorée`);
            continue;
          }
          // Comparaison faite côté SQL (due_date <> $3::date) plutôt qu'en
          // JS, pour éviter tout décalage lié au fuseau horaire lors de la
          // conversion d'un DATE Postgres en objet Date JavaScript.
          const { rowCount } = await client.query(
            `UPDATE installments
             SET due_date = $2::date,
                 original_due_date = COALESCE(original_due_date, due_date),
                 adjusted_by = $3,
                 adjusted_at = now()
             WHERE id = $1 AND due_date <> $2::date`,
            [inst.id, cible, directeur.id]
          );
          deplacees += rowCount;
        }

        if (deplacees === 0) return { skip: 'deja' };
        return { skip: null, deplacees };
      });

      if (resultat.skip === 'aucune') {
        sansEcheanceImpayee += 1;
      } else if (resultat.skip === 'deja') {
        dejaFaits += 1;
        console.log(`  ·  ${credit.reference} (${credit.client}) — déjà aligné, ignoré`);
      } else {
        alignes += 1;
        echeancesDeplacees += resultat.deplacees;
        console.log(`  OK ${credit.reference} (${credit.client}) — ${resultat.deplacees} échéance(s) déplacée(s)`);
      }
    } catch (error) {
      erreurs.push({ reference: credit.reference, message: error.message });
      console.error(`  ERREUR ${credit.reference} : ${error.message}`);
    }
  }

  console.log('\n─── Résumé ───');
  console.log(`Dossiers alignés       : ${alignes} (${echeancesDeplacees} échéances déplacées)`);
  console.log(`Déjà alignés (ignorés) : ${dejaFaits}`);
  console.log(`Sans échéance impayée  : ${sansEcheanceImpayee}`);
  if (erreurs.length) {
    console.log(`Erreurs (${erreurs.length}) :`);
    for (const e of erreurs) console.log(`  - ${e.reference} : ${e.message}`);
  }

  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
