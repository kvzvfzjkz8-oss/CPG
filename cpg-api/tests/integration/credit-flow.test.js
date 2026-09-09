import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer, stopTestServer, api, loginStaff, loginClient, hasTestDatabase, fundCaissePrincipale,
} from '../helpers/testServer.js';

/**
 * Ces tests s'exécutent dans l'ordre de déclaration (comportement par
 * défaut de node:test tant qu'aucun test n'est marqué `concurrency`).
 * Le seed ne fournit qu'un seul client de démonstration, et la règle
 * métier « une demande à la fois » en fait donc une ressource partagée
 * entre les tests d'un même bloc : c'est voulu, pour exercer la vraie
 * contrainte plutôt que de la contourner avec des comptes jetables.
 *
 * Circuit complet testé ici, du dépôt à l'octroi :
 *   en_verification -> (operateur) valide_niveau1
 *     -> (gestionnaire depose) en_attente_commission
 *     -> (seance tenue) valide_commission | rejete
 *     -> (operateur) valide_double
 *     -> (directeur) approuve
 */
describe(
  'cycle de vie d\'une demande de crédit',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    let clientToken;
    let clientPhone;
    let produitId;
    let creditId;

    before(async () => {
      await startTestServer();

      const gestionnaireToken = await loginStaff('gestionnaire');
      const phone = `+24107${String(Math.floor(Math.random() * 900000) + 100000)}`;
      await api('/v1/admin/utilisateurs', {
        method: 'POST',
        token: gestionnaireToken,
        body: {
          nomComplet: 'Client de Test Intégration',
          telephone: phone,
          role: 'client',
          codePin: '1234',
        },
      });

      clientPhone = phone;
      clientToken = await loginClient(phone, '1234');
      const { body } = await api('/v1/client/produits', { token: clientToken });
      produitId = body.produits.find((p) => p.code === 'MICRO_STD').id;
    });

    after(async () => {
      await stopTestServer();
    });

    test('la simulation ne crée aucune demande', async () => {
      const { status, body } = await api('/v1/client/credits/simulation', {
        method: 'POST',
        token: clientToken,
        body: { produitId, montant: 300000, duree: 6 },
      });
      assert.equal(status, 200);
      assert.ok(body.monthlyPayment > 0);
      assert.match(body.avertissement, /indicative/);

      const { body: credits } = await api('/v1/client/credits', { token: clientToken });
      assert.equal(credits.credits.length, 0);
    });

    test('simulation hors bornes du produit refusée', async () => {
      const { status, body } = await api('/v1/client/credits/simulation', {
        method: 'POST',
        token: clientToken,
        body: { produitId, montant: 10000000, duree: 6 },
      });
      assert.equal(status, 422);
      assert.match(body.error, /FCFA/);
    });

    test('un client dépose une demande de crédit', async () => {
      const { status, body } = await api('/v1/client/credits', {
        method: 'POST',
        token: clientToken,
        body: { produitId, montant: 300000, duree: 6, motif: 'Achat de matériel' },
      });
      assert.equal(status, 201);
      assert.equal(body.status, 'en_verification');
      creditId = body.id;
    });

    test('une deuxième demande est refusée tant que la première est en cours', async () => {
      const { status, body } = await api('/v1/client/credits', {
        method: 'POST',
        token: clientToken,
        body: { produitId, montant: 100000, duree: 3 },
      });
      assert.equal(status, 409);
      assert.match(body.error, /déjà en cours/);
    });

    test('un client ne peut pas valider son propre dossier', async () => {
      const { status } = await api(`/v1/admin/credits/${creditId}/valider-niveau1`, {
        method: 'POST',
        token: clientToken,
      });
      assert.equal(status, 403);
    });

    test('le compte technique valide le premier niveau', async () => {
      const adminToken = await loginStaff('admin');
      const { status, body } = await api(`/v1/admin/credits/${creditId}/valider-niveau1`, {
        method: 'POST',
        token: adminToken,
      });
      assert.equal(status, 200);
      assert.equal(body.status, 'valide_niveau1');
    });

    test('valider deux fois le même dossier échoue proprement', async () => {
      const operateurToken = await loginStaff('operateur');
      const { status, body } = await api(`/v1/admin/credits/${creditId}/valider-niveau1`, {
        method: 'POST',
        token: operateurToken,
      });
      assert.equal(status, 409);
      assert.match(body.error, /déjà été traité/);
    });

    test('approuver directement, sans passer par le comité, échoue', async () => {
      const directeurToken = await loginStaff('directeur');
      const { status, body } = await api(`/v1/admin/credits/${creditId}/approuver`, {
        method: 'POST', token: directeurToken,
      });
      assert.equal(status, 409);
      assert.match(body.error, /commission/);
    });

    test('déposer en commission sans séance programmée échoue', async () => {
      const gestionnaireToken = await loginStaff('gestionnaire');
      const { status, body } = await api(`/v1/admin/commission/credits/${creditId}/deposer`, {
        method: 'POST', token: gestionnaireToken,
      });
      assert.equal(status, 422);
      assert.match(body.error, /programmée/);
    });

    test('un opérateur ne peut pas programmer de séance', async () => {
      const operateurToken = await loginStaff('operateur');
      const { status } = await api('/v1/admin/commission/seance', {
        method: 'POST', token: operateurToken, body: { dateHeure: '2026-09-03T10:00' },
      });
      assert.equal(status, 403);
    });

    let sessionId;

    test('le gestionnaire programme la séance hebdomadaire', async () => {
      const gestionnaireToken = await loginStaff('gestionnaire');
      const { status, body } = await api('/v1/admin/commission/seance', {
        method: 'POST', token: gestionnaireToken, body: { dateHeure: '2026-09-03T10:00' },
      });
      assert.equal(status, 201);
      assert.equal(body.status, 'planifiee');
      sessionId = body.id;
    });

    test('une deuxième séance ne peut pas être programmée pendant qu\'une autre attend', async () => {
      const gestionnaireToken = await loginStaff('gestionnaire');
      const { status } = await api('/v1/admin/commission/seance', {
        method: 'POST', token: gestionnaireToken, body: { dateHeure: '2026-09-10T10:00' },
      });
      assert.equal(status, 409);
    });

    test('un opérateur ne peut pas déposer de dossier en commission', async () => {
      const operateurToken = await loginStaff('operateur');
      const { status } = await api(`/v1/admin/commission/credits/${creditId}/deposer`, {
        method: 'POST', token: operateurToken,
      });
      assert.equal(status, 403);
    });

    test('le gestionnaire dépose le dossier avec une note', async () => {
      const gestionnaireToken = await loginStaff('gestionnaire');
      const { status, body } = await api(`/v1/admin/commission/credits/${creditId}/deposer`, {
        method: 'POST', token: gestionnaireToken,
        body: { note: 'Bon profil, ancienneté SETRAG confirmée' },
      });
      assert.equal(status, 201);
      assert.equal(body.status, 'en_attente_commission');
    });

    test('tenir la séance sans aucune décision est refusé', async () => {
      const directeurToken = await loginStaff('directeur');
      const { status } = await api(`/v1/admin/commission/seance/${sessionId}/tenir`, {
        method: 'POST', token: directeurToken,
        body: { decisions: [] },
      });
      assert.equal(status, 422);
    });

    test('un gestionnaire ne peut pas tenir la séance — la décision revient au directeur', async () => {
      const gestionnaireToken = await loginStaff('gestionnaire');
      const { status } = await api(`/v1/admin/commission/seance/${sessionId}/tenir`, {
        method: 'POST', token: gestionnaireToken,
        body: { decisions: [{ creditId, decision: 'valide' }] },
      });
      assert.equal(status, 403);
    });

    test('le directeur tient la séance : le dossier est validé', async () => {
      const directeurToken = await loginStaff('directeur');
      const { status, body } = await api(`/v1/admin/commission/seance/${sessionId}/tenir`, {
        method: 'POST', token: directeurToken,
        body: { decisions: [{ creditId, decision: 'valide', note: 'Accord du comité' }] },
      });
      assert.equal(status, 200);
      assert.equal(body.resultats[0].status, 'valide_commission');
    });

    test('un gestionnaire ne peut pas faire la double validation', async () => {
      const gestionnaireToken = await loginStaff('gestionnaire');
      const { status } = await api(`/v1/admin/commission/credits/${creditId}/valider-double`, {
        method: 'POST', token: gestionnaireToken,
      });
      assert.equal(status, 403);
    });

    test('l\'opérateur (compte technique) fait la double validation post-commission', async () => {
      const adminToken = await loginStaff('admin');
      const { status, body } = await api(`/v1/admin/commission/credits/${creditId}/valider-double`, {
        method: 'POST', token: adminToken,
      });
      assert.equal(status, 200);
      assert.equal(body.status, 'valide_double');
    });

    test('un gestionnaire ne peut plus donner l\'approbation finale', async () => {
      const gestionnaireToken = await loginStaff('gestionnaire');
      const { status } = await api(`/v1/admin/credits/${creditId}/approuver`, {
        method: 'POST', token: gestionnaireToken,
      });
      assert.equal(status, 403);
    });

    test('séparation des tâches : qui a validé le premier niveau ne peut pas approuver au final', async () => {
      const adminToken = await loginStaff('admin');
      const { status, body } = await api(`/v1/admin/credits/${creditId}/approuver`, {
        method: 'POST', token: adminToken,
      });
      assert.equal(status, 403);
      assert.match(body.error, /premier niveau/);
    });

    test('le directeur approuve et débloque les fonds', async () => {
      const directeurToken = await loginStaff('directeur');
      await fundCaissePrincipale();
      const { status, body } = await api(`/v1/admin/credits/${creditId}/approuver`, {
        method: 'POST', token: directeurToken,
      });
      assert.equal(status, 200);
      assert.ok(body.monthly_payment > 0);
    });

    test('les échéances sont générées pour la durée exacte du crédit', async () => {
      const { body } = await api('/v1/client/credits', { token: clientToken });
      const active = body.activeCredit;
      assert.ok(active, 'un crédit actif doit exister après approbation');
      assert.equal(active.status, 'approuve');
      assert.equal(active.installments.length, 6);
      assert.equal(active.paidMonths, 0);
    });

    test('le solde du compte reflète le déblocage des fonds, net de la commission crédit (1 %)', async () => {
      const { body } = await api('/v1/client/compte', { token: clientToken });
      // 300 000 débloqués moins 1 % de commission crédit (3 000) = 297 000 net minimum.
      assert.ok(body.account.balance >= 297000);
    });

    let secondCreditId;

    test('une nouvelle demande redevient possible une fois le crédit actif traité', async () => {
      const { status, body } = await api('/v1/client/credits', {
        method: 'POST',
        token: clientToken,
        body: { produitId, montant: 60000, duree: 3, motif: 'Second dossier' },
      });
      assert.equal(status, 201);
      assert.equal(body.status, 'en_verification');
      secondCreditId = body.id;
    });

    test('un opérateur rejette avant le comité, avec motif', async () => {
      const operateurToken = await loginStaff('operateur');
      const { status, body } = await api(`/v1/admin/credits/${secondCreditId}/rejeter`, {
        method: 'POST',
        token: operateurToken,
        body: { motif: 'Pièces justificatives incomplètes' },
      });
      assert.equal(status, 200);
      assert.equal(body.status, 'rejete');
    });

    test('un dossier rejeté ne peut plus être approuvé', async () => {
      const directeurToken = await loginStaff('directeur');
      const { status, body } = await api(`/v1/admin/credits/${secondCreditId}/approuver`, {
        method: 'POST',
        token: directeurToken,
      });
      assert.equal(status, 409);
      assert.match(body.error, /commission/);
    });

    test('un client avec un crédit actif ne peut pas être redéposé sans autorisation du directeur', async () => {
      const { body: created } = await api('/v1/client/credits', {
        method: 'POST', token: clientToken,
        body: { produitId, montant: 55000, duree: 3, motif: 'Troisième dossier' },
      });
      const operateurToken = await loginStaff('operateur');
      await api(`/v1/admin/credits/${created.id}/valider-niveau1`, { method: 'POST', token: operateurToken });

      const gestionnaireToken = await loginStaff('gestionnaire');
      const { body: session } = await api('/v1/admin/commission/seance', {
        method: 'POST', token: gestionnaireToken, body: { dateHeure: '2026-09-17T10:00' },
      });
      const { status, body } = await api(`/v1/admin/commission/credits/${created.id}/deposer`, {
        method: 'POST', token: gestionnaireToken,
      });
      assert.equal(status, 403);
      assert.match(body.error, /autorisation spéciale/);

      const { body: compte } = await api('/v1/client/compte', { token: clientToken });
      void compte;
      const directeurToken = await loginStaff('directeur');
      const { body: utilisateurs } = await api('/v1/admin/utilisateurs', { token: directeurToken });
      const clientUser = utilisateurs.utilisateurs.find((u) => u.phone === clientPhone);
      const { status: authStatus } = await api('/v1/admin/commission/autorisations', {
        method: 'POST', token: directeurToken,
        body: { clientId: clientUser.id, motif: 'Situation exceptionnelle validée par la direction' },
      });
      assert.equal(authStatus, 201);

      const { status: secondAttempt } = await api(`/v1/admin/commission/credits/${created.id}/deposer`, {
        method: 'POST', token: gestionnaireToken,
      });
      assert.equal(secondAttempt, 201);

      // Referme la séance pour ne pas bloquer les fichiers de tests
      // suivants, qui partagent la même base.
      await api(`/v1/admin/commission/seance/${session.id}/tenir`, {
        method: 'POST', token: directeurToken,
        body: { decisions: [{ creditId: created.id, decision: 'rejete', note: 'Clôture de test' }] },
      });
    });

    describe('modification dune demande par le client', () => {
    // Un client frais par test : la règle « une seule demande en cours »
    // empêcherait sinon le test suivant de créer la sienne, puisque le
    // test précédent laisse toujours une demande active derrière lui.
    async function freshClient() {
      const gestionnaireToken = await loginStaff('gestionnaire');
      const phone = `+24108${String(Math.floor(Math.random() * 900000) + 100000)}`;
      const { body: client } = await api('/v1/admin/utilisateurs', {
        method: 'POST', token: gestionnaireToken,
        body: { nomComplet: 'Client Modif Test', telephone: phone, role: 'client' },
      });
      await api('/v1/auth/activer-compte', {
        method: 'POST',
        body: { phone, clientNumber: client.client_number, nouveauPin: '1234' },
      });
      return loginClient(phone, '1234');
    }

    test('modifier avant toute validation fonctionne', async () => {
      const clientToken = await freshClient();
      const { body: created } = await api('/v1/client/credits', {
        method: 'POST', token: clientToken, body: { montant: 100000, duree: 3 },
      });
      const { status, body } = await api(`/v1/client/credits/${created.id}`, {
        method: 'PATCH', token: clientToken, body: { montant: 150000, duree: 6 },
      });
      assert.equal(status, 200);
      assert.equal(body.amount, 150000);
      assert.equal(body.status, 'en_verification');
    });

    test('modifier après validation niveau 1 remet la demande en vérification', async () => {
      const clientToken = await freshClient();
      const { body: created } = await api('/v1/client/credits', {
        method: 'POST', token: clientToken, body: { montant: 100000, duree: 3 },
      });
      const operateurToken = await loginStaff('operateur');
      await api(`/v1/admin/credits/${created.id}/valider-niveau1`, { method: 'POST', token: operateurToken });

      const { body: modified } = await api(`/v1/client/credits/${created.id}`, {
        method: 'PATCH', token: clientToken, body: { montant: 300000, duree: 12 },
      });
      assert.equal(modified.status, 'en_verification');
      assert.equal(modified.amount, 300000);
    });

    test('impossible de modifier une fois en commission', async () => {
      const clientToken = await freshClient();
      const { body: created } = await api('/v1/client/credits', {
        method: 'POST', token: clientToken, body: { montant: 100000, duree: 3 },
      });
      const operateurToken = await loginStaff('operateur');
      const gestionnaireToken = await loginStaff('gestionnaire');
      await api(`/v1/admin/credits/${created.id}/valider-niveau1`, { method: 'POST', token: operateurToken });

      // S'assure qu'une séance existe avant de tenter le dépôt — sans
      // ça, un dépôt refusé laisserait le dossier en « valide_niveau1 »
      // (encore modifiable), et le test échouerait pour une tout autre
      // raison que celle qu'il vérifie.
      const { body: seanceActuelle } = await api('/v1/admin/commission/seance', { token: gestionnaireToken });
      if (!seanceActuelle.seance) {
        await api('/v1/admin/commission/seance', {
          method: 'POST', token: gestionnaireToken, body: { dateHeure: '2026-09-15T09:00' },
        });
      }
      const { status: depositStatus } = await api(`/v1/admin/commission/credits/${created.id}/deposer`, {
        method: 'POST', token: gestionnaireToken,
      });
      assert.equal(depositStatus, 201);

      const { status, body } = await api(`/v1/client/credits/${created.id}`, {
        method: 'PATCH', token: clientToken, body: { montant: 500000, duree: 12 },
      });
      assert.equal(status, 409);
      assert.match(body.error, /commission/);
    });

    test('un client ne peut pas modifier la demande dun autre', async () => {
      const clientToken = await freshClient();
      const { body: created } = await api('/v1/client/credits', {
        method: 'POST', token: clientToken, body: { montant: 100000, duree: 3 },
      });
      const autreClientToken = await freshClient();
      const { status } = await api(`/v1/client/credits/${created.id}`, {
        method: 'PATCH', token: autreClientToken, body: { montant: 500000, duree: 12 },
      });
      assert.equal(status, 404);
    });
  });
  }
);
