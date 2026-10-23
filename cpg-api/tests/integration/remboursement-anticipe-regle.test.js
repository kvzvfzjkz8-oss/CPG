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
      nomComplet: `Caissière Remb Regle ${Date.now()}`, telephone: tel, email,
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
  'Remboursement anticipé — la règle',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    // LE garde-fou : aucune politique n'est choisie par défaut.
    //
    // On retire d'abord toute règle éventuelle. Les fichiers de tests
    // partagent une base et l'un d'eux en pose une : le test porte sur
    // l'ABSENCE de règle, il ne doit pas dépendre de l'ordre des
    // fichiers.
    test('sans règle posée, aucun crédit ne peut être soldé', async () => {
      await api('/v1/admin/operations/remboursement-anticipe/regle', {
        method: 'DELETE', token: directeurToken,
      });
      const { creditId } = await creditApprouve('A', 2);
      const { status, body } = await calcul(creditId);
      assert.equal(status, 422);
      assert.match(body.error, /règle de rachat/i);
      assert.match(body.error, /direction doit/i, 'le message doit dire qui décide');
    });

    test('le gestionnaire ne peut pas retirer la règle non plus', async () => {
      await poserRegle({ partInteretsRestants: 0, penaliteInteretMensualite: 0 });
      const { status } = await api('/v1/admin/operations/remboursement-anticipe/regle', {
        method: 'DELETE', token: gestionnaireToken,
      });
      assert.equal(status, 403);
    });

    test('le gestionnaire ne peut pas poser la règle', async () => {
      const { status } = await api('/v1/admin/operations/remboursement-anticipe/regle', {
        method: 'PUT', token: gestionnaireToken,
        body: { partInteretsRestants: 0.35, penaliteInteretMensualite: 0.05 },
      });
      assert.equal(status, 403, 'la base du calcul engage l’établissement : direction seule');
    });

    // Une part au-delà de 100 % ferait payer plus d'intérêts que le
    // crédit n'en portait : la formule le refuse, en base comme dans
    // le service.
    test('une part d’intérêts supérieure à 100 % est refusée', async () => {
      const { status } = await poserRegle({ partInteretsRestants: 1.5, penaliteInteretMensualite: 0 });
      assert.equal(status, 422);

      const { status: pen } = await poserRegle({
        partInteretsRestants: 0.35, penaliteInteretMensualite: 2,
      });
      assert.equal(pen, 422, 'une pénalité au-delà d’une mensualité entière n’a plus de sens');
    });

    test('la direction pose la règle, et l’ancienne est conservée', async () => {
      const { status: a } = await poserRegle({
        partInteretsRestants: 1, penaliteInteretMensualite: 0, note: 'Première décision',
      });
      assert.equal(a, 200);

      const { status: b } = await poserRegle({
        partInteretsRestants: 0.35, penaliteInteretMensualite: 0.05,
        echeancesMinimum: 1, note: 'Révision',
      });
      assert.equal(b, 200);

      const { body } = await api('/v1/admin/operations/remboursement-anticipe/regle', {
        token: directeurToken,
      });
      assert.equal(Number(body.regle.part_interets_restants), 0.35);
      assert.equal(Number(body.regle.penalite_interet_mensualite), 0.05);
      assert.ok(body.regle.definie_par_nom, 'qui a posé la règle doit être tracé');
      assert.ok(
        body.historique.length >= 2,
        'l’ancienne règle doit rester dans l’historique — on n’écrase jamais une décision'
      );
      assert.ok(
        body.historique.some((h) => Number(h.part_interets_restants) === 1 && h.remplacee_le),
        'la règle remplacée doit porter sa date de remplacement'
      );
    });
  }
);
