/**
 * ═══════════════════════════════════════════════════════════════════
 *  VERSEMENT PONCTUEL SUR LE COMPTE D'UN CLIENT
 * ═══════════════════════════════════════════════════════════════════
 *
 * « Nous souhaitons créditer de manière ponctuelle MATEYA un montant de
 *   169 553 F, sauf qu'elle n'y arrive pas. L'opérateur se plaint que le
 *   bouton soumettre au directeur est gris et non vert. Normalement cet
 *   argent va directement sur le compte du client avant qu'il ne retire
 *   son argent dans une caisse. »
 *
 * Le bouton était gris parce que l'opération n'existait pas : l'écran
 * ne proposait que des débits. Ces tests fixent le symétrique du
 * retrait ponctuel, et surtout les deux choses qui ne doivent pas
 * bouger — le garde-fou de validation, et l'absence de tout mouvement
 * de caisse avant que le client ne vienne retirer.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer, stopTestServer, api, loginStaff, hasTestDatabase,
} from '../helpers/testServer.js';
import { query } from '../../src/db/index.js';

let operateurToken;
let directeurToken;
let gestionnaireToken;
let clientId;
let accountId;

const MONTANT = 169553;
const MOTIF = 'Compensation de la double mensualité de novembre';

const solde = async () => {
  const { rows } = await query(
    'SELECT COALESCE(balance, 0) AS b FROM account_balances WHERE account_id = $1',
    [accountId]
  );
  return Number(rows[0]?.b ?? 0);
};

before(async () => {
  await startTestServer();
  if (!hasTestDatabase()) return;
  operateurToken = await loginStaff('operateur');
  directeurToken = await loginStaff('directeur');
  gestionnaireToken = await loginStaff('gestionnaire');

  const tel = `+24109${String(Math.floor(Math.random() * 900000) + 100000)}`;
  const { body } = await api('/v1/admin/utilisateurs', {
    method: 'POST', token: gestionnaireToken,
    body: {
      nomComplet: `Client Versement ${Date.now()}`, telephone: tel, role: 'client',
      codePin: '1234', confirmerDoublon: true,
    },
  });
  clientId = body.id;
  const { rows } = await query(
    'SELECT id FROM accounts WHERE user_id = $1 ORDER BY created_at LIMIT 1', [clientId]
  );
  accountId = rows[0].id;
});

after(async () => {
  await stopTestServer();
});

const demander = (corps, token = operateurToken) => api('/v1/admin/operations/versements-ponctuels', {
  method: 'POST', token, body: { clientId, montant: MONTANT, motif: MOTIF, ...corps },
});

describe(
  'Versement ponctuel',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    let operationId;

    test('l’opératrice peut le demander — et rien n’est crédité encore', async () => {
      const avant = await solde();
      const { status, body } = await demander({});
      assert.equal(status, 201, `la demande doit aboutir (${JSON.stringify(body)})`);
      assert.equal(body.statut, 'en_attente');
      operationId = body.id;

      assert.equal(
        await solde(), avant,
        'le compte ne doit pas bouger avant la validation du directeur — '
        + 'c’est le garde-fou posé le 22/10/2026'
      );
    });

    test('la demande apparaît dans la file du directeur', async () => {
      const { body } = await api('/v1/caisse/demandes-en-attente', { token: directeurToken });
      const d = (body.demandes ?? body).find((x) => x.id === operationId);
      assert.ok(d, 'sans cela le directeur ne la verrait jamais');
      assert.equal(d.type, 'versement_ponctuel');
      assert.equal(Number(d.montant), MONTANT);
    });

    test('le motif est obligatoire, et pas symbolique', async () => {
      const { status } = await demander({ motif: 'ok' });
      assert.equal(status, 422, 'créditer un compte sans dire pourquoi est refusé');
    });

    test('la validation du directeur crédite le compte', async () => {
      const avant = await solde();
      const { status } = await api(`/v1/caisse/operations/${operationId}/valider`, {
        method: 'POST', token: directeurToken,
      });
      assert.equal(status, 200);
      assert.equal(await solde(), avant + MONTANT, 'le solde doit monter du montant versé');

      const { rows } = await query(
        `SELECT type::text, amount, label FROM ledger_entries
         WHERE account_id = $1 AND reference = $2`,
        [accountId, `VERSEMENT-PONCTUEL-${operationId.slice(0, 8)}`]
      );
      assert.equal(rows.length, 1, 'une seule écriture, et elle porte sa référence');
      assert.equal(
        rows[0].type, 'ajustement',
        'et le type est « ajustement », pas « depot » : le client n’a rien apporté au guichet'
      );
      assert.equal(Number(rows[0].amount), MONTANT);
      assert.match(rows[0].label, /Versement ponctuel/);
      assert.match(rows[0].label, new RegExp(MOTIF.slice(0, 20)), 'le motif suit l’écriture');
    });

    test('la somme sort de la caisse principale', async () => {
      // « Il est pris sur la caisse principale » (direction, 04/11/2026).
      // J'avais d'abord écrit l'inverse — aucun mouvement de caisse, par
      // analogie avec le déblocage d'un crédit. Un versement n'est pas
      // un prêt : c'est de l'argent que CPG sort de ses fonds.
      const { rows } = await query(
        `SELECT type::text, montant FROM caisse_principale_mouvements WHERE operation_id = $1`,
        [operationId]
      );
      assert.equal(rows.length, 1, 'un mouvement, et un seul');
      assert.equal(rows[0].type, 'versement_client');
      assert.equal(Number(rows[0].montant), MONTANT);
    });

    test('et le solde de la caisse principale en tient compte', async () => {
      // Sans la reprise de la vue, le mouvement existerait sans
      // diminuer le solde : le directeur verrait un fonds qu'il n'a plus
      // et autoriserait des décaissements sur de l'argent déjà promis.
      const { rows } = await query(
        `SELECT pg_get_viewdef('caisse_principale_solde'::regclass, true) AS d`
      );
      assert.match(
        rows[0].d, /versement_client/,
        'versement_client doit figurer parmi les sorties de la vue de solde'
      );
    });

    test('aucune caisse de caissière n’est touchée', async () => {
      // L'argent ne passe par un guichet que si le client vient
      // retirer, par un retrait ordinaire — jamais les deux à la fois.
      const { rows: op } = await query(
        `SELECT caissier_id FROM caisse_operations WHERE id = $1`, [operationId]
      );
      assert.equal(op[0].caissier_id, null, 'aucune caissière n’est engagée par un versement');
    });

    test('le versement n’entre pas dans le solde d’une caisse', async () => {
      // Les vues de solde énumèrent les types qui remplissent ou vident
      // un tiroir. Un versement n'en remplit ni n'en vide aucun : s'il
      // y entrait, la caissière verrait un solde qu'elle n'a pas.
      const { rows } = await query(
        `SELECT pg_get_viewdef('caisse_soldes'::regclass, true) AS d`
      );
      assert.ok(
        !rows[0].d.includes('versement_ponctuel'),
        'caisse_soldes ne doit pas compter les versements ponctuels'
      );
    });

    test('le gestionnaire et la caissière ne peuvent pas en demander', async () => {
      const { status: parGestionnaire } = await demander({}, gestionnaireToken);
      assert.equal(parGestionnaire, 403, 'ce n’est pas son poste');
    });

    test('les deux tables de permissions concordent', async () => {
      // Le back-office masque le bouton d'après sa propre table, le
      // serveur décide d'après la sienne. Une divergence et l'opératrice
      // retrouve un bouton gris — exactement le symptôme d'origine.
      const { PERMISSIONS, ROLES } = await import('../../src/utils/permissions.js');
      assert.ok(
        PERMISSIONS[ROLES.OPERATEUR].includes('operations.demander_versement_ponctuel'),
        'l’opératrice doit avoir la permission côté serveur'
      );
    });
  }
);
