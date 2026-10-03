// ═══════════════════════════════════════════════════════════════════
//  Import des crédits historiques (ancien logiciel) — script à usage
//  unique, à exécuter une seule fois par le directeur depuis son poste,
//  avec le tunnel Railway (comme pour verif_export.mjs).
//
//  Usage :
//    DATABASE_URL=postgresql://... node import_credits_historiques.mjs
//
//  Le script est rejouable sans risque : chaque ligne importée est
//  enregistrée dans `legacy_credit_imports` (ligne_origine UNIQUE), et
//  toute ligne déjà présente y est ignorée au prochain lancement.
// ═══════════════════════════════════════════════════════════════════
import pg from 'pg';
import fs from 'fs';

const DATA_PATH = new URL('./legacy_import_data.json', import.meta.url);
const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

// ─── Reprend exactement les conventions de src/services/creditService.js ───

function generateReference(prefix = 'CPG') {
  return `${prefix}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function generateClientNumber() {
  return `CPG-${String(Math.floor(Math.random() * 900000) + 100000)}`;
}

/**
 * Une par mois à compter du déblocage — le mois de déblocage lui-même
 * ne compte pas (échéance 1 = déblocage + 1 mois), exactement comme
 * buildInstallments() dans creditService.js.
 */
function buildInstallments(startDate, durationMonths, monthlyPayment, totalDue) {
  const installments = [];
  let remaining = totalDue;
  for (let i = 1; i <= durationMonths; i += 1) {
    const due = new Date(startDate);
    due.setMonth(due.getMonth() + i);
    const amount = i === durationMonths ? remaining : monthlyPayment;
    remaining -= amount;
    installments.push({ sequence: i, dueDate: due, amount });
  }
  return installments;
}

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function insertUnique(client, sql, paramsFn, maxTries = 8) {
  for (let i = 0; i < maxTries; i += 1) {
    try {
      return await client.query(sql, paramsFn());
    } catch (error) {
      if (error.code === '23505' && i < maxTries - 1) continue; // collision, on retire un nouveau tirage
      throw error;
    }
  }
}

async function main() {
  const { rows: directeurs } = await pool.query(
    `SELECT id, full_name FROM users WHERE role = 'directeur' AND status = 'actif' ORDER BY created_at LIMIT 1`
  );
  const directeur = directeurs[0];
  if (!directeur) {
    throw new Error('Aucun compte directeur actif trouvé — impossible de tracer qui a fait l’import.');
  }
  console.log(`Import exécuté au nom de : ${directeur.full_name} (${directeur.id})`);

  const rows = [
    ...data.a_importer_existant.map((r) => ({ ...r, nouveau: false })),
    ...data.nouveaux_clients.map((r) => ({ ...r, nouveau: true })),
  ];

  let importes = 0;
  let ignores = 0;
  let nouveauxComptes = 0;
  let totalMontant = 0;
  const erreurs = [];

  for (const r of rows) {
    try {
      const resultat = await withTransaction(async (client) => {
        // Idempotence : si cette ligne a déjà été importée, on ne
        // refait rien.
        const { rows: deja } = await client.query(
          `SELECT 1 FROM legacy_credit_imports WHERE ligne_origine = $1`,
          [r.ligne_origine]
        );
        if (deja[0]) return { skip: true };

        let clientId = r.client_id;
        let accountId = r.account_id;
        let nouveauCompte = false;

        if (r.nouveau) {
          // Numéro de téléphone inconnu dans l'ancien fichier : on met
          // un repère clairement provisoire, que le directeur remplace
          // par le vrai numéro dès qu'il l'a (fiche « Utilisateurs »).
          const telephonePlaceholder = `A-COMPLETER-${r.ligne_origine}`;

          const created = await insertUnique(
            client,
            `INSERT INTO users (full_name, phone, role, employer, pin_hash, password_hash, client_number, status, created_by)
             VALUES ($1, $2, 'client', $3, NULL, NULL, $4, 'actif', $5)
             RETURNING id`,
            () => [r.nom_fichier, telephonePlaceholder, r.employeur ?? null, generateClientNumber(), directeur.id]
          );
          clientId = created.rows[0].id;

          const { rows: acc } = await client.query(
            `INSERT INTO accounts (user_id) VALUES ($1) RETURNING id`,
            [clientId]
          );
          accountId = acc[0].id;
          nouveauCompte = true;
        }

        const dateCredit = new Date(r.date_credit);
        const mensualite = r.mensualite_capital + r.mensualite_interet;
        const totalDu = mensualite * r.periode;
        const tauxMensuel = r.montant > 0
          ? Math.min(1, Math.max(0, r.mensualite_interet / r.montant))
          : 0;
        const dejaPayees = r.periode - r.restante;
        const statutCredit = r.restante === 0 ? 'solde' : 'approuve';

        const reference = (await insertUnique(
          client,
          `INSERT INTO credit_requests
             (reference, user_id, amount, duration_months, monthly_rate, monthly_payment,
              purpose, status, approved_by, approved_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
           RETURNING id, reference`,
          () => [
            generateReference(), clientId, r.montant, r.periode, tauxMensuel.toFixed(4), mensualite,
            'Crédit historique — importé depuis l’ancien logiciel', statutCredit,
            directeur.id, dateCredit,
          ]
        )).rows[0];

        // Déblocage des fonds — même écriture que l'approbation normale,
        // mais datée du vrai déblocage d'origine.
        await client.query(
          `INSERT INTO ledger_entries (account_id, type, amount, label, reference, created_by, created_at)
           VALUES ($1, 'deblocage_credit', $2, $3, $4, $5, $6)`,
          [
            accountId, r.montant,
            `Déblocage crédit ${reference.reference} (import historique)`,
            reference.reference, directeur.id, dateCredit,
          ]
        );

        // Échéancier, reconstitué depuis le mois de déblocage (qui ne
        // compte pas) ; les mensualités déjà réglées dans l'ancien
        // système sont marquées payées, avec l'écriture correspondante.
        const installments = buildInstallments(dateCredit, r.periode, mensualite, totalDu);
        for (const inst of installments) {
          const estPayee = inst.sequence <= dejaPayees;
          const { rows: instRow } = await client.query(
            `INSERT INTO installments (credit_id, sequence, due_date, amount, status, paid_at)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id`,
            [
              reference.id, inst.sequence, inst.dueDate, inst.amount,
              estPayee ? 'payee' : 'a_venir', estPayee ? inst.dueDate : null,
            ]
          );

          if (estPayee) {
            const { rows: entry } = await client.query(
              `INSERT INTO ledger_entries (account_id, type, amount, label, reference, created_by, created_at)
               VALUES ($1, 'paiement_credit', $2, $3, $4, $5, $6)
               RETURNING id`,
              [
                accountId, -inst.amount,
                `Échéance ${inst.sequence}/${r.periode} — crédit ${reference.reference} (import historique)`,
                reference.reference, directeur.id, inst.dueDate,
              ]
            );
            await client.query(`UPDATE installments SET ledger_entry_id = $2 WHERE id = $1`, [instRow.id, entry[0].id]);
          }
        }

        await client.query(
          `INSERT INTO legacy_credit_imports (ligne_origine, credit_id, client_id, nouveau_client, nom_fichier, montant, imported_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [r.ligne_origine, reference.id, clientId, nouveauCompte, r.nom_fichier, r.montant, directeur.id]
        );

        return { skip: false, nouveauCompte, montant: r.montant, reference: reference.reference, nom: r.nom_fichier };
      });

      if (resultat.skip) {
        ignores += 1;
      } else {
        importes += 1;
        totalMontant += resultat.montant;
        if (resultat.nouveauCompte) nouveauxComptes += 1;
        console.log(`  OK  ligne ${r.ligne_origine} — ${resultat.nom} — ${resultat.reference} — ${resultat.montant.toLocaleString('fr-FR')} F${resultat.nouveauCompte ? ' (nouveau compte)' : ''}`);
      }
    } catch (error) {
      erreurs.push({ ligne: r.ligne_origine, nom: r.nom_fichier, message: error.message });
      console.error(`  ERREUR ligne ${r.ligne_origine} (${r.nom_fichier}) : ${error.message}`);
    }
  }

  console.log('\n─── Résumé ───');
  console.log(`Crédits importés   : ${importes}`);
  console.log(`Déjà importés (ignorés) : ${ignores}`);
  console.log(`Nouveaux comptes créés  : ${nouveauxComptes}`);
  console.log(`Montant total importé   : ${totalMontant.toLocaleString('fr-FR')} F`);
  if (erreurs.length) {
    console.log(`Erreurs (${erreurs.length}) — à traiter à la main :`);
    for (const e of erreurs) console.log(`  - ligne ${e.ligne} (${e.nom}) : ${e.message}`);
  }

  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
