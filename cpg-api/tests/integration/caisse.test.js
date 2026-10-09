import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer, stopTestServer, api, loginStaff, hasTestDatabase,
} from '../helpers/testServer.js';

let caissierToken;
let directeurToken;
let clientId;

before(async () => {
  await startTestServer();
  if (!hasTestDatabase()) return;

  const gestionnaireToken = await loginStaff('gestionnaire');
  directeurToken = await loginStaff('directeur');

  // Une caissière dédiée à ce fichier de tests, avec le même mot de
  // passe de démonstration que les autres comptes — ça permet de
  // réutiliser loginStaff() (et son cache de jetons, précieux pour ne
  // pas épuiser le limiteur de connexions) au lieu de gérer un jeton
  // à part.
  const caissiereEmail = `caissiere.test.${Date.now()}@cpg.ga`;
  const caissierePhone = `+24105${String(Math.floor(Math.random() * 900000) + 100000)}`;
  await api('/v1/admin/utilisateurs', {
    method: 'POST', token: gestionnaireToken,
    body: {
      nomComplet: 'Caissière Test', telephone: caissierePhone,
      email: caissiereEmail, role: 'caissier', motDePasse: 'MotDePasseDemo2026!',
    },
  });
  caissierToken = await loginStaff(caissiereEmail);

  // Un client avec un solde nul suffit pour tester la recherche, le
  // RIB, et le refus d'un retrait qui dépasserait le solde — les tests
  // de solde réellement débité sont déjà couverts par
  // client-activation.test.js et n'ont pas besoin d'être reproduits ici.
  const clientPhone = `+24104${String(Math.floor(Math.random() * 900000) + 100000)}`;
  const { body: client } = await api('/v1/admin/utilisateurs', {
    method: 'POST', token: gestionnaireToken,
    body: { nomComplet: 'Client Caisse Test', telephone: clientPhone, role: 'client' },
  });
  await api('/v1/auth/activer-compte', {
    method: 'POST',
    body: { phone: clientPhone, clientNumber: client.client_number, nouveauPin: '1234' },
  });
  clientId = client.id;

  // Une réserve confortable et unique pour tout ce fichier : un appro
  // ne peut désormais être validé que si la caisse principale peut
  // réellement le couvrir (voir 016_caisse_soldes_v2.sql).
  await api('/v1/caisse/principale/alimenter', {
    method: 'POST', token: directeurToken,
    body: { montant: 5000000, motif: 'Fonds de test' },
  });
});


after(async () => {
  await stopTestServer();
});

describe(
  'La Caisse',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    test('une caissière peut rechercher un client par nom', async () => {
      const { status, body } = await api('/v1/caisse/rechercher-client?q=Caisse Test', {
        token: caissierToken,
      });
      assert.equal(status, 200);
      assert.ok(body.resultats.some((r) => r.id === clientId));
    });

    test('un opérateur n\'a pas accès à la recherche caisse', async () => {
      const operateurToken = await loginStaff('operateur');
      const { status } = await api('/v1/caisse/rechercher-client?q=test', { token: operateurToken });
      assert.equal(status, 403);
    });

    test('une demande de retrait sur un solde nul est refusée', async () => {
      const { status } = await api('/v1/caisse/retraits', {
        method: 'POST', token: caissierToken,
        body: { clientId, montant: 5000 },
      });
      assert.equal(status, 422);
    });

    test('une demande d\'appro est créée en attente', async () => {
      const { status, body } = await api('/v1/caisse/appro', {
        method: 'POST', token: caissierToken,
        body: { montant: 100000, motif: 'Test' },
      });
      assert.equal(status, 201);
      assert.equal(body.statut, 'en_attente');
    });

    test('un opérateur ne peut pas valider une demande de caisse', async () => {
      const operateurToken = await loginStaff('operateur');
      const { body: appro } = await api('/v1/caisse/appro', {
        method: 'POST', token: caissierToken, body: { montant: 50000 },
      });
      const { status } = await api(`/v1/caisse/operations/${appro.id}/valider`, {
        method: 'POST', token: operateurToken,
      });
      assert.equal(status, 403);
    });

    test('le directeur valide une appro, le solde de la caisse augmente', async () => {
      const { body: avant } = await api('/v1/caisse/ma-caisse', { token: caissierToken });
      const { body: appro } = await api('/v1/caisse/appro', {
        method: 'POST', token: caissierToken, body: { montant: 75000 },
      });
      await api(`/v1/caisse/operations/${appro.id}/valider`, {
        method: 'POST', token: directeurToken,
      });
      const { body: apres } = await api('/v1/caisse/ma-caisse', { token: caissierToken });
      assert.equal(apres.solde, avant.solde + 75000);
    });

    test('le directeur peut rejeter une demande avec motif', async () => {
      const { body: appro } = await api('/v1/caisse/appro', {
        method: 'POST', token: caissierToken, body: { montant: 20000 },
      });
      const { status, body } = await api(`/v1/caisse/operations/${appro.id}/rejeter`, {
        method: 'POST', token: directeurToken,
        body: { motif: 'Budget déjà suffisant' },
      });
      assert.equal(status, 200);
      assert.equal(body.statut, 'rejetee');
    });

    test('rejeter sans motif est refusé', async () => {
      const { body: appro } = await api('/v1/caisse/appro', {
        method: 'POST', token: caissierToken, body: { montant: 20000 },
      });
      const { status } = await api(`/v1/caisse/operations/${appro.id}/rejeter`, {
        method: 'POST', token: directeurToken, body: {},
      });
      assert.equal(status, 422);
    });

    test('valider deux fois la même demande échoue proprement', async () => {
      const { body: appro } = await api('/v1/caisse/appro', {
        method: 'POST', token: caissierToken, body: { montant: 10000 },
      });
      await api(`/v1/caisse/operations/${appro.id}/valider`, { method: 'POST', token: directeurToken });
      const { status } = await api(`/v1/caisse/operations/${appro.id}/valider`, {
        method: 'POST', token: directeurToken,
      });
      assert.equal(status, 409);
    });

    test('approvisionner la caisse deux fois de suite cumule bien le solde', async () => {
      const { body: avant } = await api('/v1/caisse/ma-caisse', { token: caissierToken });
      const { body: appro1 } = await api('/v1/caisse/appro', {
        method: 'POST', token: caissierToken, body: { montant: 30000 },
      });
      await api(`/v1/caisse/operations/${appro1.id}/valider`, { method: 'POST', token: directeurToken });
      const { body: appro2 } = await api('/v1/caisse/appro', {
        method: 'POST', token: caissierToken, body: { montant: 20000 },
      });
      await api(`/v1/caisse/operations/${appro2.id}/valider`, { method: 'POST', token: directeurToken });

      const { body: apres } = await api('/v1/caisse/ma-caisse', { token: caissierToken });
      assert.equal(apres.solde, avant.solde + 50000);
    });

    test('le RIB inclut le nom du gestionnaire créateur', async () => {
      const { status, body } = await api(`/v1/caisse/rib/${clientId}`, { token: caissierToken });
      assert.equal(status, 200);
      assert.equal(body.full_name, 'Client Caisse Test');
      assert.ok(body.gestionnaire);
    });
  }
);

describe(
  'Caisse principale, dépenses et encaissements',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    test('un opérateur n\'a pas accès à la caisse principale', async () => {
      const operateurToken = await loginStaff('operateur');
      const { status } = await api('/v1/caisse/principale', { token: operateurToken });
      assert.equal(status, 403);
    });

    test('alimenter la caisse principale augmente son solde', async () => {
      const { body: avant } = await api('/v1/caisse/principale', { token: directeurToken });
      await api('/v1/caisse/principale/alimenter', {
        method: 'POST', token: directeurToken, body: { montant: 200000, motif: 'Test' },
      });
      const { body: apres } = await api('/v1/caisse/principale', { token: directeurToken });
      assert.equal(apres.solde, avant.solde + 200000);
    });

    test('un appro qui dépasse la caisse principale est refusé à la validation', async () => {
      const { body: principale } = await api('/v1/caisse/principale', { token: directeurToken });
      const { body: appro } = await api('/v1/caisse/appro', {
        method: 'POST', token: caissierToken,
        body: { montant: principale.solde + 1000000 },
      });
      const { status } = await api(`/v1/caisse/operations/${appro.id}/valider`, {
        method: 'POST', token: directeurToken,
      });
      assert.equal(status, 422);
    });

    test('un appro validé débite bien la caisse principale', async () => {
      const { body: avant } = await api('/v1/caisse/principale', { token: directeurToken });
      const { body: appro } = await api('/v1/caisse/appro', {
        method: 'POST', token: caissierToken, body: { montant: 40000 },
      });
      await api(`/v1/caisse/operations/${appro.id}/valider`, { method: 'POST', token: directeurToken });
      const { body: apres } = await api('/v1/caisse/principale', { token: directeurToken });
      assert.equal(apres.solde, avant.solde - 40000);
    });

    test('un encaissement client s\'applique immédiatement, sans validation', async () => {
      const { body } = await api('/v1/caisse/encaissements', {
        method: 'POST', token: caissierToken,
        body: { clientId, montant: 30000, motif: 'Dépôt guichet' },
      });
      assert.equal(body.statut, 'validee');
    });

    test('un encaissement client augmente le solde du client', async () => {
      const clientToken = await loginStaff('operateur'); // juste pour lire les infos via l'admin
      const { body: avant } = await api(`/v1/caisse/rechercher-client?q=Client Caisse Test`, { token: caissierToken });
      await api('/v1/caisse/encaissements', {
        method: 'POST', token: caissierToken,
        body: { clientId, montant: 15000 },
      });
      const { body: apres } = await api(`/v1/caisse/rechercher-client?q=Client Caisse Test`, { token: caissierToken });
      assert.equal(apres.resultats[0].balance, avant.resultats[0].balance + 15000);
      void clientToken;
    });

    test('une dépense de fonctionnement attend la validation du directeur', async () => {
      const { body } = await api('/v1/caisse/depenses', {
        method: 'POST', token: caissierToken,
        body: { montant: 5000, motif: 'Fournitures' },
      });
      assert.equal(body.statut, 'en_attente');
    });

    test('une dépense validée réduit le solde de la caisse', async () => {
      const { body: avant } = await api('/v1/caisse/ma-caisse', { token: caissierToken });
      const { body: depense } = await api('/v1/caisse/depenses', {
        method: 'POST', token: caissierToken, body: { montant: 8000, motif: 'Test' },
      });
      await api(`/v1/caisse/operations/${depense.id}/valider`, { method: 'POST', token: directeurToken });
      const { body: apres } = await api('/v1/caisse/ma-caisse', { token: caissierToken });
      assert.equal(apres.solde, avant.solde - 8000);
    });

    test('une caissière ne peut pas alimenter la caisse principale', async () => {
      const { status } = await api('/v1/caisse/principale/alimenter', {
        method: 'POST', token: caissierToken, body: { montant: 10000, motif: 'x' },
      });
      assert.equal(status, 403);
    });
  }
);

describe(
  'Clôture quotidienne de caisse',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    test('clôturer une caisse sous le plafond ne renvoie aucun excédent', async () => {
      const gestionnaireToken = await loginStaff('gestionnaire');
      const phone = `+24106${String(Math.floor(Math.random() * 900000) + 100000)}`;
      const email = `caissiere.cloture.${Date.now()}@cpg.ga`;
      await api('/v1/admin/utilisateurs', {
        method: 'POST', token: gestionnaireToken,
        body: { nomComplet: 'Caissière Clôture', telephone: phone, email, role: 'caissier', motDePasse: 'MotDePasseDemo2026!' },
      });
      const token = await loginStaff(email);

      const { status, body } = await api('/v1/caisse/clore', { method: 'POST', token });
      assert.equal(status, 201);
      assert.equal(body.excedent_renvoye, 0);
    });

    test('clôturer une caisse au-dessus du plafond renvoie l\'excédent à la caisse principale', async () => {
      const gestionnaireToken = await loginStaff('gestionnaire');
      const phone = `+24106${String(Math.floor(Math.random() * 900000) + 100000)}`;
      const email = `caissiere.cloture2.${Date.now()}@cpg.ga`;
      await api('/v1/admin/utilisateurs', {
        method: 'POST', token: gestionnaireToken,
        body: { nomComplet: 'Caissière Clôture 2', telephone: phone, email, role: 'caissier', motDePasse: 'MotDePasseDemo2026!' },
      });
      const token = await loginStaff(email);

      const { body: appro } = await api('/v1/caisse/appro', {
        method: 'POST', token, body: { montant: 350000 },
      });
      await api(`/v1/caisse/operations/${appro.id}/valider`, { method: 'POST', token: directeurToken });

      const { body: principaleAvant } = await api('/v1/caisse/principale', { token: directeurToken });

      const { body: cloture } = await api('/v1/caisse/clore', { method: 'POST', token });
      assert.equal(cloture.solde_avant, 350000);
      assert.equal(cloture.excedent_renvoye, 150000);

      const { body: soldeFinal } = await api('/v1/caisse/ma-caisse', { token });
      assert.equal(soldeFinal.solde, 200000);

      const { body: principaleApres } = await api('/v1/caisse/principale', { token: directeurToken });
      assert.equal(principaleApres.solde, principaleAvant.solde + 150000);
    });

    test('une deuxième clôture le même jour échoue', async () => {
      const gestionnaireToken = await loginStaff('gestionnaire');
      const phone = `+24106${String(Math.floor(Math.random() * 900000) + 100000)}`;
      const email = `caissiere.cloture3.${Date.now()}@cpg.ga`;
      await api('/v1/admin/utilisateurs', {
        method: 'POST', token: gestionnaireToken,
        body: { nomComplet: 'Caissière Clôture 3', telephone: phone, email, role: 'caissier', motDePasse: 'MotDePasseDemo2026!' },
      });
      const token = await loginStaff(email);

      await api('/v1/caisse/clore', { method: 'POST', token });
      const { status } = await api('/v1/caisse/clore', { method: 'POST', token });
      assert.equal(status, 409);
    });

    test('un opérateur ne peut pas clôturer une caisse', async () => {
      const operateurToken = await loginStaff('operateur');
      const { status } = await api('/v1/caisse/clore', { method: 'POST', token: operateurToken });
      assert.equal(status, 403);
    });
  }
);

describe(
  'Retrait payé par Mobile Money plutôt qu\'en espèces',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    test('un retrait Airtel Money sans numéro est refusé', async () => {
      const { status } = await api('/v1/caisse/retraits', {
        method: 'POST', token: caissierToken,
        body: { clientId, montant: 5000, modePaiement: 'airtel' },
      });
      assert.equal(status, 422);
    });

    test('un retrait Airtel Money validé débite le client et crée une transaction momo', async () => {
      // Un solde réel est nécessaire : encaisse d'abord.
      await api('/v1/caisse/encaissements', {
        method: 'POST', token: caissierToken, body: { clientId, montant: 60000 },
      });

      const { body: retrait } = await api('/v1/caisse/retraits', {
        method: 'POST', token: caissierToken,
        body: { clientId, montant: 20000, modePaiement: 'airtel', telephonePaiement: '+24106000099' },
      });
      assert.equal(retrait.mode_paiement, 'airtel');

      const { status, body: valide } = await api(`/v1/caisse/operations/${retrait.id}/valider`, {
        method: 'POST', token: directeurToken,
      });
      assert.equal(status, 200);
      assert.ok(valide.momo_transaction_id);
    });

    // L'argent d'un paiement Mobile Money part du telephone de la
    // caissiere, pas de son tiroir. Le decompter des especes faisait
    // afficher des caisses faussement a sec — au 09/10/2026, 1 233 374 F
    // d'ecart sur une seule caisse.
    test('un paiement Mobile Money ne touche pas aux espèces de la caissière', async () => {
      await api('/v1/caisse/encaissements', {
        method: 'POST', token: caissierToken, body: { clientId, montant: 60000 },
      });
      const { body: avant } = await api('/v1/caisse/ma-caisse', { token: caissierToken });

      const { body: retrait } = await api('/v1/caisse/retraits', {
        method: 'POST', token: caissierToken,
        body: { clientId, montant: 15000, modePaiement: 'moov', telephonePaiement: '+24106000099' },
      });
      await api(`/v1/caisse/operations/${retrait.id}/valider`, { method: 'POST', token: directeurToken });

      const { body: apres } = await api('/v1/caisse/ma-caisse', { token: caissierToken });
      assert.equal(apres.solde, avant.solde, 'les espèces ne doivent pas bouger');
    });

    // Le pendant du precedent : la caisse ne peut pas verser des
    // especes qu'elle n'a pas. Avant ce controle, seul le solde du
    // CLIENT etait verifie, et une caissiere a pu decaisser plus que
    // son stock.
    test('un retrait en espèces au-delà du stock de la caisse est refusé', async () => {
      // Le client doit avoir de quoi retirer SANS que la caisse ait de
      // quoi le servir. Un encaissement alimente les deux a la fois :
      // on provisionne donc le client, puis on vide la caisse par une
      // depense avant de tenter le retrait.
      await api('/v1/caisse/encaissements', {
        method: 'POST', token: caissierToken, body: { clientId, montant: 120000 },
      });
      const { body: avant } = await api('/v1/caisse/ma-caisse', { token: caissierToken });

      const { body: depense } = await api('/v1/caisse/depenses', {
        method: 'POST', token: caissierToken,
        body: { montant: Number(avant.solde), motif: 'Vidage de caisse pour le test' },
      });
      await api(`/v1/caisse/operations/${depense.id}/valider`, { method: 'POST', token: directeurToken });

      const { body: vide } = await api('/v1/caisse/ma-caisse', { token: caissierToken });
      assert.equal(Number(vide.solde), 0, 'la caisse doit être vide avant le test');

      const { body: retrait } = await api('/v1/caisse/retraits', {
        method: 'POST', token: caissierToken, body: { clientId, montant: 120000 },
      });
      const refus = await api(`/v1/caisse/operations/${retrait.id}/valider`, {
        method: 'POST', token: directeurToken,
      });
      assert.equal(refus.status, 422);
      assert.match(refus.body.error, /caisse/i);

      // La demande reste en attente : au directeur de la rejeter ou de
      // reapprovisionner, jamais au logiciel de trancher a sa place.
      const { body: apres } = await api('/v1/caisse/ma-caisse', { token: caissierToken });
      assert.ok(Number(apres.solde) >= 0, 'la caisse ne doit jamais passer sous zéro');
    });
  }
);
