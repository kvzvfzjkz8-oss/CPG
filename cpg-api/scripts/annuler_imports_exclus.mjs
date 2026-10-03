// ═══════════════════════════════════════════════════════════════════
//  Annulation de 13 crédits importés par erreur
// ═══════════════════════════════════════════════════════════════════
//
//  Le directeur avait explicitement demandé de ne pas importer les
//  crédits de ces 13 clients (noms ci-dessous) — ils ont pourtant été
//  importés par erreur. Ce script les retire proprement : écritures
//  de déblocage/paiement liées, échéancier (suppression en cascade
//  avec le crédit), ligne de traçabilité dans legacy_credit_imports,
//  puis le crédit lui-même.
//
//  Aucun de ces 13 dossiers ne correspond à un compte créé pour
//  l'import (tous sont des clients déjà existants) : on ne touche
//  donc à aucun compte utilisateur ici, seulement aux crédits.
//
//  Usage :
//    DATABASE_URL=postgresql://... node annuler_imports_exclus.mjs
// ═══════════════════════════════════════════════════════════════════
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

// Lignes d'origine du fichier source à retirer, avec le nom pour
// vérification humaine dans le journal affiché.
const LIGNES_A_ANNULER = [
  { ligne: 16, nom: 'EBETSE Alexis' },
  { ligne: 17, nom: 'EDOU NDONG Mathurin' },
  { ligne: 26, nom: 'IZAKO Grâce' },
  { ligne: 27, nom: 'IPEMOUSSOU Kinga' },
  { ligne: 41, nom: 'LOLA MABEMBI Kevin' },
  { ligne: 61, nom: 'MOMBO Ange' },
  { ligne: 62, nom: 'MONDJO Nestor' },
  { ligne: 63, nom: 'MOUCKAGNA G' },
  { ligne: 66, nom: 'MOUITY Eric' },
  { ligne: 86, nom: 'NGOUANGUI ULRICH' },
  { ligne: 88, nom: 'ONGOUNDJA Arnaud' },
  { ligne: 93, nom: 'PAMBOU MBANGOU H' },
  { ligne: 96, nom: 'SANGOUA Herlick' },
];

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
  let annules = 0;
  let introuvables = 0;
  let dejaAnnules = 0;
  const erreurs = [];

  for (const { ligne, nom } of LIGNES_A_ANNULER) {
    try {
      const resultat = await withTransaction(async (client) => {
        const { rows: imports } = await client.query(
          `SELECT li.id AS import_id, li.credit_id, c.reference, c.amount, u.full_name AS client_reel
           FROM legacy_credit_imports li
           JOIN credit_requests c ON c.id = li.credit_id
           JOIN users u ON u.id = li.client_id
           WHERE li.ligne_origine = $1
           FOR UPDATE OF li`,
          [ligne]
        );
        if (imports.length === 0) return { skip: 'introuvable' };
        const imp = imports[0];

        // Filet de sécurité : si une échéance a déjà été marquée
        // payée depuis l'import (peu probable le jour même, mais on
        // ne prend pas le risque de supprimer un vrai remboursement),
        // on arrête et on laisse la main.
        const { rows: paye } = await client.query(
          `SELECT count(*) AS n FROM installments WHERE credit_id = $1 AND status = 'payee'
           AND paid_at > (SELECT imported_at FROM legacy_credit_imports WHERE id = $2)`,
          [imp.credit_id, imp.import_id]
        );
        if (Number(paye[0].n) > 0) {
          throw new Error(
            `échéance réglée depuis l'import (${paye[0].n}) — annulation refusée, à traiter manuellement`
          );
        }

        await client.query(
          `DELETE FROM ledger_entries WHERE reference = $1`,
          [imp.reference]
        );
        await client.query(`DELETE FROM legacy_credit_imports WHERE id = $1`, [imp.import_id]);
        await client.query(`DELETE FROM credit_requests WHERE id = $1`, [imp.credit_id]);

        return { skip: null, reference: imp.reference, montant: imp.amount, client_reel: imp.client_reel };
      });

      if (resultat.skip === 'introuvable') {
        introuvables += 1;
        console.log(`  ·  ligne ${ligne} (${nom}) — aucun import trouvé (déjà annulé, ou jamais importé)`);
      } else {
        annules += 1;
        console.log(`  OK ligne ${ligne} — ${resultat.client_reel} — ${resultat.reference} — ${resultat.montant.toLocaleString('fr-FR')} F retiré`);
      }
    } catch (error) {
      erreurs.push({ ligne, nom, message: error.message });
      console.error(`  ERREUR ligne ${ligne} (${nom}) : ${error.message}`);
    }
  }

  console.log('\n─── Résumé ───');
  console.log(`Crédits annulés     : ${annules}`);
  console.log(`Introuvables (déjà retirés) : ${introuvables}`);
  if (erreurs.length) {
    console.log(`Erreurs (${erreurs.length}) — à traiter à la main :`);
    for (const e of erreurs) console.log(`  - ligne ${e.ligne} (${e.nom}) : ${e.message}`);
  }

  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
