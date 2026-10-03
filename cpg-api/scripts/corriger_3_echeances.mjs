// ═══════════════════════════════════════════════════════════════════
//  Correction ciblée de 3 échéances (sur 120) qui avaient hérité de
//  la mauvaise date lors du réalignement des crédits scolaires.
//  Chaque ligne est identifiée par son identifiant exact (trouvé par
//  le diagnostic précédent) — aucune ambiguïté possible.
// ═══════════════════════════════════════════════════════════════════
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

const CORRECTIONS = [
  { id: '49fe5331-b5e0-4921-8f53-91af6b1f0692', reference: 'CPG-3008', sequence: 2, dateAvant: '2027-01-25', dateApres: '2027-02-24' },
  { id: '7bd1917e-b760-4715-a103-5bc8c9d3d890', reference: 'CPG-4728', sequence: 3, dateAvant: '2027-01-25', dateApres: '2027-03-25' },
  { id: '85ecfbe3-f7fb-40e6-85ad-ea1b01f24471', reference: 'CPG-9458', sequence: 2, dateAvant: '2027-01-25', dateApres: '2027-02-24' },
];

async function main() {
  const client = await pool.connect();
  try {
    for (const c of CORRECTIONS) {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id, sequence, to_char(due_date,'YYYY-MM-DD') AS due_date, status
         FROM installments WHERE id = $1 FOR UPDATE`,
        [c.id]
      );
      const inst = rows[0];
      if (!inst) {
        console.log(`  ✗ ${c.reference} n°${c.sequence} — échéance introuvable, ignorée`);
        await client.query('ROLLBACK');
        continue;
      }
      if (inst.status !== 'a_venir') {
        console.log(`  ✗ ${c.reference} n°${c.sequence} — statut inattendu (${inst.status}), ignorée par sécurité`);
        await client.query('ROLLBACK');
        continue;
      }
      if (inst.due_date !== c.dateAvant) {
        console.log(`  ·  ${c.reference} n°${c.sequence} — déjà à ${inst.due_date} (pas ${c.dateAvant}), aucune modification`);
        await client.query('ROLLBACK');
        continue;
      }
      await client.query(
        `UPDATE installments SET due_date = $2::date, adjusted_at = now() WHERE id = $1`,
        [c.id, c.dateApres]
      );
      await client.query('COMMIT');
      console.log(`  OK ${c.reference} n°${c.sequence} — corrigé : ${c.dateAvant} → ${c.dateApres}`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
