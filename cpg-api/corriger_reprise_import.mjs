/**
 * ═══════════════════════════════════════════════════════════════════
 *  LES ÉCHÉANCES DE LA REPRISE D'IMPORT, REMISES D'APLOMB
 * ═══════════════════════════════════════════════════════════════════
 *
 * « Le crédit a été débloqué à une date, alors tu dois compter un
 *   prélèvement chaque mois après la date de validation du crédit. Cela
 *   te permettra de voir si le client doit encore ou pas. »
 *   (direction, 05/11/2026)
 *
 * Sept crédits issus de la reprise d'anciens dossiers portaient treize
 * échéances marquées « payée » SANS aucune écriture au grand livre et
 * datées dans l'avenir, jusqu'en mars 2027 — l'import avait déclaré
 * réglées des mensualités qui n'étaient pas encore échues.
 *
 * La règle ci-dessus les sépare en deux cas, et la direction a validé
 * le traitement de chacun le 05/11/2026 :
 *
 *   • LESSOUMBOU LEGNONGUI (CPG-1811) : six mois écoulés sur douze,
 *     mais DOUZE mensualités déclarées payées et le crédit marqué
 *     « soldé ». Son seul paiement réel est de 175 433 F le 06/10. Les
 *     séquences 7 à 11 redeviennent « à venir », datées du 4, et le
 *     crédit repasse en « approuvé » : 877 165 F repartent au
 *     recouvrement.
 *
 *   • les huit autres lignes : leur NOMBRE colle aux mois écoulés,
 *     l'argent a bien circulé hors du logiciel. Seule la date est
 *     fausse, et il faut qu'aucune ligne payée ne porte une date
 *     future. MESSEONG KONDA y gagne de voir apparaître sa mensualité
 *     de retard, 162 569 F.
 *
 *     Chacune prend le LENDEMAIN du dernier paiement passé de son
 *     crédit, et des jours consécutifs quand il y en a plusieurs.
 *     J'avais d'abord essayé « départ du crédit + son rang », au 4 du
 *     mois : c'était plus élégant mais ça cassait l'ordre de
 *     l'échéancier, parce que les dates posées par l'import ne forment
 *     pas une série mensuelle propre — chez CPG-2775, les séquences 1
 *     et 2 sont toutes deux datées d'octobre. La date réelle de ces
 *     règlements n'est pas connue du logiciel ; on ne cherche donc pas
 *     à la reconstituer, seulement à ne plus rien annoncer dans
 *     l'avenir.
 *
 * Rien n'est supprimé, et aucune écriture n'est portée au grand livre :
 * ces lignes n'en ont jamais eu. On ne corrige que l'échéancier.
 *
 *   railway run --service Postgres -- node cpg-api/corriger_reprise_import.mjs
 *   railway run --service Postgres -- node cpg-api/corriger_reprise_import.mjs --executer
 */
import pg from 'pg';

const REOUVRIR = 'CPG-1811';        // le crédit dont les échéances repartent au recouvrement
const PREMIERE_REOUVERTE = '2026-12-04';
const JOUR = 4;

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

function leQuatre(depuis, n) {
  const d = new Date(`${depuis}T12:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, JOUR, 12))
    .toISOString().slice(0, 10);
}

// Toutes les échéances marquées payées sans écriture et datées dans
// l'avenir, avec la date de départ de leur crédit : le déblocage réel
// s'il existe, sinon la validation du dossier.
const { rows: lignes } = await pool.query(
  `SELECT btrim(u.full_name) AS nom, c.reference, c.status::text AS credit_statut,
          i.id, i.sequence, i.amount,
          to_char(i.due_date, 'YYYY-MM-DD') AS due,
          to_char(COALESCE(d.q, c.created_at), 'YYYY-MM-DD') AS depart
   FROM installments i
   JOIN credit_requests c ON c.id = i.credit_id
   JOIN users u ON u.id = c.user_id
   LEFT JOIN LATERAL (
     SELECT min(le.created_at) AS q FROM ledger_entries le
      WHERE le.type = 'deblocage_credit' AND le.reference = c.reference
   ) d ON TRUE
   WHERE i.status = 'payee'
     AND i.ledger_entry_id IS NULL
     AND i.due_date > now()::date
   ORDER BY u.full_name, i.sequence`
);

const aReouvrir = lignes.filter((l) => l.reference === REOUVRIR);
const aRedater = lignes.filter((l) => l.reference !== REOUVRIR);

console.log(`A ROUVRIR — ${REOUVRIR}, les echeances repartent au recouvrement\n`);
let totalReouvert = 0;
aReouvrir.forEach((l, i) => {
  totalReouvert += Number(l.amount);
  console.log(`  ${l.nom.slice(0, 26).padEnd(27)} seq ${String(l.sequence).padStart(2)}  ${f(l.amount).padStart(9)} F   ${l.due} -> ${leQuatre(PREMIERE_REOUVERTE, i)}  (a_venir)`);
});
console.log(`  ${aReouvrir.length} echeances, ${f(totalReouvert)} F\n`);

// Chaque ligne fautive se place APRES la sequence qui la precede dans
// son echeancier, et jamais apres aujourd'hui. On s'appuie sur la
// sequence precedente et non sur le dernier paiement du dossier :
// celui-ci peut etre posterieur (le prelevement du 4 novembre), et la
// ligne se retrouvait alors datee d'aujourd'hui ou de demain, ou
// placee apres une sequence superieure.
const { rows: avants } = await pool.query(
  `SELECT c.reference, i.sequence, to_char(i.due_date, 'YYYY-MM-DD') AS due
     FROM installments i
     JOIN credit_requests c ON c.id = i.credit_id
    WHERE c.reference = ANY($1::text[])
    ORDER BY c.reference, i.sequence`,
  [[...new Set(aRedater.map((l) => l.reference))]]
);
const parRef = {};
for (const r of avants) (parRef[r.reference] ??= []).push(r);

const aujourdhui = new Date().toISOString().slice(0, 10);
function plusDeJours(jour, n) {
  const d = new Date(`${jour}T12:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n, 12))
    .toISOString().slice(0, 10);
}

const rang = {};
for (const l of aRedater) {
  rang[l.reference] = (rang[l.reference] ?? 0) + 1;
  const lignes = parRef[l.reference];
  const premierFautif = Math.min(
    ...aRedater.filter((x) => x.reference === l.reference).map((x) => x.sequence)
  );
  const precedente = lignes.filter((x) => x.sequence < premierFautif).pop();
  // Sans sequence precedente (le fautif est le premier du dossier), on
  // recule d'autant de jours depuis aujourd'hui.
  const base = precedente
    ? precedente.due
    : plusDeJours(aujourdhui, -aRedater.filter((x) => x.reference === l.reference).length);
  const cible = plusDeJours(base, rang[l.reference]);
  l.cible = cible > aujourdhui ? aujourdhui : cible;
  l.base = base;
}

console.log('A REDATER — la ligne reste payee, seule sa date change\n');
for (const l of aRedater) {
  console.log(`  ${l.nom.slice(0, 26).padEnd(27)} ${l.reference.padEnd(10)} seq ${String(l.sequence).padStart(2)}  ${f(l.amount).padStart(9)} F   ${l.due} -> ${l.cible}   (apres la seq. precedente du ${l.base})`);
}
console.log(`  ${aRedater.length} echeances\n`);

if (!executer) {
  console.log('Simulation. Rien n’a été écrit. Relancez avec --executer pour appliquer.');
  await pool.end();
  process.exit(0);
}

const client = await pool.connect();
try {
  await client.query('BEGIN');

  // 1. Les échéances de LESSOUMBOU redeviennent dues, datées du 4.
  for (let i = 0; i < aReouvrir.length; i += 1) {
    await client.query(
      `UPDATE installments
       SET status = 'a_venir', paid_at = NULL, due_date = $1::date
       WHERE id = $2`,
      [leQuatre(PREMIERE_REOUVERTE, i), aReouvrir[i].id]
    );
  }
  if (aReouvrir.length) {
    const { rowCount } = await client.query(
      `UPDATE credit_requests SET status = 'approuve'
       WHERE reference = $1 AND status = 'solde'`,
      [REOUVRIR]
    );
    console.log(`${REOUVRIR} : ${aReouvrir.length} echeances rouvertes, credit repasse en approuve (${rowCount} ligne)`);
  }

  // 2. Les autres lignes sont redatées, sans changer leur statut.
  for (const l of aRedater) {
    await client.query(
      `UPDATE installments SET due_date = $1::date, paid_at = $1::timestamptz + interval '12 hours'
       WHERE id = $2`,
      [l.cible, l.id]
    );
  }
  console.log(`${aRedater.length} echeances redatees.`);

  await client.query('COMMIT');
} catch (e) {
  await client.query('ROLLBACK');
  console.error(`ECHEC, rien applique — ${e.message}`);
  process.exitCode = 1;
} finally {
  client.release();
}

// Contrôle immédiat
const { rows: reste } = await pool.query(
  `SELECT count(*)::int n FROM installments
    WHERE status = 'payee' AND ledger_entry_id IS NULL AND due_date > now()::date`
);
console.log(`\nIl reste ${reste[0].n} echeance(s) payee(s) sans ecriture datee(s) dans l'avenir.`);
await pool.end();
