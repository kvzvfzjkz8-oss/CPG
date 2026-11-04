/**
 * ═══════════════════════════════════════════════════════════════════
 *  LES 5 AGENTS GROA PAIENT BIEN NOVEMBRE
 * ═══════════════════════════════════════════════════════════════════
 *
 * « Les 5 agents de GROA doivent être prélevés, car il s'agissait à ce
 *   moment d'ancien reliquat. Donc pour ce qui les concerne, prélève-les
 *   de l'échéance de ce mois de novembre. Pour QSR pas de soucis. Pour
 *   EFF également. » (direction, 04/11/2026)
 *
 * L'harmonisation du 4 novembre avait renvoyé au 4 décembre tout crédit
 * ayant payé deux mensualités en octobre : un mois double couvre celui
 * qui suit. Vrai pour QSR et EFF, faux pour ces cinq-là — leur second
 * prélèvement d'octobre rattrapait un arriéré, il n'avançait rien. Leur
 * novembre est donc bien dû.
 *
 * Leurs soldes au 30 octobre le confirment : tous à exactement 0 F, la
 * paie d'octobre entièrement absorbée par le rattrapage. Les sept
 * agents QSR, eux, etaient negatifs — leur second prelevement avait ete
 * pris en decouvert, c'est bien une avance.
 *
 * Le décalage porte sur TOUT l'échéancier restant, pas seulement sur la
 * première : sans cela, décembre porterait deux mensualités.
 *
 *   railway run --service Postgres -- node cpg-api/ramener_groa_novembre.mjs
 *   railway run --service Postgres -- node cpg-api/ramener_groa_novembre.mjs --executer
 */
import pg from 'pg';

const AGENTS = [
  'MBA ALLOGHO Ronny Dominique',
  'MOUNGUENGUI MOUNGUENGUI Wilfried',
  'NGOUA MBA François',
  'NYINGONE ASSOUGHE Styve',
  'SANOUKOUE Jean Fubri',
];
const CIBLE = '2026-11-04';
const DEPUIS = '2026-12-04';
const executer = process.argv.includes('--executer');

if (!process.env.DATABASE_PUBLIC_URL) {
  console.error('DATABASE_PUBLIC_URL absente. Lancez avec : railway run --service Postgres -- node …');
  process.exit(1);
}
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_PUBLIC_URL,
  ssl: { rejectUnauthorized: false },
});
const f = (n) => Math.round(Number(n)).toLocaleString('fr-FR');

/** Le 4 du mois, `n` mois apres la cible, a midi UTC. */
function leQuatre(n) {
  const [a, m, j] = CIBLE.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1 + n, j, 12)).toISOString().slice(0, 10);
}

const { rows: directeur } = await pool.query(
  `SELECT id FROM users WHERE role = 'directeur' ORDER BY created_at LIMIT 1`
);

const plan = [];
for (const nom of AGENTS) {
  const { rows: u } = await pool.query(
    `SELECT u.id, btrim(u.full_name) AS nom, COALESCE(b.balance, 0) AS solde
     FROM users u JOIN accounts a ON a.user_id = u.id
     LEFT JOIN account_balances b ON b.account_id = a.id
     WHERE u.role = 'client' AND btrim(u.full_name) = $1`,
    [nom]
  );
  if (!u[0]) { console.log(`${nom} : INTROUVABLE — nom a verifier`); continue; }

  // Seuls les credits dont la prochaine echeance est au 4 decembre :
  // ceux qui partent plus tard n'ont pas ete decales par erreur.
  const { rows: credits } = await pool.query(
    `SELECT c.id, c.reference
     FROM credit_requests c
     WHERE c.user_id = $1 AND c.status = 'approuve'
       AND (SELECT min(i.due_date) FROM installments i
            WHERE i.credit_id = c.id AND i.status <> 'payee') = $2::date`,
    [u[0].id, DEPUIS]
  );

  for (const c of credits) {
    const { rows: ech } = await pool.query(
      `SELECT id, sequence, to_char(due_date, 'YYYY-MM-DD') AS due, amount
       FROM installments WHERE credit_id = $1 AND status <> 'payee' ORDER BY sequence`,
      [c.id]
    );
    const lignes = ech.map((e, i) => ({ ...e, apres: leQuatre(i) }))
      .filter((l) => l.due !== l.apres);
    if (lignes.length) plan.push({ agent: u[0], credit: c, lignes, premiere: ech[0] });
  }
}

console.log(`\n${plan.length} credit(s) a ramener au ${CIBLE} :\n`);
console.log('agent                            credit      solde      mensualite  echeances decalees');
let aPrelever = 0;
for (const p of plan) {
  aPrelever += Number(p.premiere.amount);
  console.log(`${p.agent.nom.slice(0,32).padEnd(33)} ${p.credit.reference.padEnd(11)} ${f(p.agent.solde).padStart(9)}  ${f(p.premiere.amount).padStart(10)}  `
    + `${p.lignes.length} · ${p.lignes[0].due} → ${p.lignes[0].apres}`);
}
console.log(`\nSera exigible le ${CIBLE} : ${f(aPrelever)} F`);
const couverts = plan.filter((p) => Number(p.agent.solde) >= Number(p.premiere.amount)).length;
console.log(`${couverts} sur ${plan.length} couverts par leur solde actuel`);

if (!executer) {
  console.log('\n(simulation — relancez avec --executer pour appliquer)');
  await pool.end();
  process.exit(0);
}

const client = await pool.connect();
try {
  await client.query('BEGIN');
  let n = 0;
  for (const p of plan) {
    for (const l of p.lignes) {
      await client.query(
        `UPDATE installments
         SET original_due_date = COALESCE(original_due_date, due_date),
             due_date = $2::date, adjusted_by = $3, adjusted_at = now()
         WHERE id = $1`,
        [l.id, l.apres, directeur[0].id]
      );
      n += 1;
    }
  }
  await client.query(
    `INSERT INTO audit_log (actor_id, actor_role, action, entity_type, entity_id, metadata, ip_address)
     VALUES ($1, 'directeur', 'operations.echeances_redatees', 'periode', $2, $3, NULL)`,
    [directeur[0].id, CIBLE, {
      motif: 'Les 5 agents GROA paient novembre : leur double prelevement d octobre etait un rattrapage d arriere, pas une avance',
      agents: plan.map((p) => p.agent.nom),
      credits: plan.length,
      echeances: n,
    }]
  );
  await client.query('COMMIT');
  console.log(`\n${n} echeance(s) redatees sur ${plan.length} credit(s). Decision tracee au journal.`);
} catch (e) {
  await client.query('ROLLBACK');
  console.error(`\nECHEC, rien n'a ete applique : ${e.message}`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
