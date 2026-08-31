import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer, stopTestServer, api, loginStaff, hasTestDatabase,
} from '../helpers/testServer.js';

let caissierToken;
let directeurToken;
let clientId;

before(async () => {
  await startTestServer();
  if (!hasTestDatabase()) return;

  const gestionnaireToken = await loginStaff('gestionnaire');
  directeurToken = await loginStaff('directeur');

  // Une caissière dédiée à ce fichier de tests, avec le même mot de
  // passe de démonstration que les autres comptes — ça permet de
  // réutiliser loginStaff() (et son cache de jetons, précieux pour ne
  // pas épuiser le limiteur de connexions) au lieu de gérer un jeton
  // à part.
  const caissiereEmail = `caissiere.test.${Date.now()}@cpg.ga`;
  const caissierePhone = `+24105${String(Math.floor(Math.random() * 900000) + 100000)}`;
  await api('/v1/admin/utilisateurs', {
    method: 'POST', token: gestionnaireToken,
    body: {
      nomComplet: 'Caissière Test', telephone: caissierePhone,
      email: caissiereEmail, role: 'caissier', motDePasse: 'MotDePasseDemo2026!',
    },
  });
  caissierToken = await loginStaff(caissiereEmail);

  // Un client avec un solde nul suffit pour tester la recherche, le
  // RIB, et le refus d'un retrait qui dépasserait le solde — les tests
  // de solde réellement débité sont déjà couverts par
  // client-activation.test.js et n'ont pas besoin d'être reproduits ici.
  const clientPhone = `+24104${String(Math.floor(Math.random() * 900000) + 100000)}`;
  const { body: client } = await api('/v1/admin/utilisateurs', {
    method: 'POST', token: gestionnaireToken,
    body: { nomComplet: 'Client Caisse Test', telephone: clientPhone, role: 'client' },
  });
  await api('/v1/auth/activer-compte', {
    method: 'POST',
    body: { phone: clientPhone, clientNumber: client.client_number, nouveauPin: '1234' },
  });
  clientId = client.id;
});


after(async () => {
  await stopTestServer();
});

describe(
  'La Caisse',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    test('une caissière peut rechercher un client par nom', async () => {
      const { status, body } = await api('/v1/caisse/rechercher-client?q=Caisse Test', {
        token: caissierToken,
      });
      assert.equal(status, 200);
      assert.ok(body.resultats.some((r) => r.id === clientId));
    });

    test('un opérateur n\'a pas accès à la recherche caisse', async () => {
      const operateurToken = await loginStaff('operateur');
      const { status } = await api('/v1/caisse/rechercher-client?q=test', { token: operateurToken });
      assert.equal(status, 403);
    });

    test('une demande de retrait sur un solde nul est refusée', async () => {
      const { status } = await api('/v1/caisse/retraits', {
        method: 'POST', token: caissierToken,
        body: { clientId, montant: 5000 },
      });
      assert.equal(status, 422);
    });

    test('une demande d\'appro est créée en attente', async () => {
      const { status, body } = await api('/v1/caisse/appro', {
        method: 'POST', token: caissierToken,
        body: { montant: 100000, motif: 'Test' },
      });
      assert.equal(status, 201);
      assert.equal(body.statut, 'en_attente');
    });

    test('un opérateur ne peut pas valider une demande de caisse', async () => {
      const operateurToken = await loginStaff('operateur');
      const { body: appro } = await api('/v1/caisse/appro', {
        method: 'POST', token: caissierToken, body: { montant: 50000 },
      });
      const { status } = await api(`/v1/caisse/operations/${appro.id}/valider`, {
        method: 'POST', token: operateurToken,
      });
      assert.equal(status, 403);
    });

    test('le directeur valide une appro, le solde de la caisse augmente', async () => {
      const { body: avant } = await api('/v1/caisse/ma-caisse', { token: caissierToken });
      const { body: appro } = await api('/v1/caisse/appro', {
        method: 'POST', token: caissierToken, body: { montant: 75000 },
      });
      await api(`/v1/caisse/operations/${appro.id}/valider`, {
        method: 'POST', token: directeurToken,
      });
      const { body: apres } = await api('/v1/caisse/ma-caisse', { token: caissierToken });
      assert.equal(apres.solde, avant.solde + 75000);
    });

    test('le directeur peut rejeter une demande avec motif', async () => {
      const { body: appro } = await api('/v1/caisse/appro', {
        method: 'POST', token: caissierToken, body: { montant: 20000 },
      });
      const { status, body } = await api(`/v1/caisse/operations/${appro.id}/rejeter`, {
        method: 'POST', token: directeurToken,
        body: { motif: 'Budget déjà suffisant' },
      });
      assert.equal(status, 200);
      assert.equal(body.statut, 'rejetee');
    });

    test('rejeter sans motif est refusé', async () => {
      const { body: appro } = await api('/v1/caisse/appro', {
        method: 'POST', token: caissierToken, body: { montant: 20000 },
      });
      const { status } = await api(`/v1/caisse/operations/${appro.id}/rejeter`, {
        method: 'POST', token: directeurToken, body: {},
      });
      assert.equal(status, 422);
    });

    test('valider deux fois la même demande échoue proprement', async () => {
      const { body: appro } = await api('/v1/caisse/appro', {
        method: 'POST', token: caissierToken, body: { montant: 10000 },
      });
      await api(`/v1/caisse/operations/${appro.id}/valider`, { method: 'POST', token: directeurToken });
      const { status } = await api(`/v1/caisse/operations/${appro.id}/valider`, {
        method: 'POST', token: directeurToken,
      });
      assert.equal(status, 409);
    });

    test('approvisionner la caisse deux fois de suite cumule bien le solde', async () => {
      const { body: avant } = await api('/v1/caisse/ma-caisse', { token: caissierToken });
      const { body: appro1 } = await api('/v1/caisse/appro', {
        method: 'POST', token: caissierToken, body: { montant: 30000 },
      });
      await api(`/v1/caisse/operations/${appro1.id}/valider`, { method: 'POST', token: directeurToken });
      const { body: appro2 } = await api('/v1/caisse/appro', {
        method: 'POST', token: caissierToken, body: { montant: 20000 },
      });
      await api(`/v1/caisse/operations/${appro2.id}/valider`, { method: 'POST', token: directeurToken });

      const { body: apres } = await api('/v1/caisse/ma-caisse', { token: caissierToken });
      assert.equal(apres.solde, avant.solde + 50000);
    });

    test('le RIB inclut le nom du gestionnaire créateur', async () => {
      const { status, body } = await api(`/v1/caisse/rib/${clientId}`, { token: caissierToken });
      assert.equal(status, 200);
      assert.equal(body.full_name, 'Client Caisse Test');
      assert.ok(body.gestionnaire);
    });
  }
);
