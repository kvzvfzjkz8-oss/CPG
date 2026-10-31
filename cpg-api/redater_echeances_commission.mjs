/**
 * ═══════════════════════════════════════════════════════════════════
 *  REDATER LES ÉCHÉANCIERS DE LA COMMISSION DU 23/10/2026
 * ═══════════════════════════════════════════════════════════════════
 *
 * « Les dossiers qui vont être validés demain seront prélevés le 03 du
 *   mois de novembre, il faudrait que tu le gardes en mémoire. »
 *   (direction, 22/10/2026)
 *
 * Le logiciel pose la première échéance à la date d'approbation + 1
 * mois : approuvés le 23/10, ces dossiers ont tous leur première
 * échéance au 23/11. Jamais le 3.
 *
 * Ce script la ramène au 03/11/2026 et décale les suivantes au 3 de
 * chaque mois. Il refuse de toucher une échéance déjà payée — la
 * redater après coup ferait mentir le grand livre.
 *
 * La date d'origine est conservée dans `original_due_date`, et
 * `adjusted_by` / `adjusted_at` tracent qui a décidé : c'est le même
 * mécanisme que les corrections d'échéance au cas par cas.
 *
 *   railway run --service Postgres -- node cpg-api/redater_echeances_commission.mjs
 *       → simulation, n'écrit rien
 *
 *   railway run --service Postgres -- node cpg-api/redater_echeances_commission.mjs --executer
 */
import pg from 'pg';

const JOUR_APPROBATION = '2026-10-23';
const PREMIERE_ECHEANCE = '2026-11-03';
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

/**
 * Le 3 du mois, `n` mois après la première échéance.
 *
 * Construit en UTC à partir de l'année et du mois plutôt qu'avec
 * setMonth() sur une date existante : setMonth() sur un 31 déborde sur
 * le mois suivant (31 janvier + 1 mois = 3 mars). Ici le jour est fixe
 * et vaut 3, mais la méthode reste la bonne.
 */
function echeance(n) {
  const [a, m, j] = PREMIERE_ECHEANCE.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, j));
  return d.toISOString().slice(0, 10);
}

const { rows: dossiers } = await pool.query(
  `SELECT c.id, c.reference, btrim(u.full_name) AS client, c.amount, c.duration_months
   FROM credit_requests c
   JOIN users u ON u.id = c.user_id
   WHERE c.approved_at::date = $1::date AND c.status = 'approuve'
   ORDER BY c.reference`,
  [JOUR_APPROBATION]
);

const { rows: directeur } = await pool.query(
  `SELECT id FROM users WHERE role = 'directeur' ORDER BY created_at LIMIT 1`
);
if (!directeur[0]) {
  console.error('Aucun compte directeur trouve : impossible de tracer la decision.');
  await pool.end();
  process.exit(1);
}

console.log(`${dossiers.length} dossier(s) approuves le ${JOUR_APPROBATION}\n`);

let aChanger = 0;
let bloques = 0;
const plan = [];

for (const d of dossiers) {
  const { rows: ech } = await pool.query(
    // to_char et pas due_date brut : une colonne DATE revient de pg
    // comme un Date a minuit LOCAL, et toISOString() recule alors d'un
    // jour en UTC+1. Le « avant » affiche etait faux d'un jour, et une
    // echeance deja au 3 aurait pu passer pour un 2 — donc etre
    // redatee pour rien, ou l'inverse.
    `SELECT id, sequence, to_char(due_date, 'YYYY-MM-DD') AS due_date,
            status::text, amount
     FROM installments WHERE credit_id = $1 ORDER BY sequence`,
    [d.id]
  );

  const payees = ech.filter((e) => e.status === 'payee');
  if (payees.length > 0) {
    // Garde-fou : une echeance payee a produit une ecriture au grand
    // livre a sa date. La redater separerait la date de l'echeance de
    // la date du prelevement, et le releve du client deviendrait
    // incomprehensible.
    console.log(`${d.reference.padEnd(11)} ${d.client.slice(0, 24).padEnd(25)} IGNORE — ${payees.length} echeance(s) deja payee(s)`);
    bloques += 1;
    continue;
  }

  const lignes = ech.map((e, i) => ({
    id: e.id,
    sequence: e.sequence,
    avant: e.due_date,
    apres: echeance(i),
  }));
  const change = lignes.filter((l) => l.avant !== l.apres);
  if (change.length === 0) {
    console.log(`${d.reference.padEnd(11)} ${d.client.slice(0, 24).padEnd(25)} deja a jour`);
    continue;
  }

  aChanger += 1;
  plan.push({ dossier: d, lignes: change });
  console.log(
    `${d.reference.padEnd(11)} ${d.client.slice(0, 24).padEnd(25)} ${f(d.amount).padStart(9)} F · `
    + `${change.length} echeance(s) : ${change[0].avant} → ${change[0].apres}`
    + (change.length > 1 ? ` … ${change[change.length - 1].avant} → ${change[change.length - 1].apres}` : '')
  );
}

console.log(`\n${aChanger} dossier(s) a redater, ${bloques} ignore(s).`);

if (!executer) {
  console.log('\n(simulation — relancez avec --executer pour appliquer)');
  await pool.end();
  process.exit(0);
}

const client = await pool.connect();
try {
  await client.query('BEGIN');
  let total = 0;
  for (const { dossier, lignes } of plan) {
    for (const l of lignes) {
      await client.query(
        `UPDATE installments
         SET original_due_date = COALESCE(original_due_date, due_date),
             due_date = $2::date,
             adjusted_by = $3,
             adjusted_at = now()
         WHERE id = $1`,
        [l.id, l.apres, directeur[0].id]
      );
      total += 1;
    }
  }

  await client.query(
    `INSERT INTO audit_log (actor_id, actor_role, action, entity_type, entity_id, metadata, ip_address)
     VALUES ($1, 'directeur', 'operations.echeances_redatees', 'periode', $2, $3, NULL)`,
    [
      directeur[0].id,
      JOUR_APPROBATION,
      {
        motif: 'Decision de la direction du 22/10/2026 : prelevement au 3 novembre',
        premiereEcheance: PREMIERE_ECHEANCE,
        dossiers: plan.length,
        echeances: total,
      },
    ]
  );

  await client.query('COMMIT');
  console.log(`\n${total} echeance(s) redatees sur ${plan.length} dossier(s). Decision tracee au journal.`);
} catch (e) {
  await client.query('ROLLBACK');
  console.error(`\nECHEC, rien n'a ete applique : ${e.message}`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
