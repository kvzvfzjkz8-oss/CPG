import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer, stopTestServer, api, apiUpload, loginStaff, hasTestDatabase,
} from '../helpers/testServer.js';

/**
 * Chaque client de test consomme une connexion réelle contre le
 * limiteur dédié de /connexion-client (10 tentatives / 15 min, cf.
 * auth.routes.js). Les blocs ci-dessous réutilisent donc volontairement
 * un même client entre plusieurs tests quand leurs assertions le
 * permettent, plutôt que d'en créer un par test.
 */
before(async () => {
  await startTestServer();
});

after(async () => {
  await stopTestServer();
});

/** Crée un client de test dédié avec un solde vierge, retourne son jeton et son téléphone. */
async function createTestClient(label) {
  const gestionnaireToken = await loginStaff('gestionnaire');
  const phone = `+24109${String(Math.floor(Math.random() * 900000) + 100000)}`;
  await api('/v1/admin/utilisateurs', {
    method: 'POST',
    token: gestionnaireToken,
    body: { nomComplet: `Client Corr ${label}`, telephone: phone, role: 'client', codePin: '1234' },
  });
  const { body } = await api('/v1/auth/connexion-client', { method: 'POST', body: { phone, pin: '1234' } });
  return { phone, token: body.accessToken };
}

/** Fait approuver un crédit de bout en bout pour le client donné (dépose le principal). */
async function approveCreditFor(clientToken, produitId, montant, duree) {
  const { body: created } = await api('/v1/client/credits', {
    method: 'POST', token: clientToken, body: { produitId, montant, duree, motif: 'Test corrections' },
  });
  const operateurToken = await loginStaff('operateur');
  await api(`/v1/admin/credits/${created.id}/valider-niveau1`, { method: 'POST', token: operateurToken });

  const gestionnaireToken = await loginStaff('gestionnaire');
  const { body: session } = await api('/v1/admin/commission/seance', {
    method: 'POST', token: gestionnaireToken, body: { dateHeure: '2026-09-01T09:00' },
  });
  await api(`/v1/admin/commission/credits/${created.id}/deposer`, {
    method: 'POST', token: gestionnaireToken, body: { note: 'Dossier de test' },
  });
  await api(`/v1/admin/commission/seance/${session.id}/tenir`, {
    method: 'POST', token: gestionnaireToken,
    body: { decisions: [{ creditId: created.id, decision: 'valide' }] },
  });
  await api(`/v1/admin/commission/credits/${created.id}/valider-double`, {
    method: 'POST', token: operateurToken,
  });

  const directeurToken = await loginStaff('directeur');
  const { body: approved } = await api(`/v1/admin/credits/${created.id}/approuver`, {
    method: 'POST', token: directeurToken,
  });
  return { id: created.id, reference: approved.reference };
}

describe(
  'import du fichier de paie',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    let alice;
    let bob;

    before(async () => {
      alice = await createTestClient('ImportAlice');
      bob = await createTestClient('ImportBob');
    });

    test('un gestionnaire ne peut pas importer de fichier de paie', async () => {
      const gestionnaireToken = await loginStaff('gestionnaire');
      const { status } = await apiUpload('/v1/admin/operations/salaires/import', {
        token: gestionnaireToken,
        fields: { employeur: 'SETRAG', periode: '2026-08' },
        fileField: 'fichier',
        fileContent: '+24106000001,100000',
      });
      assert.equal(status, 403);
    });

    test('un opérateur importe un fichier avec téléphone et nom', async () => {
      const csv = ['identifiant,montant', `${alice.phone},150000`, 'Client Corr ImportBob,90000'].join('\n');

      const operateurToken = await loginStaff('operateur');
      const { status, body } = await apiUpload('/v1/admin/operations/salaires/import', {
        token: operateurToken,
        fields: { employeur: `IMPORTCO${Date.now()}`, periode: '2026-08' },
        fileField: 'fichier',
        fileContent: csv,
      });

      assert.equal(status, 201);
      assert.equal(body.credited.length, 2);
      assert.equal(body.lignesInvalides.length, 0);

      const { body: compteAlice } = await api('/v1/client/compte', { token: alice.token });
      assert.equal(compteAlice.account.balance, 150000);
      const { body: compteBob } = await api('/v1/client/compte', { token: bob.token });
      assert.equal(compteBob.account.balance, 90000);
    });

    test('les lignes invalides du fichier sont signalées sans bloquer les autres', async () => {
      // Réutilise bob avec un employeur différent : la référence de lot
      // change donc, pas de conflit avec le crédit du test précédent.
      const csv = [`${bob.phone},80000`, 'ligne-sans-montant', '+24100000000,-500'].join('\n');

      const operateurToken = await loginStaff('operateur');
      const { status, body } = await apiUpload('/v1/admin/operations/salaires/import', {
        token: operateurToken,
        fields: { employeur: `IMPORTCO2${Date.now()}`, periode: '2026-08' },
        fileField: 'fichier',
        fileContent: csv,
      });

      assert.equal(status, 201);
      assert.equal(body.credited.length, 1);
      assert.equal(body.lignesInvalides.length, 2);
    });

    test('aucun fichier joint est rejeté', async () => {
      const operateurToken = await loginStaff('operateur');
      const { status } = await apiUpload('/v1/admin/operations/salaires/import', {
        token: operateurToken,
        fields: { employeur: 'SETRAG', periode: '2026-08' },
      });
      assert.equal(status, 422);
    });

    test('un employeur ou une période manquants sont rejetés', async () => {
      const operateurToken = await loginStaff('operateur');
      const { status } = await apiUpload('/v1/admin/operations/salaires/import', {
        token: operateurToken,
        fields: { periode: '2026-08' },
        fileField: 'fichier',
        fileContent: '+24106000001,50000',
      });
      assert.equal(status, 422);
    });
  }
);

describe(
  'aperçu de la paie avant confirmation',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    let client;

    before(async () => {
      client = await createTestClient('Apercu');
    });

    test('l\'aperçu ne crédite rien', async () => {
      const operateurToken = await loginStaff('operateur');
      const { status, body } = await apiUpload('/v1/admin/operations/salaires/apercu', {
        token: operateurToken,
        fields: { employeur: `APERCU${Date.now()}`, periode: '2026-08' },
        fileField: 'fichier',
        fileContent: `${client.phone},55000`,
      });
      assert.equal(status, 200);
      assert.equal(body.aCrediter.length, 1);
      assert.equal(body.aCrediter[0].montant, 55000);
      assert.equal(body.total, 55000);

      const { body: compte } = await api('/v1/client/compte', { token: client.token });
      assert.equal(compte.account.balance, 0, 'un aperçu ne doit jamais écrire en base');
    });

    test('l\'aperçu signale aussi les identifiants introuvables et les lignes invalides', async () => {
      const operateurToken = await loginStaff('operateur');
      const csv = [`${client.phone},55000`, '+24100000000,30000', 'ligne-invalide'].join('\n');
      const { status, body } = await apiUpload('/v1/admin/operations/salaires/apercu', {
        token: operateurToken,
        fields: { employeur: `APERCU2${Date.now()}`, periode: '2026-08' },
        fileField: 'fichier',
        fileContent: csv,
      });
      assert.equal(status, 200);
      assert.equal(body.aCrediter.length, 1);
      assert.equal(body.notFound.length, 1);
      assert.equal(body.lignesInvalides.length, 1);
    });

    test('confirmer après aperçu crédite réellement, avec la même référence', async () => {
      const operateurToken = await loginStaff('operateur');
      const employeur = `APERCU3${Date.now()}`;
      const { body: apercu } = await apiUpload('/v1/admin/operations/salaires/apercu', {
        token: operateurToken,
        fields: { employeur, periode: '2026-08' },
        fileField: 'fichier',
        fileContent: `${client.phone},42000`,
      });

      const { status, body: confirmation } = await api('/v1/admin/operations/salaires', {
        method: 'POST', token: operateurToken,
        body: {
          employeur, periode: '2026-08',
          lignes: apercu.aCrediter.map((l) => ({ identifiant: l.identifiant, montant: l.montant })),
        },
      });
      assert.equal(status, 201);
      assert.equal(confirmation.reference, apercu.reference);
      assert.equal(confirmation.credited.length, 1);

      const { body: compte } = await api('/v1/client/compte', { token: client.token });
      assert.equal(compte.account.balance, 42000);
    });

    test('un gestionnaire ne peut pas non plus demander l\'aperçu', async () => {
      const gestionnaireToken = await loginStaff('gestionnaire');
      const { status } = await apiUpload('/v1/admin/operations/salaires/apercu', {
        token: gestionnaireToken,
        fields: { employeur: 'SETRAG', periode: '2026-08' },
        fileField: 'fichier',
        fileContent: `${client.phone},10000`,
      });
      assert.equal(status, 403);
    });
  }
);

describe(
  'relecture des transactions',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    let client;

    before(async () => {
      client = await createTestClient('Relecture');
    });

    test('un client n\'a pas accès à la liste des transactions', async () => {
      const { status } = await api(
        '/v1/admin/operations/transactions?debut=2026-08-01&fin=2026-08-31',
        { token: client.token }
      );
      assert.equal(status, 403);
    });

    test('une transaction créditée apparaît dans la liste, filtrable par type', async () => {
      const operateurToken = await loginStaff('operateur');
      const employeur = `RELECT${Date.now()}`;

      await api('/v1/admin/operations/salaires', {
        method: 'POST', token: operateurToken,
        body: { employeur, periode: '2026-08', lignes: [{ identifiant: client.phone, montant: 63000 }] },
      });

      const { status, body } = await api(
        '/v1/admin/operations/transactions?debut=2026-08-01&fin=2026-08-31&type=salaire',
        { token: operateurToken }
      );
      assert.equal(status, 200);
      assert.ok(body.transactions.some((t) => t.amount === 63000 && t.client === 'Client Corr Relecture'));
    });

    test('des dates de période manquantes sont rejetées', async () => {
      const operateurToken = await loginStaff('operateur');
      const { status } = await api('/v1/admin/operations/transactions?debut=2026-08-01', {
        token: operateurToken,
      });
      assert.equal(status, 422);
    });
  }
);

describe(
  'annulation d\'une transaction',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    let sharedClient;
    let balanceClient;
    let creditClient;
    let produitId;

    before(async () => {
      sharedClient = await createTestClient('AnnulShared');
      balanceClient = await createTestClient('AnnulBalance');
      creditClient = await createTestClient('AnnulCredit');
      const { body } = await api('/v1/admin/catalogue/produits/actifs', { token: await loginStaff('gestionnaire') });
      produitId = body.produits.find((p) => p.code === 'EXPRESS').product_id;
    });

    test('un gestionnaire ne peut pas annuler de transaction', async () => {
      const operateurToken = await loginStaff('operateur');
      const employeur = `ANNULCO${Date.now()}`;
      const { body: credit } = await api('/v1/admin/operations/salaires', {
        method: 'POST', token: operateurToken,
        body: { employeur, periode: '2026-08', lignes: [{ identifiant: sharedClient.phone, montant: 40000 }] },
      });

      const { body: transactions } = await api(
        '/v1/admin/operations/transactions?debut=2026-08-01&fin=2026-08-31',
        { token: operateurToken }
      );
      const entry = transactions.transactions.find((t) => t.reference === credit.reference);

      const gestionnaireToken = await loginStaff('gestionnaire');
      const { status } = await api(`/v1/admin/operations/transactions/${entry.id}/annuler`, {
        method: 'POST', token: gestionnaireToken, body: { motif: 'Test permission' },
      });
      assert.equal(status, 403);
    });

    test('annuler deux fois la même transaction échoue', async () => {
      // Même client que le test précédent, employeur différent : pas de
      // conflit avec le crédit déjà présent sur son compte.
      const operateurToken = await loginStaff('operateur');
      const employeur = `ANNULCO2${Date.now()}`;

      await api('/v1/admin/operations/salaires', {
        method: 'POST', token: operateurToken,
        body: { employeur, periode: '2026-08', lignes: [{ identifiant: sharedClient.phone, montant: 10000 }] },
      });
      const { body: transactions } = await api(
        `/v1/admin/operations/transactions?debut=2026-08-01&fin=2026-08-31`,
        { token: operateurToken }
      );
      const entry = transactions.transactions.find((t) => t.reference?.includes(employeur));

      const first = await api(`/v1/admin/operations/transactions/${entry.id}/annuler`, {
        method: 'POST', token: operateurToken, body: { motif: 'Première annulation' },
      });
      assert.equal(first.status, 201);

      const second = await api(`/v1/admin/operations/transactions/${entry.id}/annuler`, {
        method: 'POST', token: operateurToken, body: { motif: 'Deuxième tentative' },
      });
      assert.equal(second.status, 409);
    });

    test('un motif trop court est rejeté', async () => {
      const operateurToken = await loginStaff('operateur');
      const { status } = await api('/v1/admin/operations/transactions/00000000-0000-0000-0000-000000000000/annuler', {
        method: 'POST', token: operateurToken, body: { motif: 'abc' },
      });
      assert.equal(status, 422);
    });

    test('annuler une transaction introuvable renvoie 404', async () => {
      const operateurToken = await loginStaff('operateur');
      const { status } = await api('/v1/admin/operations/transactions/00000000-0000-0000-0000-000000000000/annuler', {
        method: 'POST', token: operateurToken, body: { motif: 'Motif suffisamment long' },
      });
      assert.equal(status, 404);
    });

    test('annuler un crédit de paie restaure exactement le solde', async () => {
      const operateurToken = await loginStaff('operateur');
      const employeur = `ANNULCO3${Date.now()}`;

      const { body: soldeInitial } = await api('/v1/client/compte', { token: balanceClient.token });
      assert.equal(soldeInitial.account.balance, 0);

      const { body: credit } = await api('/v1/admin/operations/salaires', {
        method: 'POST', token: operateurToken,
        body: { employeur, periode: '2026-08', lignes: [{ identifiant: balanceClient.phone, montant: 77000 }] },
      });

      const { body: apresCredit } = await api('/v1/client/compte', { token: balanceClient.token });
      assert.equal(apresCredit.account.balance, 77000);

      const { body: transactions } = await api(
        '/v1/admin/operations/transactions?debut=2026-08-01&fin=2026-08-31',
        { token: operateurToken }
      );
      const entry = transactions.transactions.find((t) => t.reference === credit.reference);

      const { status, body } = await api(`/v1/admin/operations/transactions/${entry.id}/annuler`, {
        method: 'POST', token: operateurToken, body: { motif: 'Montant erroné, doublon de saisie' },
      });
      assert.equal(status, 201);
      assert.equal(body.montantExtourne, -77000);

      const { body: apresAnnulation } = await api('/v1/client/compte', { token: balanceClient.token });
      assert.equal(apresAnnulation.account.balance, 0);
    });

    test('annuler un paiement d\'échéance la fait redevenir « à_venir » et desolde le crédit', async () => {
      // Un prêt sur 1 mois inclut toujours l'intérêt dans son unique
      // échéance : elle dépasse forcément le seul principal déposé à
      // l'approbation. On crédite d'abord un complément de solde pour
      // que le prélèvement réussisse — c'est le paiement réussi qu'on
      // veut ensuite annuler, pas le cas insuffisant (déjà couvert
      // ailleurs).
      const operateurToken = await loginStaff('operateur');
      await api('/v1/admin/operations/salaires', {
        method: 'POST', token: operateurToken,
        body: {
          employeur: `ANNULCO4${Date.now()}`, periode: '2026-08',
          lignes: [{ identifiant: creditClient.phone, montant: 50000 }],
        },
      });

      const credit = await approveCreditFor(creditClient.token, produitId, 200000, 1);

      const { body: avant } = await api('/v1/client/credits', { token: creditClient.token });
      const echeance = avant.activeCredit.installments[0];
      assert.equal(echeance.status, 'a_venir');

      await api('/v1/admin/operations/echeances/executer', {
        method: 'POST', token: operateurToken, body: { asOf: echeance.due_date.slice(0, 10) },
      });

      const { body: apresPrelevement } = await api('/v1/client/credits', { token: creditClient.token });
      const creditApres = apresPrelevement.credits.find((c) => c.reference === credit.reference);
      assert.equal(creditApres.status, 'solde', 'précondition : le crédit à une seule échéance doit être soldé');

      const { body: transactions } = await api(
        `/v1/admin/operations/transactions?debut=2026-08-01&fin=2027-12-31&type=paiement_credit`,
        { token: operateurToken }
      );
      const paiement = transactions.transactions.find((t) => t.reference === credit.reference);
      assert.ok(paiement, 'la transaction de paiement doit être retrouvable');

      const { status, body } = await api(`/v1/admin/operations/transactions/${paiement.id}/annuler`, {
        method: 'POST', token: operateurToken, body: { motif: 'Erreur de prélèvement à corriger' },
      });
      assert.equal(status, 201);
      assert.ok(body.installmentRevert);

      const { body: apresAnnulation } = await api('/v1/client/credits', { token: creditClient.token });
      const creditRevert = apresAnnulation.credits.find((c) => c.reference === credit.reference);
      assert.equal(creditRevert.status, 'approuve', 'le crédit doit ressortir du statut soldé');
      assert.equal(apresAnnulation.activeCredit.installments[0].status, 'a_venir');
    });
  }
);

describe(
  'correction d\'une échéance — proposition et validation du directeur',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    let client;
    let credit;
    let echeanceId;
    let echeanceDateOrigine;

    before(async () => {
      client = await createTestClient('Adjust');
      const { body } = await api('/v1/admin/catalogue/produits/actifs', { token: await loginStaff('gestionnaire') });
      const produitId = body.produits.find((p) => p.code === 'MICRO_STD').product_id;

      credit = await approveCreditFor(client.token, produitId, 120000, 6);
      const { body: credits } = await api('/v1/client/credits', { token: client.token });
      echeanceId = credits.activeCredit.installments[0].id;
      echeanceDateOrigine = credits.activeCredit.installments[0].due_date.slice(0, 10);
    });

    test('un gestionnaire ne peut pas proposer de correction', async () => {
      const gestionnaireToken = await loginStaff('gestionnaire');
      const { status } = await api(`/v1/admin/operations/echeances/${echeanceId}/proposer-correction`, {
        method: 'POST', token: gestionnaireToken,
        body: { nouvelleDate: '2026-12-01', motif: 'Test permission' },
      });
      assert.equal(status, 403);
    });

    test('une date mal formée est rejetée', async () => {
      const operateurToken = await loginStaff('operateur');
      const { status } = await api(`/v1/admin/operations/echeances/${echeanceId}/proposer-correction`, {
        method: 'POST', token: operateurToken,
        body: { nouvelleDate: '01/12/2026', motif: 'Date mal formée' },
      });
      assert.equal(status, 422);
    });

    test('un motif trop court est rejeté', async () => {
      const operateurToken = await loginStaff('operateur');
      const { status } = await api(`/v1/admin/operations/echeances/${echeanceId}/proposer-correction`, {
        method: 'POST', token: operateurToken,
        body: { nouvelleDate: '2026-12-01', motif: 'abc' },
      });
      assert.equal(status, 422);
    });

    let requestId;

    test('un opérateur propose une correction — rien ne change tant que ce n\'est pas décidé', async () => {
      const operateurToken = await loginStaff('operateur');
      const { status, body } = await api(`/v1/admin/operations/echeances/${echeanceId}/proposer-correction`, {
        method: 'POST', token: operateurToken,
        body: { nouvelleDate: '2026-12-01', motif: 'Le client a demandé un décalage' },
      });
      assert.equal(status, 201);
      assert.equal(body.status, 'en_attente');
      requestId = body.id;

      const { body: echeancier } = await api(`/v1/admin/operations/echeances?reference=${credit.reference}`, {
        token: operateurToken,
      });
      assert.match(echeancier.installments[0].due_date, new RegExp(`^${echeanceDateOrigine}`));
    });

    test('une deuxième proposition sur la même échéance est refusée tant que la première est en attente', async () => {
      const operateurToken = await loginStaff('operateur');
      const { status } = await api(`/v1/admin/operations/echeances/${echeanceId}/proposer-correction`, {
        method: 'POST', token: operateurToken,
        body: { nouvelleDate: '2026-12-15', motif: 'Deuxième tentative' },
      });
      assert.equal(status, 409);
    });

    test('la demande apparaît dans la liste des corrections en attente', async () => {
      const operateurToken = await loginStaff('operateur');
      const { status, body } = await api('/v1/admin/operations/corrections-echeances', { token: operateurToken });
      assert.equal(status, 200);
      assert.ok(body.demandes.some((d) => d.id === requestId));
    });

    test('un opérateur ne peut pas décider (même pas sa propre demande)', async () => {
      const operateurToken = await loginStaff('operateur');
      const { status } = await api(`/v1/admin/operations/corrections-echeances/${requestId}/decider`, {
        method: 'POST', token: operateurToken, body: { approuver: true },
      });
      assert.equal(status, 403);
    });

    test('un gestionnaire ne peut pas non plus décider — seul le directeur valide', async () => {
      const gestionnaireToken = await loginStaff('gestionnaire');
      const { status } = await api(`/v1/admin/operations/corrections-echeances/${requestId}/decider`, {
        method: 'POST', token: gestionnaireToken, body: { approuver: true },
      });
      assert.equal(status, 403);
    });

    test('le directeur approuve — la date s\'applique enfin', async () => {
      const directeurToken = await loginStaff('directeur');
      const { status, body } = await api(`/v1/admin/operations/corrections-echeances/${requestId}/decider`, {
        method: 'POST', token: directeurToken, body: { approuver: true, note: 'Accordé' },
      });
      assert.equal(status, 200);
      assert.equal(body.statut, 'approuve');
      assert.match(body.installment.due_date, /^2026-12-01/);
      assert.match(body.installment.original_due_date, new RegExp(`^${echeanceDateOrigine}`));
    });

    test('une demande déjà décidée ne peut pas être redécidée', async () => {
      const directeurToken = await loginStaff('directeur');
      const { status } = await api(`/v1/admin/operations/corrections-echeances/${requestId}/decider`, {
        method: 'POST', token: directeurToken, body: { approuver: false },
      });
      assert.equal(status, 409);
    });

    let secondRequestId;

    test('une nouvelle proposition redevient possible une fois la précédente décidée', async () => {
      const operateurToken = await loginStaff('operateur');
      const { status, body } = await api(`/v1/admin/operations/echeances/${echeanceId}/proposer-correction`, {
        method: 'POST', token: operateurToken,
        body: { nouvelleDate: '2026-12-20', motif: 'Nouveau décalage demandé' },
      });
      assert.equal(status, 201);
      secondRequestId = body.id;
    });

    test('le directeur rejette — rien ne change', async () => {
      const directeurToken = await loginStaff('directeur');
      const { status, body } = await api(`/v1/admin/operations/corrections-echeances/${secondRequestId}/decider`, {
        method: 'POST', token: directeurToken, body: { approuver: false, note: 'Pas justifié' },
      });
      assert.equal(status, 200);
      assert.equal(body.statut, 'rejete');
      assert.equal(body.installment, null);

      const { body: echeancier } = await api(`/v1/admin/operations/echeances?reference=${credit.reference}`, {
        token: directeurToken,
      });
      assert.match(echeancier.installments[0].due_date, /^2026-12-01/, 'toujours la date approuvée précédemment, pas la date rejetée');
    });

    test('proposer une correction sur une échéance déjà payée est refusé', async () => {
      const operateurToken = await loginStaff('operateur');
      await api('/v1/admin/operations/echeances/executer', {
        method: 'POST', token: operateurToken, body: { asOf: '2026-12-01' },
      });

      const { status, body: err } = await api(`/v1/admin/operations/echeances/${echeanceId}/proposer-correction`, {
        method: 'POST', token: operateurToken,
        body: { nouvelleDate: '2026-12-25', motif: 'Trop tard' },
      });
      assert.equal(status, 409);
      assert.match(err.error, /pas encore prélevée/);
    });

    test('proposer une correction sur une échéance introuvable renvoie 404', async () => {
      const operateurToken = await loginStaff('operateur');
      const { status } = await api('/v1/admin/operations/echeances/00000000-0000-0000-0000-000000000000/proposer-correction', {
        method: 'POST', token: operateurToken, body: { nouvelleDate: '2026-12-01', motif: 'Échéance fictive' },
      });
      assert.equal(status, 404);
    });

    test('l\'échéancier se retrouve par la référence du crédit', async () => {
      const operateurToken = await loginStaff('operateur');
      const { status, body } = await api(
        `/v1/admin/operations/echeances?reference=${credit.reference}`,
        { token: operateurToken }
      );
      assert.equal(status, 200);
      assert.equal(body.credit.reference, credit.reference);
      assert.equal(body.installments.length, 6);
      assert.equal(body.installments[0].id, echeanceId);
    });

    test('une référence de crédit inconnue renvoie 404', async () => {
      const operateurToken = await loginStaff('operateur');
      const { status } = await api('/v1/admin/operations/echeances?reference=CPG-INCONNU', {
        token: operateurToken,
      });
      assert.equal(status, 404);
    });

    test('le statut du planificateur est consultable', async () => {
      const operateurToken = await loginStaff('operateur');
      const { status, body } = await api('/v1/admin/operations/planificateur', { token: operateurToken });
      assert.equal(status, 200);
      assert.ok('echeances' in body);
      assert.ok('agios' in body);
    });

    test('un client n\'a pas accès au statut du planificateur', async () => {
      const { status } = await api('/v1/admin/operations/planificateur', { token: client.token });
      assert.equal(status, 403);
    });
  }
);
