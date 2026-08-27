import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer, stopTestServer, api, loginStaff, hasTestDatabase,
} from '../helpers/testServer.js';

/**
 * Un seul avant/après pour tout le fichier : voir la remarque en tête
 * de catalog.test.js sur pool.end() et les blocs describe multiples.
 */
before(async () => {
  await startTestServer();
});

after(async () => {
  await stopTestServer();
});

/** Crée un client de test dédié avec un solde vierge, retourne son jeton et son téléphone. */
async function createTestClient(label) {
  const gestionnaireToken = await loginStaff('gestionnaire');
  const phone = `+24108${String(Math.floor(Math.random() * 900000) + 100000)}`;
  await api('/v1/admin/utilisateurs', {
    method: 'POST',
    token: gestionnaireToken,
    body: {
      nomComplet: `Client Test ${label}`,
      telephone: phone,
      role: 'client',
      codePin: '1234',
    },
  });
  const { body } = await api('/v1/auth/connexion-client', {
    method: 'POST',
    body: { phone, pin: '1234' },
  });
  return { phone, token: body.accessToken };
}

/** Fait approuver un crédit de bout en bout pour le client donné (dépose le principal). */
async function approveCreditFor(clientToken, produitId, montant, duree) {
  const { body: created } = await api('/v1/client/credits', {
    method: 'POST',
    token: clientToken,
    body: { produitId, montant, duree, motif: 'Test opérations' },
  });

  const operateurToken = await loginStaff('operateur');
  await api(`/v1/admin/credits/${created.id}/valider-niveau1`, { method: 'POST', token: operateurToken });

  const gestionnaireToken = await loginStaff('gestionnaire');

  // Comité de crédit : programme une séance dédiée, dépose le dossier,
  // puis la tient aussitôt — un cycle complet par appel, pour ne
  // jamais laisser de séance ouverte avec un dossier d'un autre test
  // dedans (la contrainte « une seule séance planifiée à la fois »
  // l'interdirait pour l'appel suivant).
  const { body: session } = await api('/v1/admin/commission/seance', {
    method: 'POST', token: gestionnaireToken,
    body: { dateHeure: '2026-09-01T09:00' },
  });
  await api(`/v1/admin/commission/credits/${created.id}/deposer`, {
    method: 'POST', token: gestionnaireToken, body: { note: 'Dossier de test' },
  });
  await api(`/v1/admin/commission/seance/${session.id}/tenir`, {
    method: 'POST', token: gestionnaireToken,
    body: { decisions: [{ creditId: created.id, decision: 'valide' }] },
  });

  await api(`/v1/admin/commission/credits/${created.id}/valider-double`, {
    method: 'POST', token: operateurToken,
  });

  const directeurToken = await loginStaff('directeur');
  const { body: approved } = await api(`/v1/admin/credits/${created.id}/approuver`, {
    method: 'POST', token: directeurToken,
  });

  return { id: created.id, reference: approved.reference };
}

describe(
  'opérations mensuelles — paie des agents',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    let agent;
    const employeur = `TESTCO${Date.now()}`;
    const periode = '2026-08';

    before(async () => {
      agent = await createTestClient('Paie');
    });

    test('un gestionnaire ne peut pas créditer les salaires', async () => {
      const token = await loginStaff('gestionnaire');
      const { status } = await api('/v1/admin/operations/salaires', {
        method: 'POST',
        token,
        body: { employeur, periode, lignes: [{ identifiant: agent.phone, montant: 100000 }] },
      });
      assert.equal(status, 403);
    });

    test('un opérateur crédite la paie et le solde du client augmente', async () => {
      const token = await loginStaff('operateur');
      const { status, body } = await api('/v1/admin/operations/salaires', {
        method: 'POST',
        token,
        body: { employeur, periode, lignes: [{ identifiant: agent.phone, montant: 275000 }] },
      });
      assert.equal(status, 201);
      assert.equal(body.credited.length, 1);
      assert.equal(body.credited[0].montant, 275000);
      assert.equal(body.total, 275000);

      const { body: compte } = await api('/v1/client/compte', { token: agent.token });
      assert.equal(compte.account.balance, 275000);
    });

    test('un identifiant inconnu est signalé sans bloquer le reste du lot', async () => {
      const token = await loginStaff('operateur');
      const otherAgent = await createTestClient('Paie2');
      const { status, body } = await api('/v1/admin/operations/salaires', {
        method: 'POST',
        token,
        body: {
          employeur, periode: '2026-09',
          lignes: [
            { identifiant: otherAgent.phone, montant: 150000 },
            { identifiant: '+24100000000', montant: 90000 },
          ],
        },
      });
      assert.equal(status, 201);
      assert.equal(body.credited.length, 1);
      assert.equal(body.notFound.length, 1);
      assert.equal(body.notFound[0].motif, 'client_introuvable');
    });

    test('relancer le même lot ne crédite pas une seconde fois', async () => {
      const token = await loginStaff('operateur');
      const { status, body } = await api('/v1/admin/operations/salaires', {
        method: 'POST',
        token,
        body: { employeur, periode, lignes: [{ identifiant: agent.phone, montant: 275000 }] },
      });
      assert.equal(status, 201);
      assert.equal(body.credited.length, 0);
      assert.equal(body.notFound[0].motif, 'deja_credite_ce_mois');

      const { body: compte } = await api('/v1/client/compte', { token: agent.token });
      assert.equal(compte.account.balance, 275000, 'le solde ne doit pas avoir doublé');
    });

    test('une période mal formée est rejetée', async () => {
      const token = await loginStaff('operateur');
      const { status } = await api('/v1/admin/operations/salaires', {
        method: 'POST',
        token,
        body: { employeur, periode: 'août-2026', lignes: [{ identifiant: agent.phone, montant: 1000 }] },
      });
      assert.equal(status, 422);
    });

    test('un lot vide est rejeté', async () => {
      const token = await loginStaff('operateur');
      const { status } = await api('/v1/admin/operations/salaires', {
        method: 'POST',
        token,
        body: { employeur, periode, lignes: [] },
      });
      assert.equal(status, 422);
    });
  }
);

describe(
  'opérations mensuelles — prélèvement des échéances',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    let produitId;

    before(async () => {
      const token = await loginStaff('gestionnaire');
      const { body } = await api('/v1/admin/catalogue/produits/actifs', { token });
      produitId = Object.fromEntries(body.produits.map((p) => [p.code, p.product_id]));
    });

    test('un client ne peut pas déclencher la collecte', async () => {
      const client = await createTestClient('Collecte1');
      const { status } = await api('/v1/admin/operations/echeances/executer', {
        method: 'POST',
        token: client.token,
        body: {},
      });
      assert.equal(status, 403);
    });

    test('une échéance couverte par le solde est prélevée et marquée payée', async () => {
      // MICRO_STD, 6 mois : la première échéance ne consomme qu'une
      // fraction du principal déposé à l'approbation — largement
      // couverte.
      const client = await createTestClient('Collecte2');
      const credit = await approveCreditFor(client.token, produitId.MICRO_STD, 120000, 6);

      const { body: avant } = await api('/v1/client/credits', { token: client.token });
      const premiereEcheance = avant.activeCredit.installments[0];

      const operateurToken = await loginStaff('operateur');
      const { status, body } = await api('/v1/admin/operations/echeances/executer', {
        method: 'POST',
        token: operateurToken,
        body: { asOf: premiereEcheance.due_date.slice(0, 10) },
      });
      assert.equal(status, 200);

      const paidForThisCredit = body.paid.filter((p) => p.reference === credit.reference);
      assert.equal(paidForThisCredit.length, 1);
      assert.equal(paidForThisCredit[0].sequence, 1);

      const { body: apres } = await api('/v1/client/credits', { token: client.token });
      assert.equal(apres.activeCredit.paidMonths, 1);
    });

    test('une échéance qui dépasse le solde disponible passe en retard, sans mouvement d\'argent', async () => {
      // EXPRESS, 1 mois, montant minimum : l'unique échéance inclut
      // l'intérêt du mois et dépasse donc forcément le principal seul
      // déposé à l'approbation — le prélèvement doit échouer proprement.
      const client = await createTestClient('Collecte3');
      const credit = await approveCreditFor(client.token, produitId.EXPRESS, 20000, 1);

      const { body: avant } = await api('/v1/client/credits', { token: client.token });
      const soldeAvant = (await api('/v1/client/compte', { token: client.token })).body.account.balance;
      const echeance = avant.activeCredit.installments[0];
      assert.ok(echeance.amount > soldeAvant, 'précondition du test : échéance > solde déposé');

      const operateurToken = await loginStaff('operateur');
      const { status, body } = await api('/v1/admin/operations/echeances/executer', {
        method: 'POST',
        token: operateurToken,
        body: { asOf: echeance.due_date.slice(0, 10) },
      });
      assert.equal(status, 200);

      const lateForThisCredit = body.late.filter((l) => l.reference === credit.reference);
      assert.equal(lateForThisCredit.length, 1);

      const soldeApres = (await api('/v1/client/compte', { token: client.token })).body.account.balance;
      assert.equal(soldeApres, soldeAvant, 'aucun débit ne doit avoir eu lieu');

      const { body: apres } = await api('/v1/client/credits', { token: client.token });
      assert.equal(apres.activeCredit.installments[0].status, 'en_retard');
    });

    test('rejouer la collecte à la même date ne prélève pas deux fois', async () => {
      const client = await createTestClient('Collecte4');
      const credit = await approveCreditFor(client.token, produitId.MICRO_STD, 100000, 3);

      const { body: avant } = await api('/v1/client/credits', { token: client.token });
      const echeance = avant.activeCredit.installments[0];
      const asOf = echeance.due_date.slice(0, 10);
      const operateurToken = await loginStaff('operateur');

      const first = await api('/v1/admin/operations/echeances/executer', {
        method: 'POST', token: operateurToken, body: { asOf },
      });
      assert.ok(first.body.paid.some((p) => p.reference === credit.reference));

      const second = await api('/v1/admin/operations/echeances/executer', {
        method: 'POST', token: operateurToken, body: { asOf },
      });
      assert.ok(
        !second.body.paid.some((p) => p.reference === credit.reference),
        'une échéance déjà payée ne doit plus apparaître au prochain passage'
      );
    });
  }
);

describe(
  'opérations mensuelles — relevé de contrôle',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    test('le relevé reflète les salaires crédités sur la période', async () => {
      const client = await createTestClient('Releve1');
      const employeur = `RELEVECO${Date.now()}`;

      const operateurToken = await loginStaff('operateur');
      await api('/v1/admin/operations/salaires', {
        method: 'POST',
        token: operateurToken,
        body: { employeur, periode: '2026-08', lignes: [{ identifiant: client.phone, montant: 88000 }] },
      });

      const { status, body } = await api(
        '/v1/admin/operations/releve?debut=2026-08-01&fin=2026-08-31',
        { token: operateurToken }
      );
      assert.equal(status, 200);
      assert.ok(Number(body.salairesCredites.nombre) >= 1);
      assert.ok(Number(body.salairesCredites.total) >= 88000);
    });

    test('le gestionnaire peut lire le relevé, à titre de supervision', async () => {
      const token = await loginStaff('gestionnaire');
      const { status } = await api(
        '/v1/admin/operations/releve?debut=2026-08-01&fin=2026-08-31',
        { token }
      );
      assert.equal(status, 200);
    });

    test('un client n\'a pas accès au relevé', async () => {
      const client = await createTestClient('Releve2');
      const { status } = await api(
        '/v1/admin/operations/releve?debut=2026-08-01&fin=2026-08-31',
        { token: client.token }
      );
      assert.equal(status, 403);
    });

    test('des dates manquantes sont rejetées', async () => {
      const token = await loginStaff('operateur');
      const { status } = await api('/v1/admin/operations/releve?debut=2026-08-01', { token });
      assert.equal(status, 422);
    });
  }
);
