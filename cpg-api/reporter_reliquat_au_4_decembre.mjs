/**
 * ═══════════════════════════════════════════════════════════════════
 *  LE RELIQUAT DE NOVEMBRE DÉJÀ COUVERT PART AU 4 DÉCEMBRE
 * ═══════════════════════════════════════════════════════════════════
 *
 * « Le cas de Brady et Landry ne fait pas exception : ils ont déjà été
 *   coupés, alors ne prélève plus, tu attendras directement le 04
 *   décembre. » (direction, 04/11/2026)
 *
 * `corriger_doubles_prelevements.mjs` a rendu les mensualités prises
 * deux fois. Reste le symétrique : les crédits coupés fin octobre dont
 * l'échéance du 4 novembre n'a PAS été prélevée. Elle est là, en
 * retard, et la prochaine passe la prendrait — huit jours après la
 * précédente. Le garde-fou de `collecterUneEcheance` la refuserait,
 * mais elle resterait affichée en retard et compterait dans les
 * montants attendus du mois, qui seraient faux.
 *
 * Même critère que partout : ECART_MINIMUM jours entre deux
 * mensualités d'un même crédit. En dessous, l'échéance part au 4
 * décembre et la suite de l'échéancier s'aligne sur le 4.
 *
 * Le dernier paiement se lit en EXCLUANT LES DATES FUTURES : treize
 * échéances de la reprise des anciens crédits portent `paid_at =
 * due_date` dans l'avenir, sans aucune écriture au grand livre. Sans
 * cette exclusion, TCHIVEMBI ressortait avec un écart de -53 jours.
 *
 *   railway run --service Postgres -- node cpg-api/reporter_reliquat_au_4_decembre.mjs
 *   railway run --service Postgres -- node cpg-api/reporter_reliquat_au_4_decembre.mjs --executer
 */
import pg from 'pg';

const ECART_MINIMUM = 25;
const CIBLE = '2026-12-04';
const FIN_DU_MOIS = '2026-11-30';

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

const { rows: candidats } = await pool.query(
  `SELECT c.id AS credit_id, c.reference, btrim(u.full_name) AS nom,
          btrim(COALESCE(u.employer, '—')) AS employeur,
          i.id, i.sequence, i.amount, i.status::text AS statut,
          COALESCE(b.balance, 0) AS solde,
          to_char(d.dernier, 'DD/MM') AS dernier,
          (i.due_date - d.dernier::date) AS ecart
   FROM installments i
   JOIN credit_requests c ON c.id = i.credit_id
   JOIN users u ON u.id = c.user_id
   JOIN accounts a ON a.user_id = u.id
   LEFT JOIN account_balances b ON b.account_id = a.id
   JOIN LATERAL (
     SELECT max(p.paid_at) AS dernier FROM installments p
      WHERE p.credit_id = c.id AND p.status = 'payee' AND p.paid_at <= now()
   ) d ON TRUE
   WHERE i.status <> 'payee'
     AND c.status = 'approuve'
     AND i.due_date <= $1::date
     AND d.dernier IS NOT NULL
     AND (i.due_date - d.dernier::date) < $2
   ORDER BY u.full_name`,
  [FIN_DU_MOIS, ECART_MINIMUM]
);

if (!candidats.length) {
  console.log('Aucune echeance a reporter.');
  await pool.end();
  process.exit(0);
}

console.log(`${candidats.length} echeance(s) de novembre deja couverte(s) par la coupe d'octobre\n`);
console.log('client                      empl.  credit     seq  montant   dernier ecart  statut      solde');
let total = 0;
for (const c of candidats) {
  total += Number(c.amount);
  console.log(
    `${c.nom.slice(0, 26).padEnd(27)} ${c.employeur.slice(0, 5).padEnd(6)} ${c.reference.padEnd(10)} `
    + `${String(c.sequence).padStart(3)} ${f(c.amount).padStart(9)}  ${c.dernier}   ${String(c.ecart).padStart(2)} j  `
    + `${c.statut.padEnd(10)} ${f(c.solde).padStart(10)}`
  );
}
console.log(`\nTotal reporte au ${CIBLE} : ${f(total)} F`);

if (!executer) {
  console.log('\nSimulation. Rien n’a été écrit. Relancez avec --executer pour appliquer.');
  await pool.end();
  process.exit(0);
}

let credits = 0, redatees = 0;
for (const c of candidats) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: restantes } = await client.query(
      `SELECT id, sequence FROM installments
       WHERE credit_id = $1 AND status <> 'payee' ORDER BY sequence FOR UPDATE`,
      [c.credit_id]
    );
    for (let i = 0; i < restantes.length; i += 1) {
      await client.query(
        `UPDATE installments SET due_date = $1::date, status = 'a_venir' WHERE id = $2`,
        [leQuatre(i), restantes[i].id]
      );
      redatees += 1;
    }
    await client.query('COMMIT');
    credits += 1;
    console.log(`${c.nom} (${c.reference}) : ${restantes.length} echeance(s) a partir du ${leQuatre(0)}`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(`${c.nom} (${c.reference}) : ECHEC — ${e.message}`);
  } finally {
    client.release();
  }
}
console.log(`\n${credits} credit(s) traite(s), ${redatees} echeance(s) redatee(s) sur le 4.`);
await pool.end();
