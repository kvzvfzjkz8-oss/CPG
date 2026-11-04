/**
 * ═══════════════════════════════════════════════════════════════════
 *  UN SALAIRE PAIE UNE MENSUALITÉ
 * ═══════════════════════════════════════════════════════════════════
 *
 * « Le salaire du mois d'octobre prélève l'échéance prévue fin
 *   septembre ou début octobre. L'agent récupère tout son argent,
 *   c'est ce qu'on fait dans notre microfinance : le solde doit être
 *   avoisinant zéro après la récupération des salaires. Donc si un
 *   prélèvement est passé entre la période des salaires et celui du 27
 *   ou du 30, le solde a dû passer en négatif. »
 *   (direction, 04/11/2026)
 *
 * C'est le modèle de la maison, et il décide seul de tous les cas
 * rencontrés le 4 novembre 2026 :
 *
 *   • les agents QSR prélevés le 27 octobre l'ont été APRÈS que leur
 *     salaire soit reparti au guichet — solde à -151 970, -129 700,
 *     -169 553 F. C'est leur salaire de novembre qui a payé cette
 *     mensualité : novembre est couvert, la suivante attend décembre ;
 *
 *   • les agents GROA prélevés le 6 octobre l'ont été SUR leur salaire,
 *     solde resté positif. Octobre payé par octobre : leur mensualité
 *     de novembre était bien due, et l'avoir extournée a coûté
 *     1 065 371 F à rappeler.
 *
 * Deux règles antérieures sont mortes ici, et ce fichier les garde en
 * mémoire pour qu'on ne les réécrive pas :
 *   1. « une mensualité par mois civil » — 27 octobre et 4 novembre
 *      sont deux mois différents, elle ne voyait rien ;
 *   2. « au moins vingt-cinq jours d'écart » — elle bloquait
 *      27/10 → 04/11 même quand le prélèvement du 27 avait été couvert
 *      par le salaire, et renvoyait à tort des mensualités dues.
 *
 * Fichier séparé : chaque fichier de « node --test » repart avec son
 * propre compteur de requêtes (plafond de 120 par fenêtre de 60 s).
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { query } from '../../src/db/index.js';
import {
  startTestServer, stopTestServer, api, loginStaff, hasTestDatabase, fundCaissePrincipale,
} from '../helpers/testServer.js';

before(async () => { await startTestServer(); });
after(async () => { await stopTestServer(); });

const EMPLOYEUR = `SALAIRETEST${Date.now()}`;
let creneau = 0;

async function clientAvecCredit(nom, montant, duree) {
  const gestionnaireToken = await loginStaff('gestionnaire');
  const operateurToken = await loginStaff('operateur');
  const directeurToken = await loginStaff('directeur');

  const phone = `+24106${String(Math.floor(Math.random() * 900000) + 100000)}`;
  const { body: cree } = await api('/v1/admin/utilisateurs', {
    method: 'POST', token: gestionnaireToken,
    body: { nomComplet: nom, telephone: phone, role: 'client', codePin: '1234', employeur: EMPLOYEUR },
  });
  const { body: session } = await api('/v1/auth/connexion-client', {
    method: 'POST', body: { phone, pin: '1234' },
  });
  const { body: cat } = await api('/v1/admin/catalogue/produits/actifs', { token: gestionnaireToken });
  const produitId = cat.produits.find((p) => p.code === 'MICRO_STD').product_id;

  const { body: credit } = await api('/v1/client/credits', {
    method: 'POST', token: session.accessToken,
    body: { produitId, montant, duree, motif: 'Test une mensualite par salaire' },
  });
  await api(`/v1/admin/credits/${credit.id}/valider-niveau1`, { method: 'POST', token: operateurToken });

  // Un créneau de séance par crédit : deux séances ne partagent pas
  // la même heure, et ce fichier en monte plusieurs.
  const { status: seanceStatus, body: seance } = await api('/v1/admin/commission/seance', {
    method: 'POST',
    token: gestionnaireToken,
    body: { dateHeure: `2026-12-${String(5 + creneau++).padStart(2, '0')}T09:00` },
  });
  if (seanceStatus !== 201) throw new Error(`Créneau de séance occupé (${seanceStatus}).`);

  await api(`/v1/admin/commission/credits/${credit.id}/deposer`, { method: 'POST', token: gestionnaireToken });
  await api(`/v1/admin/commission/seance/${seance.id}/tenir`, {
    method: 'POST', token: directeurToken,
    body: { decisions: [{ kind: 'credit', creditId: credit.id, decision: 'valide' }] },
  });
  await api(`/v1/admin/commission/credits/${credit.id}/valider-double`, { method: 'POST', token: operateurToken });
  await fundCaissePrincipale();
  const { body: approuve } = await api(`/v1/admin/credits/${credit.id}/approuver`, {
    method: 'POST', token: directeurToken,
  });
  return {
    id: credit.id, reference: approuve.reference, numero: cree.client_number,
    clientId: cree.id, nom,
  };
}

/** Rend des échéances échues, pour pouvoir les prélever. */
const rendreEchues = (creditId, jusqua) => query(
  `UPDATE installments SET due_date = now()::date - 1
   WHERE credit_id = $1 AND sequence <= $2`,
  [creditId, jusqua]
);

/**
 * Verse un salaire. Chaque appel porte une PÉRIODE distincte : l'import
 * de paie est idempotent par employeur et par période — « relancer le
 * même lot ne crédite pas une seconde fois » — donc deux salaires du
 * même mois ne feraient qu'une écriture, et ces tests, qui comptent les
 * salaires, ne verraient rien venir.
 */
let moisDePaie = 0;
const verserSalaire = async (numero, montant) => {
  const d = new Date(Date.UTC(2026, 0 + moisDePaie++, 15));
  return api('/v1/admin/operations/salaires', {
    method: 'POST', token: await loginStaff('operateur'),
    body: {
      employeur: EMPLOYEUR,
      periode: d.toISOString().slice(0, 7),
      lignes: [{ identifiant: numero, montant }],
    },
  });
};

/**
 * Vide le compte, comme l'agent qui retire tout son salaire au
 * guichet. Écriture directe : le retrait réel passe par la caisse et la
 * validation du directeur, ce qui n'est pas l'objet de ce fichier.
 */
async function viderLeCompte(clientId) {
  const { rows } = await query(
    `SELECT a.id, COALESCE(b.balance, 0) AS solde FROM accounts a
     LEFT JOIN account_balances b ON b.account_id = a.id
     WHERE a.user_id = $1`,
    [clientId]
  );
  if (!rows[0] || Number(rows[0].solde) === 0) return;
  await query(
    `INSERT INTO ledger_entries (account_id, type, amount, label)
     VALUES ($1, 'retrait', $2, 'Retrait au guichet (fixture)')`,
    [rows[0].id, -Number(rows[0].solde)]
  );
}

const echeancesDe = (creditId) => query(
  `SELECT id, sequence, status::text AS st FROM installments
   WHERE credit_id = $1 ORDER BY sequence`,
  [creditId]
).then((r) => r.rows);

const soldeDe = (clientId) => query(
  `SELECT COALESCE(b.balance, 0) AS solde FROM accounts a
   LEFT JOIN account_balances b ON b.account_id = a.id WHERE a.user_id = $1`,
  [clientId]
).then((r) => Number(r.rows[0].solde));

const prelever = async (ids) => (await api('/v1/admin/operations/echeances/prelever', {
  method: 'POST', token: await loginStaff('operateur'), body: { echeanceIds: ids },
})).body;

describe(
  'un salaire paie une mensualité, et une seule',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    test('prélevée sur le salaire, solde resté positif : la suivante passe au salaire d’après', async () => {
      // Le cas GROA du 6 octobre. L'agent reçoit son salaire, la
      // mensualité est prise dessus, il retire le reste : solde à zéro.
      // Au salaire suivant, la mensualité du mois est bien due.
      const a = await clientAvecCredit('Agent Salaire Couvert', 300000, 6);
      await rendreEchues(a.id, 2);
      await viderLeCompte(a.clientId);

      await verserSalaire(a.numero, 600000);
      const ech = await echeancesDe(a.id);
      const premier = await prelever([ech[0].id]);
      assert.equal(premier.preleves.length, 1, 'la première passe');
      assert.ok(
        await soldeDe(a.clientId) > 0,
        'précondition : le prélèvement est couvert, le solde reste positif'
      );

      // Il retire le reste — le solde revient à zéro, comme à la
      // maison. Sans nouveau salaire, rien ne doit être prélevé.
      await viderLeCompte(a.clientId);
      const sansSalaire = await prelever([ech[1].id]);
      assert.equal(sansSalaire.preleves.length, 0, 'aucun salaire reçu depuis : rien ne passe');
      assert.match(sansSalaire.echecs[0].motif, /aucun salaire reçu depuis/);

      // Le salaire du mois suivant arrive : la mensualité est due.
      await verserSalaire(a.numero, 600000);
      const avecSalaire = await prelever([ech[1].id]);
      assert.equal(
        avecSalaire.echecs.length, 0,
        `refusée à tort : ${JSON.stringify(avecSalaire.echecs)}`
      );
      assert.equal(avecSalaire.preleves.length, 1);
    });

    test('prélevée à découvert : c’est le salaire suivant qui l’a payée, il faut attendre celui d’après', async () => {
      // Le cas QSR du 27 octobre. Le salaire est arrivé puis reparti au
      // guichet ; le prélèvement tombe ensuite sur un compte vide et le
      // met en négatif. Ce n'est pas ce salaire-là qui l'a payé.
      const a = await clientAvecCredit('Agent Salaire Decouvert', 300000, 6);
      await rendreEchues(a.id, 2);
      await viderLeCompte(a.clientId);

      await verserSalaire(a.numero, 600000);
      await viderLeCompte(a.clientId);

      const ech = await echeancesDe(a.id);
      const premier = await prelever([ech[0].id]);
      assert.equal(premier.preleves.length, 1, 'le prélèvement à découvert est permis');
      assert.equal(premier.preleves[0].decouvert, true);
      assert.ok(await soldeDe(a.clientId) < 0, 'précondition : le solde est négatif');

      // Un seul salaire depuis : il sert à rembourser ce découvert.
      await verserSalaire(a.numero, 600000);
      const unSeul = await prelever([ech[1].id]);
      assert.equal(unSeul.preleves.length, 0, 'ce salaire a payé la mensualité précédente');
      assert.match(unSeul.echecs[0].motif, /à découvert/);
      assert.match(unSeul.echecs[0].motif, /attend le salaire d’après/);

      // Le deuxième salaire, lui, paie la mensualité suivante.
      await verserSalaire(a.numero, 600000);
      const deuxieme = await prelever([ech[1].id]);
      assert.equal(deuxieme.echecs.length, 0, `refusée à tort : ${JSON.stringify(deuxieme.echecs)}`);
      assert.equal(deuxieme.preleves.length, 1);
    });

    test('deux mensualités le même mois sans salaire entre les deux sont refusées', async () => {
      // Le dégât du 27 octobre 2026 : MIYADIAMBA et NDOBA, prélevés le
      // 5, l'ont été de nouveau vingt-deux jours plus tard, sans
      // qu'aucun salaire ne soit passé entre les deux.
      const a = await clientAvecCredit('Agent Deux Le Meme Mois', 300000, 6);
      await rendreEchues(a.id, 2);
      await viderLeCompte(a.clientId);
      await verserSalaire(a.numero, 900000);

      const ech = await echeancesDe(a.id);
      assert.equal((await prelever([ech[0].id])).preleves.length, 1);

      const soldeAvant = await soldeDe(a.clientId);
      const seconde = await prelever([ech[1].id]);
      assert.equal(seconde.preleves.length, 0, 'la seconde ne doit pas passer');
      assert.match(seconde.echecs[0].motif, /aucun salaire reçu depuis/);
      assert.equal(
        await soldeDe(a.clientId), soldeAvant,
        'le compte ne doit pas avoir bougé d’un franc'
      );
    });

    test('le passage automatique obéit à la même règle', async () => {
      const a = await clientAvecCredit('Agent Passage Auto', 300000, 6);
      await rendreEchues(a.id, 2);
      await viderLeCompte(a.clientId);
      await verserSalaire(a.numero, 900000);

      const ech = await echeancesDe(a.id);
      assert.equal((await prelever([ech[0].id])).preleves.length, 1);

      const { status, body } = await api('/v1/admin/operations/echeances/executer', {
        method: 'POST', token: await loginStaff('operateur'),
      });
      assert.equal(status, 200);
      assert.equal(
        (body.paid || []).filter((p) => p.reference === a.reference).length, 0,
        'la collecte globale ne doit rien prélever de plus sur ce crédit'
      );
      const refus = (body.late || []).find((l) => l.reference === a.reference);
      assert.ok(refus, 'elle doit le signaler comme non prélevé');
      assert.match(refus.motif, /aucun salaire reçu depuis/);
    });

    test('un lot où l’opérateur choisit plusieurs échéances les règle toutes — c’est un rattrapage d’arriéré', async () => {
      // La direction veut garder ce geste : un client plusieurs mois en
      // retard qui touche enfin son salaire doit pouvoir être rattrapé.
      // Un lot est un acte unique, où l'opérateur a désigné chaque
      // échéance ; ce n'est pas deux passes séparées.
      const a = await clientAvecCredit('Agent Rattrapage Lot', 300000, 6);
      await rendreEchues(a.id, 3);
      await viderLeCompte(a.clientId);
      await verserSalaire(a.numero, 900000);

      const trois = (await echeancesDe(a.id)).filter((e) => e.sequence <= 3).map((e) => e.id);
      const lot = await prelever(trois);
      assert.equal(lot.echecs.length, 0, `le lot doit passer en entier : ${JSON.stringify(lot.echecs)}`);
      assert.equal(lot.preleves.length, 3, 'les trois arriérés doivent être réglés');
    });

    test('le compteur est propre à chaque crédit, jamais partagé entre deux', async () => {
      // « À moins que le client ait pris deux crédits qui se suivent » :
      // l'exception posée par la direction tient parce que le garde-fou
      // est borné par credit_id.
      const { rows } = await query(
        `SELECT c.id,
                count(*) FILTER (WHERE i.status = 'payee')::int AS payees
         FROM credit_requests c
         JOIN users u ON u.id = c.user_id
         JOIN installments i ON i.credit_id = c.id
         WHERE u.employer = $1
         GROUP BY c.id`,
        [EMPLOYEUR]
      );
      assert.ok(rows.length >= 5, 'ce fichier monte au moins cinq crédits');
      const comptes = rows.map((r) => r.payees).sort((x, y) => y - x);
      assert.equal(comptes[0], 3, 'le crédit soldé en un lot en porte trois');
      assert.ok(
        comptes.includes(1),
        'un autre n’en porte qu’une : les compteurs ne se mélangent pas'
      );
    });
  }
);
