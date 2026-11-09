/**
 * ═══════════════════════════════════════════════════════════════════
 *  GESTION DES CRÉDITS — TROIS SIGNATURES, CINQ NATURES
 * ═══════════════════════════════════════════════════════════════════
 *
 * « Le gestionnaire aura la possibilité de modifier un crédit : changer
 *   les dates de prélèvements avec accord préalable de l'opérateur puis
 *   validation du directeur, demander un prélèvement supplémentaire,
 *   supprimer un crédit, ou encore modifier le montant du crédit car le
 *   client a anticipé sur la prochaine échéance en déposant un montant.
 *   À ajouter aussi la modification des taux pour certains crédits en
 *   cours, ou sauter un mois de prélèvement pour certains clients étant
 *   en difficulté. » (direction, 09/11/2026)
 *
 * Ce qui est vérifié ici, et qui compte plus que les écrans : rien ne
 * bouge sur un dossier avant les trois signatures, personne n'en signe
 * deux, et chaque nature produit l'effet annoncé — au franc.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { query } from '../../src/db/index.js';
import {
  startTestServer, stopTestServer, api, loginStaff, hasTestDatabase, fundCaissePrincipale,
} from '../helpers/testServer.js';

before(async () => { await startTestServer(); });
after(async () => { await stopTestServer(); });

const EMPLOYEUR = `GESTCIRC${Date.now()}`;
let creneau = 0;

async function clientAvecCredit(nom, montant, duree) {
  const gestionnaire = await loginStaff('gestionnaire');
  const operateur = await loginStaff('operateur');
  const directeur = await loginStaff('directeur');

  const phone = `+24106${String(Math.floor(Math.random() * 900000) + 100000)}`;
  const { body: cree } = await api('/v1/admin/utilisateurs', {
    method: 'POST', token: gestionnaire,
    body: { nomComplet: nom, telephone: phone, role: 'client', codePin: '1234', employeur: EMPLOYEUR },
  });
  const { body: session } = await api('/v1/auth/connexion-client', {
    method: 'POST', body: { phone, pin: '1234' },
  });
  const { body: cat } = await api('/v1/admin/catalogue/produits/actifs', { token: gestionnaire });
  const produitId = cat.produits.find((p) => p.code === 'MICRO_STD').product_id;

  const { body: credit } = await api('/v1/client/credits', {
    method: 'POST', token: session.accessToken,
    body: { produitId, montant, duree, motif: 'Test gestion des credits' },
  });
  await api(`/v1/admin/credits/${credit.id}/valider-niveau1`, { method: 'POST', token: operateur });

  const { status: st, body: seance } = await api('/v1/admin/commission/seance', {
    method: 'POST', token: gestionnaire,
    body: { dateHeure: `2026-12-${String(10 + creneau++).padStart(2, '0')}T09:00` },
  });
  if (st !== 201) throw new Error(`Créneau de séance occupé (${st}).`);

  await api(`/v1/admin/commission/credits/${credit.id}/deposer`, { method: 'POST', token: gestionnaire });
  await api(`/v1/admin/commission/seance/${seance.id}/tenir`, {
    method: 'POST', token: directeur,
    body: { decisions: [{ kind: 'credit', creditId: credit.id, decision: 'valide' }] },
  });
  await api(`/v1/admin/commission/credits/${credit.id}/valider-double`, { method: 'POST', token: operateur });
  await fundCaissePrincipale();
  const { body: ok } = await api(`/v1/admin/credits/${credit.id}/approuver`, {
    method: 'POST', token: directeur,
  });
  return { id: credit.id, reference: ok.reference, numero: cree.client_number, clientId: cree.id, nom };
}

const echeancesDe = (creditId) => query(
  `SELECT id, sequence, status::text AS st, amount::bigint AS amount,
          to_char(due_date, 'YYYY-MM-DD') AS due
   FROM installments WHERE credit_id = $1 ORDER BY sequence`,
  [creditId]
).then((r) => r.rows);

const soldeDe = (clientId) => query(
  `SELECT COALESCE(b.balance, 0)::bigint AS solde FROM accounts a
   LEFT JOIN account_balances b ON b.account_id = a.id WHERE a.user_id = $1`,
  [clientId]
).then((r) => Number(r.rows[0].solde));

const creditDe = (creditId) => query(
  `SELECT status::text AS st, monthly_rate, monthly_payment::bigint AS mensualite
   FROM credit_requests WHERE id = $1`,
  [creditId]
).then((r) => r.rows[0]);

const deposer = async (corps, token) => api('/v1/admin/gestion-credits', {
  method: 'POST', token: token ?? await loginStaff('gestionnaire'), body: corps,
});
const accorder = async (id, token) => api(`/v1/admin/gestion-credits/${id}/accord`, {
  method: 'POST', token: token ?? await loginStaff('operateur'), body: {},
});
const valider = async (id, token) => api(`/v1/admin/gestion-credits/${id}/valider`, {
  method: 'POST', token: token ?? await loginStaff('directeur'), body: {},
});

describe(
  'Gestion des crédits — le circuit à trois signatures',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    test('l’opérateur ne peut pas déposer une demande, le gestionnaire si', async () => {
      const a = await clientAvecCredit('Gest Circuit', 300000, 6);
      const { status: refus } = await deposer(
        { creditId: a.id, nature: 'dates_echeances', jour: 4, motif: 'essai de depot' },
        await loginStaff('operateur')
      );
      assert.equal(refus, 403, 'proposer est le rôle du gestionnaire');

      const { status, body } = await deposer({
        creditId: a.id, nature: 'dates_echeances', jour: 4, motif: 'aligner sur le 4',
      });
      assert.equal(status, 201);
      assert.equal(body.status, 'en_attente_operateur');
    });

    test('le directeur ne peut pas valider avant l’accord de l’opérateur', async () => {
      const a = await clientAvecCredit('Gest Ordre', 300000, 6);
      const { body: d } = await deposer({
        creditId: a.id, nature: 'dates_echeances', jour: 4, motif: 'aligner sur le 4',
      });
      const avant = await echeancesDe(a.id);

      const { status, body } = await valider(d.id);
      assert.equal(status, 409);
      assert.match(body.error, /accord/i, 'le message doit dire ce qui manque');
      assert.deepEqual(
        (await echeancesDe(a.id)).map((e) => e.due), avant.map((e) => e.due),
        'aucune date ne doit avoir bougé'
      );
    });

    test('le gestionnaire ne peut ni accorder ni valider sa propre demande', async () => {
      const a = await clientAvecCredit('Gest Soi Meme', 300000, 6);
      const { body: d } = await deposer({
        creditId: a.id, nature: 'dates_echeances', jour: 4, motif: 'aligner sur le 4',
      });
      const gestionnaire = await loginStaff('gestionnaire');
      assert.equal((await accorder(d.id, gestionnaire)).status, 403);
      assert.equal((await valider(d.id, gestionnaire)).status, 403);
    });

    test('changer le jour de prélèvement : toutes les échéances suivent, sans décaler le mois', async () => {
      const a = await clientAvecCredit('Gest Dates', 300000, 6);
      const avant = await echeancesDe(a.id);
      const moisPremiere = avant[0].due.slice(0, 7);

      const { body: d } = await deposer({
        creditId: a.id, nature: 'dates_echeances', jour: 12, motif: 'le client est paye le 10',
      });
      assert.equal((await accorder(d.id)).status, 200);
      const { status, body } = await valider(d.id);
      assert.equal(status, 200);
      assert.equal(body.effet.jour, 12);

      const apres = await echeancesDe(a.id);
      assert.ok(apres.every((e) => e.due.slice(-2) === '12'), `jours : ${apres.map((e) => e.due).join(' ')}`);
      assert.equal(
        apres[0].due.slice(0, 7), moisPremiere,
        'changer le jour ne doit pas avancer ni reculer le dossier d’un mois'
      );
      assert.equal(apres.length, avant.length, 'aucune échéance ne doit apparaître ni disparaître');
    });

    test('sauter un mois : les échéances reculent, les montants ne changent pas', async () => {
      const a = await clientAvecCredit('Gest Report', 300000, 6);
      const avant = await echeancesDe(a.id);

      const { body: d } = await deposer({
        creditId: a.id, nature: 'report_echeance', mois: 1, motif: 'client en difficulte, mois sauté',
      });
      await accorder(d.id);
      const { status, body } = await valider(d.id);
      assert.equal(status, 200);
      assert.equal(body.effet.interets_ajoutes, 0, 'un report ne se vend pas : aucun intérêt en plus');

      const apres = await echeancesDe(a.id);
      assert.equal(apres.length, avant.length);
      assert.deepEqual(
        apres.map((e) => Number(e.amount)), avant.map((e) => Number(e.amount)),
        'les montants doivent être intacts'
      );
      for (let i = 0; i < avant.length; i += 1) {
        const mAvant = Number(avant[i].due.slice(5, 7));
        const mApres = Number(apres[i].due.slice(5, 7));
        assert.equal(((mApres - mAvant) + 12) % 12, 1, `échéance ${i + 1} : ${avant[i].due} -> ${apres[i].due}`);
      }
    });
  }
);
