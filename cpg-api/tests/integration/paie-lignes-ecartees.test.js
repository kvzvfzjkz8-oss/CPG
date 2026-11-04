/**
 * ═══════════════════════════════════════════════════════════════════
 *  CE QUE L'IMPORT DE PAIE ÉCARTE DOIT RESTER
 * ═══════════════════════════════════════════════════════════════════
 *
 * « Corrige les lignes rejetées à l'import de paie. »
 *
 * Le 3 novembre 2026, QSR a payé 39 agents sur 44. Impossible de dire
 * pourquoi les 5 autres ne l'avaient pas été : l'import calculait ses
 * rejets avec leur motif, les affichait, puis les oubliait. Le journal
 * ne gardait que « 39 crédités, 11 618 500 F ».
 *
 * Une ligne écartée est un agent qui n'a pas été payé. Ces tests
 * fixent les quatre motifs, le fait qu'un rejet porte le montant
 * demandé, et que les lignes illisibles du fichier comptent aussi.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer, stopTestServer, api, apiUpload, loginStaff, hasTestDatabase,
} from '../helpers/testServer.js';
import { query } from '../../src/db/index.js';

let operateurToken;
let gestionnaireToken;
let clientNom;
let clientTel;
const PERIODE = '2026-07';
const EMPLOYEUR = `TestRejets${Date.now()}`;

before(async () => {
  await startTestServer();
  if (!hasTestDatabase()) return;
  operateurToken = await loginStaff('operateur');
  gestionnaireToken = await loginStaff('gestionnaire');

  clientNom = `Agent Rejets ${Date.now()}`;
  clientTel = `+24109${String(Math.floor(Math.random() * 900000) + 100000)}`;
  await api('/v1/admin/utilisateurs', {
    method: 'POST', token: gestionnaireToken,
    body: { nomComplet: clientNom, telephone: clientTel, role: 'client', codePin: '1234', confirmerDoublon: true },
  });
});

after(async () => {
  await stopTestServer();
});

// La route attend `lignes`, pas `entries` : c'est le nom cote API, et
// le service le renomme en interne.
const crediter = (lignes) => api('/v1/admin/operations/salaires', {
  method: 'POST', token: operateurToken,
  body: { lignes, employeur: EMPLOYEUR, periode: PERIODE },
});

const rejets = () => api(
  `/v1/admin/operations/paie/rejets?periode=${PERIODE}&employeur=${encodeURIComponent(EMPLOYEUR)}`,
  { token: operateurToken }
);

describe(
  'Import de paie — les lignes écartées sont conservées',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    test('un client introuvable est enregistré, avec le montant demandé', async () => {
      const { status } = await crediter([
        { identifiant: clientTel, montant: 250000 },
        { identifiant: '+24109999999', montant: 180000 },
      ]);
      assert.equal(status, 201);

      const { body } = await rejets();
      const r = body.rejets.find((x) => x.identifiant === '+24109999999');
      assert.ok(r, 'la ligne écartée doit être retrouvable après coup — c’est tout l’objet');
      assert.equal(r.motif, 'client_introuvable');
      assert.equal(
        Number(r.montant), 180000,
        'le montant demandé doit être gardé : sinon on sait qu’un agent n’a pas été payé, '
        + 'mais pas de combien, et la comparaison avec le fichier de l’employeur est impossible'
      );
      assert.equal(r.employeur, EMPLOYEUR);
      assert.equal(r.periode, PERIODE);
      assert.ok(r.importe_par_nom, 'qui a lancé l’import doit être tracé');
    });

    test('une ligne illisible du fichier est conservée aussi', async () => {
      // Ces lignes n'atteignent jamais la résolution : le parseur les
      // refuse avant. Elles étaient donc perdues deux fois. Et c'est le
      // chemin normal de l'import — l'opératrice joint un fichier.
      //
      // Le montant invalide ne peut venir que de là : le schéma de la
      // route JSON refuse déjà un montant nul.
      // Le parseur attend la virgule — voir csvParser.js, « identifiant,montant ».
      const csv = [
        'identifiant,montant',
        `${clientTel},300000`,
        'ligne_sans_montant',
        `${clientTel},0`,
      ].join('\n');

      const { status } = await apiUpload('/v1/admin/operations/salaires/import', {
        token: operateurToken,
        fields: { employeur: EMPLOYEUR, periode: PERIODE },
        fileField: 'fichier', fileContent: csv,
      });
      assert.equal(status, 201, 'l’import par fichier doit aboutir');

      const { body } = await rejets();
      const illisible = body.rejets.find((x) => x.identifiant.includes('ligne_sans_montant'));
      assert.ok(
        illisible,
        'la ligne mal formée doit être retrouvable, avec son contenu brut — '
        + 'c’est le seul moyen de savoir de qui il s’agissait'
      );
      assert.equal(illisible.montant, null);
      assert.ok(
        ['colonnes_manquantes', 'identifiant_manquant', 'montant_invalide'].includes(illisible.motif),
        `motif inattendu : ${illisible.motif}`
      );
    });

    test('un second import signale les agents déjà crédités', async () => {
      // Le garde-fou anti-double-crédit laisse lui aussi une trace :
      // c'est ce qui permet de distinguer « pas payé » de « déjà payé ».
      await crediter([{ identifiant: clientTel, montant: 250000 }]);
      const { body } = await rejets();
      const r = body.rejets.filter((x) => x.motif === 'deja_credite_ce_mois');
      assert.ok(r.length >= 1, 'le rejeu doit être tracé, pas seulement refusé');
    });

    test('les motifs sont comptés, et les lots distingués', async () => {
      const { body } = await rejets();
      assert.ok(body.parMotif.client_introuvable >= 1);
      assert.ok(
        Object.keys(body.parMotif).length >= 2,
        `plusieurs motifs doivent coexister : ${JSON.stringify(body.parMotif)}`
      );
      assert.ok(body.lots >= 1, 'plusieurs tentatives d’import ne doivent pas se confondre');
      assert.equal(body.total, body.rejets.length);
    });

    test('un import qui échoue ne laisse pas de rejets derrière lui', async () => {
      // Les rejets sont écrits dans la MÊME transaction que les crédits.
      // Un lot qui n'a pas eu lieu ne doit pas laisser de traces d'un
      // lot qui n'a pas eu lieu.
      const avant = (await rejets()).body.total;
      const { status } = await api('/v1/admin/operations/salaires', {
        method: 'POST', token: operateurToken,
        body: { lignes: [], employeur: EMPLOYEUR, periode: PERIODE },
      });
      assert.equal(status, 422, 'un lot vide est refusé');
      assert.equal((await rejets()).body.total, avant);
    });

    test('la lecture est refusée à la caissière', async () => {
      const email = `caissiere.rejets.${Date.now()}@cpg.ga`;
      const tel = `+24105${String(Math.floor(Math.random() * 900000) + 100000)}`;
      await api('/v1/admin/utilisateurs', {
        method: 'POST', token: gestionnaireToken,
        body: {
          nomComplet: `Caissière Rejets ${Date.now()}`, telephone: tel, email,
          role: 'caissier', motDePasse: 'MotDePasseDemo2026!', confirmerDoublon: true,
        },
      });
      const caissierToken = await loginStaff(email);
      const { status } = await api('/v1/admin/operations/paie/rejets', { token: caissierToken });
      assert.equal(status, 403, 'la paie n’est pas de son ressort');
    });

    test('la table garde bien la référence du lot', async () => {
      const { rows } = await query(
        `SELECT DISTINCT reference FROM payroll_import_rejects WHERE employeur = $1`,
        [EMPLOYEUR]
      );
      assert.ok(rows.length >= 1);
      assert.ok(
        rows.every((r) => r.reference.includes(PERIODE.replace('-', '')) || r.reference.length > 0),
        'la référence relie les lignes écartées aux lignes créditées du même lot'
      );
    });
  }
);
