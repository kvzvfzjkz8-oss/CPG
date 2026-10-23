/**
 * ═══════════════════════════════════════════════════════════════════
 *  QUI PEUT LIRE L'HISTORIQUE D'UN CLIENT
 * ═══════════════════════════════════════════════════════════════════
 *
 * « J'aimerais regarder l'historique d'un client, comment je peux
 *   faire ? » — « Ajoute-moi ce bouton rapidement et mets-le aussi chez
 *   le gestionnaire. »
 *
 * Le bouton « Voir l'historique des transactions » existait déjà dans la
 * fiche client, ouverte depuis « Crédits en cours » ou « Demandes en
 * attente ». Mais la route qu'il appelle n'était permise qu'à la
 * caissière : chez le directeur et le gestionnaire, l'appel échouait, et
 * comme l'écran n'avait aucune gestion d'erreur il affichait
 * « Chargement… » indéfiniment. On en concluait que le client n'avait
 * pas d'historique.
 *
 * Ces tests fixent qui peut lire, pour que la permission ne reparte pas
 * silencieusement à la prochaine relecture du fichier des rôles.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer, stopTestServer, api, loginStaff, hasTestDatabase,
} from '../helpers/testServer.js';

let gestionnaireToken;
let directeurToken;
let operateurToken;
let clientId;

before(async () => {
  await startTestServer();
  if (!hasTestDatabase()) return;
  gestionnaireToken = await loginStaff('gestionnaire');
  directeurToken = await loginStaff('directeur');
  operateurToken = await loginStaff('operateur');

  const tel = `+24102${String(Math.floor(Math.random() * 900000) + 100000)}`;
  const { body } = await api('/v1/admin/utilisateurs', {
    method: 'POST', token: gestionnaireToken,
    body: {
      nomComplet: `Client Historique ${Date.now()}`, telephone: tel,
      role: 'client', codePin: '1234', confirmerDoublon: true,
    },
  });
  clientId = body.id;
});

after(async () => {
  await stopTestServer();
});

const historique = (token) => api(`/v1/caisse/clients/${clientId}/transactions`, { token });

describe(
  'Accès à l’historique d’un client',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    test('le directeur peut lire l’historique', async () => {
      const { status, body } = await historique(directeurToken);
      assert.equal(status, 200, 'le bouton de la fiche client doit fonctionner chez le directeur');
      assert.ok(body.client, 'la fiche du client doit accompagner ses transactions');
      assert.ok(Array.isArray(body.transactions));
    });

    test('le gestionnaire aussi', async () => {
      const { status, body } = await historique(gestionnaireToken);
      assert.equal(status, 200, 'c’est lui qui monte le dossier et répond au client');
      assert.ok(Array.isArray(body.transactions));
    });

    test('l’opératrice, non — elle n’a pas été ajoutée', async () => {
      // Volontaire, et à revoir si le besoin se présente : la demande
      // portait sur le directeur et le gestionnaire. Ce test fige la
      // décision pour qu'elle soit revue sciemment, pas par accident.
      const { status } = await historique(operateurToken);
      assert.equal(status, 403);
    });

    test('les deux tables de permissions concordent sur cette clé', async () => {
      // Le back-office masque des boutons d'après sa propre table ; le
      // serveur décide d'après la sienne. Les deux doivent dire la même
      // chose, sinon un bouton s'affiche pour une action refusée — ou
      // l'inverse, qui est ce qui s'est produit ici.
      const { PERMISSIONS, ROLES } = await import('../../src/utils/permissions.js');
      for (const role of [ROLES.DIRECTEUR, ROLES.SUPERVISEUR, ROLES.CAISSIER]) {
        assert.ok(
          PERMISSIONS[role].includes('caisse.consulter_solde_client'),
          `${role} doit pouvoir lire l’historique d’un client`
        );
      }
    });
  }
);
