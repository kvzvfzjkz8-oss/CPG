/**
 * ═══════════════════════════════════════════════════════════════════
 *  LE SOLDE DE FIN DE MOIS DIT SI LA MENSUALITÉ A ÉTÉ PRISE
 * ═══════════════════════════════════════════════════════════════════
 *
 * « Lorsque tu arrives en fin de mois d'octobre et que le solde d'un
 *   client est passé de 0 à moins quelque chose, cela veut dire qu'il y
 *   a eu un prélèvement fait après qu'il ait perçu son salaire. Donc en
 *   début de mois il n'y a plus de prélèvement à faire. Mais pour le cas
 *   de GROA les soldes étaient déjà à 0 en fin de mois, donc il n'y a eu
 *   aucun prélèvement fait après la période des salaires, et le
 *   prélèvement de novembre reste dû. » (direction, 04/11/2026)
 *
 * C'est le critère juste, et il remplace celui que j'avais retenu —
 * « deux mensualités payées en octobre » — qui confondait deux
 * situations opposées :
 *
 *   • solde NÉGATIF au 30/10 : la seconde mensualité a été prise APRÈS
 *     le salaire, en découvert. Le client a payé d'avance, son novembre
 *     est couvert → 4 décembre.
 *
 *   • solde À ZÉRO ou positif au 30/10 : le salaire a tout absorbé mais
 *     rien n'a été pris au-delà. C'était du rattrapage d'arriéré, pas
 *     une avance → novembre reste dû.
 *
 * Mon critère envoyait sept crédits à décembre à tort, dont trois qui
 * pouvaient payer immédiatement.
 *
 *   railway run --service Postgres -- node cpg-api/appliquer_regle_solde_fin_mois.mjs
 *   railway run --service Postgres -- node cpg-api/appliquer_regle_solde_fin_mois.mjs --executer
 */
import pg from 'pg';

const FIN_DE_MOIS = '2026-10-31';   // solde arrêté la veille de cette date
const CIBLE = '2026-11-04';
const DEPUIS = '2026-12-04';
/** Comptes de test : on ne redate pas leurs échéances, ils seront fermés. */
const EXCLUS = ['koumba', 'Jean-Paul Ndong'];
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

function leQuatre(n) {
  const [a, m, j] = CIBLE.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1 + n, j, 12)).toISOString().slice(0, 10);
}

const { rows: directeur } = await pool.query(
  `SELECT id FROM users WHERE role = 'directeur' ORDER BY created_at LIMIT 1`
);

// Tous les crédits renvoyés au 4 décembre sans avoir rien payé en
// novembre, avec leur solde arrêté à la fin d'octobre.
const { rows: candidats } = await pool.query(
  `SELECT c.id, c.reference, btrim(u.full_name) AS nom,
          btrim(COALESCE(u.employer,'—')) AS employeur,
          COALESCE((SELECT SUM(le.amount) FROM ledger_entries le
                    WHERE le.account_id = a.id AND le.created_at < $1::date), 0) AS solde_fin_mois,
          COALESCE(b.balance, 0) AS solde_actuel
   FROM credit_requests c
   JOIN users u ON u.id = c.user_id
   JOIN accounts a ON a.user_id = u.id
   LEFT JOIN account_balances b ON b.account_id = a.id
   WHERE c.status = 'approuve'
     AND (SELECT min(i.due_date) FROM installments i
          WHERE i.credit_id = c.id AND i.status <> 'payee') = $2::date
     AND NOT EXISTS (SELECT 1 FROM installments x WHERE x.credit_id = c.id
                     AND x.status = 'payee' AND x.paid_at >= date_trunc('month', now())
                     AND x.paid_at <= now())
   ORDER BY u.full_name`,
  [FIN_DE_MOIS, DEPUIS]
);

const plan = [];
console.log('agent                          employeur   solde fin oct   verdict');
for (const c of candidats) {
  const du = Number(c.solde_fin_mois) >= 0;
  const exclu = EXCLUS.some((e) => c.nom.toLowerCase().includes(e.toLowerCase()));
  console.log(`${c.nom.slice(0,30).padEnd(31)} ${c.employeur.slice(0,10).padEnd(11)} ${f(c.solde_fin_mois).padStart(13)}   `
    + (exclu ? 'compte de test — laisse tel quel' : du ? 'NOVEMBRE DU' : 'decembre, correct'));
  if (!du || exclu) continue;

  const { rows: ech } = await pool.query(
    `SELECT id, sequence, to_char(due_date,'YYYY-MM-DD') AS due, amount
     FROM installments WHERE credit_id = $1 AND status <> 'payee' ORDER BY sequence`,
    [c.id]
  );
  const lignes = ech.map((e, i) => ({ ...e, apres: leQuatre(i) })).filter((l) => l.due !== l.apres);
  if (lignes.length) plan.push({ credit: c, lignes, premiere: ech[0] });
}

console.log(`\n${plan.length} credit(s) a ramener au ${CIBLE} :\n`);
let total = 0;
for (const p of plan) {
  total += Number(p.premiere.amount);
  const peut = Number(p.credit.solde_actuel) >= Number(p.premiere.amount);
  console.log(`  ${p.credit.reference.padEnd(11)} ${p.credit.nom.slice(0,28).padEnd(29)} ${f(p.premiere.amount).padStart(9)} F · `
    + `solde ${f(p.credit.solde_actuel).padStart(9)} F · ${peut ? 'peut payer' : 'passera en retard'}`);
}
console.log(`\nDevient exigible le ${CIBLE} : ${f(total)} F`);

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
      motif: 'Regle du solde de fin de mois : solde a zero au 30/10 = aucun prelevement apres le salaire, novembre reste du',
      credits: plan.map((p) => `${p.credit.reference} ${p.credit.nom}`),
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
