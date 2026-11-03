/**
 * ═══════════════════════════════════════════════════════════════════
 *  UN FRAIS DE TENUE PAR COMPTE ET PAR MOIS, QUOI QU'IL ARRIVE
 * ═══════════════════════════════════════════════════════════════════
 *
 * « Assure-toi que les prélèvements ne passeront pas deux fois. »
 *
 * Un index unique protégeait déjà (fee_version_id, compte, période).
 * Il laissait passer un cas : si la direction révise le tarif en cours
 * de mois, la nouvelle version porte un autre identifiant, l'index ne
 * reconnaît plus la ligne déjà posée, et tous les comptes sont
 * facturés une seconde fois. C'est l'accident du 14/10/2026, où
 * 189 agents ont payé deux fois.
 *
 * La migration 056 déplace l'unicité sur le barème lui-même. Ces tests
 * figent les deux situations : la relance simple, et la relance après
 * changement de tarif.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer, stopTestServer, api, loginStaff, hasTestDatabase,
} from '../helpers/testServer.js';
import { query } from '../../src/db/index.js';
import { applyFeeVersion } from '../../src/services/feeService.js';

let operateurToken;
let directeurToken;
let clientId;
let accountId;
let feeId;

const mois = new Date();
const debut = new Date(Date.UTC(mois.getUTCFullYear(), mois.getUTCMonth(), 1)).toISOString().slice(0, 10);
const fin = new Date(Date.UTC(mois.getUTCFullYear(), mois.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);

/** Les lignes de frais de tenue de ce compte sur le mois en cours. */
async function lignesDuMois() {
  const { rows } = await query(
    `SELECT af.id, af.amount, af.fee_id, to_char(af.period_start,'YYYY-MM-DD') AS debut
     FROM applied_fees af
     JOIN fee_versions fv ON fv.id = af.fee_version_id
     JOIN fee_definitions fd ON fd.id = fv.fee_id
     WHERE fd.code = 'FRAIS_TENUE' AND af.account_id = $1 AND af.period_start = $2::date`,
    [accountId, debut]
  );
  return rows;
}

const preleverTout = () => api('/v1/admin/catalogue/tenue-compte/executer', {
  method: 'POST', token: operateurToken, body: { debut, fin },
});

before(async () => {
  await startTestServer();
  if (!hasTestDatabase()) return;
  operateurToken = await loginStaff('operateur');
  directeurToken = await loginStaff('directeur');

  const tel = `+24109${String(Math.floor(Math.random() * 900000) + 100000)}`;
  const { body } = await api('/v1/admin/utilisateurs', {
    method: 'POST', token: await loginStaff('gestionnaire'),
    body: {
      nomComplet: `Client Frais Tenue ${Date.now()}`, telephone: tel, role: 'client',
      codePin: '1234', confirmerDoublon: true,
    },
  });
  clientId = body.id;

  const { rows: comptes } = await query(
    'SELECT id FROM accounts WHERE user_id = $1 ORDER BY created_at LIMIT 1',
    [clientId]
  );
  accountId = comptes[0].id;

  const { rows: fee } = await query(
    `SELECT id FROM fee_definitions WHERE code = 'FRAIS_TENUE'`
  );
  feeId = fee[0].id;
});

after(async () => {
  await stopTestServer();
});

describe(
  'Frais de tenue — une seule fois par mois',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    test('le premier prélèvement passe et facture le compte', async () => {
      const { status } = await preleverTout();
      assert.equal(status, 200);

      const lignes = await lignesDuMois();
      assert.equal(lignes.length, 1, 'une ligne de frais pour le mois');
      assert.ok(lignes[0].fee_id, 'le barème est tracé sur la ligne — c’est lui qui porte l’unicité');
      assert.equal(lignes[0].fee_id, feeId);
    });

    test('le prélèvement est débité même si le compte passe en négatif', async () => {
      // Le frais de tenue est le coût de possession du compte, pas une
      // pénalité : il ne se conditionne pas au solde. C'est volontaire,
      // et le compte du client est à zéro — il vient d'être créé.
      const { rows } = await query(
        `SELECT COALESCE(b.balance, 0) AS solde FROM account_balances b WHERE b.account_id = $1`,
        [accountId]
      );
      assert.ok(
        Number(rows[0].solde) < 0,
        `le compte doit être passé en négatif du montant du frais, il est à ${rows[0].solde}`
      );
    });

    test('relancer le même mois ne facture rien de plus', async () => {
      const { status, body } = await preleverTout();
      assert.equal(status, 200);
      assert.ok(
        !body.details?.some((d) => d.accountId === accountId),
        'notre compte ne doit pas reparaître dans les prélèvements effectués'
      );
      assert.equal((await lignesDuMois()).length, 1);
    });

    test('un changement de tarif en cours de mois ne rouvre pas la porte', async () => {
      // LE cas qui manquait. L'ancienne unicité portait sur la version
      // du barème : une nouvelle version, et les 196 comptes repassaient
      // à la caisse le même mois.
      const avant = await lignesDuMois();
      assert.equal(avant.length, 1);

      await applyFeeVersion({
        feeId,
        scale: { amount: 7000, rate: 0, minAmount: 0, maxAmount: null, exemptBelow: 0 },
        actorId: (await query(`SELECT id FROM users WHERE role = 'directeur' LIMIT 1`)).rows[0].id,
        note: 'Test : revision de tarif en cours de mois',
      });

      const { rows: versions } = await query(
        `SELECT count(*)::int AS n FROM fee_versions WHERE fee_id = $1`, [feeId]
      );
      assert.ok(versions[0].n >= 2, 'le tarif doit bien avoir changé de version');

      const { status } = await preleverTout();
      assert.equal(status, 200);

      const apres = await lignesDuMois();
      assert.equal(
        apres.length, 1,
        'le compte ne doit pas être facturé une seconde fois sous le nouveau tarif'
      );
      assert.equal(apres[0].id, avant[0].id, 'et c’est bien la ligne d’origine qui subsiste');
    });

    test('aucun compte n’a deux lignes sur le mois', async () => {
      // Garde-fou global : le test précédent ne regarde qu'un compte,
      // celui-ci regarde toute la base de test.
      const { rows } = await query(
        `SELECT af.account_id, count(*)::int AS n
         FROM applied_fees af
         JOIN fee_versions fv ON fv.id = af.fee_version_id
         JOIN fee_definitions fd ON fd.id = fv.fee_id
         WHERE fd.code = 'FRAIS_TENUE' AND af.period_start = $1::date
         GROUP BY 1 HAVING count(*) > 1`,
        [debut]
      );
      assert.equal(rows.length, 0, `${rows.length} compte(s) facturé(s) deux fois`);
    });
  }
);

/**
 * ═══════════════════════════════════════════════════════════════════
 *  UNE ÉCHÉANCE EN RETARD SE PRÉLÈVE DÈS QUE LA PAIE ARRIVE
 * ═══════════════════════════════════════════════════════════════════
 *
 * « Redate au 3 novembre. » — 22 des 25 échéances redatées tombaient
 * en retard le jour même, faute de salaire versé.
 *
 * La collecte ne retenait que les échéances « à_venir » : une fois en
 * retard, aucune reprise automatique. Le salaire arrivait trois jours
 * plus tard et l'échéance restait impayée jusqu'à ce qu'un opérateur
 * la prélève à la main, une par une — vingt-deux fois.
 */
describe(
  'Collecte des échéances — reprise des retards',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    test('en retard faute de provision, puis prélevée quand le compte est alimenté', async () => {
      const { runInstallmentCollection } = await import('../../src/services/operationsService.js');
      const { rows: [dir] } = await query(`SELECT id FROM users WHERE role = 'directeur' LIMIT 1`);

      // Le dossier est posé directement en base, et pas monté par tout
      // le circuit de validation : ce qui est testé ici est la boucle de
      // collecte, qui ne lit que credit_requests et installments.
      //
      // Surtout, le test ne dépend d'AUCUNE donnée préexistante. Une
      // première version cherchait un crédit déjà approuvé et sortait
      // sans rien vérifier quand elle n'en trouvait pas : elle passait
      // en 1,8 ms sans rien tester, ce qui est pire que pas de test.
      const tel = `+24109${String(Math.floor(Math.random() * 900000) + 100000)}`;
      const { body: client } = await api('/v1/admin/utilisateurs', {
        method: 'POST', token: await loginStaff('gestionnaire'),
        body: {
          nomComplet: `Client Retard ${Date.now()}`, telephone: tel, role: 'client',
          codePin: '1234', confirmerDoublon: true,
        },
      });
      const { rows: [compte] } = await query(
        'SELECT id FROM accounts WHERE user_id = $1 ORDER BY created_at LIMIT 1',
        [client.id]
      );
      const { rows: [version] } = await query(
        `SELECT v.id FROM product_versions v
         JOIN credit_products p ON p.id = v.product_id
         WHERE p.code = 'MICRO_STD' AND v.effective_to IS NULL`
      );

      const reference = `TEST-RETARD-${Date.now()}`;
      const { rows: [credit] } = await query(
        `INSERT INTO credit_requests
           (reference, user_id, amount, duration_months, monthly_rate, monthly_payment,
            purpose, status, product_version_id, approved_by, approved_at)
         VALUES ($1, $2, 100000, 1, 0.05, 105000, 'Test reprise des retards',
                 'approuve', $3, $4, now())
         RETURNING id`,
        [reference, client.id, version.id, dir.id]
      );
      const { rows: [echeance] } = await query(
        `INSERT INTO installments (credit_id, sequence, due_date, amount)
         VALUES ($1, 1, CURRENT_DATE, 105000) RETURNING id`,
        [credit.id]
      );

      // Premier passage : le compte est vide, l'échéance tombe en retard.
      await runInstallmentCollection({ actorId: dir.id });
      const { rows: [apres] } = await query(
        `SELECT status::text FROM installments WHERE id = $1`, [echeance.id]
      );
      assert.equal(apres.status, 'en_retard', 'sans provision, elle passe en retard');

      // La paie arrive.
      await query(
        `INSERT INTO ledger_entries (account_id, type, amount, label, created_by)
         VALUES ($1, 'salaire', 150000, 'Salaire du test', $2)`,
        [compte.id, dir.id]
      );

      const resultat = await runInstallmentCollection({ actorId: dir.id });

      // On juge sur le statut final, pas sur le contenu du compte rendu :
      // `paid` ne porte que référence, rang et montant, pas l'identifiant
      // de l'échéance.
      const { rows: [final] } = await query(
        `SELECT status::text FROM installments WHERE id = $1`, [echeance.id]
      );
      assert.equal(
        final.status, 'payee',
        'l’échéance en retard doit être reprise d’elle-même, sans geste de l’opérateur'
      );
      assert.ok(
        resultat.paid.some((p) => p.reference === reference),
        'et figurer au compte rendu du passage'
      );

      // Le crédit n'avait qu'une échéance : il doit être soldé.
      const { rows: [dossier] } = await query(
        `SELECT status::text FROM credit_requests WHERE id = $1`, [credit.id]
      );
      assert.equal(dossier.status, 'solde');
    });

  }
);
