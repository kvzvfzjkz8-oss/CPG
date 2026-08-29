import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer, stopTestServer, api, loginStaff, hasTestDatabase,
} from '../helpers/testServer.js';

before(async () => {
  await startTestServer();
});

after(async () => {
  await stopTestServer();
});

/** Crée un client de test sans PIN (activation en attente). */
async function createUnactivatedClient(label) {
  const gestionnaireToken = await loginStaff('gestionnaire');
  const phone = `+24108${String(Math.floor(Math.random() * 900000) + 100000)}`;
  const { body } = await api('/v1/admin/utilisateurs', {
    method: 'POST', token: gestionnaireToken,
    body: { nomComplet: `Client Activation ${label}`, telephone: phone, role: 'client' },
  });
  return { id: body.id, phone, clientNumber: body.client_number };
}

describe(
  'activation de compte client en libre-service',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    test('un compte peut être créé sans PIN', async () => {
      const client = await createUnactivatedClient('Basic');
      assert.ok(client.clientNumber);
    });

    test('la connexion échoue proprement tant que le compte n\'est pas activé', async () => {
      const client = await createUnactivatedClient('NoLogin');
      const { status, body } = await api('/v1/auth/connexion-client', {
        method: 'POST', body: { phone: client.phone, pin: '1234' },
      });
      assert.equal(status, 403);
      assert.equal(body.code, 'pin_non_defini');
    });

    test('activer avec un mauvais numéro client échoue', async () => {
      const client = await createUnactivatedClient('WrongNumber');
      const { status } = await api('/v1/auth/activer-compte', {
        method: 'POST',
        body: { phone: client.phone, clientNumber: 'CPG-00000', nouveauPin: '5678' },
      });
      assert.equal(status, 422);
    });

    test('activer avec le bon numéro client réussit et connecte immédiatement', async () => {
      const client = await createUnactivatedClient('Success');
      const { status, body } = await api('/v1/auth/activer-compte', {
        method: 'POST',
        body: { phone: client.phone, clientNumber: client.clientNumber, nouveauPin: '5678' },
      });
      assert.equal(status, 201);
      assert.ok(body.accessToken);
      assert.equal(body.user.clientNumber, client.clientNumber);
    });

    test('un compte déjà activé ne peut pas être réactivé par cette voie', async () => {
      const client = await createUnactivatedClient('Reactivate');
      await api('/v1/auth/activer-compte', {
        method: 'POST',
        body: { phone: client.phone, clientNumber: client.clientNumber, nouveauPin: '5678' },
      });
      const { status } = await api('/v1/auth/activer-compte', {
        method: 'POST',
        body: { phone: client.phone, clientNumber: client.clientNumber, nouveauPin: '9999' },
      });
      assert.equal(status, 422);
    });

    test('un PIN mal formé est rejeté à l\'activation', async () => {
      const client = await createUnactivatedClient('BadPin');
      const { status } = await api('/v1/auth/activer-compte', {
        method: 'POST',
        body: { phone: client.phone, clientNumber: client.clientNumber, nouveauPin: 'abcd' },
      });
      assert.equal(status, 422);
    });
  }
);

describe(
  'réinitialisation du PIN client par le gestionnaire',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    test('un opérateur ne peut pas réinitialiser le PIN d\'un client', async () => {
      const client = await createUnactivatedClient('OpBlocked');
      const operateurToken = await loginStaff('operateur');
      const { status } = await api(`/v1/admin/utilisateurs/${client.id}/reinitialiser-pin-client`, {
        method: 'POST', token: operateurToken,
      });
      assert.equal(status, 403);
    });

    test('le gestionnaire réinitialise, l\'ancien PIN cesse de fonctionner', async () => {
      const client = await createUnactivatedClient('GestReset');
      await api('/v1/auth/activer-compte', {
        method: 'POST',
        body: { phone: client.phone, clientNumber: client.clientNumber, nouveauPin: '2222' },
      });

      const gestionnaireToken = await loginStaff('gestionnaire');
      const { status, body } = await api(`/v1/admin/utilisateurs/${client.id}/reinitialiser-pin-client`, {
        method: 'POST', token: gestionnaireToken,
      });
      assert.equal(status, 200);
      assert.equal(body.pinDefini, false);

      const apres = await api('/v1/auth/connexion-client', {
        method: 'POST', body: { phone: client.phone, pin: '2222' },
      });
      assert.equal(apres.status, 403);
      assert.equal(apres.body.code, 'pin_non_defini');
    });

    test('après réinitialisation, le client réactive avec un nouveau PIN', async () => {
      const client = await createUnactivatedClient('ReactivateAfterReset');
      await api('/v1/auth/activer-compte', {
        method: 'POST',
        body: { phone: client.phone, clientNumber: client.clientNumber, nouveauPin: '3333' },
      });
      const gestionnaireToken = await loginStaff('gestionnaire');
      await api(`/v1/admin/utilisateurs/${client.id}/reinitialiser-pin-client`, {
        method: 'POST', token: gestionnaireToken,
      });

      const { status, body } = await api('/v1/auth/activer-compte', {
        method: 'POST',
        body: { phone: client.phone, clientNumber: client.clientNumber, nouveauPin: '7777' },
      });
      assert.equal(status, 201);
      assert.ok(body.accessToken);
    });

    test('réinitialiser le PIN d\'un employé (pas un client) échoue', async () => {
      const gestionnaireToken = await loginStaff('gestionnaire');
      const { body: utilisateurs } = await api('/v1/admin/utilisateurs', { token: gestionnaireToken });
      const employe = utilisateurs.utilisateurs.find((u) => u.role === 'operateur');

      const { status } = await api(`/v1/admin/utilisateurs/${employe.id}/reinitialiser-pin-client`, {
        method: 'POST', token: gestionnaireToken,
      });
      assert.equal(status, 404);
    });

    test('réinitialiser le PIN d\'un client introuvable renvoie 404', async () => {
      const gestionnaireToken = await loginStaff('gestionnaire');
      const { status } = await api('/v1/admin/utilisateurs/00000000-0000-0000-0000-000000000000/reinitialiser-pin-client', {
        method: 'POST', token: gestionnaireToken,
      });
      assert.equal(status, 404);
    });
  }
);

describe(
  'vérification du numéro avant affichage du PIN',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    test('un compte fraîchement créé sans PIN signale une activation requise', async () => {
      const client = await createUnactivatedClient('VerifNeeded');
      const { status, body } = await api('/v1/auth/verifier-numero', {
        method: 'POST', body: { phone: client.phone },
      });
      assert.equal(status, 200);
      assert.equal(body.activationRequise, true);
    });

    test('un numéro totalement inconnu ne signale rien de particulier', async () => {
      const { status, body } = await api('/v1/auth/verifier-numero', {
        method: 'POST', body: { phone: '+24101020304' },
      });
      assert.equal(status, 200);
      assert.equal(body.activationRequise, false);
    });
  }
);
