/**
 * ═══════════════════════════════════════════════════════════════════
 *  IMPORTER UNE PAIE DEPUIS UN FICHIER
 * ═══════════════════════════════════════════════════════════════════
 *
 * Même chemin que l'écran de l'opérateur — `previewAgentSalariesFromCsv`
 * puis `creditAgentSalariesFromCsv` — pour que le résultat soit
 * identique à celui d'un import fait à la main : même résolution des
 * identifiants, même idempotence par employeur et période, mêmes
 * écritures au grand livre.
 *
 * En deux temps, et c'est volontaire : l'aperçu n'écrit RIEN, il dit
 * seulement qui serait crédité de combien et quelles lignes posent
 * problème. On ne crédite qu'après l'avoir lu.
 *
 *   railway run --service Postgres -- node cpg-api/importer_paie.mjs <fichier.csv> <EMPLOYEUR> <AAAA-MM>
 *   railway run --service Postgres -- node cpg-api/importer_paie.mjs <fichier.csv> <EMPLOYEUR> <AAAA-MM> --executer
 */
process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
process.env.DATABASE_SSL = 'relaxed';

import { readFileSync } from 'node:fs';

const args = process.argv.slice(2).filter((a) => a !== '--executer');
const executer = process.argv.includes('--executer');
const [fichier, employeur, periode] = args;

if (!fichier || !employeur || !periode) {
  console.error('Usage : node importer_paie.mjs <fichier.csv> <EMPLOYEUR> <AAAA-MM> [--executer]');
  process.exit(1);
}
if (!process.env.DATABASE_PUBLIC_URL) {
  console.error('DATABASE_PUBLIC_URL absente. Lancez avec : railway run --service Postgres -- node …');
  process.exit(1);
}

const { query } = await import('./src/db/index.js');
const { previewAgentSalariesFromCsv, creditAgentSalariesFromCsv } = await import('./src/services/operationsService.js');

const f = (n) => Math.round(Number(n)).toLocaleString('fr-FR');
const csvText = readFileSync(fichier, 'utf8');

const apercu = await previewAgentSalariesFromCsv({ csvText, employeur, periode });

console.log(`APERCU — ${employeur}, periode ${periode}\n`);
const lignes = apercu.lignes ?? apercu.aCrediter ?? [];
if (lignes.length) {
  console.log('client                              numero       montant   solde avant');
  for (const l of lignes) {
    const nom = l.client ?? l.nom ?? '(?)';
    console.log(
      `${String(nom).slice(0, 34).padEnd(35)} ${String(l.client_number ?? l.identifiant ?? '').padEnd(12)} `
      + `${f(l.montant).padStart(9)} ${l.solde !== undefined ? f(l.solde).padStart(12) : ''}`
    );
  }
}
const total = lignes.reduce((t, l) => t + Number(l.montant), 0);
console.log(`\n${lignes.length} ligne(s), ${f(total)} F`);

for (const [cle, titre] of [
  ['introuvables', 'IDENTIFIANTS INTROUVABLES'],
  ['lignesInvalides', 'LIGNES INVALIDES'],
  ['ambigus', 'IDENTIFIANTS AMBIGUS'],
  ['dejaCredites', 'DEJA CREDITES POUR CETTE PERIODE'],
]) {
  const v = apercu[cle];
  if (Array.isArray(v) && v.length) {
    console.log(`\n${titre} (${v.length}) :`);
    for (const x of v) console.log(`  ${JSON.stringify(x)}`);
  }
}

if (!executer) {
  console.log('\nApercu seulement. Rien n’a été écrit. Relancez avec --executer pour créditer.');
  process.exit(0);
}

const { rows: operateur } = await query(
  `SELECT id FROM users WHERE role = 'operateur' ORDER BY created_at LIMIT 1`
);

const r = await creditAgentSalariesFromCsv({
  csvText, employeur, periode, actorId: operateur[0].id,
});

// `creditAgentSalaries` renvoie { reference, credited, notFound, total }.
// J'avais d'abord lu `credites`, qui n'existe pas : le script annoncait
// « 0 credites » alors que les sept lignes etaient bien ecrites.
console.log(`\nCREDITE`);
console.log(`  reference    ${r.reference ?? '—'}`);
console.log(`  credites     ${r.credited?.length ?? 0}`);
console.log(`  total        ${f(r.total ?? 0)} F`);
if (r.notFound?.length) {
  console.log(`  introuvables ${r.notFound.length} :`);
  for (const x of r.notFound) console.log(`    ${JSON.stringify(x)}`);
}
if (r.lignesInvalides?.length) {
  console.log(`  lignes ecartees ${r.lignesInvalides.length} (conservees en base, migration 057)`);
}
process.exit(0);
