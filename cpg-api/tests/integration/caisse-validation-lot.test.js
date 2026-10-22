/**
 * ═══════════════════════════════════════════════════════════════════
 *  VALIDATION GROUPÉE DES DEMANDES DE CAISSE
 * ═══════════════════════════════════════════════════════════════════
 *
 * L'opératrice dépose parfois dix retraits en quelques minutes, et les
 * valider un par un faisait attendre le guichet. La validation groupée
 * supprime cette attente — mais elle ne doit rien supprimer du
 * contrôle. Ces tests vérifient précisément les deux :
 *
 *   • le lot valide bien plusieurs demandes d'un coup ;
 *   • chaque ligne subit les MÊMES vérifications que si elle avait été
 *     validée seule, et une ligne refusée n'emporte pas les autres.
 *
 * Fichier séparé de caisse.test.js à dessein : src/app.js plafonne à
 * 120 requêtes par fenêtre de 60 s, et node --test lance un processus
 * par fichier, donc chaque fichier repart d'un compteur neuf.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer, stopTestServer, api, loginStaff, hasTestDatabase,
} from '../helpers/testServer.js';

let caissierToken;
let directeurToken;
let operateurToken;
let clientId;

before(async () => {
  await startTestServer();
  if (!hasTestDatabase()) return;

  const gestionnaireToken = await loginStaff('gestionnaire');
  directeurToken = await loginStaff('directeur');
  operateurToken = await loginStaff('operateur');

  // Caissière et client propres à ce fichier : les numéros sont tirés
  // au hasard pour qu'un second passage sur la même base ne bute pas
  // sur un conflit d'unicité.
  const caissiereEmail = `caissiere.lot.${Date.now()}@cpg.ga`;
  const caissierePhone = `+24105${String(Math.floor(Math.random() * 900000) + 100000)}`;
  await api('/v1/admin/utilisateurs', {
    method: 'POST', token: gestionnaireToken,
    body: {
      nomComplet: 'Caissière Lot', telephone: caissierePhone,
      email: caissiereEmail, role: 'caissier', motDePasse: 'MotDePasseDemo2026!',
    },
  });
  caissierToken = await loginStaff(caissiereEmail);

  const clientPhone = `+24104${String(Math.floor(Math.random() * 900000) + 100000)}`;
  const { body: client } = await api('/v1/admin/utilisateurs', {
    method: 'POST', token: gestionnaireToken,
    body: { nomComplet: 'Client Validation Lot', telephone: clientPhone, role: 'client' },
  });
  await api('/v1/auth/activer-compte', {
    method: 'POST',
    body: { phone: clientPhone, clientNumber: client.client_number, nouveauPin: '1234' },
  });
  clientId = client.id;

  await api('/v1/caisse/principale/alimenter', {
    method: 'POST', token: directeurToken,
    body: { montant: 5000000, motif: 'Fonds de test validation groupée' },
  });
});

after(async () => {
  await stopTestServer();
});

/** Demande de récupération par CPG — ne touche aucun tiroir. */
async function demanderRecuperation(montant, motif) {
  const { status, body } = await api('/v1/admin/operations/retraits-ponctuels', {
    method: 'POST', token: operateurToken,
    body: { clientId, montant, destination: 'cpg', motif },
  });
  assert.equal(status, 201, `la demande de ${montant} aurait dû être acceptée`);
  return body.id;
}

async function soldeClient() {
  const { body } = await api(`/v1/caisse/clients/${clientId}/transactions`, { token: caissierToken });
  return Number(body.client.balance);
}

describe(
  'Validation groupée des demandes de caisse',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    test('un opérateur ne peut pas valider un lot', async () => {
      const { status } = await api('/v1/caisse/operations/valider-lot', {
        method: 'POST', token: operateurToken,
        body: { ids: ['00000000-0000-0000-0000-000000000000'] },
      });
      assert.equal(status, 403, 'seul le directeur valide — groupé ou non');
    });

    test('un lot vide est refusé', async () => {
      const { status } = await api('/v1/caisse/operations/valider-lot', {
        method: 'POST', token: directeurToken, body: { ids: [] },
      });
      assert.equal(status, 422);
    });

    test('le directeur valide trois demandes en une seule requête', async () => {
      await api('/v1/caisse/encaissements', {
        method: 'POST', token: caissierToken, body: { clientId, montant: 150000 },
      });
      const avant = await soldeClient();

      const ids = [
        await demanderRecuperation(10000, 'Récupération groupée, première ligne'),
        await demanderRecuperation(15000, 'Récupération groupée, deuxième ligne'),
        await demanderRecuperation(20000, 'Récupération groupée, troisième ligne'),
      ];

      const { status, body } = await api('/v1/caisse/operations/valider-lot', {
        method: 'POST', token: directeurToken, body: { ids },
      });

      assert.equal(status, 200);
      assert.equal(body.valides, 3);
      assert.equal(body.echecs, 0);
      assert.equal(body.montant_valide, 45000);
      assert.equal(await soldeClient(), avant - 45000, 'le client est débité des trois lignes');

      // Plus aucune des trois ne doit rester à valider.
      const { body: attente } = await api('/v1/caisse/demandes-en-attente', { token: directeurToken });
      const restantes = attente.demandes.filter((d) => ids.includes(d.id));
      assert.equal(restantes.length, 0);
    });

    // Le test qui compte vraiment : le solde est vérifié ligne par
    // ligne, DANS l'ordre, et une ligne qui ne passe plus ne doit ni
    // annuler les précédentes ni passer en force.
    test('une ligne dont le solde ne suffit plus n’emporte pas les autres', async () => {
      await api('/v1/caisse/encaissements', {
        method: 'POST', token: caissierToken, body: { clientId, montant: 100000 },
      });
      const avant = await soldeClient();

      // Chacune passe seule au moment de la demande (le solde les
      // couvre), mais pas les deux ensemble : la seconde doit échouer
      // à la validation parce que la première est déjà passée.
      const premier = await demanderRecuperation(
        Math.round(avant * 0.7), 'Première ligne, passe'
      );
      const second = await demanderRecuperation(
        Math.round(avant * 0.7), 'Seconde ligne, solde devenu insuffisant'
      );

      const { status, body } = await api('/v1/caisse/operations/valider-lot', {
        method: 'POST', token: directeurToken, body: { ids: [premier, second] },
      });

      assert.equal(status, 200, 'un échec partiel reste une réponse normale, pas une erreur');
      assert.equal(body.valides, 1);
      assert.equal(body.echecs, 1);

      const echec = body.resultats.find((r) => !r.ok);
      assert.equal(echec.id, second, 'c’est la seconde ligne qui ne passe pas');
      assert.match(echec.message, /solde/i, 'le motif du refus doit être lisible par le directeur');

      // La ligne refusée reste à valider : rien n'est perdu en silence.
      const { body: attente } = await api('/v1/caisse/demandes-en-attente', { token: directeurToken });
      assert.ok(
        attente.demandes.some((d) => d.id === second),
        'la demande refusée doit rester en attente'
      );

      assert.equal(
        await soldeClient(), avant - Math.round(avant * 0.7),
        'seule la première ligne a débité le client'
      );
    });

    test('valider deux fois le même lot ne débite pas deux fois', async () => {
      await api('/v1/caisse/encaissements', {
        method: 'POST', token: caissierToken, body: { clientId, montant: 60000 },
      });
      const id = await demanderRecuperation(12000, 'Ligne validée puis revalidée');

      const { body: premier } = await api('/v1/caisse/operations/valider-lot', {
        method: 'POST', token: directeurToken, body: { ids: [id] },
      });
      assert.equal(premier.valides, 1);
      const apresPremier = await soldeClient();

      const { body: second } = await api('/v1/caisse/operations/valider-lot', {
        method: 'POST', token: directeurToken, body: { ids: [id] },
      });
      assert.equal(second.valides, 0);
      assert.equal(second.echecs, 1);
      assert.equal(await soldeClient(), apresPremier, 'aucun second débit');
    });
  }
);
