/**
 * ═══════════════════════════════════════════════════════════════════
 *  PRÉLÈVEMENT DES FRAIS DE TENUE DE COMPTE DU MOIS
 * ═══════════════════════════════════════════════════════════════════
 *
 * « Arrange-toi que demain tous les comptes soient débités des frais de
 *   tenue de compte. » (direction, 03/11/2026)
 *
 * La règle est désormais le 30 de chaque mois (tâche planifiée). Ce
 * script est le rattrapage : il prélève le mois en cours tout de suite,
 * pour tous les comptes clients actifs qui ne l'ont pas encore payé.
 *
 *   railway run --service Postgres -- node cpg-api/prelever_frais_tenue.mjs
 *       → simulation : qui serait prélevé, pour combien, et ce que
 *         devient chaque solde. N'écrit rien.
 *
 *   railway run --service Postgres -- node cpg-api/prelever_frais_tenue.mjs --executer
 *
 * Deux garde-fous, et ils sont en base, pas ici :
 *
 *   • un compte déjà prélevé sur le mois est refusé — index unique sur
 *     (barème, compte, période), migration 056. Relancer ce script est
 *     donc sans danger, et la tâche du 30 ne refacturera pas ce qui est
 *     prélevé aujourd'hui ;
 *
 *   • le frais passe même si le compte devient négatif. C'est voulu :
 *     c'est le coût de possession du compte, pas une pénalité de
 *     découvert.
 */
import pg from 'pg';

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

const { rows: bareme } = await pool.query(
  `SELECT version_id, amount, name FROM current_fee_versions
   WHERE trigger_on = 'tenue_compte' AND status = 'actif' LIMIT 1`
);
if (!bareme[0]) {
  console.error('Aucun bareme de frais de tenue actif.');
  await pool.end();
  process.exit(1);
}
const montant = Number(bareme[0].amount);

const { rows: periode } = await pool.query(
  `SELECT to_char(date_trunc('month', now()), 'YYYY-MM-DD') AS debut,
          to_char((date_trunc('month', now()) + interval '1 month - 1 day'), 'YYYY-MM-DD') AS fin`
);
const { debut, fin } = periode[0];

const { rows: comptes } = await pool.query(
  `SELECT a.id, btrim(u.full_name) AS nom, u.client_number,
          COALESCE(b.balance, 0) AS solde
   FROM accounts a
   JOIN users u ON u.id = a.user_id
   LEFT JOIN account_balances b ON b.account_id = a.id
   WHERE u.role = 'client' AND u.status = 'actif'
     -- On passe par fee_versions plutot que par applied_fees.fee_id :
     -- cette colonne vient de la migration 056, et le script doit
     -- tourner avant comme apres son application.
     AND NOT EXISTS (
       SELECT 1 FROM applied_fees af
       JOIN fee_versions fva ON fva.id = af.fee_version_id
       WHERE af.account_id = a.id
         AND fva.fee_id = (SELECT fee_id FROM fee_versions WHERE id = $1)
         AND af.period_start = $2::date
     )
   ORDER BY u.full_name`,
  [bareme[0].version_id, debut]
);

console.log(`${bareme[0].name} : ${f(montant)} F · periode ${debut} → ${fin}\n`);
console.log(`${comptes.length} compte(s) a prelever, soit ${f(comptes.length * montant)} F\n`);

const negatifs = comptes.filter((c) => Number(c.solde) - montant < 0);
const basculent = comptes.filter((c) => Number(c.solde) >= 0 && Number(c.solde) - montant < 0);
console.log(`  resteraient positifs : ${comptes.length - negatifs.length}`);
console.log(`  basculeraient en negatif : ${basculent.length}`);
console.log(`  deja negatifs : ${negatifs.length - basculent.length}`);

if (!executer) {
  console.log('\n(simulation — relancez avec --executer pour appliquer)');
  await pool.end();
  process.exit(0);
}

let faits = 0;
let refuses = 0;
const echecs = [];

for (const c of comptes) {
  const client = await pool.connect();
  try {
    // Une transaction par compte : un refus ou une erreur sur l'un ne
    // doit pas annuler les precedents ni arreter les suivants.
    await client.query('BEGIN');
    const { rows: entry } = await client.query(
      `INSERT INTO ledger_entries (account_id, type, amount, label, reference)
       VALUES ($1, 'frais', $2, 'Frais de tenue de compte', $3) RETURNING id`,
      [c.id, -montant, `TENUE-${debut}`]
    );
    await client.query(
      `INSERT INTO applied_fees
         (fee_version_id, account_id, amount, basis_detail, period_start, period_end, ledger_entry_id)
       VALUES ($1, $2, $3, $4, $5::date, $6::date, $7)`,
      [bareme[0].version_id, c.id, montant, { basis: 'fixe', source: 'rattrapage manuel' }, debut, fin, entry[0].id]
    );
    await client.query('COMMIT');
    faits += 1;
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') {
      refuses += 1; // deja preleve sur la periode : exactement ce qu'on veut
    } else {
      echecs.push({ nom: c.nom, message: e.message });
    }
  } finally {
    client.release();
  }
}

console.log(`\n${faits} compte(s) preleves, ${f(faits * montant)} F.`);
if (refuses > 0) console.log(`${refuses} refuse(s) — deja preleve(s) sur la periode, aucun double.`);
for (const e of echecs) console.log(`ECHEC ${e.nom} : ${e.message}`);
await pool.end();
