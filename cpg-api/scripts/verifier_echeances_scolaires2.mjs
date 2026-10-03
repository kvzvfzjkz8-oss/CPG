// ═══════════════════════════════════════════════════════════════════
//  Lecture seule — version corrigée (comparaison de dates faite en
//  SQL avec to_char, sans passer par un objet Date JavaScript qui
//  introduisait un décalage de fuseau horaire dans la v1).
// ═══════════════════════════════════════════════════════════════════
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

const DATES_ATTENDUES = { 1: '2027-01-25', 2: '2027-02-24', 3: '2027-03-25' };

async function main() {
  const { rows: installments } = await pool.query(
    `SELECT c.reference, u.full_name AS client, c.status AS statut_credit,
            i.sequence, to_char(i.due_date, 'YYYY-MM-DD') AS due_date, i.status AS statut_echeance,
            i.adjusted_at
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
    if (r.statut_echeance === 'payee') {
      payeesAnterieures += 1;
      continue;
    }
    const attendue = DATES_ATTENDUES[r.sequence];
    if (!attendue) {
      console.log(`  !  ${r.reference} (${r.client}) — échéance n°${r.sequence} inattendue`);
      anomalies += 1;
      continue;
    }
    if (r.due_date !== attendue) {
      console.log(`  ✗  ${r.reference} (${r.client}) — échéance n°${r.sequence} au ${r.due_date} au lieu du ${attendue} (statut : ${r.statut_echeance}, ajustée le : ${r.adjusted_at ?? 'jamais'})`);
      anomalies += 1;
    } else {
      impayeesOk += 1;
    }
  }

  console.log('\n─── Résumé ───');
  console.log(`Échéances impayées correctement sur les 3 dates : ${impayeesOk}`);
  console.log(`Échéances déjà payées avant l'alignement (non touchées, normal) : ${payeesAnterieures}`);
  console.log(`Anomalies détectées : ${anomalies}`);
  if (anomalies === 0) {
    console.log('\n✓ Tous les crédits scolaires actifs sont correctement alignés à partir de janvier 2027.');
  }

  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
