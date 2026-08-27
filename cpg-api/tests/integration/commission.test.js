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

/** Crée un client de test dédié et fait avancer son dossier jusqu'à « valide_niveau1 ». */
async function createLevel1Credit(label, produitId, montant = 80000, duree = 4) {
  const gestionnaireToken = await loginStaff('gestionnaire');
  const phone = `+24106${String(Math.floor(Math.random() * 900000) + 100000)}`;
  await api('/v1/admin/utilisateurs', {
    method: 'POST', token: gestionnaireToken,
    body: { nomComplet: `Client Commission ${label}`, telephone: phone, role: 'client', codePin: '1234' },
  });
  const { body: session } = await api('/v1/auth/connexion-client', {
    method: 'POST', body: { phone, pin: '1234' },
  });
  const clientToken = session.accessToken;

  const { body: created } = await api('/v1/client/credits', {
    method: 'POST', token: clientToken,
    body: { produitId, montant, duree, motif: `Test commission ${label}` },
  });
  const operateurToken = await loginStaff('operateur');
  await api(`/v1/admin/credits/${created.id}/valider-niveau1`, { method: 'POST', token: operateurToken });

  return { id: created.id, reference: created.reference, clientToken };
}

describe(
  'comité de crédit — programmation et cycle de vie des séances',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    let produitId;

    before(async () => {
      const { body } = await api('/v1/admin/catalogue/produits/actifs', { token: await loginStaff('gestionnaire') });
      produitId = body.produits.find((p) => p.code === 'MICRO_STD').product_id;
    });

    test('aucune séance programmée au départ (ou une précédente déjà tenue)', async () => {
      const operateurToken = await loginStaff('operateur');
      const { status, body } = await api('/v1/admin/commission/seance', { token: operateurToken });
      assert.equal(status, 200);
      // Peut être null (pas de séance) ou tenue/annulée selon l'ordre
      // d'exécution des autres fichiers de test partageant la base ;
      // seul le statut 'planifiee' doit être absent ici.
      if (body.seance) assert.notEqual(body.seance.status, 'planifiee');
    });

    let sessionId;

    test('le gestionnaire programme une séance avec une date/heure valide', async () => {
      const gestionnaireToken = await loginStaff('gestionnaire');
      const { status, body } = await api('/v1/admin/commission/seance', {
        method: 'POST', token: gestionnaireToken, body: { dateHeure: '2026-10-01T09:00' },
      });
      assert.equal(status, 201);
      sessionId = body.id;
    });

    test('un format de date invalide est rejeté', async () => {
      // Une séance est déjà programmée, mais le format est vérifié
      // avant même d'atteindre cette règle métier.
      const gestionnaireToken = await loginStaff('gestionnaire');
      const { status } = await api('/v1/admin/commission/seance', {
        method: 'POST', token: gestionnaireToken, body: { dateHeure: '01/10/2026' },
      });
      assert.equal(status, 422);
    });

    test('la séance programmée est visible via GET', async () => {
      const operateurToken = await loginStaff('operateur');
      const { body } = await api('/v1/admin/commission/seance', { token: operateurToken });
      assert.equal(body.seance.id, sessionId);
      assert.equal(body.seance.status, 'planifiee');
    });

    test('un gestionnaire annule la séance programmée', async () => {
      const gestionnaireToken = await loginStaff('gestionnaire');
      const { status, body } = await api(`/v1/admin/commission/seance/${sessionId}`, {
        method: 'DELETE', token: gestionnaireToken,
      });
      assert.equal(status, 200);
      assert.equal(body.status, 'annulee');
    });

    test('une séance annulée libère le créneau pour en programmer une autre', async () => {
      const gestionnaireToken = await loginStaff('gestionnaire');
      const { status } = await api('/v1/admin/commission/seance', {
        method: 'POST', token: gestionnaireToken, body: { dateHeure: '2026-10-08T09:00' },
      });
      assert.equal(status, 201);
    });

    test('annuler une séance déjà annulée échoue', async () => {
      const gestionnaireToken = await loginStaff('gestionnaire');
      const { status } = await api(`/v1/admin/commission/seance/${sessionId}`, {
        method: 'DELETE', token: gestionnaireToken,
      });
      assert.equal(status, 409);
    });

    test('la file d\'attente avec plusieurs dossiers exige une décision pour chacun', async () => {
      const alice = await createLevel1Credit('Alice', produitId);
      const bob = await createLevel1Credit('Bob', produitId);
      const gestionnaireToken = await loginStaff('gestionnaire');

      // Réutilise la séance déjà programmée par le test précédent.
      const { body: seanceActuelle } = await api('/v1/admin/commission/seance', { token: gestionnaireToken });
      const currentSessionId = seanceActuelle.seance.id;

      await api(`/v1/admin/commission/credits/${alice.id}/deposer`, { method: 'POST', token: gestionnaireToken });
      await api(`/v1/admin/commission/credits/${bob.id}/deposer`, { method: 'POST', token: gestionnaireToken });

      const { body: file } = await api(`/v1/admin/commission/file-attente/${currentSessionId}`, {
        token: gestionnaireToken,
      });
      assert.ok(file.dossiers.length >= 2);

      const { status: incompleteStatus, body: incompleteBody } = await api(
        `/v1/admin/commission/seance/${currentSessionId}/tenir`,
        {
          method: 'POST', token: gestionnaireToken,
          body: { decisions: [{ creditId: alice.id, decision: 'valide' }] }, // bob manquant
        }
      );
      assert.equal(incompleteStatus, 422);
      assert.match(incompleteBody.error, /n.ont pas de décision/);

      const { status: completeStatus, body: completeBody } = await api(
        `/v1/admin/commission/seance/${currentSessionId}/tenir`,
        {
          method: 'POST', token: gestionnaireToken,
          body: {
            decisions: [
              { creditId: alice.id, decision: 'valide' },
              { creditId: bob.id, decision: 'rejete', note: 'Dossier incomplet' },
            ],
          },
        }
      );
      assert.equal(completeStatus, 200);
      const aliceResult = completeBody.resultats.find((r) => r.id === alice.id);
      const bobResult = completeBody.resultats.find((r) => r.id === bob.id);
      assert.equal(aliceResult.status, 'valide_commission');
      assert.equal(bobResult.status, 'rejete');
    });

    test('retirer un dossier de la file avant la séance le renvoie à « valide_niveau1 »', async () => {
      const carole = await createLevel1Credit('Carole', produitId);
      const gestionnaireToken = await loginStaff('gestionnaire');

      const { status: scheduleStatus, body: newSession } = await api('/v1/admin/commission/seance', {
        method: 'POST', token: gestionnaireToken, body: { dateHeure: '2026-10-15T09:00' },
      });
      assert.equal(scheduleStatus, 201);

      const { status: deposeStatus } = await api(`/v1/admin/commission/credits/${carole.id}/deposer`, {
        method: 'POST', token: gestionnaireToken,
      });
      assert.equal(deposeStatus, 201);

      const { status: retraitStatus, body: retraitBody } = await api(
        `/v1/admin/commission/credits/${carole.id}/retirer`,
        { method: 'POST', token: gestionnaireToken }
      );
      assert.equal(retraitStatus, 200);
      assert.equal(retraitBody.status, 'valide_niveau1');

      // Nettoyage : referme la séance (vide) pour ne pas bloquer la suite.
      await api(`/v1/admin/commission/seance/${newSession.id}`, { method: 'DELETE', token: gestionnaireToken });
    });

    test('retirer un dossier qui n\'est pas dans la file échoue', async () => {
      const daniel = await createLevel1Credit('Daniel', produitId);
      const gestionnaireToken = await loginStaff('gestionnaire');
      const { status } = await api(`/v1/admin/commission/credits/${daniel.id}/retirer`, {
        method: 'POST', token: gestionnaireToken,
      });
      assert.equal(status, 409);
    });
  }
);

describe(
  'comité de crédit — autorisations d\'exception',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    test('un gestionnaire ne peut pas accorder d\'autorisation d\'exception', async () => {
      const gestionnaireToken = await loginStaff('gestionnaire');
      const { body: utilisateurs } = await api('/v1/admin/utilisateurs', { token: gestionnaireToken });
      const client = utilisateurs.utilisateurs.find((u) => u.role === 'client');

      const { status } = await api('/v1/admin/commission/autorisations', {
        method: 'POST', token: gestionnaireToken,
        body: { clientId: client.id, motif: 'Test permission' },
      });
      assert.equal(status, 403);
    });

    test('le directeur accorde une autorisation, visible dans la liste', async () => {
      const directeurToken = await loginStaff('directeur');
      const { body: utilisateurs } = await api('/v1/admin/utilisateurs', { token: directeurToken });
      const client = utilisateurs.utilisateurs.find((u) => u.role === 'client');

      const { status, body } = await api('/v1/admin/commission/autorisations', {
        method: 'POST', token: directeurToken,
        body: { clientId: client.id, motif: 'Autorisation de test intégration' },
      });
      assert.equal(status, 201);

      const { body: liste } = await api('/v1/admin/commission/autorisations', { token: directeurToken });
      assert.ok(liste.autorisations.some((a) => a.id === body.id));
    });

    test('un motif trop court est rejeté', async () => {
      const directeurToken = await loginStaff('directeur');
      const { body: utilisateurs } = await api('/v1/admin/utilisateurs', { token: directeurToken });
      const client = utilisateurs.utilisateurs.find((u) => u.role === 'client');

      const { status } = await api('/v1/admin/commission/autorisations', {
        method: 'POST', token: directeurToken,
        body: { clientId: client.id, motif: 'ok' },
      });
      assert.equal(status, 422);
    });

    test('un client introuvable renvoie 404', async () => {
      const directeurToken = await loginStaff('directeur');
      const { status } = await api('/v1/admin/commission/autorisations', {
        method: 'POST', token: directeurToken,
        body: { clientId: '00000000-0000-0000-0000-000000000000', motif: 'Motif suffisamment long' },
      });
      assert.equal(status, 404);
    });
  }
);

/** Fait approuver un crédit de bout en bout via tout le circuit commission. */
async function fullyApproveCredit(clientToken, produitId, montant, duree) {
  const { body: created } = await api('/v1/client/credits', {
    method: 'POST', token: clientToken, body: { produitId, montant, duree, motif: 'Test commission items' },
  });
  const operateurToken = await loginStaff('operateur');
  await api(`/v1/admin/credits/${created.id}/valider-niveau1`, { method: 'POST', token: operateurToken });

  const gestionnaireToken = await loginStaff('gestionnaire');
  const { body: session } = await api('/v1/admin/commission/seance', {
    method: 'POST', token: gestionnaireToken, body: { dateHeure: '2026-09-01T09:00' },
  });
  await api(`/v1/admin/commission/credits/${created.id}/deposer`, { method: 'POST', token: gestionnaireToken });
  await api(`/v1/admin/commission/seance/${session.id}/tenir`, {
    method: 'POST', token: gestionnaireToken,
    body: { decisions: [{ creditId: created.id, decision: 'valide' }] },
  });
  await api(`/v1/admin/commission/credits/${created.id}/valider-double`, { method: 'POST', token: operateurToken });

  const directeurToken = await loginStaff('directeur');
  const { body: approved } = await api(`/v1/admin/credits/${created.id}/approuver`, {
    method: 'POST', token: directeurToken,
  });
  return { id: created.id, reference: approved.reference };
}

describe(
  'comité de crédit — dossiers en difficulté et demandes exceptionnelles',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    let produitExpressId;
    let produitMicroId;

    before(async () => {
      const { body } = await api('/v1/admin/catalogue/produits/actifs', { token: await loginStaff('gestionnaire') });
      produitExpressId = body.produits.find((p) => p.code === 'EXPRESS').product_id;
      produitMicroId = body.produits.find((p) => p.code === 'MICRO_STD').product_id;
    });

    test('déposer un dossier sans échéance en retard est refusé', async () => {
      const phone = `+24106${String(Math.floor(Math.random() * 900000) + 100000)}`;
      const gestionnaireToken = await loginStaff('gestionnaire');
      await api('/v1/admin/utilisateurs', {
        method: 'POST', token: gestionnaireToken,
        body: { nomComplet: 'Client Difficulte OK', telephone: phone, role: 'client', codePin: '1234' },
      });
      const { body: session } = await api('/v1/auth/connexion-client', { method: 'POST', body: { phone, pin: '1234' } });

      const credit = await fullyApproveCredit(session.accessToken, produitMicroId, 120000, 6);

      const { status: sessionStatus, body: newSession } = await api('/v1/admin/commission/seance', {
        method: 'POST', token: gestionnaireToken, body: { dateHeure: '2026-09-15T09:00' },
      });
      assert.equal(sessionStatus, 201);

      const { status, body } = await api(`/v1/admin/commission/credits/${credit.id}/deposer-difficulte`, {
        method: 'POST', token: gestionnaireToken,
      });
      assert.equal(status, 422);
      assert.match(body.error, /retard/);

      await api(`/v1/admin/commission/seance/${newSession.id}`, { method: 'DELETE', token: gestionnaireToken });
    });

    test('un dossier avec une échéance en retard peut être déposé, décidé, et cesse d\'apparaître', async () => {
      const phone = `+24106${String(Math.floor(Math.random() * 900000) + 100000)}`;
      const gestionnaireToken = await loginStaff('gestionnaire');
      await api('/v1/admin/utilisateurs', {
        method: 'POST', token: gestionnaireToken,
        body: { nomComplet: 'Client Difficulte Retard', telephone: phone, role: 'client', codePin: '1234' },
      });
      const { body: clientSession } = await api('/v1/auth/connexion-client', { method: 'POST', body: { phone, pin: '1234' } });
      const clientToken = clientSession.accessToken;

      // EXPRESS, 1 mois : l'unique échéance inclut l'intérêt et dépasse
      // donc forcément le seul principal déposé — retard garanti.
      const credit = await fullyApproveCredit(clientToken, produitExpressId, 20000, 1);

      const { body: avant } = await api('/v1/client/credits', { token: clientToken });
      const echeance = avant.activeCredit.installments[0];

      const operateurToken = await loginStaff('operateur');
      await api('/v1/admin/operations/echeances/executer', {
        method: 'POST', token: operateurToken, body: { asOf: echeance.due_date.slice(0, 10) },
      });

      const { body: apres } = await api('/v1/client/credits', { token: clientToken });
      const creditEnRetard = apres.credits.find((c) => c.reference === credit.reference);
      assert.equal(creditEnRetard.status, 'approuve'); // toujours actif, juste en retard

      const { status: sessionStatus, body: session } = await api('/v1/admin/commission/seance', {
        method: 'POST', token: gestionnaireToken, body: { dateHeure: '2026-09-22T09:00' },
      });
      assert.equal(sessionStatus, 201);

      const { status: deposeStatus, body: item } = await api(`/v1/admin/commission/credits/${credit.id}/deposer-difficulte`, {
        method: 'POST', token: gestionnaireToken, body: { note: 'Échéance unique en retard' },
      });
      assert.equal(deposeStatus, 201);
      assert.equal(item.type, 'dossier_difficulte');

      const { body: pointsAvant } = await api(`/v1/admin/commission/items/${session.id}`, { token: gestionnaireToken });
      assert.ok(pointsAvant.points.some((p) => p.id === item.id));

      const { status: tenirStatus, body: tenirBody } = await api(`/v1/admin/commission/seance/${session.id}/tenir`, {
        method: 'POST', token: gestionnaireToken,
        body: { decisions: [{ kind: 'item', itemId: item.id, decision: 'valide', note: 'Restructuration accordée' }] },
      });
      assert.equal(tenirStatus, 200);
      assert.equal(tenirBody.resultats[0].status, 'valide');

      const { body: pointsApres } = await api(`/v1/admin/commission/items/${session.id}`, { token: gestionnaireToken });
      assert.equal(pointsApres.points.length, 0);
    });

    test('un opérateur ne peut pas déposer de dossier en difficulté ni de demande exceptionnelle', async () => {
      const operateurToken = await loginStaff('operateur');
      const { status: status1 } = await api('/v1/admin/commission/credits/00000000-0000-0000-0000-000000000000/deposer-difficulte', {
        method: 'POST', token: operateurToken,
      });
      assert.equal(status1, 403);

      const { status: status2 } = await api('/v1/admin/commission/demandes-exceptionnelles', {
        method: 'POST', token: operateurToken,
        body: { clientId: '00000000-0000-0000-0000-000000000000', titre: 'Test' },
      });
      assert.equal(status2, 403);
    });

    test('une demande exceptionnelle sans client est refusée', async () => {
      const gestionnaireToken = await loginStaff('gestionnaire');
      const { status } = await api('/v1/admin/commission/demandes-exceptionnelles', {
        method: 'POST', token: gestionnaireToken,
        body: { titre: 'Sujet interne' },
      });
      assert.equal(status, 422);
    });

    test('une demande exceptionnelle avec titre trop court est refusée', async () => {
      const gestionnaireToken = await loginStaff('gestionnaire');
      const { body: utilisateurs } = await api('/v1/admin/utilisateurs', { token: gestionnaireToken });
      const client = utilisateurs.utilisateurs.find((u) => u.role === 'client');

      const { status } = await api('/v1/admin/commission/demandes-exceptionnelles', {
        method: 'POST', token: gestionnaireToken,
        body: { clientId: client.id, titre: 'Ok' },
      });
      assert.equal(status, 422);
    });

    test('retirer une demande exceptionnelle avant la séance fonctionne', async () => {
      const gestionnaireToken = await loginStaff('gestionnaire');
      const { body: utilisateurs } = await api('/v1/admin/utilisateurs', { token: gestionnaireToken });
      const client = utilisateurs.utilisateurs.find((u) => u.role === 'client');

      const { status: sessionStatus, body: session } = await api('/v1/admin/commission/seance', {
        method: 'POST', token: gestionnaireToken, body: { dateHeure: '2026-09-29T09:00' },
      });
      assert.equal(sessionStatus, 201);

      const { body: item } = await api('/v1/admin/commission/demandes-exceptionnelles', {
        method: 'POST', token: gestionnaireToken,
        body: { clientId: client.id, titre: 'Demande à retirer', note: 'Test de retrait' },
      });

      const { status: retraitStatus } = await api(`/v1/admin/commission/items/${item.id}/retirer`, {
        method: 'POST', token: gestionnaireToken,
      });
      assert.equal(retraitStatus, 200);

      const { body: points } = await api(`/v1/admin/commission/items/${session.id}`, { token: gestionnaireToken });
      assert.ok(!points.points.some((p) => p.id === item.id));

      await api(`/v1/admin/commission/seance/${session.id}`, { method: 'DELETE', token: gestionnaireToken });
    });

    test('une séance mélangeant un nouveau crédit et une demande exceptionnelle exige une décision pour chacun', async () => {
      const phone = `+24106${String(Math.floor(Math.random() * 900000) + 100000)}`;
      const gestionnaireToken = await loginStaff('gestionnaire');
      await api('/v1/admin/utilisateurs', {
        method: 'POST', token: gestionnaireToken,
        body: { nomComplet: 'Client Mixte', telephone: phone, role: 'client', codePin: '1234' },
      });
      const { body: clientSession } = await api('/v1/auth/connexion-client', { method: 'POST', body: { phone, pin: '1234' } });

      const { body: newCredit } = await api('/v1/client/credits', {
        method: 'POST', token: clientSession.accessToken,
        body: { produitId: produitMicroId, montant: 90000, duree: 5, motif: 'Dossier mixte' },
      });
      const operateurToken = await loginStaff('operateur');
      await api(`/v1/admin/credits/${newCredit.id}/valider-niveau1`, { method: 'POST', token: operateurToken });

      const { body: utilisateurs } = await api('/v1/admin/utilisateurs', { token: gestionnaireToken });
      const autreClient = utilisateurs.utilisateurs.find((u) => u.role === 'client' && u.phone !== phone);

      const { body: session } = await api('/v1/admin/commission/seance', {
        method: 'POST', token: gestionnaireToken, body: { dateHeure: '2026-10-06T09:00' },
      });
      await api(`/v1/admin/commission/credits/${newCredit.id}/deposer`, { method: 'POST', token: gestionnaireToken });
      const { body: exceptionnelle } = await api('/v1/admin/commission/demandes-exceptionnelles', {
        method: 'POST', token: gestionnaireToken,
        body: { clientId: autreClient.id, titre: 'Point mixte à trancher' },
      });

      const { status: incompleteStatus } = await api(`/v1/admin/commission/seance/${session.id}/tenir`, {
        method: 'POST', token: gestionnaireToken,
        body: { decisions: [{ kind: 'credit', creditId: newCredit.id, decision: 'valide' }] }, // demande manquante
      });
      assert.equal(incompleteStatus, 422);

      const { status: completeStatus, body: completeBody } = await api(`/v1/admin/commission/seance/${session.id}/tenir`, {
        method: 'POST', token: gestionnaireToken,
        body: {
          decisions: [
            { kind: 'credit', creditId: newCredit.id, decision: 'valide' },
            { kind: 'item', itemId: exceptionnelle.id, decision: 'rejete', note: 'Pas de motif suffisant' },
          ],
        },
      });
      assert.equal(completeStatus, 200);
      assert.equal(completeBody.resultats.length, 2);
    });
  }
);
