import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer, stopTestServer, api, loginStaff, loginClient, hasTestDatabase,
} from '../helpers/testServer.js';

/**
 * Un seul avant/après pour tout le fichier : startTestServer() met en
 * cache le serveur et stopTestServer() ferme le pool de connexions de
 * façon définitive (pool.end()). L'appeler depuis plusieurs blocs
 * describe casserait les blocs suivants avec « Cannot use a pool
 * after calling end on the pool ».
 */
before(async () => {
  await startTestServer();
});

after(async () => {
  await stopTestServer();
});

describe(
  'catalogue — création et permissions',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    test('un opérateur ne peut pas créer de produit', async () => {
      const token = await loginStaff('operateur');
      const { status } = await api('/v1/admin/catalogue/produits', {
        method: 'POST',
        token,
        body: {
          code: 'TEST_OP',
          nom: 'Tentative opérateur',
          bareme: {
            monthlyRate: 0.02, minAmount: 10000, maxAmount: 100000,
            minDuration: 1, maxDuration: 6,
          },
        },
      });
      assert.equal(status, 403);
    });

    test('un gestionnaire crée un produit, en brouillon', async () => {
      const token = await loginStaff('gestionnaire');
      const code = `TEST_${Date.now()}`;
      const { status, body } = await api('/v1/admin/catalogue/produits', {
        method: 'POST',
        token,
        body: {
          code,
          nom: 'Crédit de test',
          description: 'Produit créé par les tests d\'intégration',
          bareme: {
            monthlyRate: 0.02, minAmount: 10000, maxAmount: 500000,
            minDuration: 1, maxDuration: 12,
          },
        },
      });
      assert.equal(status, 201);
      assert.equal(body.product.status, 'brouillon');
      assert.match(body.message, /activé par le directeur/);
    });

    test('un produit au-delà du plafond réglementaire est refusé à la création', async () => {
      // Plafond credit_monthly du seed : 3 %/mois.
      const token = await loginStaff('gestionnaire');
      const { status, body } = await api('/v1/admin/catalogue/produits', {
        method: 'POST',
        token,
        body: {
          code: `TEST_PLAFOND_${Date.now()}`,
          nom: 'Taux abusif',
          bareme: {
            monthlyRate: 0.10, minAmount: 10000, maxAmount: 100000,
            minDuration: 1, maxDuration: 6,
          },
        },
      });
      assert.equal(status, 422);
      assert.match(body.error, /plafond/);
    });

    test('un gestionnaire ne peut pas activer un produit', async () => {
      const gestionnaireToken = await loginStaff('gestionnaire');
      const code = `TEST_ACT_${Date.now()}`;
      const { body: created } = await api('/v1/admin/catalogue/produits', {
        method: 'POST',
        token: gestionnaireToken,
        body: {
          code,
          nom: 'Produit à activer',
          bareme: {
            monthlyRate: 0.02, minAmount: 10000, maxAmount: 200000,
            minDuration: 1, maxDuration: 6,
          },
        },
      });

      const { status } = await api(`/v1/admin/catalogue/produits/${created.product.id}/statut`, {
        method: 'PATCH',
        token: gestionnaireToken,
        body: { statut: 'actif' },
      });
      assert.equal(status, 403);
    });

    test('un directeur active le produit, qui devient visible des clients', async () => {
      const gestionnaireToken = await loginStaff('gestionnaire');
      const directeurToken = await loginStaff('directeur');
      const code = `TEST_VISIBLE_${Date.now()}`;

      const { body: created } = await api('/v1/admin/catalogue/produits', {
        method: 'POST',
        token: gestionnaireToken,
        body: {
          code,
          nom: 'Produit visible après activation',
          bareme: {
            monthlyRate: 0.02, minAmount: 10000, maxAmount: 200000,
            minDuration: 1, maxDuration: 6,
          },
        },
      });

      const { status: activationStatus } = await api(
        `/v1/admin/catalogue/produits/${created.product.id}/statut`,
        { method: 'PATCH', token: directeurToken, body: { statut: 'actif' } }
      );
      assert.equal(activationStatus, 200);

      const clientToken = await loginClient();
      const { body: produits } = await api('/v1/client/produits', { token: clientToken });
      assert.ok(produits.produits.some((p) => p.code === code));
    });
  }
);

describe(
  'catalogue — marge déléguée et arbitrage du directeur',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    let productId;
    let currentRate;

    before(async () => {
      const token = await loginStaff('gestionnaire');
      const { body } = await api('/v1/admin/catalogue/produits', { token });
      const cheminot = body.produits.find((p) => p.code === 'CHEMINOT');
      productId = cheminot.id;
      currentRate = Number(cheminot.monthly_rate); // 0.012
    });


    test('le gestionnaire ajuste dans la marge déléguée : appliqué immédiatement', async () => {
      const token = await loginStaff('gestionnaire');
      // ±20 % relatif : 0.012 * 1.1 = 0.0132, dans la marge.
      const nouveauTaux = Number((currentRate * 1.1).toFixed(6));

      const { status, body } = await api(`/v1/admin/catalogue/produits/${productId}/bareme`, {
        method: 'PUT',
        token,
        body: {
          motif: 'Ajustement mineur dans la marge déléguée',
          bareme: {
            monthlyRate: nouveauTaux, minAmount: 50000, maxAmount: 3000000,
            minDuration: 3, maxDuration: 36,
          },
        },
      });
      assert.equal(status, 200);
      assert.equal(body.statut, 'applique');
      assert.equal(body.motif, 'dans_la_marge_deleguee');
    });

    test('le gestionnaire propose hors marge : mis en attente, rien n\'est appliqué', async () => {
      const token = await loginStaff('gestionnaire');
      // +50 % : dépasse largement les 20 % délégués, mais reste sous
      // le plafond réglementaire de 3 %/mois.
      const propose = Number((currentRate * 1.5).toFixed(6));

      const { status, body } = await api(`/v1/admin/catalogue/produits/${productId}/bareme`, {
        method: 'PUT',
        token,
        body: {
          motif: 'Repositionnement tarifaire, hors marge',
          bareme: {
            monthlyRate: propose, minAmount: 50000, maxAmount: 3000000,
            minDuration: 3, maxDuration: 36,
          },
        },
      });
      assert.equal(status, 200);
      assert.equal(body.statut, 'a_valider');
      assert.equal(body.motif, 'hors_marge_deleguee');
      assert.ok(body.demande.id);
    });

    test('un opérateur ne voit pas apparaître de droit d\'arbitrage sur la demande', async () => {
      const { body: changements } = await api('/v1/admin/catalogue/changements', {
        token: await loginStaff('gestionnaire'),
      });
      const demande = changements.changements.find((c) => c.status === 'en_attente');
      assert.ok(demande, 'une demande en attente doit exister');

      const operateurToken = await loginStaff('operateur');
      const { status } = await api(`/v1/admin/catalogue/changements/${demande.id}/decider`, {
        method: 'POST',
        token: operateurToken,
        body: { approuver: true },
      });
      assert.equal(status, 403);
    });

    test('le directeur approuve la demande, qui applique enfin le nouveau barème', async () => {
      const directeurToken = await loginStaff('directeur');
      const { body: changements } = await api('/v1/admin/catalogue/changements', {
        token: directeurToken,
      });
      const demande = changements.changements.find((c) => c.status === 'en_attente');

      const { status, body } = await api(
        `/v1/admin/catalogue/changements/${demande.id}/decider`,
        { method: 'POST', token: directeurToken, body: { approuver: true, note: 'Validé en comité' } }
      );
      assert.equal(status, 200);
      assert.equal(body.statut, 'approuve');

      const { body: historique } = await api(`/v1/admin/catalogue/produits/${productId}/historique`, {
        token: directeurToken,
      });
      // La version en vigueur doit refléter le taux de la demande approuvée.
      const enVigueur = historique.versions.find((v) => v.effective_to === null);
      assert.ok(enVigueur);
      assert.equal(Number(enVigueur.monthly_rate), Number((currentRate * 1.5).toFixed(6)));
    });

    test('le directeur ajuste hors marge et hors délai, directement, sans passer par une demande', async () => {
      const directeurToken = await loginStaff('directeur');
      const { status, body } = await api(`/v1/admin/catalogue/produits/${productId}/bareme`, {
        method: 'PUT',
        token: directeurToken,
        body: {
          motif: 'Décision directe de la direction',
          bareme: {
            monthlyRate: 0.028, minAmount: 50000, maxAmount: 3000000,
            minDuration: 3, maxDuration: 36,
          },
        },
      });
      assert.equal(status, 200);
      assert.equal(body.statut, 'applique');
      assert.equal(body.motif, 'autorite_directeur');
    });

    test('même le directeur ne dépasse pas le plafond réglementaire', async () => {
      const directeurToken = await loginStaff('directeur');
      const { status, body } = await api(`/v1/admin/catalogue/produits/${productId}/bareme`, {
        method: 'PUT',
        token: directeurToken,
        body: {
          motif: 'Tentative au-delà du plafond',
          bareme: {
            monthlyRate: 0.05, minAmount: 50000, maxAmount: 3000000,
            minDuration: 3, maxDuration: 36,
          },
        },
      });
      assert.equal(status, 422);
      assert.match(body.error, /plafond/);
    });
  }
);

describe(
  'plafonds réglementaires',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    test('un gestionnaire ne peut pas modifier les plafonds', async () => {
      const token = await loginStaff('gestionnaire');
      const { status } = await api('/v1/admin/catalogue/plafonds/credit_monthly', {
        method: 'PUT',
        token,
        body: { maxRate: 0.05 },
      });
      assert.equal(status, 403);
    });

    test('le directeur relève le plafond, ce qui débloque un taux auparavant refusé', async () => {
      const directeurToken = await loginStaff('directeur');

      const { status: raiseStatus } = await api('/v1/admin/catalogue/plafonds/credit_monthly', {
        method: 'PUT',
        token: directeurToken,
        body: { maxRate: 0.06, note: 'Ajustement temporaire pour les tests' },
      });
      assert.equal(raiseStatus, 200);

      const { body: catalog } = await api('/v1/admin/catalogue/produits', { token: directeurToken });
      const cible = catalog.produits[0];

      const { status: baremeStatus } = await api(`/v1/admin/catalogue/produits/${cible.id}/bareme`, {
        method: 'PUT',
        token: directeurToken,
        body: {
          motif: 'Test avec plafond relevé',
          bareme: {
            monthlyRate: 0.045, minAmount: 10000, maxAmount: 1000000,
            minDuration: 1, maxDuration: 12,
          },
        },
      });
      assert.equal(baremeStatus, 200);

      // On restaure le plafond d'origine pour ne pas fausser les autres
      // suites de tests si elles s'exécutent contre la même base.
      await api('/v1/admin/catalogue/plafonds/credit_monthly', {
        method: 'PUT',
        token: directeurToken,
        body: { maxRate: 0.03, note: 'Restauration après test' },
      });
    });
  }
);
