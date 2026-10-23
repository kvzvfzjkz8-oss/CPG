/**
 * ═══════════════════════════════════════════════════════════════════
 *  REMBOURSEMENT ANTICIPÉ D'UN CRÉDIT
 * ═══════════════════════════════════════════════════════════════════
 *
 * « Possibilité de rachat d'un crédit. Il faut regarder comment on peut
 *   le faire. »
 *
 * Le rachat se pose sur cette brique : solder un crédit avant son
 * terme. Ce qui est testé ici, dans l'ordre d'importance :
 *
 *   • RIEN n'est soldable tant que la direction n'a pas posé la règle.
 *     Le choix de la base — capital restant ou reste des mensualités —
 *     représentait 8 673 641 F d'écart sur le portefeuille au
 *     23/10/2026. Le logiciel ne le prend pas à sa place.
 *
 *   • le calcul lui-même, vérifié à la main sur l'intérêt simple ;
 *
 *   • les deux bases donnent bien deux montants différents, et la règle
 *     retenue est celle qui s'applique ;
 *
 *   • le solde effectif : une seule écriture, les échéances restantes
 *     rattachées à elle, le crédit passé « solde » avec sa trace.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer, stopTestServer, api, loginStaff, hasTestDatabase, fundCaissePrincipale,
} from '../helpers/testServer.js';

let gestionnaireToken;
let directeurToken;
let operateurToken;
let caissierToken;
let produitId;

const CAPITAL = 600000;
const DUREE = 6;
const TAUX = 0.015;

before(async () => {
  await startTestServer();
  if (!hasTestDatabase()) return;
  gestionnaireToken = await loginStaff('gestionnaire');
  directeurToken = await loginStaff('directeur');
  operateurToken = await loginStaff('operateur');

  const email = `caissiere.remb.${Date.now()}@cpg.ga`;
  const tel = `+24105${String(Math.floor(Math.random() * 900000) + 100000)}`;
  await api('/v1/admin/utilisateurs', {
    method: 'POST', token: gestionnaireToken,
    body: {
      // Nom unique par fichier : un nom EXACTEMENT identique ne peut
      // être confirmé que par le directeur, et c'est le gestionnaire
      // qui crée ici. Les trois fichiers se marchaient dessus.
      nomComplet: `Caissière Remb Calcul ${Date.now()}`, telephone: tel, email,
      role: 'caissier', motDePasse: 'MotDePasseDemo2026!',
      // Les autres fichiers créent aussi des « Caissière … » : sans
      // cette confirmation, le garde-fou anti-doublon refuse la
      // création (409), la connexion échoue ensuite et tout le fichier
      // tombe sur un jeton vide.
      confirmerDoublon: true,
    },
  });
  caissierToken = await loginStaff(email);

  const { body } = await api('/v1/admin/catalogue/produits/actifs', { token: gestionnaireToken });
  produitId = body.produits.find((p) => p.code === 'MICRO_STD').product_id;
  await fundCaissePrincipale(5000000);
});

after(async () => {
  if (!hasTestDatabase()) { await stopTestServer(); return; }
  const { body } = await api('/v1/admin/commission/seance', { token: gestionnaireToken });
  if (body?.seance?.id) {
    const { body: file } = await api(`/v1/admin/commission/file-attente/${body.seance.id}`, {
      token: gestionnaireToken,
    });
    for (const d of file?.dossiers ?? []) {
      await api(`/v1/admin/commission/credits/${d.id}/retirer`, {
        method: 'POST', token: gestionnaireToken,
      });
    }
    await api(`/v1/admin/commission/seance/${body.seance.id}`, {
      method: 'DELETE', token: gestionnaireToken,
    });
  }
  await stopTestServer();
});

/**
 * Un crédit réellement en cours, avec `payees` échéances déjà réglées.
 *
 * On passe par la route « créer pour client » du gestionnaire : la
 * connexion client est plafonnée à 10 appels par quart d'heure et les
 * fichiers de tests partagent ce budget.
 */
async function creditApprouve(label, payees = 0) {
  const tel = `+24109${String(Math.floor(Math.random() * 900000) + 100000)}`;
  const { body: client } = await api('/v1/admin/utilisateurs', {
    method: 'POST', token: gestionnaireToken,
    body: {
      nomComplet: `Client Solde ${label}`, telephone: tel, role: 'client', codePin: '1234',
      confirmerDoublon: true,
    },
  });
  const { body: credit } = await api('/v1/admin/credits', {
    method: 'POST', token: gestionnaireToken,
    body: { clientId: client.id, produitId, montant: CAPITAL, duree: DUREE, motif: `Solde ${label}` },
  });
  await api(`/v1/admin/credits/${credit.id}/valider-niveau1`, { method: 'POST', token: operateurToken });

  const { body: existante } = await api('/v1/admin/commission/seance', { token: gestionnaireToken });
  if (existante?.seance?.id) {
    const { body: file } = await api(`/v1/admin/commission/file-attente/${existante.seance.id}`, {
      token: gestionnaireToken,
    });
    for (const d of file?.dossiers ?? []) {
      await api(`/v1/admin/commission/credits/${d.id}/retirer`, {
        method: 'POST', token: gestionnaireToken,
      });
    }
    await api(`/v1/admin/commission/seance/${existante.seance.id}`, {
      method: 'DELETE', token: gestionnaireToken,
    });
  }
  const demain = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
  const { body: seance } = await api('/v1/admin/commission/seance', {
    method: 'POST', token: gestionnaireToken, body: { dateHeure: demain },
  });
  await api(`/v1/admin/commission/credits/${credit.id}/deposer`, {
    method: 'POST', token: gestionnaireToken,
  });
  await api(`/v1/admin/commission/seance/${seance.id}/tenir`, {
    method: 'POST', token: directeurToken,
    body: { decisions: [{ kind: 'credit', creditId: credit.id, decision: 'valide' }] },
  });
  await api(`/v1/admin/commission/credits/${credit.id}/valider-double`, {
    method: 'POST', token: operateurToken,
  });
  const { status } = await api(`/v1/admin/credits/${credit.id}/approuver`, {
    method: 'POST', token: directeurToken,
  });
  assert.equal(status, 200, 'le crédit doit être approuvé');

  // Fait payer les premières échéances, pour se placer en milieu de
  // crédit — le cas réel d'un rachat.
  if (payees > 0) {
    const { body: detail } = await api(`/v1/admin/credits/${credit.id}`, { token: directeurToken });
    const aPayer = detail.installments.slice(0, payees);
    const total = aPayer.reduce((s, i) => s + Number(i.amount), 0);
    await api('/v1/caisse/encaissements', {
      method: 'POST', token: caissierToken, body: { clientId: client.id, montant: total + 50000 },
    });
    const { status: prel } = await api('/v1/admin/operations/echeances/prelever', {
      method: 'POST', token: operateurToken,
      body: { echeanceIds: aPayer.map((i) => i.id) },
    });
    assert.equal(prel, 200, 'les premières échéances doivent être prélevées');
  }

  return { creditId: credit.id, clientId: client.id, reference: credit.reference };
}

const poserRegle = (corps) => api('/v1/admin/operations/remboursement-anticipe/regle', {
  method: 'PUT', token: directeurToken, body: corps,
});

const calcul = (creditId, token = directeurToken) => api(
  `/v1/admin/operations/credits/${creditId}/solde-anticipe`, { token }
);

describe(
  'Remboursement anticipé — le calcul',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    // La formule de la direction, refaite à la main :
    //   capital restant + 35 % des intérêts restants
    //                   + 5 % de l'intérêt d'UNE mensualité
    test('le calcul applique la formule, terme par terme', async () => {
      await poserRegle({ partInteretsRestants: 0.35, penaliteInteretMensualite: 0.05, echeancesMinimum: 1 });
      const { creditId } = await creditApprouve('B2', 3);

      const { status, body } = await calcul(creditId);
      assert.equal(status, 200);

      const n = body.credit.echeancesTotal;
      const k = body.credit.echeancesPayees;
      const capital = body.credit.capital;
      const interetTotal = body.credit.interetTotal;

      assert.equal(body.capitalRestant, Math.round((capital * (n - k)) / n));
      assert.equal(body.interetsRestants, Math.round((interetTotal * (n - k)) / n));
      assert.equal(body.interetParMensualite, Math.round(interetTotal / n));
      assert.equal(body.partInterets, Math.round(body.interetsRestants * 0.35));
      assert.equal(body.penalite, Math.round(body.interetParMensualite * 0.05));
      assert.equal(
        body.montant,
        body.capitalRestant + body.partInterets + body.penalite,
        'le montant est la somme exacte des trois termes'
      );

      // Ce à quoi CPG renonce doit être dit, pas déduit.
      assert.equal(body.interetsAbandonnes, body.interetsRestants - body.partInterets);
      assert.ok(
        body.montant < body.resteMensualites,
        'la formule doit coûter moins au client que la totalité des mensualités restantes'
      );
      assert.ok(
        body.montant > body.capitalRestant,
        'et plus que le capital seul — CPG garde une part des intérêts'
      );
    });

    test('la part à 100 % équivaut au reste des mensualités', async () => {
      await poserRegle({ partInteretsRestants: 1, penaliteInteretMensualite: 0, echeancesMinimum: 1 });
      const { creditId } = await creditApprouve('B', 3);

      const { status, body } = await calcul(creditId);
      assert.equal(status, 200);
      assert.equal(body.credit.echeancesPayees, 3);
      assert.equal(body.credit.echeancesTotal, DUREE);

      // Intérêt simple : capital restant = capital × (n − k) / n.
      const attendu = Math.round((CAPITAL * (DUREE - 3)) / DUREE);
      assert.equal(body.capitalRestant, attendu, 'capital restant linéaire sur les échéances');
      assert.equal(
        body.montant, body.resteMensualites,
        'avec 100 % des intérêts et aucune pénalité, on retombe exactement sur le reste des mensualités'
      );
      assert.equal(body.interetsAbandonnes, 0, 'CPG ne renonce alors à rien');
    });


    test('changer la part change le montant réclamé', async () => {
      const { creditId } = await creditApprouve('D', 3);

      await poserRegle({ partInteretsRestants: 0, penaliteInteretMensualite: 0 });
      const { body: sansInterets } = await calcul(creditId);

      await poserRegle({ partInteretsRestants: 0.35, penaliteInteretMensualite: 0.05 });
      const { body: formule } = await calcul(creditId);

      await poserRegle({ partInteretsRestants: 1, penaliteInteretMensualite: 0 });
      const { body: tousInterets } = await calcul(creditId);

      assert.equal(sansInterets.montant, sansInterets.capitalRestant);
      assert.equal(tousInterets.montant, tousInterets.resteMensualites);
      assert.ok(
        sansInterets.montant < formule.montant && formule.montant < tousInterets.montant,
        'la formule de la direction doit se situer entre les deux extrêmes'
      );
    });

    test('la règle peut exiger un minimum d’échéances payées', async () => {
      await poserRegle({ partInteretsRestants: 0, penaliteInteretMensualite: 0, echeancesMinimum: 3 });
      const { creditId } = await creditApprouve('E', 1);

      const { body } = await calcul(creditId);
      assert.equal(body.possible, false);
      assert.equal(body.echeancesManquantes, 2);

      const { status, body: refus } = await api(`/v1/admin/operations/credits/${creditId}/solder`, {
        method: 'POST', token: directeurToken,
      });
      assert.equal(status, 422);
      assert.match(refus.error, /il en manque 2/);
    });

    // Le cœur : le solde effectif.
  }
);
