/**
 * ═══════════════════════════════════════════════════════════════════
 *  REPRENDRE LES MENSUALITÉS DE NOVEMBRE RÉELLEMENT DUES
 * ═══════════════════════════════════════════════════════════════════
 *
 * Le 4 novembre 2026, j'ai extourné quatorze prélèvements en croyant
 * qu'ils doublaient celui du 27 octobre. C'était vrai pour sept d'entre
 * eux, faux pour les sept autres.
 *
 * La règle de la direction, énoncée le 04/11/2026, les sépare :
 *
 *   « Le salaire du mois d'octobre prélève l'échéance prévue fin
 *     septembre ou début octobre. L'agent récupère tout son argent :
 *     le solde doit être avoisinant zéro après la récupération des
 *     salaires. Donc si un prélèvement est passé entre la période des
 *     salaires et celui du 27 ou du 30, le solde a dû passer en
 *     négatif. »
 *
 *   • les QSR ont été prélevés le 27 octobre APRÈS que leur salaire
 *     soit reparti au guichet : solde à -151 970, -129 700, -169 553…
 *     C'est leur salaire de novembre qui a payé. Novembre est couvert,
 *     ils attendent décembre ;
 *
 *   • les GROA ont été prélevés le 6 octobre SUR leur salaire, solde
 *     resté positif. Octobre a été payé par octobre, et leur salaire de
 *     novembre est arrivé : la mensualité de novembre leur est due.
 *
 * Ce script remet l'échéance de ces derniers au 4 novembre et la
 * prélève par le chemin normal du logiciel — `collectInstallments`,
 * celui de l'opérateur — pour que le garde-fou, le contrôle de
 * provision et l'écriture au grand livre soient exactement les mêmes
 * que d'habitude. Puis il réaligne la suite de l'échéancier sur le 4.
 *
 *   railway run --service Postgres -- node cpg-api/reprendre_novembre_du.mjs
 *   railway run --service Postgres -- node cpg-api/reprendre_novembre_du.mjs --executer
 */
process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
process.env.DATABASE_SSL = 'relaxed';

const executer = process.argv.includes('--executer');
const CIBLE = '2026-11-04';
const SUITE = '2026-12-04';

if (!process.env.DATABASE_PUBLIC_URL) {
  console.error('DATABASE_PUBLIC_URL absente. Lancez avec : railway run --service Postgres -- node …');
  process.exit(1);
}

const { query } = await import('./src/db/index.js');
const { collectInstallments } = await import('./src/services/operationsService.js');

const f = (n) => Math.round(Number(n)).toLocaleString('fr-FR');
function leQuatre(n) {
  const [a, m, j] = SUITE.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1 + n, j, 12)).toISOString().slice(0, 10);
}

// Le critère du garde-fou, rejoué ici pour établir la liste : dernier
// prélèvement vivant du crédit, solde réel juste après, et nombre de
// salaires reçus depuis.
const { rows: candidats } = await query(
  `SELECT c.id AS credit_id, c.reference, btrim(u.full_name) AS nom,
          btrim(COALESCE(u.employer, '—')) AS employeur,
          COALESCE(b.balance, 0) AS solde,
          to_char(d.paid_at, 'DD/MM') AS dernier,
          (SELECT COALESCE(SUM(le2.amount), 0) FROM ledger_entries le2
            WHERE le2.account_id = d.account_id
              AND (le2.created_at, le2.id) <= (d.created_at, d.entry_id)) AS solde_apres,
          (SELECT count(*) FROM ledger_entries le3
            WHERE le3.account_id = d.account_id AND le3.type = 'salaire'
              AND (le3.created_at, le3.id) > (d.created_at, d.entry_id)
              AND NOT EXISTS (SELECT 1 FROM ledger_entries x
                               WHERE x.reversed_entry_id = le3.id))::int AS salaires
   FROM credit_requests c
   JOIN users u ON u.id = c.user_id
   JOIN accounts a ON a.user_id = u.id
   LEFT JOIN account_balances b ON b.account_id = a.id
   JOIN LATERAL (
     SELECT i.paid_at, le.id AS entry_id, le.created_at, le.account_id
     FROM installments i JOIN ledger_entries le ON le.id = i.ledger_entry_id
     WHERE i.credit_id = c.id AND i.status = 'payee' AND i.paid_at <= now()
       AND NOT EXISTS (SELECT 1 FROM ledger_entries x WHERE x.reversed_entry_id = le.id)
     ORDER BY le.created_at DESC, le.id DESC LIMIT 1
   ) d ON TRUE
   WHERE c.status = 'approuve'
     AND EXISTS (SELECT 1 FROM installments i WHERE i.credit_id = c.id AND i.status <> 'payee')
     -- aucune mensualité encaissée en novembre
     AND NOT EXISTS (
       SELECT 1 FROM installments i JOIN ledger_entries le ON le.id = i.ledger_entry_id
        WHERE i.credit_id = c.id AND i.status = 'payee'
          AND le.created_at >= '2026-11-01'
          AND NOT EXISTS (SELECT 1 FROM ledger_entries x WHERE x.reversed_entry_id = le.id))
   ORDER BY u.full_name`
);

const dus = candidats.filter((c) => {
  const requis = Number(c.solde_apres) < 0 ? 2 : 1;
  return c.salaires >= requis;
});

if (!dus.length) {
  console.log('Aucune mensualite de novembre a reprendre.');
  process.exit(0);
}

console.log(`${dus.length} credit(s) dont la mensualite de novembre est due\n`);
console.log('client                        empl.  credit     dern. solde apres  salaires  solde actuel');
for (const c of dus) {
  console.log(
    `${c.nom.slice(0, 28).padEnd(29)} ${c.employeur.slice(0, 5).padEnd(6)} ${c.reference.padEnd(10)} `
    + `${c.dernier} ${f(c.solde_apres).padStart(11)}     ${c.salaires}      ${f(c.solde).padStart(11)}`
  );
}

if (!executer) {
  console.log('\nSimulation. Rien n’a été écrit. Relancez avec --executer pour appliquer.');
  process.exit(0);
}

const { rows: directeur } = await query(
  `SELECT id FROM users WHERE role = 'directeur' ORDER BY created_at LIMIT 1`
);

let preleves = 0, total = 0;
for (const c of dus) {
  // L'échéance revient au 4 novembre : c'est la date du prélèvement de
  // ce mois, celle de tout le monde.
  const { rows: prochaine } = await query(
    `SELECT id, sequence FROM installments
     WHERE credit_id = $1 AND status <> 'payee' ORDER BY sequence LIMIT 1`,
    [c.credit_id]
  );
  if (!prochaine[0]) continue;
  await query(
    `UPDATE installments SET due_date = $1::date, status = 'a_venir' WHERE id = $2`,
    [CIBLE, prochaine[0].id]
  );

  const r = await collectInstallments({
    echeanceIds: [prochaine[0].id],
    actorId: directeur[0].id,
  });

  if (r.preleves.length) {
    preleves += 1;
    total += Number(r.preleves[0].amount);
    console.log(`${c.nom} (${c.reference}) : ${f(r.preleves[0].amount)} F preleves`
      + `${r.preleves[0].decouvert ? ' — compte a decouvert' : ''}`);
  } else {
    console.log(`${c.nom} (${c.reference}) : NON PRELEVE — ${r.echecs[0]?.motif ?? 'motif inconnu'}`);
  }

  // Le reste de l'échéancier repart du 4 décembre.
  const { rows: restantes } = await query(
    `SELECT id FROM installments WHERE credit_id = $1 AND status <> 'payee' ORDER BY sequence`,
    [c.credit_id]
  );
  for (let i = 0; i < restantes.length; i += 1) {
    await query(
      `UPDATE installments SET due_date = $1::date, status = 'a_venir' WHERE id = $2`,
      [leQuatre(i), restantes[i].id]
    );
  }
}

console.log(`\n${preleves} mensualite(s) prelevee(s), ${f(total)} F.`);
process.exit(0);
