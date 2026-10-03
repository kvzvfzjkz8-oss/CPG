// ═══════════════════════════════════════════════════════════════════
//  Réalignement des échéanciers importés sur le 27 de chaque mois
// ═══════════════════════════════════════════════════════════════════
//
//  Script à usage unique, demandé par le directeur : pour tous les
//  crédits importés depuis l'ancien logiciel (table
//  legacy_credit_imports), toutes les échéances pas encore payées
//  sont décalées pour tomber le 27 de mois consécutifs, à partir du
//  prochain 27 à venir.
//
//  Rejouable sans risque : un crédit dont la prochaine échéance
//  impayée tombe déjà un 27 est laissé tel quel (déjà traité).
//
//  Usage :
//    DATABASE_URL=postgresql://... node realigner_echeances_27.mjs
// ═══════════════════════════════════════════════════════════════════
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

/** Le prochain 27 à partir d'une date donnée (aujourd'hui si le jour est déjà passé). */
function next27th(from) {
  const d = new Date(from);
  let year = d.getFullYear();
  let month = d.getMonth(); // 0-indexé
  if (d.getDate() > 27) month += 1;
  return new Date(year, month, 27);
}

function addMonths(date, n) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}

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
    `SELECT DISTINCT c.id, c.reference
     FROM legacy_credit_imports li
     JOIN credit_requests c ON c.id = li.credit_id
     ORDER BY c.reference`
  );
  console.log(`Dossiers importés trouvés : ${credits.length}`);

  let realignes = 0;
  let dejaFaits = 0;
  let sansEcheanceImpayee = 0;
  let echeancesDeplacees = 0;

  for (const credit of credits) {
    const resultat = await withTransaction(async (client) => {
      const { rows: installments } = await client.query(
        `SELECT id, sequence, due_date FROM installments
         WHERE credit_id = $1 AND status = 'a_venir'
         ORDER BY sequence FOR UPDATE`,
        [credit.id]
      );
      if (installments.length === 0) return { skip: 'aucune' };

      // Déjà aligné : la première échéance impayée tombe déjà un 27.
      if (new Date(installments[0].due_date).getDate() === 27) {
        return { skip: 'deja' };
      }

      const base = next27th(new Date());
      let deplacees = 0;
      for (let i = 0; i < installments.length; i += 1) {
        const nouvelleDate = addMonths(base, i);
        await client.query(
          `UPDATE installments
           SET due_date = $2,
               original_due_date = COALESCE(original_due_date, due_date),
               adjusted_by = $3,
               adjusted_at = now()
           WHERE id = $1`,
          [installments[i].id, nouvelleDate, directeur.id]
        );
        deplacees += 1;
      }
      return { skip: null, deplacees };
    });

    if (resultat.skip === 'aucune') {
      sansEcheanceImpayee += 1;
    } else if (resultat.skip === 'deja') {
      dejaFaits += 1;
      console.log(`  ·  ${credit.reference} — déjà aligné sur le 27, ignoré`);
    } else {
      realignes += 1;
      echeancesDeplacees += resultat.deplacees;
      console.log(`  OK ${credit.reference} — ${resultat.deplacees} échéance(s) déplacée(s) sur le 27`);
    }
  }

  console.log('\n─── Résumé ───');
  console.log(`Dossiers réalignés     : ${realignes} (${echeancesDeplacees} échéances déplacées)`);
  console.log(`Déjà alignés (ignorés) : ${dejaFaits}`);
  console.log(`Sans échéance impayée  : ${sansEcheanceImpayee}`);

  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
