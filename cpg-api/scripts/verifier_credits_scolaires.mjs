// ═══════════════════════════════════════════════════════════════════
//  Lecture seule — identifie les crédits "rentrée scolaire" avant de
//  préparer le script de réalignement des échéances.
// ═══════════════════════════════════════════════════════════════════
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

async function main() {
  const { rows: produits } = await pool.query(
    `SELECT id, code, name, status FROM credit_products
     WHERE name ILIKE '%scolaire%' OR code ILIKE '%scolaire%'`
  );
  console.log('── Produits correspondant à "scolaire" ──');
  console.table(produits);

  const { rows: parPurpose } = await pool.query(
    `SELECT DISTINCT purpose, count(*) AS nb
     FROM credit_requests WHERE purpose ILIKE '%scolaire%' GROUP BY purpose`
  );
  console.log('── Champ "purpose" contenant "scolaire" ──');
  console.table(parPurpose);

  if (produits.length > 0) {
    const ids = produits.map((p) => p.id);
    const { rows: credits } = await pool.query(
      `SELECT c.id, c.reference, c.status, c.duration_months, c.created_at,
              u.full_name AS client
       FROM credit_requests c
       JOIN product_versions pv ON pv.id = c.product_version_id
       JOIN users u ON u.id = c.user_id
       WHERE pv.product_id = ANY($1)
       ORDER BY c.created_at DESC
       LIMIT 100`,
      [ids]
    );
    console.log(`── ${credits.length} crédit(s) trouvé(s) via le produit scolaire ──`);
    console.table(credits);

    const durees = [...new Set(credits.map((c) => c.duration_months))];
    console.log('Durées distinctes (mois) :', durees);
  }

  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
