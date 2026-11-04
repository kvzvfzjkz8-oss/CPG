/**
 * ═══════════════════════════════════════════════════════════════════
 *  DEUX PRÉLÈVEMENTS À HUIT JOURS D'INTERVALLE : ON REND LE SECOND
 * ═══════════════════════════════════════════════════════════════════
 *
 * « Beaucoup sont prélevés le 27 et ensuite le 04, ce n'est pas
 *   possible. Et je ne veux plus que ça se reproduise sur les
 *   prochains mois. Tu centralises tout au 04. » (direction, 04/11/2026)
 *
 * Le 27 octobre, une passe de rattrapage a prélevé des mensualités en
 * retard. Le 4 novembre, l'harmonisation a ramené tout le monde au 4 et
 * a prélevé ceux qui avaient de l'argent — dont ces mêmes clients, huit
 * jours après. Deux mensualités en huit jours : c'est une mensualité de
 * trop, quel que soit le mois civil où elle tombe.
 *
 * Ma garde « une mensualité par mois civil » ne voyait pas ce cas : le
 * 27 octobre et le 4 novembre sont deux mois civils différents. Le
 * critère juste est l'ÉCART entre deux prélèvements du même crédit.
 * C'est ce que ce script corrige dans les données, et ce que la garde
 * de `collecterUneEcheance` applique désormais à chaque passe.
 *
 * Ce qu'il fait, pour chaque échéance de novembre prise moins de
 * ECART_MINIMUM jours après la précédente du même crédit :
 *   • porte une extourne (`annulation`) sur l'écriture de paiement —
 *     le client est recrédité, et le journal reste en ajout seul ;
 *   • l'échéance redevient « à_venir » ;
 *   • elle est redatée au 4 décembre, et la suite de l'échéancier
 *     s'aligne sur le 4 des mois suivants.
 *
 *   railway run --service Postgres -- node cpg-api/corriger_doubles_prelevements.mjs
 *   railway run --service Postgres -- node cpg-api/corriger_doubles_prelevements.mjs --executer
 */
import pg from 'pg';

const ECART_MINIMUM = 25;        // jours entre deux mensualités d'un même crédit
const DEBUT_PASSE = '2026-11-01';
const CIBLE = '2026-12-04';      // où repartent les échéances annulées
const MOTIF = 'Double prelevement du 04/11 a huit jours de celui du 27/10 — mensualite reportee au 04/12';

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
if (!directeur[0]) { console.error('Aucun directeur en base.'); process.exit(1); }

// Les échéances de la passe de novembre dont la précédente du même
// crédit est trop proche. On ne regarde que les paiements de crédit :
// les frais de tenue de compte ne sont pas concernés.
const { rows: doubles } = await pool.query(
  `WITH nov AS (
     SELECT i.id, i.credit_id, i.sequence, i.amount, i.ledger_entry_id, i.paid_at
     FROM installments i
     WHERE i.status = 'payee' AND i.paid_at >= $1::date AND i.paid_at <= now()
   ), precedente AS (
     SELECT credit_id, max(paid_at) AS q FROM installments
     WHERE status = 'payee' AND paid_at < $1::date
     GROUP BY credit_id
   )
   SELECT n.id, n.credit_id, n.sequence, n.amount, n.ledger_entry_id,
          c.reference, btrim(u.full_name) AS nom,
          btrim(COALESCE(u.employer, '—')) AS employeur,
          COALESCE(b.balance, 0) AS solde,
          to_char(p.q, 'DD/MM') AS precedente,
          EXTRACT(DAY FROM n.paid_at - p.q)::int AS ecart,
          EXISTS(SELECT 1 FROM ledger_entries r
                 WHERE r.reversed_entry_id = n.ledger_entry_id) AS deja_annulee
   FROM nov n
   JOIN credit_requests c ON c.id = n.credit_id
   JOIN users u ON u.id = c.user_id
   JOIN accounts a ON a.user_id = u.id
   LEFT JOIN account_balances b ON b.account_id = a.id
   JOIN precedente p ON p.credit_id = n.credit_id
   WHERE EXTRACT(DAY FROM n.paid_at - p.q)::int < $2
   ORDER BY u.full_name`,
  [DEBUT_PASSE, ECART_MINIMUM]
);

if (!doubles.length) {
  console.log('Aucun double prelevement a corriger.');
  await pool.end();
  process.exit(0);
}

console.log(`${doubles.length} echeance(s) prelevee(s) moins de ${ECART_MINIMUM} jours apres la precedente\n`);
console.log('client                        empl.  credit     seq   montant   prec.  ecart   solde avant   solde apres');
let total = 0;
const aFaire = [];
for (const d of doubles) {
  if (d.deja_annulee) {
    console.log(`${d.nom.slice(0, 28).padEnd(29)} deja annulee, on passe`);
    continue;
  }
  const apres = Number(d.solde) + Number(d.amount);
  total += Number(d.amount);
  aFaire.push(d);
  console.log(
    `${d.nom.slice(0, 28).padEnd(29)} ${d.employeur.slice(0, 5).padEnd(6)} ${d.reference.padEnd(10)} ` +
    `${String(d.sequence).padStart(3)} ${f(d.amount).padStart(9)}  ${d.precedente}  ${String(d.ecart).padStart(2)} j  ` +
    `${f(d.solde).padStart(12)}  ${f(apres).padStart(12)}`
  );
}
console.log(`\nTotal a restituer aux clients : ${f(total)} F sur ${aFaire.length} echeance(s)`);

if (!executer) {
  console.log('\nSimulation. Rien n’a été écrit. Relancez avec --executer pour appliquer.');
  await pool.end();
  process.exit(0);
}

let annulees = 0, redatees = 0;
for (const d of aFaire) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: orig } = await client.query(
      `SELECT * FROM ledger_entries WHERE id = $1 FOR UPDATE`, [d.ledger_entry_id]
    );
    if (!orig[0]) throw new Error(`ecriture ${d.ledger_entry_id} introuvable`);

    const { rows: deja } = await client.query(
      `SELECT 1 FROM ledger_entries WHERE reversed_entry_id = $1`, [d.ledger_entry_id]
    );
    if (deja[0]) { await client.query('ROLLBACK'); client.release(); continue; }

    // Extourne : même mécanisme que reverseTransaction, le journal
    // reste en ajout seul.
    await client.query(
      `INSERT INTO ledger_entries (account_id, type, amount, label, reference, created_by, reversed_entry_id)
       VALUES ($1, 'annulation', $2, $3, $4, $5, $6)`,
      [orig[0].account_id, -orig[0].amount,
       `Annulation — ${orig[0].label} (${MOTIF})`,
       orig[0].reference, directeur[0].id, orig[0].id]
    );

    await client.query(
      `UPDATE installments SET status = 'a_venir', paid_at = NULL, ledger_entry_id = NULL
       WHERE id = $1`, [d.id]
    );
    await client.query(
      `UPDATE credit_requests SET status = 'approuve' WHERE id = $1 AND status = 'solde'`,
      [d.credit_id]
    );

    // Tout au 4 : l'échéance annulée repart au 4 décembre, les
    // suivantes au 4 des mois d'après.
    const { rows: restantes } = await client.query(
      `SELECT id, sequence FROM installments
       WHERE credit_id = $1 AND status <> 'payee' ORDER BY sequence`,
      [d.credit_id]
    );
    for (let i = 0; i < restantes.length; i += 1) {
      await client.query(
        `UPDATE installments SET due_date = $1::date, status = 'a_venir' WHERE id = $2`,
        [leQuatre(i), restantes[i].id]
      );
      redatees += 1;
    }

    await client.query('COMMIT');
    annulees += 1;
    console.log(`${d.nom} (${d.reference}) : ${f(d.amount)} F rendus, ${restantes.length} echeance(s) a partir du ${leQuatre(0)}`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(`${d.nom} (${d.reference}) : ECHEC — ${e.message}`);
  } finally {
    client.release();
  }
}

console.log(`\n${annulees} extourne(s) portee(s), ${redatees} echeance(s) redatee(s) sur le 4.`);
await pool.end();
