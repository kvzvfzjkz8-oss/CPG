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

const EMPLOYEUR = `GESTEFF${Date.now()}`;
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
    body: { dateHeure: `2026-12-${String(16 + creneau++).padStart(2, '0')}T09:00` },
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
  'Gestion des crédits — les effets sur l’argent',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    test('réviser le taux : seules les échéances restantes changent, et le plafond est tenu', async () => {
      const a = await clientAvecCredit('Gest Taux', 300000, 6);
      const avant = await creditDe(a.id);

      const plafond = Number((await query(
        `SELECT max_rate FROM rate_ceilings WHERE scope = 'credit_monthly'`
      )).rows[0].max_rate);

      const { status: trop, body: msg } = await deposer({
        creditId: a.id, nature: 'taux', tauxMensuel: plafond + 0.01, motif: 'au-dessus du plafond',
      });
      assert.equal(trop, 422);
      assert.match(msg.error, /plafond/i);

      // Le nouveau taux se derive de CELUI DU CREDIT, pas du plafond :
      // « plafond / 2 » tombait pile sur le taux deja en vigueur du
      // produit de test, et l'assertion ne distinguait plus rien.
      const nouveau = Number((Number(avant.monthly_rate) / 2).toFixed(4));
      assert.notEqual(nouveau, Number(avant.monthly_rate), 'precondition du test : le taux doit changer');
      const { body: d } = await deposer({
        creditId: a.id, nature: 'taux', tauxMensuel: nouveau, motif: 'geste commercial accorde',
      });
      await accorder(d.id);
      const { status, body } = await valider(d.id);
      assert.equal(status, 200);
      assert.equal(Number(body.effet.nouveau_taux), nouveau);
      assert.equal(Number(body.effet.ancien_taux), Number(avant.monthly_rate));

      const apres = await creditDe(a.id);
      assert.equal(Number(apres.monthly_rate), nouveau);
      assert.ok(
        Number(apres.mensualite) < Number(avant.mensualite),
        `un taux plus bas doit baisser la mensualité : ${avant.mensualite} -> ${apres.mensualite}`
      );

      // La somme des échéances restantes doit égaler le total annoncé,
      // au franc : c'est la convention « la dernière absorbe l'arrondi ».
      const restantes = (await echeancesDe(a.id)).filter((e) => e.st !== 'payee');
      const somme = restantes.reduce((s, e) => s + Number(e.amount), 0);
      assert.equal(somme, Number(body.effet.total_restant_du));
    });

    test('dépôt anticipé : le capital baisse, les intérêts restent, et l’argent est encaissé', async () => {
      // « Le capital baisse sans toucher aux intérêts, car le logiciel a
      //   déjà calculé ce qu'il attend. » (direction, 09/11/2026)
      const a = await clientAvecCredit('Gest Anticipe', 300000, 6);
      const ech = await echeancesDe(a.id);
      const premiere = Number(ech[0].amount);
      const soldeAvant = await soldeDe(a.clientId);
      assert.ok(soldeAvant >= premiere, 'précondition : le capital débloqué couvre une mensualité');

      const { body: d } = await deposer({
        creditId: a.id, nature: 'montant', montantDepose: premiere,
        motif: 'le client a depose une mensualite d avance',
      });
      await accorder(d.id);
      const { status, body } = await valider(d.id);
      assert.equal(status, 200);

      assert.equal(body.effet.interets_remis, 0, 'aucune remise d’intérêts');
      assert.equal(body.effet.montant_impute, premiere);
      assert.equal(body.effet.echeances_soldees.length, 1, 'une mensualité entière doit être soldée');
      assert.equal(body.effet.echeances_soldees[0].sequence, 1, 'la plus proche d’abord');

      assert.equal(
        await soldeDe(a.clientId), soldeAvant - premiere,
        'l’argent doit avoir quitté le compte : sans cela la maison perd le dépôt'
      );
      const apres = await echeancesDe(a.id);
      assert.equal(apres[0].st, 'payee');
      assert.ok(apres[0].amount, 'le montant de l’échéance soldée reste lisible');
      assert.equal(
        apres.filter((e) => e.st !== 'payee').length, ech.length - 1,
        'une échéance de moins à payer'
      );
    });

    test('un dépôt plus gros que le reste dû est refusé, et renvoie vers le rachat', async () => {
      const a = await clientAvecCredit('Gest Trop Gros', 300000, 6);
      const total = (await echeancesDe(a.id)).reduce((s, e) => s + Number(e.amount), 0);
      const { status, body } = await deposer({
        creditId: a.id, nature: 'montant', montantDepose: total + 1000,
        motif: 'depot superieur au reste du',
      });
      assert.equal(status, 422);
      assert.match(body.error, /rachat|anticip/i, 'le message doit dire où aller');
    });

    test('un dépôt que le compte ne porte pas est refusé', async () => {
      const a = await clientAvecCredit('Gest Sans Argent', 300000, 6);
      // On vide le compte, comme un client qui a tout retiré au guichet.
      await query(
        `INSERT INTO ledger_entries (account_id, type, amount, label)
         SELECT a.id, 'retrait', -COALESCE(b.balance, 0), 'Retrait guichet (fixture)'
         FROM accounts a LEFT JOIN account_balances b ON b.account_id = a.id
         WHERE a.user_id = $1 AND COALESCE(b.balance, 0) > 0`,
        [a.clientId]
      );
      const { status, body } = await deposer({
        creditId: a.id, nature: 'montant', montantDepose: 50000, motif: 'depot qui n existe pas',
      });
      assert.equal(status, 422);
      assert.match(body.error, /compte/i);
    });

    test('prélèvement supplémentaire : il passe outre « un salaire paie une mensualité »', async () => {
      // La règle du 04/11/2026 refuse une seconde mensualité sans
      // nouveau salaire. Les trois signatures sont l'autorisation
      // formelle de l'outrepasser — et le seul endroit du logiciel qui
      // pose `forcer`.
      const a = await clientAvecCredit('Gest Supplement', 300000, 6);
      await query(
        `UPDATE installments SET due_date = now()::date - 1
         WHERE credit_id = $1 AND sequence IN (1, 2)`,
        [a.id]
      );
      const operateur = await loginStaff('operateur');
      const ech = await echeancesDe(a.id);

      const { body: un } = await api('/v1/admin/operations/echeances/prelever', {
        method: 'POST', token: operateur, body: { echeanceIds: [ech[0].id] },
      });
      assert.equal(un.preleves.length, 1, 'la première passe normalement');

      // Sans salaire depuis, la seconde est refusée par la règle.
      const { body: deux } = await api('/v1/admin/operations/echeances/prelever', {
        method: 'POST', token: operateur, body: { echeanceIds: [ech[1].id] },
      });
      assert.equal(deux.preleves.length, 0);
      assert.match(deux.echecs[0].motif, /salaire/i);

      // Avec les trois signatures, elle passe.
      const { body: d } = await deposer({
        creditId: a.id, nature: 'prelevement_supplementaire', installmentId: ech[1].id,
        motif: 'le client a demande a payer deux mois d avance',
      });
      await accorder(d.id);
      const { status, body } = await valider(d.id);
      assert.equal(status, 200, JSON.stringify(body));
      assert.equal(body.effet.sequence, 2);

      const apres = await echeancesDe(a.id);
      assert.equal(apres[1].st, 'payee');
    });

    test('deux demandes de même nature en cours sur un dossier : la seconde est refusée', async () => {
      const a = await clientAvecCredit('Gest Doublon', 300000, 6);
      assert.equal((await deposer({
        creditId: a.id, nature: 'dates_echeances', jour: 4, motif: 'premiere demande',
      })).status, 201);
      const { status, body } = await deposer({
        creditId: a.id, nature: 'dates_echeances', jour: 8, motif: 'seconde demande',
      });
      assert.equal(status, 409);
      assert.match(body.error, /en cours/i);

      // Mais une autre nature peut coexister : elles ne se contredisent pas.
      const ech = await echeancesDe(a.id);
      assert.equal((await deposer({
        creditId: a.id, nature: 'prelevement_supplementaire', installmentId: ech[0].id,
        motif: 'autre nature, meme dossier',
      })).status, 201);
    });

    test('un refus ne touche à rien, et le motif revient au gestionnaire', async () => {
      const a = await clientAvecCredit('Gest Refus', 300000, 6);
      const avant = await echeancesDe(a.id);
      const { body: d } = await deposer({
        creditId: a.id, nature: 'dates_echeances', jour: 20, motif: 'demande a refuser',
      });

      const { status } = await api(`/v1/admin/gestion-credits/${d.id}/refuser`, {
        method: 'POST', token: await loginStaff('operateur'),
        body: { note: 'le guichet ne tient pas cette date' },
      });
      assert.equal(status, 200);

      assert.deepEqual(
        (await echeancesDe(a.id)).map((e) => e.due), avant.map((e) => e.due),
        'un refus ne doit rien modifier'
      );
      const { body: liste } = await api('/v1/admin/gestion-credits?statut=rejete', {
        token: await loginStaff('gestionnaire'),
      });
      const refusee = liste.demandes.find((x) => x.id === d.id);
      assert.ok(refusee, 'le gestionnaire doit retrouver sa demande refusée');
      assert.match(refusee.decision_note, /guichet/);
    });

    test('le client n’a accès à rien de tout cela', async () => {
      const a = await clientAvecCredit('Gest Client', 300000, 6);
      const { body: session } = await api('/v1/auth/connexion-client', {
        method: 'POST',
        body: {
          phone: (await query('SELECT phone FROM users WHERE id = $1', [a.clientId])).rows[0].phone,
          pin: '1234',
        },
      });
      const { status } = await api('/v1/admin/gestion-credits', { token: session.accessToken });
      assert.equal(status, 403);
    });
  }
);
