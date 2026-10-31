/**
 * ═══════════════════════════════════════════════════════════════════
 *  APPLIQUER LES MIGRATIONS SUR LA BASE DE PRODUCTION
 * ═══════════════════════════════════════════════════════════════════
 *
 * À lancer depuis la racine du projet :
 *
 *   railway run --service Postgres -- node cpg-api/migrer_prod.mjs
 *       → n'affiche que ce qui SERAIT appliqué, n'écrit rien
 *
 *   railway run --service Postgres -- node cpg-api/migrer_prod.mjs --executer
 *       → applique réellement
 *
 * Pourquoi ce script et pas `npm run migrate` :
 *
 *   • DATABASE_PUBLIC_URL n'existe que sur le service Postgres de
 *     Railway, d'où le `--service Postgres` ; depuis le Mac, l'URL
 *     interne du service CPG ne résout pas ;
 *
 *   • src/db/index.js se connecte sans SSL sauf si DATABASE_SSL=true,
 *     et met alors rejectUnauthorized: true — ni l'un ni l'autre ne
 *     convient au point d'entrée public de Railway. Ce script fixe
 *     donc le SSL lui-même.
 *
 * Même table de suivi que `npm run migrate` (schema_migrations) : une
 * migration déjà passée n'est jamais rejouée, et les deux commandes se
 * comprennent mutuellement.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'src', 'db', 'migrations');
const executer = process.argv.includes('--executer');

if (!process.env.DATABASE_PUBLIC_URL) {
  console.error(
    'DATABASE_PUBLIC_URL absente.\n'
    + 'Lancez la commande avec : railway run --service Postgres -- node cpg-api/migrer_prod.mjs'
  );
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_PUBLIC_URL,
  ssl: { rejectUnauthorized: false },
});

await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);

const { rows } = await pool.query('SELECT name FROM schema_migrations');
const deja = new Set(rows.map((r) => r.name));
const fichiers = (await readdir(DIR)).filter((f) => f.endsWith('.sql')).sort();
const aFaire = fichiers.filter((f) => !deja.has(f));

console.log(`${deja.size} migrations déjà appliquées, ${aFaire.length} en attente :`);
for (const f of aFaire) console.log(`  ${f}`);

if (!aFaire.length) {
  console.log('\nRien à faire, la base est à jour.');
  await pool.end();
  process.exit(0);
}

if (!executer) {
  console.log('\n(simulation — relancez avec --executer pour appliquer)');
  await pool.end();
  process.exit(0);
}

for (const f of aFaire) {
  process.stdout.write(`-> ${f} ... `);
  try {
    await pool.query(await readFile(join(DIR, f), 'utf8'));
    await pool.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
    console.log('OK');
  } catch (e) {
    // On s'arrête à la première erreur : la suivante pourrait dépendre
    // de celle qui a échoué, et l'appliquer quand même laisserait la
    // base dans un état que personne ne sait décrire.
    console.log(`ÉCHEC : ${e.message}`);
    console.log('\nArrêt. Rien de ce qui suit n’a été appliqué.');
    await pool.end();
    process.exit(1);
  }
}

console.log('\nTerminé.');
await pool.end();
