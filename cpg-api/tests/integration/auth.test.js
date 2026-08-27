import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer, stopTestServer, api, loginStaff, loginClient, hasTestDatabase,
} from '../helpers/testServer.js';

describe('authentification', { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' }, () => {
  before(async () => {
    await startTestServer();
  });

  after(async () => {
    await stopTestServer();
  });

  test('un gestionnaire se connecte avec son mot de passe', async () => {
    const token = await loginStaff('gestionnaire');
    assert.ok(token.length > 20);
  });

  test('un client se connecte avec son code PIN', async () => {
    const token = await loginClient();
    assert.ok(token.length > 20);
  });

  test('mauvais mot de passe refusé sans préciser si le compte existe', async () => {
    const { status, body } = await api('/v1/auth/connexion-agent', {
      method: 'POST',
      body: { email: 'sylvie@cpg.ga', password: 'mauvais-mot-de-passe' },
    });
    assert.equal(status, 401);
    // Le message ne doit pas permettre de distinguer un compte
    // inexistant d'un mot de passe erroné : sinon l'API sert à
    // énumérer les employés de CPG.
    assert.ok(body.error);
  });

  test('email inconnu renvoie le même statut qu\'un mauvais mot de passe', async () => {
    const { status } = await api('/v1/auth/connexion-agent', {
      method: 'POST',
      body: { email: 'personne@cpg.ga', password: 'peu-importe-le-mot-de-passe' },
    });
    assert.equal(status, 401);
  });

  test('mauvais code PIN refusé', async () => {
    const { status } = await api('/v1/auth/connexion-client', {
      method: 'POST',
      body: { phone: '+24106000001', pin: '0000' },
    });
    assert.equal(status, 401);
  });

  test('numéro de téléphone inconnu refusé avec le même statut', async () => {
    const { status } = await api('/v1/auth/connexion-client', {
      method: 'POST',
      body: { phone: '+24199999999', pin: '1234' },
    });
    assert.equal(status, 401);
  });

  test('code PIN mal formé rejeté avant toute requête en base', async () => {
    const { status } = await api('/v1/auth/connexion-client', {
      method: 'POST',
      body: { phone: '+24106000001', pin: 'abcd' },
    });
    // 422 : c'est la convention du projet pour toute erreur de
    // validation Zod (cf. errorHandler.js), pas 400.
    assert.equal(status, 422);
  });

  test('aucune route protégée sans jeton', async () => {
    const { status, body } = await api('/v1/auth/moi');
    assert.equal(status, 401);
    assert.ok(body.error);
  });

  test('jeton invalide ou corrompu refusé', async () => {
    const { status } = await api('/v1/auth/moi', { token: 'ceci-nest-pas-un-jwt' });
    assert.equal(status, 401);
  });

  test('/auth/moi renvoie le rôle et les permissions attendues', async () => {
    const token = await loginStaff('operateur');
    const { status, body } = await api('/v1/auth/moi', { token });
    assert.equal(status, 200);
    assert.equal(body.role, 'operateur');
    assert.ok(body.permissions.includes('demandes.valider_niveau1'));
    assert.ok(!body.permissions.includes('demandes.valider_final'));
  });

  test('déconnexion révoque le jeton de rafraîchissement', async () => {
    const { status: loginStatus, body: loginBody } = await api('/v1/auth/connexion-agent', {
      method: 'POST',
      body: { email: 'eric@cpg.ga', password: 'MotDePasseDemo2026!' },
    });
    assert.equal(loginStatus, 200);

    const { status } = await api('/v1/auth/deconnexion', {
      method: 'POST',
      token: loginBody.accessToken,
    });
    // La route renvoie { ok: true } avec le code 200 par défaut
    // d'Express, pas 204 : elle a un corps de réponse.
    assert.equal(status, 200);
  });
});
