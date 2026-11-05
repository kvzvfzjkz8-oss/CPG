/**
 * ═══════════════════════════════════════════════════════════════════
 *  DEUX ÉCHÉANCIERS REMIS DANS L'ORDRE, ET LE DÉCOUVERT OUVERT
 * ═══════════════════════════════════════════════════════════════════
 *
 * « Renumérote les deux et mets le découvert à 9,21 » (direction,
 *   05/11/2026).
 *
 * 1. CPG-1811 (LESSOUMBOU) et CPG-2775 (TCHIVEMBI). Chez ces deux
 *    dossiers de reprise, le paiement réellement encaissé en espèces
 *    avait été imputé sur une séquence PLUS HAUTE que les lignes de
 *    l'import : la dernière échéance apparaissait réglée avant les
 *    précédentes. Les montants et les comptes étaient justes, mais
 *    l'échéancier se lisait à l'envers.
 *
 *    La renumérotation ne touche QUE la colonne `sequence` : chaque
 *    ligne garde sa date, son statut, son montant et son écriture au
 *    grand livre. On réordonne par date d'échéance, les lignes payées
 *    d'abord à date égale. Les montants de ces deux crédits sont
 *    uniformes (175 433 F et 304 817 F), donc aucun arrondi ne se
 *    déplace — la convention « la dernière échéance absorbe l'arrondi »
 *    reste vraie.
 *
 *    Passage en deux temps : `UNIQUE (credit_id, sequence)` interdit
 *    d'écrire la cible directement, deux lignes se croiseraient. On
 *    décale donc d'abord de +1000, puis on pose la valeur finale.
 *
 * 2. Le produit DECOUVERT passe de 5,00 % à **9,21 %/mois**, le taux de
 *    l'EXPRESS. À 5 % il était l'argent le moins cher de la maison
 *    après le scolaire, pour un risque plus court et plus volatil : un
 *    agent ayant le choix aurait pris le découvert plutôt que
 *    l'EXPRESS. Puis le produit est **activé** — il devient visible des
 *    gestionnaires.
 *
 *    On passe par `applyNewVersion` et `setProductStatus`, les
 *    fonctions du logiciel : le barème est versionné (la version 1
 *    reste en archive, la 2 prend effet maintenant), le plafond
 *    réglementaire est vérifié, et l'activation est tracée.
 *
 *   railway run --service Postgres -- node cpg-api/renumeroter_et_activer_decouvert.mjs
 *   railway run --service Postgres -- node cpg-api/renumeroter_et_activer_decouvert.mjs --executer
 */
process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
process.env.DATABASE_SSL = 'relaxed';

const A_RENUMEROTER = ['CPG-1811', 'CPG-2775'];
const TAUX_DECOUVERT = 0.0921;

const executer = process.argv.includes('--executer');

if (!process.env.DATABASE_PUBLIC_URL) {
  console.error('DATABASE_PUBLIC_URL absente. Lancez avec : railway run --service Postgres -- node …');
  process.exit(1);
}

const { query, withTransaction } = await import('./src/db/index.js');
const { applyNewVersion, setProductStatus } = await import('./src/services/productService.js');

const f = (n) => Math.round(Number(n)).toLocaleString('fr-FR');

// ── 1. Les deux échéanciers ────────────────────────────────────────
const plans = [];
for (const ref of A_RENUMEROTER) {
  const { rows } = await query(
    `SELECT i.id, i.sequence, i.status::text AS st, i.amount,
            to_char(i.due_date, 'YYYY-MM-DD') AS due,
            i.ledger_entry_id IS NOT NULL AS ecr
     FROM installments i
     JOIN credit_requests c ON c.id = i.credit_id
     WHERE c.reference = $1
     ORDER BY i.sequence`,
    [ref]
  );
  // Par date, et à date égale la ligne payée passe devant : c'est
  // l'ordre dans lequel un échéancier se lit.
  const cible = [...rows].sort(
    (a, b) => a.due.localeCompare(b.due) || (a.st === 'payee' ? -1 : 1)
  );
  plans.push({ ref, rows, cible });

  console.log(`\n${ref}`);
  cible.forEach((r, i) => {
    const neuf = i + 1;
    console.log(
      `  seq ${String(r.sequence).padStart(2)} -> ${String(neuf).padStart(2)}`
      + `${neuf === r.sequence ? '  (inchange)' : '  <- deplacee'}`
      + `   ${r.st.padEnd(9)} ${f(r.amount).padStart(9)} F  due ${r.due}`
      + `  ${r.st === 'payee' ? (r.ecr ? 'paiement reel' : 'ligne d import') : ''}`
    );
  });
}

// ── 2. Le découvert ────────────────────────────────────────────────
const { rows: prod } = await query(
  `SELECT p.id, p.code, p.status::text AS statut,
          v.id AS version_id, v.version, v.monthly_rate,
          v.min_amount, v.max_amount, v.min_duration, v.max_duration,
          v.file_fee_fixed, v.file_fee_rate, v.late_penalty_rate
   FROM credit_products p
   JOIN product_versions v ON v.product_id = p.id AND v.effective_to IS NULL
   WHERE p.code = 'DECOUVERT'`
);
if (!prod[0]) { console.error('\nProduit DECOUVERT introuvable.'); process.exit(1); }
const d = prod[0];
console.log(`\n\nDECOUVERT — produit ${d.statut}, version ${d.version} en vigueur`);
console.log(`  taux     ${(Number(d.monthly_rate) * 100).toFixed(2)} %  ->  ${(TAUX_DECOUVERT * 100).toFixed(2)} %/mois`);
console.log(`  montants ${f(d.min_amount)} a ${f(d.max_amount)} F  (inchanges)`);
console.log(`  duree    ${d.min_duration} a ${d.max_duration} mois  (inchangee)`);
console.log(`  statut   ${d.statut}  ->  actif`);

const { rows: dossiers } = await query(
  `SELECT count(*)::int n FROM credit_requests c
   JOIN product_versions v ON v.id = c.product_version_id
   WHERE v.product_id = $1`,
  [d.id]
);
console.log(`  dossiers deja ouverts sur ce produit : ${dossiers[0].n}`);

if (!executer) {
  console.log('\nSimulation. Rien n’a été écrit. Relancez avec --executer pour appliquer.');
  process.exit(0);
}

const { rows: directeur } = await query(
  `SELECT id FROM users WHERE role = 'directeur' ORDER BY created_at LIMIT 1`
);

for (const { ref, cible } of plans) {
  await withTransaction(async (client) => {
    // Décalage hors de portée : UNIQUE (credit_id, sequence) refuserait
    // une permutation écrite directement.
    for (const r of cible) {
      await client.query('UPDATE installments SET sequence = sequence + 1000 WHERE id = $1', [r.id]);
    }
    for (let i = 0; i < cible.length; i += 1) {
      await client.query('UPDATE installments SET sequence = $1 WHERE id = $2', [i + 1, cible[i].id]);
    }
  });
  console.log(`${ref} : ${cible.length} echeances renumerotees.`);
}

const { created } = await applyNewVersion({
  productId: d.id,
  scale: {
    monthlyRate: TAUX_DECOUVERT,
    minAmount: Number(d.min_amount),
    maxAmount: Number(d.max_amount),
    minDuration: d.min_duration,
    maxDuration: d.max_duration,
    fileFeeFixed: Number(d.file_fee_fixed),
    fileFeeRate: Number(d.file_fee_rate),
    latePenaltyRate: Number(d.late_penalty_rate),
  },
  actorId: directeur[0].id,
  approvedBy: directeur[0].id,
  note: 'Taux aligne sur l’EXPRESS (9,21 %/mois) avant ouverture du produit — direction, 05/11/2026',
});
console.log(`DECOUVERT : version ${created.version} creee a ${(Number(created.monthly_rate) * 100).toFixed(2)} %/mois.`);

const actif = await setProductStatus({ productId: d.id, status: 'actif', actorId: directeur[0].id });
console.log(`DECOUVERT : produit ${actif.status}.`);

process.exit(0);
