import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer, stopTestServer, api, loginStaff, hasTestDatabase,
} from '../helpers/testServer.js';

describe(
  'gestion des utilisateurs',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    before(async () => {
      await startTestServer();
    });

    after(async () => {
      await stopTestServer();
    });

    test('un opérateur ne peut pas lister les utilisateurs', async () => {
      const token = await loginStaff('operateur');
      const { status } = await api('/v1/admin/utilisateurs', { token });
      assert.equal(status, 403);
    });

    test('un gestionnaire crée un employé opérateur', async () => {
      const token = await loginStaff('gestionnaire');
      const { status, body } = await api('/v1/admin/utilisateurs', {
        method: 'POST',
        token,
        body: {
          nomComplet: 'Employé de Test',
          telephone: `+2410600${Math.floor(Math.random() * 9000) + 1000}`,
          email: `test.${Date.now()}@cpg.ga`,
          role: 'operateur',
          motDePasse: 'MotDePasseTest2026!',
        },
      });
      assert.equal(status, 201);
      assert.equal(body.role, 'operateur');
      assert.equal(body.status, 'actif');
    });

    test('créer un compte employé sans mot de passe est refusé', async () => {
      const token = await loginStaff('gestionnaire');
      const { status, body } = await api('/v1/admin/utilisateurs', {
        method: 'POST',
        token,
        body: {
          nomComplet: 'Employé Incomplet',
          telephone: '+24106009999',
          email: `incomplet.${Date.now()}@cpg.ga`,
          role: 'operateur',
        },
      });
      assert.equal(status, 422);
      assert.match(body.error, /mot de passe/);
    });

    test('un compte suspendu perd immédiatement l\'accès, même avec un jeton encore valide', async () => {
      const gestionnaireToken = await loginStaff('gestionnaire');
      const email = `suspendre.${Date.now()}@cpg.ga`;

      const { body: created } = await api('/v1/admin/utilisateurs', {
        method: 'POST',
        token: gestionnaireToken,
        body: {
          nomComplet: 'À Suspendre',
          telephone: `+2410601${Math.floor(Math.random() * 9000) + 1000}`,
          email,
          role: 'operateur',
          motDePasse: 'MotDePasseTest2026!',
        },
      });

      const { status: loginStatus, body: session } = await api('/v1/auth/connexion-agent', {
        method: 'POST',
        body: { email, password: 'MotDePasseTest2026!' },
      });
      assert.equal(loginStatus, 200);
      const employeeToken = session.accessToken;

      // Le jeton fonctionne avant la suspension.
      const before = await api('/v1/auth/moi', { token: employeeToken });
      assert.equal(before.status, 200);

      const { status: suspendStatus } = await api(`/v1/admin/utilisateurs/${created.id}/statut`, {
        method: 'PATCH',
        token: gestionnaireToken,
        body: { statut: 'suspendu' },
      });
      assert.equal(suspendStatus, 200);

      // Même jeton, non expiré, mais refusé : le statut est relu en base
      // à chaque requête plutôt que fait confiance au contenu du JWT.
      const after = await api('/v1/auth/moi', { token: employeeToken });
      assert.equal(after.status, 403);
    });

    test('un gestionnaire ne peut pas modifier son propre statut', async () => {
      const token = await loginStaff('gestionnaire');
      const { body: moi } = await api('/v1/auth/moi', { token });

      const { status, body } = await api(`/v1/admin/utilisateurs/${moi.id}/statut`, {
        method: 'PATCH',
        token,
        body: { statut: 'suspendu' },
      });
      assert.equal(status, 400);
      assert.match(body.error, /propre statut/);
    });

    test('le journal d\'audit trace la création d\'utilisateur', async () => {
      const directeurToken = await loginStaff('directeur');
      const { status, body } = await api('/v1/admin/audit', { token: directeurToken });
      assert.equal(status, 200);
      assert.ok(body.entrees.some((e) => e.action === 'utilisateur.cree'));
    });

    test('un opérateur n\'a pas accès au journal d\'audit', async () => {
      const token = await loginStaff('operateur');
      const { status } = await api('/v1/admin/audit', { token });
      assert.equal(status, 403);
    });
  }
);
