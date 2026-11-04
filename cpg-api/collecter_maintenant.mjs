/**
 * ═══════════════════════════════════════════════════════════════════
 *  LANCER LA COLLECTE DES ÉCHÉANCES TOUT DE SUITE
 * ═══════════════════════════════════════════════════════════════════
 *
 * « Pour ceux qui ont déjà été payés, que le crédit passe tout de
 *   suite. » (direction, 04/11/2026)
 *
 * La tâche planifiée passe chaque jour à 6 h. Quand un échéancier est
 * modifié dans la journée — l'harmonisation du 4 novembre, par exemple —
 * les échéances devenues exigibles attendent le lendemain matin. Ce
 * script fait passer la collecte maintenant.
 *
 * Il appelle `runInstallmentCollection`, la MÊME fonction que la tâche
 * de 6 h. Rien n'est réécrit ici : une seconde implémentation de la
 * collecte finirait par diverger de celle qui tourne en production, et
 * c'est de l'argent client.
 *
 * Les règles du logiciel s'appliquent donc telles quelles :
 *   • une échéance déjà payée n'est jamais reprise ;
 *   • le découvert n'est autorisé que si l'agent a reçu un salaire ce
 *     mois-ci — sinon l'échéance passe en retard, sans mouvement ;
 *   • une échéance en retard est reprise à chaque passage.
 *
 *   railway run --service Postgres -- sh -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" \
 *     DATABASE_SSL=relaxed node cpg-api/collecter_maintenant.mjs'
 *       → simulation : ce qui serait prélevé, ce qui resterait en retard
 *
 *   … node cpg-api/collecter_maintenant.mjs --executer
 */
import { query, pool } from './src/db/index.js';
import { runInstallmentCollection } from './src/services/operationsService.js';
import { auditAutomated } from './src/services/auditService.js';

const executer = process.argv.includes('--executer');
const f = (n) => Math.round(Number(n)).toLocaleString('fr-FR');

const { rows: acteur } = await query(
  `SELECT id, btrim(full_name) AS nom FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`
);
if (!acteur[0]) {
  console.error('Aucun compte technique (role admin) : impossible de tracer la collecte.');
  await pool.end();
  process.exit(1);
}

// Aperçu : exactement ce que la fonction va examiner, et le verdict
// qu'elle rendra pour chaque ligne.
const { rows: apercu } = await query(
  `SELECT btrim(u.full_name) AS client, c.reference, i.sequence, i.amount,
          i.status::text AS statut, to_char(i.due_date,'YYYY-MM-DD') AS due,
          COALESCE(b.balance, 0) AS solde,
          EXISTS (SELECT 1 FROM ledger_entries le WHERE le.account_id = a.id
                  AND le.type = 'salaire' AND le.created_at >= date_trunc('month', now())) AS paye_ce_mois
   FROM installments i
   JOIN credit_requests c ON c.id = i.credit_id
   JOIN users u ON u.id = c.user_id
   JOIN accounts a ON a.user_id = u.id
   LEFT JOIN account_balances b ON b.account_id = a.id
   WHERE i.status IN ('a_venir','en_retard') AND i.due_date <= CURRENT_DATE
     AND c.status = 'approuve'
   ORDER BY i.due_date, u.full_name`
);

console.log(`${apercu.length} echeance(s) exigible(s) a examiner :\n`);
console.log('due          client                     echeance     solde  paye ce mois  verdict');
let prevus = 0;
for (const r of apercu) {
  const provision = Number(r.solde) >= Number(r.amount);
  const ira = provision || r.paye_ce_mois;
  if (ira) prevus += Number(r.amount);
  console.log(`${r.due}  ${r.client.slice(0,25).padEnd(26)} ${f(r.amount).padStart(8)} ${f(r.solde).padStart(9)}  `
    + `${(r.paye_ce_mois ? 'oui' : 'non').padEnd(12)}  ${ira ? (provision ? 'PRELEVEE' : 'PRELEVEE (decouvert)') : 'reste en retard'}`);
}
console.log(`\nSerait preleve : ${f(prevus)} F`);

if (!executer) {
  console.log('\n(simulation — relancez avec --executer pour appliquer)');
  await pool.end();
  process.exit(0);
}

const result = await runInstallmentCollection({ actorId: acteur[0].id });

// La trace, comme la tache de 6 h l'ecrit : `runInstallmentCollection`
// ne journalise rien par lui-meme, c'est son appelant qui le fait. Sans
// cette ligne, de l'argent bouge sur des comptes clients sans qu'aucune
// trace ne dise qui l'a declenche ni quand.
await auditAutomated({
  actorId: acteur[0].id,
  actorRole: 'admin',
  action: 'operations.echeances_prelevees_manuellement',
  entityType: 'periode',
  entityId: new Date().toISOString().slice(0, 10),
  metadata: {
    motif: 'Collecte lancee a la main apres modification des echeanciers',
    examinees: result.checked,
    payees: result.paid.length,
    retards: result.late.length,
    total: result.totalCollected,
  },
});

console.log(`\n${result.checked ?? apercu.length} echeance(s) examinee(s)`);
console.log(`  ${result.paid.length} prelevee(s) pour ${f(result.totalCollected)} F`);
console.log(`  ${result.late.length} en retard`);
if (result.overdrafts?.length) {
  console.log(`  ${result.overdrafts.length} ont mis le compte a decouvert :`);
  for (const o of result.overdrafts) console.log(`     ${o.reference} ${f(o.amount)} F → solde ${f(o.soldeApres)} F`);
}
for (const p of result.paid) console.log(`  OK   ${p.reference} ech. ${p.sequence} · ${f(p.amount)} F`);
for (const l of result.late) console.log(`  --   ${l.reference} ech. ${l.sequence} · ${f(l.amount)} F · ${l.motif}`);

await pool.end();
