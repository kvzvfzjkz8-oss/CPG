import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  startTestServer, stopTestServer, api, loginStaff, loginClient, hasTestDatabase,
} from '../helpers/testServer.js';

/**
 * Ces tests tournent sans identifiants Airtel dans l'environnement :
 * mobileMoneyService bascule alors en mode simulé (cf. commentaire dans
 * src/services/mobileMoneyService.js). Rien n'appelle donc l'API Airtel
 * réelle ici — c'est le comportement voulu pour un environnement de test.
 */
describe(
  'Mobile Money — mode simulé',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    let clientToken;

    before(async () => {
      await startTestServer();
      clientToken = await loginClient();
    });

    after(async () => {
      await stopTestServer();
    });

    test('un dépôt entrant est accepté et reste en attente de confirmation', async () => {
      const { status, body } = await api('/v1/client/momo', {
        method: 'POST',
        token: clientToken,
        body: {
          operateur: 'airtel', sens: 'entrant', montant: 5000,
          telephone: '+24106000001',
        },
      });
      assert.equal(status, 202);
      assert.equal(body.statut, 'en_attente');
      assert.ok(body.reference.startsWith('TX-'));
    });

    test('un retrait qui dépasse le solde est refusé avant tout appel opérateur', async () => {
      // 1 999 999 reste sous le maximum autorisé par le schéma (2 000 000)
      // mais dépasse largement le solde d'ouverture du client de démo :
      // on veut exercer la vérification de solde, pas la validation Zod.
      const { status, body } = await api('/v1/client/momo', {
        method: 'POST',
        token: clientToken,
        body: {
          operateur: 'airtel', sens: 'sortant', montant: 1999999,
          telephone: '+24106000001',
        },
      });
      assert.equal(status, 400);
      assert.match(body.error, /[Ss]olde/);
    });

    test('une clé d\'idempotence réutilisée renvoie la même transaction, pas une nouvelle', async () => {
      const cleIdempotence = crypto.randomUUID();

      const first = await api('/v1/client/momo', {
        method: 'POST',
        token: clientToken,
        body: {
          operateur: 'airtel', sens: 'entrant', montant: 2000,
          telephone: '+24106000001', cleIdempotence,
        },
      });
      assert.equal(first.status, 202);

      const second = await api('/v1/client/momo', {
        method: 'POST',
        token: clientToken,
        body: {
          operateur: 'airtel', sens: 'entrant', montant: 2000,
          telephone: '+24106000001', cleIdempotence,
        },
      });
      assert.equal(second.status, 202);
      assert.equal(second.body.reference, first.body.reference);
    });

    test('un client ne peut pas consulter la transaction d\'un autre', async () => {
      const { body } = await api('/v1/client/momo', {
        method: 'POST',
        token: clientToken,
        body: {
          operateur: 'airtel', sens: 'entrant', montant: 1000,
          telephone: '+24106000001',
        },
      });

      // Le gestionnaire a une route de supervision distincte ; le client
      // n'a que /client/momo/:reference, filtré sur son propre user_id.
      const gestionnaireToken = await loginStaff('gestionnaire');
      const { status } = await api(`/v1/client/momo/${body.reference}`, {
        token: gestionnaireToken,
      });
      // La permission momo.initier n'est pas accordée au gestionnaire :
      // c'est la matrice qui bloque avant même la question de propriété.
      assert.equal(status, 403);
    });

    test('le gestionnaire supervise l\'ensemble des transactions', async () => {
      const gestionnaireToken = await loginStaff('gestionnaire');
      const { status, body } = await api('/v1/admin/momo', { token: gestionnaireToken });
      assert.equal(status, 200);
      assert.ok(body.transactions.length > 0);
    });

    test('un opérateur n\'a pas accès à la supervision Mobile Money', async () => {
      const operateurToken = await loginStaff('operateur');
      const { status } = await api('/v1/admin/momo', { token: operateurToken });
      assert.equal(status, 403);
    });
  }
);
