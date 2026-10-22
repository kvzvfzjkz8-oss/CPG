/**
 * ═══════════════════════════════════════════════════════════════════
 *  RECHERCHE ET FILTRES DANS L'ONGLET UTILISATEURS
 * ═══════════════════════════════════════════════════════════════════
 *
 * « Il faut qu'au niveau de l'onglet utilisateur, on puisse juste en
 *   tapant le nom trouver le client. »
 *
 * Le problème n'était pas l'absence d'une barre de recherche : la
 * liste était plafonnée côté serveur, triée par nom. Passé ce plafond,
 * un client parfaitement existant n'apparaissait nulle part et semblait
 * absent du logiciel — un filtre dans le navigateur n'aurait cherché
 * que parmi les noms déjà chargés, donc n'aurait rien réglé.
 *
 * Ces tests vérifient les trois réponses apportées :
 *
 *   • la recherche se fait côté SERVEUR et atteint n'importe quel
 *     compte, quel que soit son rang alphabétique ;
 *   • elle tolère les fautes de frappe (« ROGE ERIC » trouve
 *     « ROGUE Eric ») et porte aussi sur le numéro client, le
 *     téléphone, l'e-mail et l'employeur ;
 *   • la réponse dit toujours le nombre TOTAL de comptes et si la
 *     liste est tronquée, pour ne plus laisser croire qu'elle montre
 *     tout.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer, stopTestServer, api, loginStaff, hasTestDatabase,
} from '../helpers/testServer.js';

let gestionnaireToken;
let caissierToken;
const marque = String(Date.now()).slice(-6);
const ENTREPRISE = `TESTCORP${marque}`;
let numeroClientRogue;

async function creerClient(nom, employeur) {
  const phone = `+24104${String(Math.floor(Math.random() * 900000) + 100000)}`;
  const { body } = await api('/v1/admin/utilisateurs', {
    method: 'POST', token: gestionnaireToken,
    body: {
      nomComplet: nom, telephone: phone, role: 'client',
      ...(employeur ? { employeur } : {}),
      // Des homonymes volontaires : le logiciel ne doit pas refuser la
      // création, seulement la signaler.
      confirmerDoublon: true,
    },
  });
  return body;
}

before(async () => {
  await startTestServer();
  if (!hasTestDatabase()) return;

  gestionnaireToken = await loginStaff('gestionnaire');

  const caissiereEmail = `caissiere.rech.${Date.now()}@cpg.ga`;
  const caissierePhone = `+24105${String(Math.floor(Math.random() * 900000) + 100000)}`;
  await api('/v1/admin/utilisateurs', {
    method: 'POST', token: gestionnaireToken,
    body: {
      nomComplet: 'Caissière Recherche', telephone: caissierePhone,
      email: caissiereEmail, role: 'caissier', motDePasse: 'MotDePasseDemo2026!',
    },
  });
  caissierToken = await loginStaff(caissiereEmail);

  const rogue = await creerClient(`ROGUE Eric ${marque}`, ENTREPRISE);
  numeroClientRogue = rogue.client_number;
  await creerClient(`ZZTOP Dernier ${marque}`, ENTREPRISE);
  await creerClient(`Client Sans Entreprise ${marque}`, null);
});

after(async () => {
  await stopTestServer();
});

const chercher = (params = {}) => {
  const p = new URLSearchParams(params);
  return api(`/v1/admin/utilisateurs${p.toString() ? `?${p}` : ''}`, { token: gestionnaireToken });
};

describe(
  'Recherche et filtres des utilisateurs',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    test('la réponse annonce toujours le total et si la liste est tronquée', async () => {
      const { status, body } = await chercher();
      assert.equal(status, 200);
      assert.ok(Array.isArray(body.utilisateurs));
      assert.equal(typeof body.total, 'number');
      assert.ok(body.total >= body.utilisateurs.length);
      assert.equal(typeof body.tronque, 'boolean');
      assert.ok(Array.isArray(body.employeurs), 'la liste des entreprises sert à remplir le filtre');
    });

    test('taper le nom trouve le client', async () => {
      const { body } = await chercher({ q: `ROGUE Eric ${marque}` });
      assert.ok(
        body.utilisateurs.some((u) => u.full_name === `ROGUE Eric ${marque}`),
        'le client doit être trouvé par son nom'
      );
    });

    // Le cas réel : un nom mal orthographié au clavier.
    test('la recherche tolère une faute de frappe', async () => {
      const { body } = await chercher({ q: `ROGE ERIC ${marque}` });
      assert.ok(
        body.utilisateurs.some((u) => u.full_name === `ROGUE Eric ${marque}`),
        '« ROGE ERIC » doit retrouver « ROGUE Eric »'
      );
    });

    test('la recherche porte aussi sur le numéro client', async () => {
      const { body } = await chercher({ q: numeroClientRogue });
      assert.equal(body.utilisateurs.length >= 1, true);
      assert.ok(body.utilisateurs.some((u) => u.client_number === numeroClientRogue));
    });

    test('une seule lettre ne déclenche pas de recherche', async () => {
      const { status, body } = await chercher({ q: 'R' });
      assert.equal(status, 200);
      assert.equal(body.recherche, null, 'moins de deux lettres : on retombe sur la liste');
    });

    test('le filtre par entreprise ne renvoie que ses agents', async () => {
      const { body } = await chercher({ employeur: ENTREPRISE });
      assert.ok(body.utilisateurs.length >= 2);
      assert.ok(
        body.utilisateurs.every((u) => u.employer === ENTREPRISE),
        'aucun compte d’une autre entreprise ne doit apparaître'
      );
      assert.equal(body.totalFiltre, body.utilisateurs.length);
    });

    test('le filtre « sans entreprise » retrouve les comptes créés à la main', async () => {
      const { body } = await chercher({ employeur: '__sans__' });
      assert.ok(
        body.utilisateurs.some((u) => u.full_name === `Client Sans Entreprise ${marque}`)
      );
      assert.ok(
        body.utilisateurs.every((u) => !u.employer || u.employer.trim() === ''),
        'aucun compte rattaché à une entreprise ne doit apparaître'
      );
    });

    test('le filtre par rôle fonctionne', async () => {
      const { body } = await chercher({ role: 'caissier' });
      assert.ok(body.utilisateurs.length >= 1);
      assert.ok(body.utilisateurs.every((u) => u.role === 'caissier'));
    });

    test('recherche et filtre se combinent', async () => {
      const { body } = await chercher({ q: `ROGUE ${marque}`, employeur: ENTREPRISE });
      assert.ok(body.utilisateurs.some((u) => u.full_name === `ROGUE Eric ${marque}`));
      assert.ok(body.utilisateurs.every((u) => u.employer === ENTREPRISE));
    });

    // Une valeur inattendue ne doit jamais faire tomber la requête :
    // le transtypage vers l'énumération PostgreSQL aurait renvoyé 500.
    test('un rôle inconnu renvoie une liste vide, pas une erreur', async () => {
      const { status, body } = await chercher({ role: 'roi_du_monde' });
      assert.equal(status, 200);
      assert.equal(body.utilisateurs.length, 0);
    });

    test('une caissière n’a pas accès à la liste des utilisateurs', async () => {
      const { status } = await api('/v1/admin/utilisateurs', { token: caissierToken });
      assert.equal(status, 403);
    });
  }
);
