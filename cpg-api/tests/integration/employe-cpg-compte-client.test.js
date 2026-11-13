/**
 * ═══════════════════════════════════════════════════════════════════
 *  UN EMPLOYÉ CPG TOUCHE SON SALAIRE SUR LE LOGICIEL
 * ═══════════════════════════════════════════════════════════════════
 *
 * « Il faut que tu puisses permettre aux employés de la banque d'ouvrir
 *   un compte et de toucher leur salaire directement sur le logiciel.
 *   Création comme tout client, employeur CPG. » (direction, 11/11/2026)
 *   « Deux fiches par employé. » (direction, 13/11/2026)
 *
 * Un employé a donc deux fiches : son compte d'agent pour travailler,
 * son compte client pour être payé — et UN SEUL numéro de téléphone,
 * puisqu'il n'en a qu'un.
 *
 * Ce que ce fichier protège : que le partage de numéro ne desserre
 * jamais l'unicité qui porte l'authentification. Un numéro ne désigne
 * qu'un seul client, et c'est par lui que les clients se connectent.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { query } from '../../src/db/index.js';
import {
  startTestServer, stopTestServer, api, loginStaff, hasTestDatabase,
} from '../helpers/testServer.js';

before(async () => { await startTestServer(); });
after(async () => { await stopTestServer(); });

const unique = Date.now();

describe(
  'Un employé CPG et son compte client',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    test('l’employé garde son numéro sur ses deux fiches', async () => {
      const directeur = await loginStaff('directeur');
      const tel = `+24106${String(unique).slice(-6)}`;
      const nom = `Employe Deux Fiches ${unique}`;

      // 1. Sa fiche d'agent.
      const { status: agent } = await api('/v1/admin/utilisateurs', {
        method: 'POST', token: directeur,
        body: {
          nomComplet: nom, telephone: tel, role: 'caissier',
          email: `employe.${unique}@cpg.ga`, motDePasse: 'MotDePasse123!',
        },
      });
      assert.equal(agent, 201, 'la fiche d’agent doit se créer');

      // 2. Sa fiche client, MÊME NUMÉRO. Le logiciel signale l'homonyme
      //    — c'est voulu — et nomme la fiche d'agent pour que le
      //    directeur sache ce qu'il confirme.
      const { status: refus, body: msg } = await api('/v1/admin/utilisateurs', {
        method: 'POST', token: directeur,
        body: { nomComplet: nom, telephone: tel, role: 'client', codePin: '1234', employeur: 'CPG' },
      });
      assert.equal(refus, 409, 'l’homonyme doit être signalé avant d’être créé');
      assert.match(msg.error, /agent/i, 'le message doit dire que l’homonyme est une fiche d’agent');
      assert.match(msg.error, /salaire|client/i, 'et pourquoi on confirme');

      const { status: client, body: cree } = await api('/v1/admin/utilisateurs', {
        method: 'POST', token: directeur,
        body: {
          nomComplet: nom, telephone: tel, role: 'client',
          codePin: '1234', employeur: 'CPG', confirmerDoublon: true,
        },
      });
      assert.equal(client, 201, 'la fiche client doit se créer avec le même numéro');
      assert.ok(cree.client_number, 'et recevoir un numéro client');

      // 3. Les deux fiches coexistent, et une seule a un compte.
      const { rows } = await query(
        `SELECT u.role::text AS role, u.client_number, (a.id IS NOT NULL) AS a_un_compte
         FROM users u LEFT JOIN accounts a ON a.user_id = u.id
         WHERE u.phone = $1 ORDER BY u.role`,
        [tel]
      );
      assert.equal(rows.length, 2, 'deux fiches, un seul numéro');
      const fichClient = rows.find((r) => r.role === 'client');
      const fichAgent = rows.find((r) => r.role !== 'client');
      assert.ok(fichClient.a_un_compte, 'la fiche client porte le compte');
      assert.ok(!fichAgent.a_un_compte, 'la fiche d’agent n’en a pas');
      assert.ok(!fichAgent.client_number, 'ni de numéro client');
    });

    test('l’employé se connecte en client avec son numéro, sans ambiguïté', async () => {
      const directeur = await loginStaff('directeur');
      const tel = `+24107${String(unique + 1).slice(-6)}`;
      const nom = `Employe Connexion ${unique}`;

      await api('/v1/admin/utilisateurs', {
        method: 'POST', token: directeur,
        body: {
          nomComplet: nom, telephone: tel, role: 'operateur',
          email: `connexion.${unique}@cpg.ga`, motDePasse: 'MotDePasse123!',
        },
      });
      await api('/v1/admin/utilisateurs', {
        method: 'POST', token: directeur,
        body: {
          nomComplet: nom, telephone: tel, role: 'client',
          codePin: '4321', employeur: 'CPG', confirmerDoublon: true,
        },
      });

      // Le numéro désigne sa fiche CLIENT, jamais celle d'agent : les
      // trois lectures par téléphone filtrent `role = 'client'`.
      const { status, body } = await api('/v1/auth/connexion-client', {
        method: 'POST', body: { phone: tel, pin: '4321' },
      });
      assert.equal(status, 200, 'la connexion client doit aboutir');
      assert.equal(body.user.role, 'client', 'et porter sur la fiche client');
      assert.ok(body.user.clientNumber, 'avec son numéro client');
    });

    test('deux clients ne peuvent toujours pas partager un numéro', async () => {
      const directeur = await loginStaff('directeur');
      const tel = `+24108${String(unique + 2).slice(-6)}`;

      assert.equal((await api('/v1/admin/utilisateurs', {
        method: 'POST', token: directeur,
        body: { nomComplet: `Client Un ${unique}`, telephone: tel, role: 'client', codePin: '1111' },
      })).status, 201);

      const { status } = await api('/v1/admin/utilisateurs', {
        method: 'POST', token: directeur,
        body: { nomComplet: `Client Deux ${unique}`, telephone: tel, role: 'client', codePin: '2222' },
      });
      assert.notEqual(status, 201, 'l’unicité qui porte l’authentification reste entière');
    });

    test('son salaire lui arrive comme à n’importe quel client', async () => {
      const directeur = await loginStaff('directeur');
      const operateur = await loginStaff('operateur');
      const tel = `+24109${String(unique + 3).slice(-6)}`;

      const { body: employe } = await api('/v1/admin/utilisateurs', {
        method: 'POST', token: directeur,
        body: {
          nomComplet: `Employe Paye ${unique}`, telephone: tel, role: 'client',
          codePin: '1234', employeur: 'CPG',
        },
      });

      const periode = new Date().toISOString().slice(0, 7);
      const { status } = await api('/v1/admin/operations/salaires', {
        method: 'POST', token: operateur,
        body: {
          employeur: 'CPG', periode,
          lignes: [{ identifiant: employe.client_number, montant: 450000 }],
        },
      });
      assert.equal(status, 201, 'la paie CPG doit passer comme une autre');

      const { rows } = await query(
        `SELECT COALESCE(b.balance, 0)::bigint AS solde
         FROM accounts a LEFT JOIN account_balances b ON b.account_id = a.id
         WHERE a.user_id = $1`,
        [employe.id]
      );
      assert.equal(Number(rows[0].solde), 450000, 'le salaire doit être sur son compte');
    });
  }
);
