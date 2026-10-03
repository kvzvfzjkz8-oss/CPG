// ═══════════════════════════════════════════════════════════════════
//  Lecture seule — vérifie que TOUS les crédits scolaires actifs ont
//  bien leurs échéances impayées sur 25/01/2027, 24/02/2027, 25/03/2027,
//  et qu'aucune échéance scolaire ne reste avant janvier 2027.
// ═══════════════════════════════════════════════════════════════════
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

const DATES_ATTENDUES = { 1: '2027-01-25', 2: '2027-02-24', 3: '2027-03-25' };

async function main() {
  const { rows: installments } = await pool.query(
    `SELECT c.reference, u.full_name AS client, c.status AS statut_credit,
            i.sequence, i.due_date, i.status AS statut_echeance
     FROM installments i
     JOIN credit_requests c ON c.id = i.credit_id
     JOIN product_versions pv ON pv.id = c.product_version_id
     JOIN credit_products p ON p.id = pv.product_id
     JOIN users u ON u.id = c.user_id
     WHERE p.code = 'SCOLAIRE' AND c.status IN ('approuve', 'suspendu')
     ORDER BY c.reference, i.sequence`
  );

  let anomalies = 0;
  let payeesAnterieures = 0;
  let impayeesOk = 0;

  for (const r of installments) {
    const dueDateStr = new Date(r.due_date).toISOString().slice(0, 10);
    if (r.statut_echeance === 'payee') {
      payeesAnterieures += 1;
      continue; // une échéance déjà réglée n'a pas à être sur les nouvelles dates
    }
    const attendue = DATES_ATTENDUES[r.sequence];
    if (!attendue) {
      console.log(`  !  ${r.reference} (${r.client}) — échéance n°${r.sequence} inattendue (crédit scolaire normalement à 3 mensualités)`);
      anomalies += 1;
      continue;
    }
    if (dueDateStr !== attendue) {
      console.log(`  ✗  ${r.reference} (${r.client}) — échéance n°${r.sequence} au ${dueDateStr} au lieu du ${attendue} attendu (statut échéance : ${r.statut_echeance})`);
      anomalies += 1;
    } else {
      impayeesOk += 1;
    }
  }

  const credits = new Set(installments.map((r) => r.reference));

  console.log('\n─── Résumé ───');
  console.log(`Dossiers scolaires actifs contrôlés : ${credits.size}`);
  console.log(`Échéances impayées correctement sur les 3 dates : ${impayeesOk}`);
  console.log(`Échéances déjà payées avant l'alignement (non touchées, normal) : ${payeesAnterieures}`);
  console.log(`Anomalies détectées : ${anomalies}`);
  if (anomalies === 0) {
    console.log('\n✓ Aucun crédit scolaire n’a d’échéance impayée avant janvier 2027 : tous les prélèvements restants tomberont bien à partir du 25/01/2027.');
  } else {
    console.log('\n✗ Des écarts existent — voir le détail ci-dessus avant de considérer le réalignement comme complet.');
  }

  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
