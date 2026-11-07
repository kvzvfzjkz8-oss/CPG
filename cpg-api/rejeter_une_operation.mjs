/**
 * ═══════════════════════════════════════════════════════════════════
 *  REJETER UNE DEMANDE DE CAISSE EN ATTENTE
 * ═══════════════════════════════════════════════════════════════════
 *
 * Reproduit exactement ce que fait POST /caisse/operations/:id/rejeter :
 * la demande passe en « rejetee », avec l'auteur de la décision et le
 * motif. Aucune écriture n'est portée au grand livre — une demande en
 * attente n'en a jamais eu, c'est tout l'intérêt du circuit de
 * validation.
 *
 * Utilisé le 05/11/2026 pour le retrait ponctuel de 33 098 F demandé
 * sur le compte de SANOUKOUE Jean Fubri : l'opération allait DÉBITER le
 * client alors qu'il s'agissait de lui rendre un trop-perçu. Un
 * trop-perçu se rend par un « Versement sur le solde », pas par un
 * retrait.
 *
 * Le motif est obligatoire : c'est ce que l'operateur lit dans son
 * ecran, et donc ce qui lui dit quoi refaire.
 *
 *   railway run --service Postgres -- node cpg-api/rejeter_une_operation.mjs <id|client> "<motif>"
 *   railway run --service Postgres -- node cpg-api/rejeter_une_operation.mjs <id|client> "<motif>" --executer
 */
import pg from 'pg';

const args = process.argv.slice(2).filter((a) => a !== '--executer');
const executer = process.argv.includes('--executer');
const [cible, motifRejet] = args;

// Le motif est obligatoire et porte en argument : il est lu par
// l'operateur dans son ecran, c'est lui qui lui dit quoi refaire. Le
// figer dans le script rendrait tous les rejets suivants faux.
if (!cible || !motifRejet) {
  console.error(
    'Usage : node rejeter_une_operation.mjs <id de l operation | nom du client> "<motif du rejet>" [--executer]'
  );
  process.exit(1);
}
const MOTIF = motifRejet;
if (!process.env.DATABASE_PUBLIC_URL) {
  console.error('DATABASE_PUBLIC_URL absente. Lancez avec : railway run --service Postgres -- node …');
  process.exit(1);
}
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_PUBLIC_URL,
  ssl: { rejectUnauthorized: false },
});
const f = (n) => Math.round(Number(n)).toLocaleString('fr-FR');

const estUuid = /^[0-9a-f-]{36}$/i.test(cible);
const { rows: demandes } = await pool.query(
  `SELECT o.id, o.type::text AS t, o.montant, o.destination, o.motif,
          to_char(o.demandee_le, 'DD/MM/YY HH24:MI') AS demande,
          btrim(u.full_name) AS client, u.client_number,
          COALESCE(b.balance, 0) AS solde,
          btrim(COALESCE(d.full_name, '—')) AS demandeur
   FROM caisse_operations o
   JOIN users u ON u.id = o.client_id
   JOIN accounts a ON a.user_id = u.id
   LEFT JOIN account_balances b ON b.account_id = a.id
   LEFT JOIN users d ON d.id = o.demandeur_id
   WHERE o.statut = 'en_attente'
     AND (${estUuid ? 'o.id = $1::uuid' : 'u.full_name ILIKE $1'})`,
  [estUuid ? cible : `%${cible}%`]
);

if (!demandes.length) {
  console.log(`Aucune demande en attente pour « ${cible} ».`);
  await pool.end();
  process.exit(0);
}
if (demandes.length > 1) {
  console.log(`${demandes.length} demandes en attente correspondent — precisez l'identifiant :\n`);
  for (const d of demandes) console.log(`  ${d.id}  ${d.client}  ${d.t}  ${f(d.montant)} F  ${d.demande}`);
  await pool.end();
  process.exit(1);
}

const d = demandes[0];
console.log(`A REJETER

  client      ${d.client} (${d.client_number})
  type        ${d.t}  (${d.t.startsWith('versement') ? 'credit' : 'debit'} sur le compte)
  montant     ${f(d.montant)} F
  solde       ${f(d.solde)} F — inchange, la demande n'a porte aucune ecriture
  demandee    ${d.demande} par ${d.demandeur}
  motif       « ${d.motif ?? '—'} »

  motif du rejet : « ${MOTIF} »`);

if (!executer) {
  console.log('\nSimulation. Rien n’a été écrit. Relancez avec --executer pour appliquer.');
  await pool.end();
  process.exit(0);
}

const { rows: directeur } = await pool.query(
  `SELECT id FROM users WHERE role = 'directeur' ORDER BY created_at LIMIT 1`
);
const { rows: fait } = await pool.query(
  `UPDATE caisse_operations
   SET statut = 'rejetee', decidee_le = now(), decidee_par = $2, motif_rejet = $3
   WHERE id = $1 AND statut = 'en_attente'
   RETURNING id, statut::text AS statut, to_char(decidee_le, 'DD/MM/YY HH24:MI') AS le`,
  [d.id, directeur[0].id, MOTIF]
);
if (!fait[0]) {
  console.error('Demande introuvable ou deja traitee entre-temps.');
  process.exitCode = 1;
} else {
  console.log(`\n${d.client} : demande ${fait[0].statut} le ${fait[0].le}. Solde inchange a ${f(d.solde)} F.`);
}
await pool.end();
