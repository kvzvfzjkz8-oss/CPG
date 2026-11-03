/**
 * ═══════════════════════════════════════════════════════════════════
 *  LA DATE DU PREMIER PRÉLÈVEMENT, DÉCIDÉE EN SÉANCE
 * ═══════════════════════════════════════════════════════════════════
 *
 * « Les dossiers qui vont être validés demain seront prélevés le 03 du
 *   mois de novembre, il faudrait que tu le gardes en mémoire. »
 *   (direction, 22/10/2026)
 *
 * Le logiciel posait la première échéance à l'approbation + 1 mois :
 * les 25 dossiers validés le 23/10 ont tous reçu un 23 novembre, et il
 * a fallu les redater un par un quatre jours avant le prélèvement.
 *
 * La séance porte désormais la date. Ce fichier fixe les points qui
 * comptent :
 *
 *   • la date commande tout l'échéancier des dossiers validés ;
 *   • sans date, le comportement d'avant est intact ;
 *   • une date passée est refusée — elle produirait des échéances
 *     exigibles le lendemain matin à 6 h ;
 *   • le gestionnaire ne la fixe pas : c'est une décision de trésorerie.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer, stopTestServer, api, loginStaff, hasTestDatabase, fundCaissePrincipale,
} from '../helpers/testServer.js';

let gestionnaireToken;
let directeurToken;
let operateurToken;
let produitId;

/**
 * Une date du mois prochain dont le JOUR diffère d'aujourd'hui.
 *
 * Le cas réel était « le 3 du mois prochain », la décision du
 * 22/10/2026. Mais le comportement par défaut pose la première échéance
 * au même jour du mois suivant : un test lancé un 3 voyait donc le
 * défaut tomber exactement sur la cible, et l'assertion « sans date
 * fixée, le comportement d'avant est intact » ne distinguait plus rien.
 * C'est arrivé le 03/11/2026.
 *
 * Le jour choisi reste ≤ 28 pour exister dans tous les mois.
 */
function cibleDistincteDuDefaut() {
  const n = new Date();
  const jour = n.getUTCDate() === 17 ? 11 : 17;
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, jour)).toISOString().slice(0, 10);
}
const CIBLE = cibleDistincteDuDefaut();

before(async () => {
  await startTestServer();
  if (!hasTestDatabase()) return;
  gestionnaireToken = await loginStaff('gestionnaire');
  directeurToken = await loginStaff('directeur');
  operateurToken = await loginStaff('operateur');

  const { body } = await api('/v1/admin/catalogue/produits/actifs', { token: gestionnaireToken });
  produitId = body.produits.find((p) => p.code === 'MICRO_STD').product_id;
  await fundCaissePrincipale(5000000);
});

after(async () => {
  if (!hasTestDatabase()) { await stopTestServer(); return; }
  await viderSeance();
  await stopTestServer();
});

/**
 * La séance est partagée entre fichiers de tests : on retire ses
 * dossiers avant de la supprimer, sinon l'annulation est refusée.
 */
async function viderSeance() {
  const { body } = await api('/v1/admin/commission/seance', { token: gestionnaireToken });
  if (!body?.seance?.id) return;
  const { body: file } = await api(`/v1/admin/commission/file-attente/${body.seance.id}`, {
    token: gestionnaireToken,
  });
  for (const d of file?.dossiers ?? []) {
    await api(`/v1/admin/commission/credits/${d.id}/retirer`, { method: 'POST', token: gestionnaireToken });
  }
  await api(`/v1/admin/commission/seance/${body.seance.id}`, { method: 'DELETE', token: gestionnaireToken });
}

/** Une séance neuve, et son identifiant. */
async function seanceNeuve() {
  await viderSeance();
  const demain = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
  const { body } = await api('/v1/admin/commission/seance', {
    method: 'POST', token: gestionnaireToken, body: { dateHeure: demain },
  });
  return body.id;
}

/** Un dossier déposé dans la séance en cours, prêt à être tenu. */
async function dossierDepose(label, duree = 3) {
  const tel = `+24109${String(Math.floor(Math.random() * 900000) + 100000)}`;
  const { body: client } = await api('/v1/admin/utilisateurs', {
    method: 'POST', token: gestionnaireToken,
    body: {
      nomComplet: `Client Echeance ${label}`, telephone: tel, role: 'client',
      codePin: '1234', confirmerDoublon: true,
    },
  });
  const { body: credit } = await api('/v1/admin/credits', {
    method: 'POST', token: gestionnaireToken,
    body: { clientId: client.id, produitId, montant: 150000, duree, motif: `Echeance ${label}` },
  });
  assert.ok(credit.id, `le dossier doit être créé (${JSON.stringify(credit)})`);
  await api(`/v1/admin/credits/${credit.id}/valider-niveau1`, { method: 'POST', token: operateurToken });
  await api(`/v1/admin/commission/credits/${credit.id}/deposer`, { method: 'POST', token: gestionnaireToken });
  return credit.id;
}

/**
 * Les dates d'échéance d'un dossier, en texte.
 *
 * Lues depuis la base avec to_char et non depuis la réponse HTTP : une
 * colonne DATE revient de pg comme un Date à minuit LOCAL, que la
 * sérialisation JSON rend en UTC — donc la veille, en UTC+1. Le test
 * comparerait des dates décalées d'un jour et échouerait sur un
 * logiciel correct.
 */
async function joursEcheances(creditId) {
  const { query } = await import('../../src/db/index.js');
  const { rows } = await query(
    `SELECT sequence, to_char(due_date, 'YYYY-MM-DD') AS jour
     FROM installments WHERE credit_id = $1 ORDER BY sequence`,
    [creditId]
  );
  return rows.map((r) => r.jour);
}

/** Tient la séance, double-valide et approuve — le circuit complet. */
async function approuver(seanceId, creditId) {
  await api(`/v1/admin/commission/seance/${seanceId}/tenir`, {
    method: 'POST', token: directeurToken,
    body: { decisions: [{ kind: 'credit', creditId, decision: 'valide' }] },
  });
  await api(`/v1/admin/commission/credits/${creditId}/valider-double`, {
    method: 'POST', token: operateurToken,
  });
  const { status } = await api(`/v1/admin/credits/${creditId}/approuver`, {
    method: 'POST', token: directeurToken,
  });
  assert.equal(status, 200, 'le dossier doit être approuvé');
  return joursEcheances(creditId);
}

const fixerDate = (seanceId, date, token = directeurToken) => api(
  `/v1/admin/commission/seance/${seanceId}/premiere-echeance`,
  { method: 'PATCH', token, body: { premiereEcheance: date } }
);

describe(
  'Premier prélèvement fixé en séance',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    test('la date fixée commande tout l’échéancier', async () => {
      const seanceId = await seanceNeuve();
      const { status } = await fixerDate(seanceId, CIBLE);
      assert.equal(status, 200);

      const { body: relue } = await api('/v1/admin/commission/seance', { token: directeurToken });
      assert.equal(
        relue.seance.premiere_echeance, CIBLE,
        'la date relue doit être celle décidée — une colonne DATE lue sans to_char '
        + 'revient d’un jour en arrière en UTC+1'
      );

      const creditId = await dossierDepose(`Avec ${Date.now()}`, 3);
      const jours = await approuver(seanceId, creditId);
      assert.equal(jours.length, 3);
      assert.equal(jours[0], CIBLE, 'la première échéance est la date décidée');

      const jourDuMois = Number(CIBLE.slice(8, 10));
      for (const j of jours) {
        assert.equal(
          Number(j.slice(8, 10)), jourDuMois,
          `toutes les échéances doivent tomber le ${jourDuMois} de chaque mois (${jours.join(', ')})`
        );
      }
    });

    test('sans date fixée, le comportement d’avant est intact', async () => {
      const seanceId = await seanceNeuve();
      // Durée 3 et pas 2 : le barème MICRO_STD impose un minimum de 3
      // mois, et un dossier hors barème est refusé à la création.
      const creditId = await dossierDepose(`Sans ${Date.now()}`, 3);
      const [premiere] = await approuver(seanceId, creditId);

      // Le mois suivant, calculé par les composantes et non avec
      // setMonth(+1) : approuvé un 31, setMonth() déborde sur le mois
      // d'après (31 octobre + 1 mois = 1er décembre). C'est le défaut
      // que le code corrige, l'attente du test ne doit pas le
      // reproduire.
      const n = new Date();
      const moisSuivant = new Date(Date.UTC(n.getFullYear(), n.getMonth() + 1, 1))
        .toISOString().slice(0, 7);
      assert.equal(
        premiere.slice(0, 7), moisSuivant,
        'un mois après l’approbation, comme avant'
      );
      assert.notEqual(premiere, CIBLE);
    });

    test('une date déjà passée est refusée', async () => {
      const seanceId = await seanceNeuve();
      const { status, body } = await fixerDate(seanceId, '2020-01-03');
      assert.equal(status, 422);
      assert.match(body.error, /déjà passé/i);
      assert.match(body.error, /lendemain matin/i, 'le message doit dire ce qui se produirait');
    });

    test('le gestionnaire ne fixe pas la date', async () => {
      const seanceId = await seanceNeuve();
      const { status } = await fixerDate(seanceId, CIBLE, gestionnaireToken);
      assert.equal(status, 403, 'c’est une décision de trésorerie, comme l’enveloppe');
    });

    test('revenir au défaut est possible tant que la séance n’est pas tenue', async () => {
      const seanceId = await seanceNeuve();
      await fixerDate(seanceId, CIBLE);
      const { status } = await fixerDate(seanceId, null);
      assert.equal(status, 200);
      const { body } = await api('/v1/admin/commission/seance', { token: directeurToken });
      assert.equal(body.seance.premiere_echeance, null);
    });
  }
);
