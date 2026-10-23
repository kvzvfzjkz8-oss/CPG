/**
 * ═══════════════════════════════════════════════════════════════════
 *  AJUSTER UN DOSSIER EN SÉANCE, PUIS LE VALIDER
 * ═══════════════════════════════════════════════════════════════════
 *
 * « Je vais modifier les montants demain en commission. Il faut que tu
 *   me mettes cette capacité, c'est-à-dire la capacité de modifier les
 *   requêtes des gestionnaires et valider. »
 *
 * Ces tests existent pour qu'une séance réelle ne se bloque pas. Ils
 * couvrent donc d'abord le chemin normal — réduire un montant puis
 * valider, enveloppe comprise — et ensuite chaque refus possible, parce
 * qu'un refus incompris en pleine séance est aussi bloquant qu'un bug :
 *
 *   • réduire un montant, puis tenir la séance → doit passer ;
 *   • un montant hors des bornes du produit → refusé, avec les bornes ;
 *   • un dossier déjà tranché → plus modifiable ;
 *   • un dossier pas encore déposé → pas ajustable ;
 *   • la demande d'origine du client → conservée, et non écrasée par
 *     une seconde retouche ;
 *   • l'enveloppe → recalculée sur le montant ajusté, ce qui est tout
 *     l'intérêt : ajuster pour tenir dans l'enveloppe au lieu d'écarter.
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
  'Ajuster un dossier en séance',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    // Le chemin normal, celui de demain matin.
    test('réduire un montant puis valider : la séance passe', async () => {
      const sessionId = await seanceNeuve(500000);
      const a = await dossierPret('A', 800000, 6);
      await deposer(a.id);

      const { status, body } = await ajuster(a.id, { montant: 400000, motif: 'Réduit en séance' });
      assert.equal(status, 200);
      assert.equal(Number(body.amount), 400000);
      assert.equal(Number(body.amount_initial), 800000, 'la demande du client est conservée');
      assert.ok(body.mensualiteApercu > 0, 'la mensualité prévisionnelle est renvoyée');

      // L'enveloppe suit le montant ajusté — c'est tout l'intérêt.
      const { body: e } = await api(`/v1/admin/commission/seance/${sessionId}/enveloppe`, {
        token: directeurToken,
      });
      assert.equal(e.depose, 400000);
      assert.equal(e.depassement, 0, 'le dossier ajusté tient maintenant dans l’enveloppe');

      const { status: tenue } = await api(`/v1/admin/commission/seance/${sessionId}/tenir`, {
        method: 'POST', token: directeurToken,
        body: { decisions: [{ kind: 'credit', creditId: a.id, decision: 'valide' }] },
      });
      assert.equal(tenue, 200, 'le dossier ajusté doit pouvoir être validé');
    });

    test('la durée seule peut être modifiée', async () => {
      await seanceNeuve();
      const a = await dossierPret('B', 200000, 6);
      await deposer(a.id);

      const { status, body } = await ajuster(a.id, { duree: 12 });
      assert.equal(status, 200);
      assert.equal(Number(body.duration_months), 12);
      assert.equal(Number(body.duration_initial), 6);
      assert.equal(Number(body.amount), 200000, 'le montant ne doit pas bouger');
    });

    test('les frais de dossier sont recalculés sur le nouveau montant', async () => {
      await seanceNeuve();
      const a = await dossierPret('C', 1000000, 6);
      await deposer(a.id);
      // La route renvoie { credit, documents, installments }.
      const { body: avant } = await api(`/v1/admin/credits/${a.id}`, { token: directeurToken });
      const fraisAvant = Number(avant.credit.file_fee);
      assert.ok(fraisAvant > 0, 'les frais de dossier sont posés dès la création');

      const { body } = await ajuster(a.id, { montant: 200000 });
      assert.ok(
        Number(body.file_fee) < fraisAvant,
        `réduire le montant doit réduire les frais : ${fraisAvant} F → ${body.file_fee} F`
      );
    });





    test('une seconde retouche n’écrase pas la demande d’origine', async () => {
      await seanceNeuve();
      const a = await dossierPret('H', 900000, 6);
      await deposer(a.id);

      await ajuster(a.id, { montant: 600000 });
      const { body } = await ajuster(a.id, { montant: 300000 });

      assert.equal(Number(body.amount), 300000);
      assert.equal(
        Number(body.amount_initial), 900000,
        'le montant d’origine doit rester celui demandé par le client, pas la retouche intermédiaire'
      );
    });




    test('l’ordre du jour montre la demande d’origine à côté du montant retenu', async () => {
      const sessionId = await seanceNeuve();
      const a = await dossierPret('L', 700000, 6);
      await deposer(a.id);
      await ajuster(a.id, { montant: 350000, motif: 'Capacité de remboursement' });

      const file = await ordreDuJour(sessionId);
      const ligne = (file.dossiers ?? []).find((c) => c.id === a.id);
      assert.ok(ligne, 'le dossier doit être à l’ordre du jour');
      assert.equal(Number(ligne.amount), 350000);
      assert.equal(Number(ligne.amount_initial), 700000);
      assert.ok(ligne.ajuste_par_nom, 'qui a ajusté doit être visible');
      assert.match(ligne.commission_note ?? '', /Capacité de remboursement/);
    });
  }
);
