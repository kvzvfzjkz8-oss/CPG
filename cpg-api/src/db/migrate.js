import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './index.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, 'migrations');

async function run() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const applied = new Set(
    (await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name)
  );

  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`· ${file} déjà appliquée`);
      continue;
    }
    const sql = await readFile(join(migrationsDir, file), 'utf8');
    console.log(`→ application de ${file}`);
    await pool.query(sql);
    await pool.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
  }

  console.log('Migrations terminées.');
  await pool.end();
}

run().catch((err) => {
  console.error('Échec des migrations :', err.message);
  process.exit(1);
});
