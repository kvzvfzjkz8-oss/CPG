/**
 * ═══════════════════════════════════════════════════════════════════
 *  LE CRÉDIT D'UNE ENTREPRISE S'AMORTIT SANS SALAIRE
 * ═══════════════════════════════════════════════════════════════════
 *
 * « Peux-tu me regarder si c'est possible de faire un crédit
 *   entreprise ? » puis « Oui fais-le, virement mensuel encaissé au
 *   guichet. » (direction, 17/11/2026)
 *
 * La règle du 04/11/2026 — un salaire paie une mensualité — raisonne
 * sur le salaire : c'est lui qui paie, et c'est son arrivée qui
 * autorise la mensualité suivante. Une entreprise n'en reçoit jamais :
 * elle vire sa mensualité, qu'on encaisse au guichet. Appliquée telle
 * quelle, la règle bloquait son crédit après la PREMIÈRE échéance, et
 * pour toujours.
 *
 * Ce fichier vérifie les deux côtés de la correction : qu'une
 * entreprise s'amortit normalement, et que les particuliers restent
 * protégés exactement comme avant. Le second point compte autant que le
 * premier — 231 clients en dépendent.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { query } from '../../src/db/index.js';
import {
  startTestServer, stopTestServer, api, loginStaff, hasTestDatabase, fundCaissePrincipale,
} from '../helpers/testServer.js';

// Une caissiere propre a ce fichier : il n'y en a pas dans ACCOUNTS, et
// l'encaissement au guichet est tout l'objet de la serie — c'est par la
// que l'entreprise provisionne son compte.
let caissiereToken;

before(async () => {
  await startTestServer();
  if (!hasTestDatabase()) return;
  const directeur = await loginStaff('directeur');
  const email = `caissiere.entreprise.${Date.now()}@cpg.ga`;
  const { status } = await api('/v1/admin/utilisateurs', {
    method: 'POST', token: directeur,
    body: {
      nomComplet: 'Caissiere Credit Entreprise',
      telephone: `+24105${String(Math.floor(Math.random() * 900000) + 100000)}`,
      email, role: 'caissier', motDePasse: 'MotDePasseDemo2026!',
    },
  });
  assert.equal(status, 201, 'la caissiere du fichier doit se creer');
  caissiereToken = await loginStaff(email);
});
after(async () => { await stopTestServer(); });

const unique = Date.now();
let suivant = 0;
let creneau = 0;

async function clientAvecCredit(nom, typeClient, montant, duree) {
  const gestionnaire = await loginStaff('gestionnaire');
  const operateur = await loginStaff('operateur');
  const directeur = await loginStaff('directeur');

  const phone = `+2410${String(unique).slice(-6)}${String(suivant++).padStart(2, '0')}`;
  const { status: cree, body: client } = await api('/v1/admin/utilisateurs', {
    method: 'POST', token: directeur,
    body: {
      nomComplet: nom, telephone: phone, role: 'client',
      codePin: '1234', employeur: 'CREDENT', typeClient,
    },
  });
  assert.equal(cree, 201, `création de « ${nom} » : ${JSON.stringify(client)}`);

  const { body: session } = await api('/v1/auth/connexion-client', {
    method: 'POST', body: { phone, pin: '1234' },
  });
  const { body: cat } = await api('/v1/admin/catalogue/produits/actifs', { token: gestionnaire });
  const produitId = cat.produits.find((p) => p.code === 'MICRO_STD').product_id;

  const { body: credit } = await api('/v1/client/credits', {
    method: 'POST', token: session.accessToken,
    body: { produitId, montant, duree, motif: 'Test credit entreprise' },
  });
  await api(`/v1/admin/credits/${credit.id}/valider-niveau1`, { method: 'POST', token: operateur });

  const { status: st, body: seance } = await api('/v1/admin/commission/seance', {
    method: 'POST', token: gestionnaire,
    body: { dateHeure: `2026-12-${String(5 + creneau++).padStart(2, '0')}T09:00` },
  });
  if (st !== 201) throw new Error(`Créneau de séance occupé (${st}).`);

  await api(`/v1/admin/commission/credits/${credit.id}/deposer`, { method: 'POST', token: gestionnaire });
  await api(`/v1/admin/commission/seance/${seance.id}/tenir`, {
    method: 'POST', token: directeur,
    body: { decisions: [{ kind: 'credit', creditId: credit.id, decision: 'valide' }] },
  });
  await api(`/v1/admin/commission/credits/${credit.id}/valider-double`, { method: 'POST', token: operateur });
  await fundCaissePrincipale();
  await api(`/v1/admin/credits/${credit.id}/approuver`, { method: 'POST', token: directeur });

  return { id: credit.id, clientId: client.id, numero: client.client_number };
}

const echeancesDe = (creditId) => query(
  `SELECT id, sequence, status::text AS st, amount::bigint AS amount
   FROM installments WHERE credit_id = $1 ORDER BY sequence`,
  [creditId]
).then((r) => r.rows);

const soldeDe = (clientId) => query(
  `SELECT COALESCE(b.balance, 0)::bigint AS solde FROM accounts a
   LEFT JOIN account_balances b ON b.account_id = a.id WHERE a.user_id = $1`,
  [clientId]
).then((r) => Number(r.rows[0].solde));

/** Le virement mensuel de l'entreprise, encaissé au guichet. */
const encaisser = (clientId, montant) => api('/v1/caisse/encaissements', {
  method: 'POST', token: caissiereToken,
  body: { clientId, montant },
});

const rendreEchues = (creditId, jusqua) => query(
  `UPDATE installments SET due_date = now()::date - 1
   WHERE credit_id = $1 AND sequence <= $2`,
  [creditId, jusqua]
);

const prelever = async (ids) => (await api('/v1/admin/operations/echeances/prelever', {
  method: 'POST', token: await loginStaff('operateur'), body: { echeanceIds: ids },
})).body;

describe(
  'Crédit d’entreprise — le rythme est l’échéancier, pas le salaire',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    test('une entreprise enchaîne ses mensualités sans jamais recevoir de salaire', async () => {
      const e = await clientAvecCredit(`Entreprise Credit ${unique}`, 'entreprise', 300000, 6);
      await rendreEchues(e.id, 3);
      const ech = await echeancesDe(e.id);

      // Elle vire de quoi couvrir trois mensualités : on encaisse au
      // guichet, comme la direction l'a décrit.
      const troisMois = ech.slice(0, 3).reduce((t, x) => t + Number(x.amount), 0);
      await encaisser(e.clientId, troisMois);

      // Trois passes SÉPARÉES — c'est ce que la règle du salaire
      // refusait : sans paie entre deux, la deuxième était bloquée.
      for (const i of [0, 1, 2]) {
        const r = await prelever([ech[i].id]);
        assert.equal(
          r.preleves.length, 1,
          `l’échéance ${i + 1} doit passer : ${JSON.stringify(r.echecs)}`
        );
      }

      const apres = await echeancesDe(e.id);
      assert.equal(
        apres.filter((x) => x.st === 'payee').length, 3,
        'trois mensualités réglées, sans une seule ligne de paie'
      );
    });

    test('un particulier reste protégé : la deuxième mensualité est toujours refusée', async () => {
      // Le même scénario, sur un particulier. Si cette assertion
      // tombait, la correction aurait ouvert une brèche chez les 231
      // clients que la règle protège.
      const p = await clientAvecCredit(`Particulier Credit ${unique}`, 'particulier', 300000, 6);
      await rendreEchues(p.id, 2);
      const ech = await echeancesDe(p.id);
      await encaisser(p.clientId, ech[0].amount + ech[1].amount);

      assert.equal((await prelever([ech[0].id])).preleves.length, 1, 'la première passe');

      const seconde = await prelever([ech[1].id]);
      assert.equal(seconde.preleves.length, 0, 'la seconde doit être refusée');
      assert.match(seconde.echecs[0].motif, /salaire/i, 'et pour la raison du salaire');
    });

    test('sans provision, l’entreprise n’est pas mise à découvert', async () => {
      // Un agent payé dont le salaire ne couvre pas l'échéance passe à
      // découvert : c'est un signal. Une entreprise qui n'a pas encore
      // viré n'est pas dans ce cas — l'échéance reste en retard, sans
      // mouvement d'argent.
      const e = await clientAvecCredit(`Entreprise Sans Virement ${unique}`, 'entreprise', 300000, 6);
      await rendreEchues(e.id, 1);
      const ech = await echeancesDe(e.id);

      // On vide le compte : le capital débloqué a été retiré, et le
      // virement du mois n'est pas arrivé.
      await query(
        `INSERT INTO ledger_entries (account_id, type, amount, label)
         SELECT a.id, 'retrait', -COALESCE(b.balance, 0), 'Retrait guichet (fixture)'
         FROM accounts a LEFT JOIN account_balances b ON b.account_id = a.id
         WHERE a.user_id = $1 AND COALESCE(b.balance, 0) > 0`,
        [e.clientId]
      );

      const r = await prelever([ech[0].id]);
      assert.equal(r.preleves.length, 0, 'rien ne doit être prélevé');
      assert.match(r.echecs[0].motif, /virement/i, 'le motif doit parler du virement, pas d’un salaire');
      assert.equal(await soldeDe(e.clientId), 0, 'le compte ne doit pas passer au négatif');

      const apres = await echeancesDe(e.id);
      assert.equal(apres[0].st, 'en_retard', 'l’échéance est signalée en retard');
    });

    test('le passage automatique traite l’entreprise comme l’échéancier le demande', async () => {
      const e = await clientAvecCredit(`Entreprise Auto ${unique}`, 'entreprise', 300000, 6);
      await rendreEchues(e.id, 2);
      const ech = await echeancesDe(e.id);
      await encaisser(e.clientId, ech[0].amount + ech[1].amount);

      const { status, body } = await api('/v1/admin/operations/echeances/executer', {
        method: 'POST', token: await loginStaff('operateur'),
      });
      assert.equal(status, 200);

      const apres = await echeancesDe(e.id);
      const payees = apres.filter((x) => x.st === 'payee').length;
      assert.ok(
        payees >= 1,
        `la collecte automatique doit encaisser ce qui est dû et provisionné : ${payees} payée(s), ${JSON.stringify(body.late?.slice(0, 2))}`
      );
    });
  }
);
