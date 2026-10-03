import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

async function main() {
  const { rows } = await pool.query(
    `SELECT c.reference, i.id, i.sequence, to_char(i.due_date,'YYYY-MM-DD') AS due_date,
            i.status, i.amount, to_char(i.original_due_date,'YYYY-MM-DD') AS original_due_date
     FROM installments i
     JOIN credit_requests c ON c.id = i.credit_id
     WHERE c.reference IN ('CPG-3008', 'CPG-4728', 'CPG-9458')
     ORDER BY c.reference, i.sequence, i.id`
  );
  console.table(rows);
  await pool.end();
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
