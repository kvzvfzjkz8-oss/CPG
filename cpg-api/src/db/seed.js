import bcrypt from 'bcrypt';
import { pool, withTransaction } from './index.js';
import { computeSchedule, buildInstallments } from '../services/creditService.js';

/**
 * Jeu de données de démonstration, calqué sur les maquettes.
 *
 * ⚠️ Ne jamais exécuter en production : les mots de passe sont connus.
 * Le script refuse de démarrer si NODE_ENV vaut « production ».
 */

if (process.env.NODE_ENV === 'production') {
  console.error('Refus : le seed ne doit pas être exécuté en production.');
  process.exit(1);
}

const DEMO_PIN = '1234';
const DEMO_PASSWORD = 'MotDePasseDemo2026!';

async function seed() {
  await withTransaction(async (client) => {
    console.log('Nettoyage des données existantes…');
    await client.query(`
      TRUNCATE audit_log, notifications, devices, messages, conversations,
               momo_transactions, installments, credit_documents, credit_requests,
               applied_fees, fee_versions, fee_definitions,
               rate_change_requests, product_versions, credit_products,
               ledger_entries, accounts, refresh_tokens, users
      RESTART IDENTITY CASCADE
    `);

    // ⚠️ rate_ceilings n'est pas listée ci-dessus, mais elle référence
    // users(id) via updated_by : le CASCADE la vide quand même. Sans
    // cette réinsertion, chaque seed supprime silencieusement le
    // plafond réglementaire — le garde-fou contre l'erreur de saisie
    // sur les taux disparaîtrait sans le moindre avertissement.
    console.log('Restauration des plafonds réglementaires…');
    await client.query(`
      INSERT INTO rate_ceilings (scope, max_rate, note) VALUES
        ('credit_monthly', 0.0300, 'Plafond interne du taux mensuel de crédit. À aligner sur le taux d''usure BEAC en vigueur.'),
        ('agios_daily',    0.0010, 'Plafond du taux journalier d''agios sur solde débiteur.'),
        ('fee_percentage', 0.0500, 'Plafond des commissions exprimées en pourcentage.')
    `);

    const pinHash = await bcrypt.hash(DEMO_PIN, 12);
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

    console.log('Création des employés…');
    const { rows: staff } = await client.query(
      `INSERT INTO users (full_name, phone, email, role, password_hash)
       VALUES
         ('Sylvie Mabiala', '+24101000001', 'sylvie@cpg.ga', 'operateur', $1),
         ('Éric Moussavou', '+24101000002', 'eric@cpg.ga', 'operateur', $1),
         ('David Nzue', '+24101000003', 'david@cpg.ga', 'superviseur', $1),
         ('Paulette Ovono', '+24101000004', 'direction@cpg.ga', 'directeur', $1),
         ('Admin CPG', '+24101000000', 'admin@cpg.ga', 'admin', $1)
       RETURNING id, full_name, role`,
      [passwordHash]
    );

    const gestionnaire = staff.find((s) => s.role === 'superviseur');
    const directeur = staff.find((s) => s.role === 'directeur');

    console.log('Création du catalogue de produits…');
    const produits = [
      ['MICRO_STD', 'Microcrédit standard', 'Produit généraliste, tout public.',
       0.0150, 50000, 2000000, 3, 24, 5000, 0.0100, 0.0500],
      ['CHEMINOT', 'Microcrédit cheminot', 'Réservé aux agents de la voie, taux préférentiel et durée étendue.',
       0.0120, 50000, 3000000, 3, 36, 2500, 0.0050, 0.0300],
      ['EXPRESS', 'Crédit express', 'Petits montants, déblocage sous 24 h.',
       0.0250, 20000, 300000, 1, 6, 3000, 0.0000, 0.0800],
    ];

    for (const [code, name, description, rate, minA, maxA, minD, maxD, feeFixed, feeRate, penalty] of produits) {
      const { rows: p } = await client.query(
        `INSERT INTO credit_products (code, name, description, status, created_by, activated_by, activated_at)
         VALUES ($1, $2, $3, 'actif', $4, $5, now()) RETURNING id`,
        [code, name, description, gestionnaire.id, directeur.id]
      );

      await client.query(
        `INSERT INTO product_versions
           (product_id, version, monthly_rate, min_amount, max_amount, min_duration, max_duration,
            file_fee_fixed, file_fee_rate, late_penalty_rate, created_by, approved_by, note)
         VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'Barème initial')`,
        [p[0].id, rate, minA, maxA, minD, maxD, feeFixed, feeRate, penalty, gestionnaire.id, directeur.id]
      );
    }

    // Un produit en brouillon, pour montrer qu'il n'apparaît pas côté client.
    const { rows: brouillon } = await client.query(
      `INSERT INTO credit_products (code, name, description, status, created_by)
       VALUES ('SCOLAIRE', 'Crédit scolaire', 'Rentrée des classes. En cours de validation.', 'brouillon', $1)
       RETURNING id`,
      [gestionnaire.id]
    );
    await client.query(
      `INSERT INTO product_versions
         (product_id, version, monthly_rate, min_amount, max_amount, min_duration, max_duration,
          file_fee_fixed, created_by, note)
       VALUES ($1, 1, 0.0100, 25000, 500000, 3, 12, 1000, $2, 'Barème initial, en attente d''activation')`,
      [brouillon[0].id, gestionnaire.id]
    );

    console.log('Création des services annexes et agios…');
    const services = [
      ['AGIOS_DECOUVERT', 'Agios sur solde débiteur',
       'Intérêts débiteurs calculés jour par jour sur les soldes négatifs.',
       'journalier_solde', 'solde_debiteur', 0, 0.000500, 0, 25000, 5000],
      ['FRAIS_TENUE', 'Frais de tenue de compte', 'Forfait mensuel.',
       'fixe', 'tenue_compte', 1000, 0, 0, null, 0],
      ['COMM_RETRAIT', 'Commission de retrait', 'Commission sur retrait en agence.',
       'pourcentage', 'retrait', 0, 0.005000, 200, 5000, 10000],
      ['COMM_MOMO', 'Commission transfert Mobile Money', 'Commission sur transfert sortant.',
       'pourcentage', 'transfert_momo', 0, 0.010000, 100, 3000, 2000],
    ];

    for (const [code, name, description, basis, trigger, amount, rate, minA, maxA, exempt] of services) {
      const { rows: f } = await client.query(
        `INSERT INTO fee_definitions (code, name, description, basis, trigger_on, status, created_by, activated_by, activated_at)
         VALUES ($1, $2, $3, $4, $5, 'actif', $6, $7, now()) RETURNING id`,
        [code, name, description, basis, trigger, gestionnaire.id, directeur.id]
      );

      await client.query(
        `INSERT INTO fee_versions
           (fee_id, version, amount, rate, min_amount, max_amount, exempt_below, created_by, approved_by, note)
         VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, 'Barème initial')`,
        [f[0].id, amount, rate, minA, maxA, exempt, gestionnaire.id, directeur.id]
      );
    }

    console.log('Création des clients…');
    const clients = [
      ['Jean-Paul Ndong', '+24106000001', 'CPG-00931', 'SETRAG', 'Agent de la voie', 412500],
      ['Alice Mintsa', '+24106000002', 'CPG-00932', 'Éducation nationale', 'Institutrice', 85000],
      ['Serge Obiang', '+24106000003', 'CPG-00933', 'SETRAG', 'Agent de la voie', 230000],
      ['Marie Ella', '+24106000004', 'CPG-00934', 'Commerce', 'Commerçante', 51000],
    ];

    const createdClients = [];

    for (const [name, phone, number, employer, job, balance] of clients) {
      const { rows } = await client.query(
        `INSERT INTO users (full_name, phone, client_number, employer, job_title, role, pin_hash)
         VALUES ($1, $2, $3, $4, $5, 'client', $6) RETURNING id, full_name`,
        [name, phone, number, employer, job, pinHash]
      );

      const { rows: account } = await client.query(
        'INSERT INTO accounts (user_id) VALUES ($1) RETURNING id',
        [rows[0].id]
      );

      // Solde initial via une écriture au journal, jamais en écrivant
      // un champ « balance » : le solde reste toujours dérivé.
      await client.query(
        `INSERT INTO ledger_entries (account_id, type, amount, label)
         VALUES ($1, 'ajustement', $2, 'Solde d''ouverture')`,
        [account[0].id, balance]
      );

      createdClients.push({ ...rows[0], accountId: account[0].id });
    }

    console.log('Création des mouvements…');
    const jp = createdClients[0];
    await client.query(
      `INSERT INTO ledger_entries (account_id, type, amount, label, created_at) VALUES
         ($1, 'depot', 120000, 'Dépôt Airtel Money', now() - interval '5 days'),
         ($1, 'retrait', -30000, 'Retrait agence Owendo', now() - interval '8 days'),
         ($1, 'depot', 380000, 'Virement salaire SETRAG', now() - interval '11 days')`,
      [jp.accountId]
    );

    console.log('Création des demandes de crédit…');
    const operateur = staff.find((s) => s.full_name === 'Sylvie Mabiala');

    // Deux dossiers en vérification, pour l'écran Opérateur.
    await client.query(
      `INSERT INTO credit_requests (reference, user_id, amount, duration_months, monthly_rate, purpose, status)
       VALUES
         ('CPG-4471', $1, 300000, 12, 0.0150, 'Équipement professionnel', 'en_verification'),
         ('CPG-4472', $2, 150000, 6, 0.0150, 'Imprévu familial', 'en_verification')`,
      [createdClients[0].id, createdClients[1].id]
    );

    // Deux dossiers validés niveau 1, pour l'écran Superviseur.
    await client.query(
      `INSERT INTO credit_requests
         (reference, user_id, amount, duration_months, monthly_rate, status, level1_by, level1_at)
       VALUES
         ('CPG-4468', $1, 500000, 18, 0.0150, 'valide_niveau1', $3, now() - interval '1 day'),
         ('CPG-4460', $2, 200000, 9, 0.0150, 'valide_niveau1', $3, now() - interval '2 days')`,
      [createdClients[2].id, createdClients[3].id, operateur.id]
    );

    // Un crédit approuvé avec son échéancier, pour l'écran mobile.
    const superviseur = staff.find((s) => s.role === 'superviseur');
    const amount = 500000;
    const months = 12;
    const { monthlyPayment, totalDue } = computeSchedule(amount, months);

    const { rows: approved } = await client.query(
      `INSERT INTO credit_requests
         (reference, user_id, amount, duration_months, monthly_rate, monthly_payment,
          status, level1_by, level1_at, approved_by, approved_at)
       VALUES ('CPG-4400', $1, $2, $3, 0.0150, $4, 'approuve', $5, now() - interval '5 months',
               $6, now() - interval '5 months')
       RETURNING id`,
      [jp.id, amount, months, monthlyPayment, operateur.id, superviseur.id]
    );

    const start = new Date();
    start.setMonth(start.getMonth() - 5);
    const installments = buildInstallments(start, months, monthlyPayment, totalDue);

    for (const inst of installments) {
      // Les cinq premières échéances sont réglées : cela reproduit
      // l'état affiché par la maquette mobile (5 payées sur 12).
      const paid = inst.sequence <= 5;
      await client.query(
        `INSERT INTO installments (credit_id, sequence, due_date, amount, status, paid_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          approved[0].id,
          inst.sequence,
          inst.dueDate,
          inst.amount,
          paid ? 'payee' : 'a_venir',
          paid ? inst.dueDate : null,
        ]
      );
    }

    console.log('Création des conversations…');
    const { rows: conv } = await client.query(
      'INSERT INTO conversations (client_id, last_message_at) VALUES ($1, now()) RETURNING id',
      [jp.id]
    );
    await client.query(
      `INSERT INTO messages (conversation_id, sender_id, body, created_at) VALUES
         ($1, $2, 'Bonjour Jean-Paul, je suis Sylvie, votre conseillère CPG. Comment puis-je vous aider ?', now() - interval '2 hours'),
         ($1, $3, 'Bonjour, je voudrais savoir où en est ma demande de crédit.', now() - interval '1 hour')`,
      [conv[0].id, operateur.id, jp.id]
    );

    console.log('Création des transactions Mobile Money…');
    await client.query(
      `INSERT INTO momo_transactions
         (reference, user_id, account_id, operator, direction, amount, phone, status, confirmed_at)
       VALUES
         ('TX-9021', $1, $2, 'airtel', 'entrant', 120000, '+24106000001', 'confirmee', now() - interval '5 days'),
         ('TX-9023', $1, $2, 'airtel', 'entrant', 300000, '+24106000001', 'en_attente', NULL)`,
      [jp.id, jp.accountId]
    );
  });

  console.log('\n─────────────────────────────────────────────');
  console.log('Données de démonstration créées.\n');
  console.log('Back-office :');
  console.log(`  Opérateur    sylvie@cpg.ga     / ${DEMO_PASSWORD}`);
  console.log(`  Gestionnaire david@cpg.ga      / ${DEMO_PASSWORD}`);
  console.log(`  Directeur    direction@cpg.ga  / ${DEMO_PASSWORD}`);
  console.log('\nApplication mobile :');
  console.log(`  Téléphone    +24106000001    / PIN ${DEMO_PIN}`);
  console.log('─────────────────────────────────────────────\n');

  await pool.end();
}

seed().catch(async (err) => {
  console.error('Échec du seed :', err.message);
  await pool.end();
  process.exit(1);
});
