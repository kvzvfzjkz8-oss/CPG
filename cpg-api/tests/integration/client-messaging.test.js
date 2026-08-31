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

/** Crée un client déjà activé, prêt à envoyer des messages. */
async function createActivatedClient(label) {
  const gestionnaireToken = await loginStaff('gestionnaire');
  const phone = `+24109${String(Math.floor(Math.random() * 900000) + 100000)}`;
  const { body: created } = await api('/v1/admin/utilisateurs', {
    method: 'POST', token: gestionnaireToken,
    body: { nomComplet: `Client Messagerie ${label}`, telephone: phone, role: 'client' },
  });
  const { body: session } = await api('/v1/auth/activer-compte', {
    method: 'POST',
    body: { phone, clientNumber: created.client_number, nouveauPin: '1234' },
  });
  return session.accessToken;
}

describe(
  'réponse automatique unique à la première prise de contact',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    test('le tout premier message déclenche une réponse automatique', async () => {
      const token = await createActivatedClient('Premier');
      await api('/v1/client/messages', { method: 'POST', token, body: { texte: 'Bonjour.' } });

      const { body } = await api('/v1/client/messages', { token });
      const staffMessages = body.messages.filter((m) => !m.mine);
      assert.equal(staffMessages.length, 1);
    });

    test('les messages suivants ne déclenchent aucune nouvelle réponse automatique', async () => {
      const token = await createActivatedClient('Suivants');
      await api('/v1/client/messages', { method: 'POST', token, body: { texte: 'Message 1.' } });
      await api('/v1/client/messages', { method: 'POST', token, body: { texte: 'Message 2.' } });
      await api('/v1/client/messages', { method: 'POST', token, body: { texte: 'Message 3.' } });

      const { body } = await api('/v1/client/messages', { token });
      const staffMessages = body.messages.filter((m) => !m.mine);
      const clientMessages = body.messages.filter((m) => m.mine);
      assert.equal(staffMessages.length, 1);
      assert.equal(clientMessages.length, 3);
    });
  }
);
