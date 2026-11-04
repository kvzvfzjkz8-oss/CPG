/**
 * ═══════════════════════════════════════════════════════════════════
 *  UNE MENSUALITÉ PAR MOIS, POUR TOUT LE MONDE
 * ═══════════════════════════════════════════════════════════════════
 *
 * « Chaque mois il y a un prélèvement, à moins que le client ait pris
 *   deux crédits qui se suivent. » (direction, 04/11/2026)
 *
 * C'est la règle, et elle est simple. Un crédit prélevé en octobre doit
 * l'être en novembre. Le solde de fin de mois n'est PAS un critère pour
 * sauter un mois : il explique seulement si quelque chose a été pris
 * après le salaire, ce qui est une autre question.
 *
 * Je m'y suis trompé deux fois, et ce fichier remplace les deux
 * tentatives :
 *
 *   1. « prélevé dans le dernier mois glissant → mois suivant » :
 *      32 crédits prélevés le 6 octobre sautaient novembre,
 *      4 203 041 F non appelés ;
 *
 *   2. « solde négatif au 30/10 → a payé d'avance → mois suivant » :
 *      10 crédits de plus sautaient novembre, 1 418 551 F. MATEYA en
 *      était l'exemple : solde à -169 553 F au 30 octobre, mais il
 *      n'avait rien payé d'avance — il avait réglé septembre en retard
 *      le 5 octobre, puis octobre le 27. Sa mensualité de novembre,
 *      due le 26 à l'origine, s'est retrouvée au 4 décembre.
 *
 * La règle retenue ne regarde donc qu'une chose : CE MOIS-CI a-t-il
 * déjà eu son prélèvement ? Si non, la prochaine échéance revient au 4
 * du mois courant, et tout l'échéancier suit.
 *
 * Deux exceptions :
 *   • les crédits SCOLAIRE, qui démarrent en janvier ;
 *   • les comptes de test, qu'on ne touche pas.
 *
 *   railway run --service Postgres -- node cpg-api/une_mensualite_par_mois.mjs
 *   railway run --service Postgres -- node cpg-api/une_mensualite_par_mois.mjs --executer
 */
import pg from 'pg';

const CIBLE = '2026-11-04';
const MOIS_COURANT = '2026-11-01';
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

// Tout crédit actif qui n'a RIEN été prélevé ce mois-ci et dont la
// prochaine échéance tombe après le 4 du mois courant.
const { rows: candidats } = await pool.query(
  `SELECT c.id, c.reference, btrim(u.full_name) AS nom,
          btrim(COALESCE(u.employer,'—')) AS employeur,
          COALESCE(p.code, '(sans produit)') AS produit,
          COALESCE(b.balance, 0) AS solde
   FROM credit_requests c
   JOIN users u ON u.id = c.user_id
   LEFT JOIN product_versions pv ON pv.id = c.product_version_id
   LEFT JOIN credit_products p ON p.id = pv.product_id
   JOIN accounts a ON a.user_id = c.user_id
   LEFT JOIN account_balances b ON b.account_id = a.id
   WHERE c.status = 'approuve'
     AND COALESCE(p.code, '') <> 'SCOLAIRE'
     AND (SELECT min(i.due_date) FROM installments i
          WHERE i.credit_id = c.id AND i.status <> 'payee') > $1::date
     AND NOT EXISTS (SELECT 1 FROM installments x WHERE x.credit_id = c.id
                     AND x.status = 'payee' AND x.paid_at >= $2::date AND x.paid_at <= now())
   ORDER BY u.full_name`,
  [CIBLE, MOIS_COURANT]
);

const plan = [];
for (const c of candidats) {
  if (EXCLUS.some((e) => c.nom.toLowerCase().includes(e.toLowerCase()))) {
    console.log(`${c.nom} (${c.reference}) : compte de test, laisse tel quel`);
    continue;
  }
  const { rows: ech } = await pool.query(
    `SELECT id, sequence, to_char(due_date,'YYYY-MM-DD') AS due, amount
     FROM installments WHERE credit_id = $1 AND status <> 'payee' ORDER BY sequence`,
    [c.id]
  );
  const lignes = ech.map((e, i) => ({ ...e, apres: leQuatre(i) })).filter((l) => l.due !== l.apres);
  if (lignes.length) plan.push({ credit: c, lignes, premiere: ech[0] });
}

console.log(`\n${plan.length} credit(s) a ramener au ${CIBLE} :\n`);
console.log('client                     employeur   mensualite     solde   peut payer');
let total = 0, peuvent = 0, montantPeuvent = 0;
for (const p of plan) {
  total += Number(p.premiere.amount);
  const ok = Number(p.credit.solde) >= Number(p.premiere.amount);
  if (ok) { peuvent += 1; montantPeuvent += Number(p.premiere.amount); }
  console.log(`${p.credit.nom.slice(0,25).padEnd(26)} ${p.credit.employeur.slice(0,10).padEnd(11)} ${f(p.premiere.amount).padStart(10)} ${f(p.credit.solde).padStart(9)}   ${ok ? 'OUI' : 'non'}`);
}
console.log(`\n${f(total)} F deviennent exigibles · ${peuvent} peuvent payer tout de suite pour ${f(montantPeuvent)} F`);

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
      motif: 'Une mensualite par mois : tout credit sans prelevement ce mois-ci revient au 4 du mois courant',
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
