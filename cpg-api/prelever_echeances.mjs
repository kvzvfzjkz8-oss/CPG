/**
 * ═══════════════════════════════════════════════════════════════════
 *  PRÉLEVER DES ÉCHÉANCES DÉSIGNÉES, MAINTENANT
 * ═══════════════════════════════════════════════════════════════════
 *
 * Même chemin que le prélèvement ciblé de l'opérateur —
 * `collectInstallments` — donc même garde-fou « un salaire paie une
 * mensualité », même contrôle de provision, mêmes écritures. Aucune
 * exception n'est posée : une échéance refusée par la règle le reste,
 * et le motif est affiché.
 *
 * Sert quand la direction veut encaisser sans attendre le passage
 * automatique de 6h — à l'arrivée d'une paie, typiquement.
 *
 *   railway run --service Postgres -- node cpg-api/prelever_echeances.mjs <id,id,id>
 *   railway run --service Postgres -- node cpg-api/prelever_echeances.mjs <id,id,id> --executer
 */
process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
process.env.DATABASE_SSL = 'relaxed';

// ─────────────────────────────────────────────────────────────────────
//  --forcer "<motif>" : OUTREPASSER LA RÈGLE DU SALAIRE
// ─────────────────────────────────────────────────────────────────────
//
// À n'employer que sur décision expresse de la direction. La règle « un
// salaire paie une mensualité » raisonne sur l'ARGENT : un prélèvement
// pris à découvert est payé par le salaire suivant, qui ne peut donc
// pas payer en plus la mensualité du mois. Le calendrier, lui, peut
// dire autre chose — une échéance datée du 4 novembre et impayée est
// due, vue de l'échéancier.
//
// Quand la direction tranche pour le calendrier contre l'argent, c'est
// ici que cela se passe. L'écriture est alors portée AU NOM DU
// DIRECTEUR (`created_by`) et non de l'opérateur : qui décide d'une
// exception doit en rester l'auteur dans le grand livre.
//
// Le chemin ordinaire reste l'onglet Gestion des crédits, où une telle
// exception exige trois signatures. Ce drapeau est la porte de service,
// et le motif est obligatoire pour qu'elle ne s'emprunte pas sans
// laisser de trace.
const brut = process.argv.slice(2);
const executer = brut.includes('--executer');
const iForcer = brut.indexOf('--forcer');
const forcer = iForcer !== -1;
const motifForcage = forcer ? brut[iForcer + 1] : null;
const args = brut.filter((a, i) => (
  a !== '--executer' && a !== '--forcer' && !(forcer && i === iForcer + 1)
));
const ids = (args[0] ?? '').split(',').map((s) => s.trim()).filter(Boolean);

if (forcer && (!motifForcage || motifForcage.trim().length < 10)) {
  console.error('--forcer exige un motif d’au moins 10 caracteres, entre guillemets.');
  process.exit(1);
}
if (!ids.length) {
  console.error('Usage : node prelever_echeances.mjs <id,id,id> [--forcer "<motif>"] [--executer]');
  process.exit(1);
}
if (!process.env.DATABASE_PUBLIC_URL) {
  console.error('DATABASE_PUBLIC_URL absente. Lancez avec : railway run --service Postgres -- node …');
  process.exit(1);
}

const { query } = await import('./src/db/index.js');
const { collectInstallments } = await import('./src/services/operationsService.js');
const f = (n) => Math.round(Number(n)).toLocaleString('fr-FR');

const { rows: cibles } = await query(
  `SELECT i.id, i.sequence, i.amount::bigint AS montant,
          to_char(i.due_date, 'YYYY-MM-DD') AS due, i.status::text AS statut,
          c.reference, btrim(u.full_name) AS client, u.client_number,
          COALESCE(b.balance, 0)::bigint AS solde
   FROM installments i
   JOIN credit_requests c ON c.id = i.credit_id
   JOIN users u ON u.id = c.user_id
   JOIN accounts a ON a.user_id = u.id
   LEFT JOIN account_balances b ON b.account_id = a.id
   WHERE i.id = ANY($1::uuid[])
   ORDER BY u.full_name`,
  [ids]
);

console.log(`${cibles.length} echeance(s) designee(s) sur ${ids.length} identifiant(s)\n`);
console.log('client                            credit     ech  montant      due         solde     apres');
let total = 0;
for (const c of cibles) {
  total += Number(c.montant);
  const apres = Number(c.solde) - Number(c.montant);
  console.log(
    `${c.client.slice(0, 32).padEnd(33)} ${c.reference.padEnd(10)} ${String(c.sequence).padStart(3)} `
    + `${f(c.montant).padStart(9)}  ${c.due}  ${f(c.solde).padStart(9)} ${f(apres).padStart(10)}`
    + `${apres < 0 ? '  <- A DECOUVERT' : ''}`
  );
}
console.log(`\nTotal : ${f(total)} F`);

if (forcer) {
  console.log('\nEXCEPTION — la regle « un salaire paie une mensualite » sera outrepassee.');
  console.log(`  motif : ${motifForcage.trim()}`);
}

if (!executer) {
  console.log('\nSimulation. Rien n’a été écrit. Relancez avec --executer pour prélever.');
  process.exit(0);
}

// L'auteur de l'ecriture : l'operateur en temps normal, le DIRECTEUR
// quand on force — qui decide d'une exception doit en rester l'auteur
// dans le grand livre.
const { rows: acteur } = await query(
  `SELECT id, btrim(full_name) AS nom FROM users
   WHERE role = $1 ORDER BY created_at LIMIT 1`,
  [forcer ? 'directeur' : 'operateur']
);
if (forcer) console.log(`  auteur au grand livre : ${acteur[0].nom} (directeur)`);
const r = await collectInstallments({ echeanceIds: ids, actorId: acteur[0].id, forcer });

console.log(`\n${r.preleves.length} prelevee(s), ${f(r.totalPreleve)} F`);
for (const p of r.preleves) {
  console.log(`  ${p.client} — ${p.reference} ech. ${p.sequence} : ${f(p.amount)} F`
    + `${p.decouvert ? '  (a decouvert)' : ''}`);
}
if (r.echecs.length) {
  console.log(`\n${r.echecs.length} refusee(s) :`);
  for (const e of r.echecs) console.log(`  ${e.client ?? ''} — ${e.motif}`);
}
process.exit(0);
