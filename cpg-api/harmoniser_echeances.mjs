/**
 * ═══════════════════════════════════════════════════════════════════
 *  HARMONISER TOUS LES ÉCHÉANCIERS SUR LE 4 DU MOIS
 * ═══════════════════════════════════════════════════════════════════
 *
 * « Harmonise les prélèvements à une seule date pour tout le monde, le
 *   4 de ce jour. Certains comptes seront à découvert mais ce sera pour
 *   une petite période, donc ce n'est pas un souci. Ramène le tout au
 *   04 novembre et les autres échéances au 04 décembre. Sauf pour les
 *   crédits rentrée scolaire qui vont débuter en janvier. »
 *   (direction, 04/11/2026)
 *
 * Pourquoi : les échéances étaient éparpillées du 5 au 30 du mois, et
 * les salaires arrivent groupés en début de mois. Entre la paie et
 * l'échéance, le client passait au guichet — c'est ainsi que
 * MIYADIAMBA et NDOBA se sont retrouvés à découvert le 27 octobre.
 * Une seule date, juste après la paie, supprime la fenêtre.
 *
 * Ce que fait le script, pour chaque crédit approuvé :
 *   • les échéances DÉJÀ PAYÉES ne sont jamais touchées ;
 *   • les impayées sont redatées dans l'ordre : le 4 du mois de départ,
 *     puis le 4 de chaque mois suivant ;
 *   • départ au 04/11/2026, sauf les crédits du produit SCOLAIRE qui
 *     partent au 04/01/2027 — la rentrée scolaire se rembourse à
 *     partir de janvier ;
 *
 *   • et surtout : UNE MENSUALITÉ PAR MOIS CIVIL. Un crédit part au
 *     04/12/2026 dans deux cas seulement :
 *
 *       – une échéance a déjà été prélevée en novembre (les 15 du
 *         4 novembre à 6 h) : son mois est fait ;
 *
 *       – DEUX échéances ont été prélevées en octobre. C'est le cas de
 *         MIYADIAMBA et NDOBA, dont les mois doublés ont déjà couvert
 *         novembre par avance. « Ils ont déjà été coupés, alors ne
 *         prélève plus, tu attendras directement le 04 décembre. »
 *
 *     Ma première version comparait à un mois glissant — prélevé après
 *     le 4 octobre, donc décembre. Elle faisait sauter novembre à
 *     32 crédits prélevés le 6 octobre, soit 4 203 041 F non appelés,
 *     alors que 29 jours s'étaient écoulés. Un mois civil, pas 30
 *     jours : c'est ainsi que les salaires tombent.
 *
 *     ⚠️ Et « deux mensualités en octobre » n'est TOUJOURS PAS le bon
 *     critère. La direction a donné le sien le 04/11/2026 : c'est le
 *     SOLDE DE FIN DE MOIS qui tranche. Deux mensualités payées avec un
 *     solde final négatif = la seconde a été prise après le salaire,
 *     donc en avance ; avec un solde à zéro = c'était du rattrapage
 *     d'arriéré, et le mois suivant reste dû. Mon critère confondait
 *     les deux et renvoyait sept crédits à décembre à tort.
 *     Voir appliquer_regle_solde_fin_mois.mjs, qui corrige ce calcul
 *     et qui est la référence.
 *
 * La date d'origine est conservée (original_due_date) et la décision
 * tracée (adjusted_by, adjusted_at, journal d'audit).
 *
 *   railway run --service Postgres -- node cpg-api/harmoniser_echeances.mjs
 *       → simulation : le plan complet, ce qui sera prélevé demain
 *         matin, et combien de comptes passeront à découvert.
 *
 *   railway run --service Postgres -- node cpg-api/harmoniser_echeances.mjs --executer
 */
import pg from 'pg';

const DEPART = '2026-11-04';
const DEPART_SCOLAIRE = '2027-01-04';
/** Les deux mois civils qui servent a compter les mensualites deja payees. */
const MOIS_COURANT = '2026-11-01';
const MOIS_PRECEDENT = '2026-10-01';
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
 * Le 4 du mois, `n` mois après la date de départ. Construit à partir
 * des composantes et en UTC : passer par setMonth() sur une date
 * existante déborde sur le mois suivant quand le jour n'existe pas, et
 * une date à minuit local recule d'un jour en UTC+1 — deux pièges déjà
 * rencontrés dans ce projet. Le 4 existe dans tous les mois.
 */
function leQuatre(depart, n) {
  const [a, m, j] = depart.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1 + n, j, 12)).toISOString().slice(0, 10);
}

const { rows: credits } = await pool.query(
  `SELECT c.id, c.reference, btrim(u.full_name) AS client, p.code AS produit,
          COALESCE(p.code, '(sans produit)') AS produit_affiche,
          a.id AS compte, COALESCE(b.balance, 0) AS solde
   FROM credit_requests c
   JOIN users u ON u.id = c.user_id
   -- LEFT JOIN et non JOIN : les credits repris du fichier d'import
   -- n'ont pas de version de produit. Une jointure interne les ecartait
   -- silencieusement — 34 credits, dont ceux de MIYADIAMBA et NDOBA,
   -- n'avaient pas ete harmonises au premier passage.
   LEFT JOIN product_versions pv ON pv.id = c.product_version_id
   LEFT JOIN credit_products p ON p.id = pv.product_id
   JOIN accounts a ON a.user_id = c.user_id
   LEFT JOIN account_balances b ON b.account_id = a.id
   WHERE c.status = 'approuve'
   ORDER BY u.full_name, c.reference`
);

const { rows: directeur } = await pool.query(
  `SELECT id FROM users WHERE role = 'directeur' ORDER BY created_at LIMIT 1`
);
if (!directeur[0]) {
  console.error('Aucun compte directeur : impossible de tracer la decision.');
  await pool.end();
  process.exit(1);
}

const plan = [];
let dejaBon = 0;

for (const c of credits) {
  const { rows: ech } = await pool.query(
    // to_char : une colonne DATE revient de pg comme un Date a minuit
    // local, que la conversion UTC recule d'un jour.
    `SELECT id, sequence, to_char(due_date, 'YYYY-MM-DD') AS due, status::text AS statut, amount
     FROM installments WHERE credit_id = $1 AND status <> 'payee'
     ORDER BY sequence`,
    [c.id]
  );
  if (!ech.length) continue;

  // Combien d'echeances ce credit a-t-il REELLEMENT payees en octobre,
  // et en novembre ? On ecarte les paid_at dans le futur : les credits
  // repris du fichier d'import en portent (192 au 30/10/2026), et les
  // prendre pour des paiements recents renverrait a tort le dossier au
  // mois suivant.
  const { rows: comptage } = await pool.query(
    `SELECT
       count(*) FILTER (WHERE paid_at >= $2::date AND paid_at < $3::date)::int AS octobre,
       count(*) FILTER (WHERE paid_at >= $3::date AND paid_at <= now())::int AS novembre,
       to_char(max(paid_at) FILTER (WHERE paid_at <= now()), 'YYYY-MM-DD') AS dernier
     FROM installments
     WHERE credit_id = $1 AND status = 'payee'`,
    [c.id, MOIS_PRECEDENT, MOIS_COURANT]
  );
  const { octobre, novembre, dernier: dernierPaiement } = comptage[0];

  // Une mensualite par mois civil. Le mois est fait si une echeance a
  // ete prelevee ce mois-ci, ou si le mois precedent en a pris deux —
  // un mois double couvre celui qui suit.
  const dejaCoupe = Number(novembre) > 0 || Number(octobre) >= 2;

  const depart = c.produit === 'SCOLAIRE'
    ? DEPART_SCOLAIRE
    : (dejaCoupe ? leQuatre(DEPART, 1) : DEPART);
  const lignes = ech.map((e, i) => ({ ...e, apres: leQuatre(depart, i) }));
  const change = lignes.filter((l) => l.due !== l.apres);
  if (!change.length) { dejaBon += 1; continue; }

  plan.push({
    credit: c, lignes: change, premiere: lignes[0],
    depart, dejaCoupe, dernierPaiement, payeesOctobre: Number(octobre), payeesNovembre: Number(novembre),
  });
}

console.log(`${credits.length} credit(s) approuve(s) · ${plan.length} a harmoniser · ${dejaBon} deja conforme(s)\n`);

const scolaires = plan.filter((p) => p.credit.produit === 'SCOLAIRE');
const dejaPayes = plan.filter((p) => p.credit.produit !== 'SCOLAIRE' && p.dejaCoupe);
const autres = plan.filter((p) => p.credit.produit !== 'SCOLAIRE' && !p.dejaCoupe);
console.log(`  ${autres.length} credits ordinaires            → premiere echeance au ${DEPART}`);
console.log(`  ${dejaPayes.length} mois deja fait (novembre, ou octobre double) → premiere echeance au ${leQuatre(DEPART, 1)}`);
console.log(`  ${scolaires.length} credits SCOLAIRE              → premiere echeance au ${DEPART_SCOLAIRE}\n`);

// Ce que la collecte prendra au prochain passage de 6 h
let aPrelever = 0;
let decouverts = 0;
let couverts = 0;
for (const p of plan) {
  if (p.premiere.apres !== DEPART) continue;
  const montant = Number(p.premiere.amount);
  aPrelever += montant;
  if (Number(p.credit.solde) >= montant) couverts += 1; else decouverts += 1;
}
console.log(`Au prochain passage de 6 h, ${couverts + decouverts} echeances exigibles pour ${f(aPrelever)} F :`);
console.log(`  ${couverts} couvertes par le solde`);
console.log(`  ${decouverts} mettront le compte a decouvert (accepte par la direction)\n`);

console.log('reference   client                    produit     echeances redatees');
for (const p of plan.slice(0, 15)) {
  const l = p.lignes;
  console.log(`${p.credit.reference.padEnd(11)} ${p.credit.client.slice(0,24).padEnd(25)} ${String(p.credit.produit_affiche).padEnd(14)} `
    + `${l.length} · ${l[0].due} → ${l[0].apres}${l.length > 1 ? ` … ${l[l.length-1].due} → ${l[l.length-1].apres}` : ''}`);
}
if (plan.length > 15) console.log(`  … et ${plan.length - 15} autres credits`);

const totalLignes = plan.reduce((s, p) => s + p.lignes.length, 0);
console.log(`\n${totalLignes} echeance(s) a redater sur ${plan.length} credit(s).`);

if (!executer) {
  console.log('\n(simulation — relancez avec --executer pour appliquer)');
  await pool.end();
  process.exit(0);
}

const client = await pool.connect();
try {
  // Une seule transaction : une harmonisation a moitie faite laisserait
  // un portefeuille dont personne ne saurait dire la regle.
  await client.query('BEGIN');
  let faites = 0;
  for (const p of plan) {
    for (const l of p.lignes) {
      await client.query(
        `UPDATE installments
         SET original_due_date = COALESCE(original_due_date, due_date),
             due_date = $2::date,
             adjusted_by = $3,
             adjusted_at = now()
         WHERE id = $1`,
        [l.id, l.apres, directeur[0].id]
      );
      faites += 1;
    }
  }
  await client.query(
    `INSERT INTO audit_log (actor_id, actor_role, action, entity_type, entity_id, metadata, ip_address)
     VALUES ($1, 'directeur', 'operations.echeances_harmonisees', 'periode', $2, $3, NULL)`,
    [
      directeur[0].id,
      DEPART,
      {
        motif: 'Harmonisation de toutes les echeances sur le 4 du mois, decision du 04/11/2026',
        depart: DEPART,
        departScolaire: DEPART_SCOLAIRE,
        credits: plan.length,
        echeances: faites,
      },
    ]
  );
  await client.query('COMMIT');
  console.log(`\n${faites} echeance(s) redatees sur ${plan.length} credit(s). Decision tracee au journal.`);
} catch (e) {
  await client.query('ROLLBACK');
  console.error(`\nECHEC, rien n'a ete applique : ${e.message}`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
