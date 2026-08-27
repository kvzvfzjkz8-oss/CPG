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

/** Crée un opérateur de test dédié, pour ne pas toucher aux comptes de démo partagés. */
async function createTestStaff(label) {
  const directeurToken = await loginStaff('directeur');
  const phone = `+24107${String(Math.floor(Math.random() * 900000) + 100000)}`;
  const email = `pin.${label}.${Date.now()}@cpg.ga`;
  const { body } = await api('/v1/admin/utilisateurs', {
    method: 'POST',
    token: directeurToken,
    body: {
      nomComplet: `Employé PIN ${label}`, telephone: phone, email,
      role: 'operateur', motDePasse: 'MotDePasseTest2026!',
    },
  });
  return { id: body.id, email, phone };
}

describe(
  'gestion du code PIN back-office',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    test('un gestionnaire ne peut pas définir de PIN', async () => {
      const staff = await createTestStaff('Perm1');
      const gestionnaireToken = await loginStaff('gestionnaire');
      const { status } = await api(`/v1/admin/utilisateurs/${staff.id}/pin`, {
        method: 'PUT', token: gestionnaireToken, body: { pin: '12345678' },
      });
      assert.equal(status, 403);
    });

    test('un opérateur ne peut pas définir de PIN, même le sien', async () => {
      const staff = await createTestStaff('Perm2');
      const operateurToken = await loginStaff('operateur');
      const { status } = await api(`/v1/admin/utilisateurs/${staff.id}/pin`, {
        method: 'PUT', token: operateurToken, body: { pin: '12345678' },
      });
      assert.equal(status, 403);
    });

    test('le directeur définit un PIN à 8 chiffres', async () => {
      const staff = await createTestStaff('Set1');
      const directeurToken = await loginStaff('directeur');
      const { status, body } = await api(`/v1/admin/utilisateurs/${staff.id}/pin`, {
        method: 'PUT', token: directeurToken, body: { pin: '73920481' },
      });
      assert.equal(status, 200);
      assert.equal(body.pinBackofficeDefini, true);
    });

    test('un PIN mal formé est rejeté (pas exactement 8 chiffres)', async () => {
      const staff = await createTestStaff('Set2');
      const directeurToken = await loginStaff('directeur');

      const tropCourt = await api(`/v1/admin/utilisateurs/${staff.id}/pin`, {
        method: 'PUT', token: directeurToken, body: { pin: '1234567' },
      });
      assert.equal(tropCourt.status, 422);

      const nonNumerique = await api(`/v1/admin/utilisateurs/${staff.id}/pin`, {
        method: 'PUT', token: directeurToken, body: { pin: 'abcd1234' },
      });
      assert.equal(nonNumerique.status, 422);
    });

    test('impossible de définir un PIN back-office sur un compte client', async () => {
      const gestionnaireToken = await loginStaff('gestionnaire');
      const phone = `+24107${String(Math.floor(Math.random() * 900000) + 100000)}`;
      const { body: client } = await api('/v1/admin/utilisateurs', {
        method: 'POST', token: gestionnaireToken,
        body: { nomComplet: 'Client Test PIN', telephone: phone, role: 'client', codePin: '1234' },
      });

      const directeurToken = await loginStaff('directeur');
      const { status } = await api(`/v1/admin/utilisateurs/${client.id}/pin`, {
        method: 'PUT', token: directeurToken, body: { pin: '73920481' },
      });
      assert.equal(status, 422);
    });

    test('un employé se connecte avec son PIN une fois défini', async () => {
      const staff = await createTestStaff('Login1');
      const directeurToken = await loginStaff('directeur');
      await api(`/v1/admin/utilisateurs/${staff.id}/pin`, {
        method: 'PUT', token: directeurToken, body: { pin: '55667788' },
      });

      const { status, body } = await api('/v1/auth/connexion-backoffice', {
        method: 'POST', body: { email: staff.email, pin: '55667788' },
      });
      assert.equal(status, 200);
      assert.ok(body.accessToken);
      assert.equal(body.user.role, 'operateur');
    });

    test('un email inconnu renvoie le même statut qu\'un mauvais PIN', async () => {
      const { status, body } = await api('/v1/auth/connexion-backoffice', {
        method: 'POST', body: { email: 'personne.inconnue@cpg.ga', pin: '12345678' },
      });
      assert.equal(status, 401);
      assert.equal(body.error, 'Identifiants incorrects.');
    });

    test('le directeur supprime un PIN, la connexion par PIN cesse de fonctionner', async () => {
      const staff = await createTestStaff('Delete1');
      const directeurToken = await loginStaff('directeur');
      await api(`/v1/admin/utilisateurs/${staff.id}/pin`, {
        method: 'PUT', token: directeurToken, body: { pin: '99887766' },
      });

      const { status: deleteStatus, body: deleteBody } = await api(`/v1/admin/utilisateurs/${staff.id}/pin`, {
        method: 'DELETE', token: directeurToken,
      });
      assert.equal(deleteStatus, 200);
      assert.equal(deleteBody.pinBackofficeDefini, false);

      const apres = await api('/v1/auth/connexion-backoffice', {
        method: 'POST', body: { email: staff.email, pin: '99887766' },
      });
      assert.equal(apres.status, 401);
    });

    test('un gestionnaire ne peut pas supprimer de PIN', async () => {
      const staff = await createTestStaff('Delete2');
      const directeurToken = await loginStaff('directeur');
      await api(`/v1/admin/utilisateurs/${staff.id}/pin`, {
        method: 'PUT', token: directeurToken, body: { pin: '44556677' },
      });

      const gestionnaireToken = await loginStaff('gestionnaire');
      const { status } = await api(`/v1/admin/utilisateurs/${staff.id}/pin`, {
        method: 'DELETE', token: gestionnaireToken,
      });
      assert.equal(status, 403);
    });

    test('remplacer un PIN révoque les sessions ouvertes avec l\'ancien', async () => {
      const staff = await createTestStaff('Rotate1');
      const directeurToken = await loginStaff('directeur');
      await api(`/v1/admin/utilisateurs/${staff.id}/pin`, {
        method: 'PUT', token: directeurToken, body: { pin: '10203040' },
      });

      const { body: session } = await api('/v1/auth/connexion-backoffice', {
        method: 'POST', body: { email: staff.email, pin: '10203040' },
      });
      assert.ok(session.refreshToken);

      await api(`/v1/admin/utilisateurs/${staff.id}/pin`, {
        method: 'PUT', token: directeurToken, body: { pin: '50607080' },
      });

      const { status } = await api('/v1/auth/rafraichir', {
        method: 'POST', body: { refreshToken: session.refreshToken },
      });
      assert.equal(status, 401);
    });

    test('la liste des utilisateurs indique si un PIN back-office est défini, sans jamais l\'exposer', async () => {
      const staff = await createTestStaff('List1');
      const directeurToken = await loginStaff('directeur');
      await api(`/v1/admin/utilisateurs/${staff.id}/pin`, {
        method: 'PUT', token: directeurToken, body: { pin: '65432187' },
      });

      const { body } = await api('/v1/admin/utilisateurs', { token: directeurToken });
      const found = body.utilisateurs.find((u) => u.id === staff.id);
      assert.equal(found.pin_backoffice_defini, true);
      assert.equal('pin_hash' in found, false);
    });

    test('un compte désactivé ne peut pas se connecter par PIN', async () => {
      const staff = await createTestStaff('Suspend1');
      const directeurToken = await loginStaff('directeur');
      await api(`/v1/admin/utilisateurs/${staff.id}/pin`, {
        method: 'PUT', token: directeurToken, body: { pin: '13571357' },
      });
      await api(`/v1/admin/utilisateurs/${staff.id}/statut`, {
        method: 'PATCH', token: directeurToken, body: { statut: 'suspendu' },
      });

      const { status } = await api('/v1/auth/connexion-backoffice', {
        method: 'POST', body: { email: staff.email, pin: '13571357' },
      });
      assert.equal(status, 403);
    });

    test('un PIN back-office et le mot de passe restent tous deux valables pour le même compte', async () => {
      const staff = await createTestStaff('Both1');
      const directeurToken = await loginStaff('directeur');
      await api(`/v1/admin/utilisateurs/${staff.id}/pin`, {
        method: 'PUT', token: directeurToken, body: { pin: '24681357' },
      });

      const parMotDePasse = await api('/v1/auth/connexion-agent', {
        method: 'POST', body: { email: staff.email, password: 'MotDePasseTest2026!' },
      });
      assert.equal(parMotDePasse.status, 200);

      const parPin = await api('/v1/auth/connexion-backoffice', {
        method: 'POST', body: { email: staff.email, pin: '24681357' },
      });
      assert.equal(parPin.status, 200);
    });
  }
);
