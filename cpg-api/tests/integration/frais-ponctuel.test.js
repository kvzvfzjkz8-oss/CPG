/**
 * ═══════════════════════════════════════════════════════════════════
 *  RATTRAPAGE PONCTUEL D'UN FRAIS DE TENUE OU D'AGIOS
 * ═══════════════════════════════════════════════════════════════════
 *
 * « Il faut que l'opérateur ait la possibilité de retirer les frais de
 *   tenue de compte ou agios ponctuellement à un client si elle
 *   constate que cela n'a pas été fait par le logiciel. »
 *
 * Ce que ces tests protègent, dans l'ordre d'importance :
 *
 *   1. l'impossibilité de prélever DEUX FOIS le même mois. C'est
 *      l'incident du 14/10/2026 : 189 comptes reprélevés, 1 228 500 F.
 *   2. l'impossibilité pour l'opératrice de prélever seule — le
 *      directeur valide, règle sans exception.
 *   3. l'impossibilité d'inventer un montant : il vient du barème.
 *   4. le fait qu'un frais soit dû MÊME sans provision — le seul
 *      mouvement autorisé à mettre un compte au rouge.
 *
 * Fichier séparé : src/app.js plafonne à 120 requêtes par minute et
 * node --test lance un processus par fichier, donc chaque fichier
 * repart d'un compteur neuf.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer, stopTestServer, api, loginStaff, hasTestDatabase,
} from '../helpers/testServer.js';

let caissierToken;
let directeurToken;
let operateurToken;
let gestionnaireToken;
let clientId;
let clientSansFondsId;

const moisCourant = () => new Date().toISOString().slice(0, 7);

/** Le mois civil précédent, pour tester un rattrapage sur le passé. */
const moisPrecedent = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1))
    .toISOString().slice(0, 7);
};

async function creerClient(gestionnaire, nom) {
  const phone = `+24104${String(Math.floor(Math.random() * 900000) + 100000)}`;
  const { body } = await api('/v1/admin/utilisateurs', {
    method: 'POST', token: gestionnaire,
    body: { nomComplet: nom, telephone: phone, role: 'client' },
  });
  await api('/v1/auth/activer-compte', {
    method: 'POST',
    body: { phone, clientNumber: body.client_number, nouveauPin: '1234' },
  });
  return body.id;
}

before(async () => {
  await startTestServer();
  if (!hasTestDatabase()) return;

  gestionnaireToken = await loginStaff('gestionnaire');
  directeurToken = await loginStaff('directeur');
  operateurToken = await loginStaff('operateur');

  const caissiereEmail = `caissiere.frais.${Date.now()}@cpg.ga`;
  const caissierePhone = `+24105${String(Math.floor(Math.random() * 900000) + 100000)}`;
  await api('/v1/admin/utilisateurs', {
    method: 'POST', token: gestionnaireToken,
    body: {
      nomComplet: 'Caissière Frais', telephone: caissierePhone,
      email: caissiereEmail, role: 'caissier', motDePasse: 'MotDePasseDemo2026!',
    },
  });
  caissierToken = await loginStaff(caissiereEmail);

  clientId = await creerClient(gestionnaireToken, 'Client Frais Ponctuel');
  clientSansFondsId = await creerClient(gestionnaireToken, 'Client Sans Provision');

  // De quoi payer les frais sur le premier client.
  await api('/v1/caisse/encaissements', {
    method: 'POST', token: caissierToken, body: { clientId, montant: 50000 },
  });
});

after(async () => {
  await stopTestServer();
});

async function soldeDe(id) {
  const { body } = await api(`/v1/caisse/clients/${id}/transactions`, { token: caissierToken });
  return Number(body.client.balance);
}

async function transactionsDe(id) {
  const { body } = await api(`/v1/caisse/clients/${id}/transactions`, { token: caissierToken });
  return body.transactions ?? [];
}

describe(
  'Rattrapage ponctuel d’un frais',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    test('l’aperçu donne le montant du barème, sans rien écrire', async () => {
      const avant = await soldeDe(clientId);

      const { status, body } = await api('/v1/admin/operations/frais-ponctuels/apercu', {
        method: 'POST', token: operateurToken,
        body: { clientId, nature: 'frais_tenue', periode: moisCourant() },
      });

      assert.equal(status, 200);
      assert.ok(body.montant > 0, 'le barème doit donner un montant');
      assert.equal(body.dejaPreleve, null);
      assert.equal(body.nature, 'frais_tenue');
      assert.equal(await soldeDe(clientId), avant, 'un aperçu ne touche à rien');
    });

    test('un mois non écoulé est refusé', async () => {
      const d = new Date();
      const futur = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 1))
        .toISOString().slice(0, 7);
      const { status } = await api('/v1/admin/operations/frais-ponctuels', {
        method: 'POST', token: operateurToken,
        body: { clientId, nature: 'frais_tenue', periode: futur, motif: 'Prélèvement anticipé' },
      });
      assert.equal(status, 422);
    });

    test('un gestionnaire ne peut pas demander de rattrapage', async () => {
      const { status } = await api('/v1/admin/operations/frais-ponctuels', {
        method: 'POST', token: gestionnaireToken,
        body: { clientId, nature: 'frais_tenue', periode: moisCourant(), motif: 'Tentative' },
      });
      assert.equal(status, 403);
    });

    // Le cœur du circuit : demande, attente, validation, écriture.
    test('la demande attend le directeur, puis le frais est prélevé', async () => {
      const avant = await soldeDe(clientId);

      const { status, body: demande } = await api('/v1/admin/operations/frais-ponctuels', {
        method: 'POST', token: operateurToken,
        body: {
          clientId, nature: 'frais_tenue', periode: moisCourant(),
          motif: 'Non prélevé par le logiciel, agent crédité le 28',
        },
      });
      assert.equal(status, 201);
      assert.equal(demande.statut, 'en_attente');
      assert.ok(demande.montant > 0);
      assert.equal(await soldeDe(clientId), avant, 'rien n’est prélevé avant validation');

      // Le directeur doit voir la nature ET le mois : un montant seul
      // ne permet pas de décider.
      const { body: attente } = await api('/v1/caisse/demandes-en-attente', { token: directeurToken });
      const vue = attente.demandes.find((d) => d.id === demande.id);
      assert.ok(vue, 'la demande doit arriver sous les yeux du directeur');
      assert.equal(vue.type, 'frais_ponctuel');
      assert.equal(vue.nature_frais, 'frais_tenue');
      assert.equal(vue.periode_frais, moisCourant());

      const { status: valide } = await api(`/v1/caisse/operations/${demande.id}/valider`, {
        method: 'POST', token: directeurToken,
      });
      assert.equal(valide, 200);

      assert.equal(
        await soldeDe(clientId), avant - Number(demande.montant),
        'le client est débité du montant du barème'
      );

      // L'écriture doit être de type « frais », pas « retrait » :
      // sinon elle disparaît des relevés de frais.
      const ecritures = await transactionsDe(clientId);
      const frais = ecritures.find((e) => e.type === 'frais');
      assert.ok(frais, 'l’écriture doit être de type frais');
    });

    test('le même mois ne peut pas être prélevé deux fois', async () => {
      const avant = await soldeDe(clientId);
      const { status, body } = await api('/v1/admin/operations/frais-ponctuels', {
        method: 'POST', token: operateurToken,
        body: {
          clientId, nature: 'frais_tenue', periode: moisCourant(),
          motif: 'Seconde tentative sur le même mois',
        },
      });
      assert.equal(status, 409);
      assert.match(body.error, /déjà/i);
      assert.equal(await soldeDe(clientId), avant, 'aucun second débit');
    });

    test('l’aperçu signale désormais que le mois est déjà réglé', async () => {
      const { body } = await api('/v1/admin/operations/frais-ponctuels/apercu', {
        method: 'POST', token: operateurToken,
        body: { clientId, nature: 'frais_tenue', periode: moisCourant() },
      });
      assert.ok(body.dejaPreleve, 'l’opératrice doit l’apprendre avant de soumettre');
      assert.ok(body.dejaPreleve.montant > 0);
    });

    test('un mois différent reste prélevable', async () => {
      const { status } = await api('/v1/admin/operations/frais-ponctuels', {
        method: 'POST', token: operateurToken,
        body: {
          clientId, nature: 'frais_tenue', periode: moisPrecedent(),
          motif: 'Rattrapage du mois précédent, oublié',
        },
      });
      assert.equal(status, 201);
    });

    test('deux demandes en attente pour le même mois sont impossibles', async () => {
      const { status, body } = await api('/v1/admin/operations/frais-ponctuels', {
        method: 'POST', token: operateurToken,
        body: {
          clientId, nature: 'frais_tenue', periode: moisPrecedent(),
          motif: 'Doublon de la demande déjà en attente',
        },
      });
      assert.equal(status, 409);
      assert.match(body.error, /attend déjà/i);
    });

    // Règle de la direction : « il ne doit y avoir que le négatif des
    // frais de tenue de compte ». Un frais est donc dû sans provision.
    test('un frais est prélevé même sans provision et met le compte au rouge', async () => {
      assert.equal(await soldeDe(clientSansFondsId), 0, 'le compte part de zéro');

      const { status, body: demande } = await api('/v1/admin/operations/frais-ponctuels', {
        method: 'POST', token: operateurToken,
        body: {
          clientId: clientSansFondsId, nature: 'frais_tenue', periode: moisCourant(),
          motif: 'Frais dû malgré un compte sans provision',
        },
      });
      assert.equal(status, 201, 'un solde nul ne doit pas bloquer la demande');

      const { status: valide } = await api(`/v1/caisse/operations/${demande.id}/valider`, {
        method: 'POST', token: directeurToken,
      });
      assert.equal(valide, 200, 'un solde nul ne doit pas bloquer la validation');
      assert.equal(
        await soldeDe(clientSansFondsId), -Number(demande.montant),
        'le compte passe au rouge du montant du frais, et de rien d’autre'
      );
    });

    test('un rattrapage ne touche à aucune caisse', async () => {
      const { body: avant } = await api('/v1/caisse/ma-caisse', { token: caissierToken });
      const { body: avantPrincipale } = await api('/v1/caisse/principale', { token: directeurToken });

      const { body: demande } = await api('/v1/admin/operations/frais-ponctuels', {
        method: 'POST', token: operateurToken,
        body: {
          clientId: clientSansFondsId, nature: 'frais_tenue', periode: moisPrecedent(),
          motif: 'Vérification qu’aucune caisse ne bouge',
        },
      });
      await api(`/v1/caisse/operations/${demande.id}/valider`, {
        method: 'POST', token: directeurToken,
      });

      const { body: apres } = await api('/v1/caisse/ma-caisse', { token: caissierToken });
      const { body: apresPrincipale } = await api('/v1/caisse/principale', { token: directeurToken });
      assert.equal(Number(apres.solde), Number(avant.solde), 'le tiroir de la caissière ne bouge pas');
      assert.equal(
        Number(apresPrincipale.solde), Number(avantPrincipale.solde),
        'la caisse principale non plus — comme pour le prélèvement automatique'
      );
    });
  }
);
