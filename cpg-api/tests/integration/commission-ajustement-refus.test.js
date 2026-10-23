/**
 * ═══════════════════════════════════════════════════════════════════
 *  AJUSTER UN DOSSIER — CE QUI EST REFUSÉ
 * ═══════════════════════════════════════════════════════════════════
 *
 * « Je vais modifier les montants demain en commission. Il faut que tu
 *   me mettes cette capacité, c'est-à-dire la capacité de modifier les
 *   requêtes des gestionnaires et valider. »
 *
 * Le chemin normal est couvert par commission-ajustement.test.js. Ici,
 * tous les refus — parce qu'un refus incompris en pleine séance bloque
 * autant qu'un bug. Chaque message doit dire pourquoi, et quoi faire.
 *
 * Séparé du premier fichier pour le limiteur de requêtes : 120 par
 * minute, et node --test lance un processus par fichier.
 *
 * Fichier séparé : src/app.js plafonne à 120 requêtes par minute et
 * node --test lance un processus par fichier.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer, stopTestServer, api, loginStaff, hasTestDatabase,
} from '../helpers/testServer.js';

let gestionnaireToken;
let directeurToken;
let operateurToken;
let produitId;

before(async () => {
  await startTestServer();
  if (!hasTestDatabase()) return;
  gestionnaireToken = await loginStaff('gestionnaire');
  directeurToken = await loginStaff('directeur');
  operateurToken = await loginStaff('operateur');
  const { body } = await api('/v1/admin/catalogue/produits/actifs', { token: gestionnaireToken });
  produitId = body.produits.find((p) => p.code === 'MICRO_STD').product_id;
});

after(async () => {
  if (!hasTestDatabase()) { await stopTestServer(); return; }
  // Ne pas laisser de séance « planifiee » : commission.test.js exige
  // qu'il n'y en ait aucune au démarrage, et les fichiers partagent une
  // seule base.
  // Retirer les dossiers AVANT d'annuler la séance : une séance annulée
  // qui en contient encore les laisse à « en_attente_commission »
  // rattachés à une séance morte, invisibles et gênants pour les
  // fichiers suivants, qui partagent la même base.
  const { body } = await api('/v1/admin/commission/seance', { token: gestionnaireToken });
  if (body?.seance?.id) {
    const { body: file } = await api(`/v1/admin/commission/file-attente/${body.seance.id}`, {
      token: gestionnaireToken,
    });
    for (const d of file?.dossiers ?? []) {
      await api(`/v1/admin/commission/credits/${d.id}/retirer`, {
        method: 'POST', token: gestionnaireToken,
      });
    }
    await api(`/v1/admin/commission/seance/${body.seance.id}`, {
      method: 'DELETE', token: gestionnaireToken,
    });
  }
  await stopTestServer();
});

/** Un dossier amené jusqu'à « valide_niveau1 ». */
async function dossierPret(label, montant, duree = 6) {
  const phone = `+24106${String(Math.floor(Math.random() * 900000) + 100000)}`;
  await api('/v1/admin/utilisateurs', {
    method: 'POST', token: gestionnaireToken,
    body: {
      nomComplet: `Client Ajust ${label}`, telephone: phone, role: 'client', codePin: '1234',
      confirmerDoublon: true,
    },
  });
  const { body: s } = await api('/v1/auth/connexion-client', {
    method: 'POST', body: { phone, pin: '1234' },
  });
  const { body: cree } = await api('/v1/client/credits', {
    method: 'POST', token: s.accessToken,
    body: { produitId, montant, duree, motif: `Test ajustement ${label}` },
  });
  await api(`/v1/admin/credits/${cree.id}/valider-niveau1`, { method: 'POST', token: operateurToken });
  return { id: cree.id, reference: cree.reference };
}

async function seanceNeuve(plafond = null) {
  const { body: existante } = await api('/v1/admin/commission/seance', { token: gestionnaireToken });
  if (existante?.seance?.id) {
    await api(`/v1/admin/commission/seance/${existante.seance.id}`, {
      method: 'DELETE', token: gestionnaireToken,
    });
  }
  const demain = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
  const { body } = await api('/v1/admin/commission/seance', {
    method: 'POST', token: gestionnaireToken, body: { dateHeure: demain },
  });
  if (plafond !== null) {
    await api(`/v1/admin/commission/seance/${body.id}/plafond`, {
      method: 'PATCH', token: directeurToken, body: { plafond },
    });
  }
  return body.id;
}

const deposer = (id) => api(`/v1/admin/commission/credits/${id}/deposer`, {
  method: 'POST', token: gestionnaireToken,
});

const ajuster = (id, corps, token = directeurToken) => api(
  `/v1/admin/commission/credits/${id}/ajuster`,
  { method: 'PATCH', token, body: corps }
);

const ordreDuJour = async (sessionId) => {
  const { body } = await api(`/v1/admin/commission/file-attente/${sessionId}`, { token: directeurToken });
  return body;
};

describe(
  'Ajuster un dossier — ce qui est refusé',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    // Un refus incompris en séance bloque autant qu'un bug : le message
    // doit dire les bornes.
    test('un montant hors des bornes du produit est refusé, avec les bornes', async () => {
      await seanceNeuve();
      const a = await dossierPret('D', 200000, 6);
      await deposer(a.id);

      const { status, body } = await ajuster(a.id, { montant: 5000000 });
      assert.equal(status, 422);
      assert.match(body.error, /montants de/i, 'les bornes du produit doivent être citées');

      const { status: bas } = await ajuster(a.id, { montant: 1000 });
      assert.equal(bas, 422, 'en dessous du minimum aussi');
    });

    test('une durée hors des bornes du produit est refusée', async () => {
      await seanceNeuve();
      const a = await dossierPret('E', 200000, 6);
      await deposer(a.id);
      const { status, body } = await ajuster(a.id, { duree: 48 });
      assert.equal(status, 422);
      assert.match(body.error, /durées de/i);
    });

    test('un dossier pas encore déposé en commission n’est pas ajustable', async () => {
      await seanceNeuve();
      const a = await dossierPret('F', 200000, 6);
      const { status } = await ajuster(a.id, { montant: 150000 });
      assert.equal(status, 409);
    });

    test('un dossier déjà tranché n’est plus modifiable', async () => {
      const sessionId = await seanceNeuve();
      const a = await dossierPret('G', 200000, 6);
      await deposer(a.id);
      await api(`/v1/admin/commission/seance/${sessionId}/tenir`, {
        method: 'POST', token: directeurToken,
        body: { decisions: [{ kind: 'credit', creditId: a.id, decision: 'valide' }] },
      });

      const { status, body } = await ajuster(a.id, { montant: 150000 });
      assert.equal(status, 409);
      assert.match(body.error, /tranché|déposé/i);
    });

    test('un ajustement sans changement réel est refusé', async () => {
      await seanceNeuve();
      const a = await dossierPret('I', 200000, 6);
      await deposer(a.id);
      const { status } = await ajuster(a.id, { montant: 200000, duree: 6 });
      assert.equal(status, 422);
    });

    test('une requête vide est refusée', async () => {
      await seanceNeuve();
      const a = await dossierPret('J', 200000, 6);
      await deposer(a.id);
      const { status } = await ajuster(a.id, {});
      assert.equal(status, 422);
    });

    test('le gestionnaire ne peut pas ajuster un dossier', async () => {
      await seanceNeuve();
      const a = await dossierPret('K', 200000, 6);
      await deposer(a.id);
      const { status } = await ajuster(a.id, { montant: 150000 }, gestionnaireToken);
      assert.equal(status, 403, 'ajuster un dossier est une décision de comité');
    });
  }
);
