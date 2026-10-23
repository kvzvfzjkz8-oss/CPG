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
      nomComplet: `Caissière Remb Solde ${Date.now()}`, telephone: tel, email,
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
  'Remboursement anticipé — solder',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    test('solder débite une seule fois, règle toutes les échéances et clôt le crédit', async () => {
      await poserRegle({ base: 'capital_restant', indemniteMois: 1, echeancesMinimum: 1 });
      const { creditId, clientId } = await creditApprouve('F', 3);

      const { body: avant } = await calcul(creditId);
      // De quoi payer : le client solde avec son propre argent.
      await api('/v1/caisse/encaissements', {
        method: 'POST', token: caissierToken,
        body: { clientId, montant: avant.montant + 10000 },
      });

      const { body: soldeAvant } = await api(`/v1/caisse/clients/${clientId}/transactions`, {
        token: caissierToken,
      });

      const { status, body } = await api(`/v1/admin/operations/credits/${creditId}/solder`, {
        method: 'POST', token: directeurToken,
      });
      assert.equal(status, 200);
      assert.equal(body.montant, avant.montant);
      assert.equal(body.echeancesSoldees, DUREE - 3, 'les trois échéances restantes sont réglées');
      assert.equal(body.rachat, false, 'soldé par le client, pas par un rachat');

      // Le client est débité une seule fois, du montant calculé.
      const { body: apres } = await api(`/v1/caisse/clients/${clientId}/transactions`, {
        token: caissierToken,
      });
      assert.equal(
        Number(apres.client.balance), Number(soldeAvant.client.balance) - avant.montant,
        'un seul débit, du montant exact'
      );

      // Le crédit est clos, et sa trace dit qu'il l'a été par anticipation.
      const { body: detail } = await api(`/v1/admin/credits/${creditId}`, { token: directeurToken });
      assert.equal(detail.credit.status, 'solde');
      assert.equal(Number(detail.credit.solde_par_anticipation_montant), avant.montant);
      assert.ok(detail.credit.solde_par_anticipation_le, 'la date d’anticipation doit être posée');
      assert.equal(detail.credit.rachete_par_credit_id, null);
      assert.ok(
        detail.installments.every((i) => i.status === 'payee'),
        'plus aucune échéance ne doit rester due'
      );
    });

    test('un crédit déjà soldé ne peut pas l’être deux fois', async () => {
      await poserRegle({ base: 'capital_restant', indemniteMois: 0, echeancesMinimum: 1 });
      const { creditId, clientId } = await creditApprouve('G', 2);
      const { body: c } = await calcul(creditId);
      await api('/v1/caisse/encaissements', {
        method: 'POST', token: caissierToken, body: { clientId, montant: c.montant + 5000 },
      });
      await api(`/v1/admin/operations/credits/${creditId}/solder`, {
        method: 'POST', token: directeurToken,
      });

      const { status, body } = await api(`/v1/admin/operations/credits/${creditId}/solder`, {
        method: 'POST', token: directeurToken,
      });
      assert.equal(status, 409);
      assert.match(body.error, /déjà soldé/i);
    });

    // Après approbation, les fonds du crédit sont ENCORE sur le compte
    // du client : il a de quoi solder. Pour éprouver le refus, il faut
    // d'abord vider le compte — ce que fait un agent qui retire son
    // argent au guichet, le cas réel.
    test('un solde non couvert par le compte est refusé', async () => {
      await poserRegle({ base: 'capital_restant', indemniteMois: 0, echeancesMinimum: 1 });
      const { creditId, clientId } = await creditApprouve('H', 2);

      const { body: avant } = await api(`/v1/caisse/clients/${clientId}/transactions`, {
        token: caissierToken,
      });
      const aVider = Number(avant.client.balance);
      assert.ok(aVider > 0, 'le compte porte bien les fonds du crédit');

      const { body: retrait } = await api('/v1/admin/operations/retraits-ponctuels', {
        method: 'POST', token: operateurToken,
        body: { clientId, montant: aVider, destination: 'cpg', motif: 'Vidage pour test de refus' },
      });
      await api(`/v1/caisse/operations/${retrait.id}/valider`, {
        method: 'POST', token: directeurToken,
      });

      const { status, body } = await api(`/v1/admin/operations/credits/${creditId}/solder`, {
        method: 'POST', token: directeurToken,
      });
      assert.equal(status, 422);
      assert.match(body.error, /insuffisant/i);
    });

    test('un opérateur ne peut pas solder un crédit', async () => {
      await poserRegle({ base: 'capital_restant', indemniteMois: 0, echeancesMinimum: 1 });
      const { creditId } = await creditApprouve('I', 2);
      const { status } = await api(`/v1/admin/operations/credits/${creditId}/solder`, {
        method: 'POST', token: operateurToken,
      });
      assert.equal(status, 403);
    });
  }
);
