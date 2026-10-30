/**
 * ═══════════════════════════════════════════════════════════════════
 *  LE DÉTAIL DERRIÈRE LE CHIFFRE DU COFFRE
 * ═══════════════════════════════════════════════════════════════════
 *
 * « J'aimerais aussi que dans l'onglet coffre, pour ce qui est des
 *   remboursements collectés, tu puisses détailler les remboursements
 *   lorsqu'on clique sur le chiffre. »
 *
 * Le coffre affichait un total, puis une répartition par mois. Un total
 * de plusieurs millions sans ses lignes ne se vérifie pas : il se
 * croit. Ces tests fixent le niveau du dessous — qui a payé, combien,
 * sur quel crédit, quelle échéance — et surtout le point qui ferait
 * mentir l'écran : le total affiché doit porter sur toute la période,
 * même quand la liste est tronquée.
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
let clientNom;
let reference;
let montantEcheance;

const moisCourant = new Date().toISOString().slice(0, 7);

before(async () => {
  await startTestServer();
  if (!hasTestDatabase()) return;
  gestionnaireToken = await loginStaff('gestionnaire');
  directeurToken = await loginStaff('directeur');
  operateurToken = await loginStaff('operateur');

  const email = `caissiere.coffre.${Date.now()}@cpg.ga`;
  const tel = `+24105${String(Math.floor(Math.random() * 900000) + 100000)}`;
  await api('/v1/admin/utilisateurs', {
    method: 'POST', token: gestionnaireToken,
    body: {
      nomComplet: `Caissière Coffre Detail ${Date.now()}`, telephone: tel, email,
      role: 'caissier', motDePasse: 'MotDePasseDemo2026!', confirmerDoublon: true,
    },
  });
  caissierToken = await loginStaff(email);

  const { body: cat } = await api('/v1/admin/catalogue/produits/actifs', { token: gestionnaireToken });
  produitId = cat.produits.find((p) => p.code === 'MICRO_STD').product_id;
  await fundCaissePrincipale(5000000);

  // Un crédit réellement remboursé d'une échéance : c'est lui qui
  // écrit le paiement_credit que le coffre doit savoir détailler.
  clientNom = `Client Coffre ${Date.now()}`;
  const telClient = `+24109${String(Math.floor(Math.random() * 900000) + 100000)}`;
  const { body: client } = await api('/v1/admin/utilisateurs', {
    method: 'POST', token: gestionnaireToken,
    body: { nomComplet: clientNom, telephone: telClient, role: 'client', codePin: '1234', confirmerDoublon: true },
  });

  const { body: credit } = await api('/v1/admin/credits', {
    method: 'POST', token: gestionnaireToken,
    body: { clientId: client.id, produitId, montant: 600000, duree: 6, motif: 'Coffre detail' },
  });
  reference = credit.reference;
  await api(`/v1/admin/credits/${credit.id}/valider-niveau1`, { method: 'POST', token: operateurToken });

  // La séance est partagée entre fichiers de tests : on vide puis on
  // supprime celle en place avant d'en programmer une à nous.
  const { body: existante } = await api('/v1/admin/commission/seance', { token: gestionnaireToken });
  if (existante?.seance?.id) {
    const { body: file } = await api(`/v1/admin/commission/file-attente/${existante.seance.id}`, { token: gestionnaireToken });
    for (const d of file?.dossiers ?? []) {
      await api(`/v1/admin/commission/credits/${d.id}/retirer`, { method: 'POST', token: gestionnaireToken });
    }
    await api(`/v1/admin/commission/seance/${existante.seance.id}`, { method: 'DELETE', token: gestionnaireToken });
  }
  const demain = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
  const { body: seance } = await api('/v1/admin/commission/seance', {
    method: 'POST', token: gestionnaireToken, body: { dateHeure: demain },
  });
  await api(`/v1/admin/commission/credits/${credit.id}/deposer`, { method: 'POST', token: gestionnaireToken });
  await api(`/v1/admin/commission/seance/${seance.id}/tenir`, {
    method: 'POST', token: directeurToken,
    body: { decisions: [{ kind: 'credit', creditId: credit.id, decision: 'valide' }] },
  });
  await api(`/v1/admin/commission/credits/${credit.id}/valider-double`, { method: 'POST', token: operateurToken });
  await api(`/v1/admin/credits/${credit.id}/approuver`, { method: 'POST', token: directeurToken });

  const { body: detail } = await api(`/v1/admin/credits/${credit.id}`, { token: directeurToken });
  const premiere = detail.installments[0];
  montantEcheance = Number(premiere.amount);

  await api('/v1/caisse/encaissements', {
    method: 'POST', token: caissierToken,
    body: { clientId: client.id, montant: montantEcheance + 50000 },
  });
  const { status } = await api('/v1/admin/operations/echeances/prelever', {
    method: 'POST', token: operateurToken, body: { echeanceIds: [premiere.id] },
  });
  assert.equal(status, 200, 'l’échéance doit être prélevée — sans elle, rien à détailler');
});

after(async () => {
  if (!hasTestDatabase()) { await stopTestServer(); return; }
  const { body } = await api('/v1/admin/commission/seance', { token: gestionnaireToken });
  if (body?.seance?.id) {
    const { body: file } = await api(`/v1/admin/commission/file-attente/${body.seance.id}`, { token: gestionnaireToken });
    for (const d of file?.dossiers ?? []) {
      await api(`/v1/admin/commission/credits/${d.id}/retirer`, { method: 'POST', token: gestionnaireToken });
    }
    await api(`/v1/admin/commission/seance/${body.seance.id}`, { method: 'DELETE', token: gestionnaireToken });
  }
  await stopTestServer();
});

const mouvements = (coffre, mois, token = directeurToken) => api(
  `/v1/caisse/coffres/${coffre}/mouvements${mois ? `?mois=${mois}` : ''}`, { token }
);

describe(
  'Coffre — le détail derrière le chiffre',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    test('le remboursement encaissé figure au détail, avec son client et son crédit', async () => {
      const { status, body } = await mouvements('remboursements');
      assert.equal(status, 200);

      const ligne = body.mouvements.find((m) => m.client === clientNom);
      assert.ok(ligne, 'le client qui vient de rembourser doit apparaître nommément');
      assert.equal(ligne.montant, montantEcheance, 'et pour le montant réellement prélevé');
      assert.equal(ligne.credit, reference, 'avec la référence du crédit remboursé');
      assert.equal(ligne.echeances, '1', 'et le rang de l’échéance couverte');
      assert.ok(ligne.date, 'une ligne sans date ne se vérifie pas');
    });

    test('le montant est positif — vu du coffre, un remboursement est une entrée', async () => {
      // paiement_credit est écrit en négatif côté client. Sans le
      // changement de signe, le détail afficherait des montants
      // négatifs sous un total positif.
      const { body } = await mouvements('remboursements');
      assert.ok(body.mouvements.every((m) => m.montant > 0));
      assert.ok(body.total > 0);
    });

    test('une écriture couvrant deux échéances ne compte qu’une fois', async () => {
      // Le défaut trouvé par ce fichier : la jointure sur les échéances
      // dupliquait l'écriture quand un prélèvement en soldait deux, et
      // le détail annonçait 5 645 902 F là où le coffre en comptait
      // 3 826 102. Un écran de vérification qui invente de l'argent est
      // pire que pas d'écran.
      const { body } = await mouvements('remboursements');
      const ids = body.mouvements.map((m) => m.id);
      assert.equal(new Set(ids).size, ids.length, 'une écriture, une ligne');
    });

    test('le total annoncé est la somme de la période, pas celle des lignes affichées', async () => {
      // C'est le point par lequel un écran de détail devient faux : si
      // la liste est tronquée et que le total suit la liste, le
      // directeur lit un chiffre qui n'existe pas.
      const { body } = await mouvements('remboursements');
      assert.equal(typeof body.nombre, 'number');
      assert.equal(body.tronque, body.nombre > body.mouvements.length);
      if (!body.tronque) {
        const somme = body.mouvements.reduce((s, m) => s + m.montant, 0);
        assert.equal(somme, body.total, 'liste complète : la somme doit tomber sur le total');
      }
    });

    test('le filtre par mois ne garde que ce mois', async () => {
      const { status, body } = await mouvements('remboursements', moisCourant);
      assert.equal(status, 200);
      assert.equal(body.mois, moisCourant);
      assert.ok(
        body.mouvements.every((m) => m.date.slice(0, 7) === moisCourant),
        'une ligne d’un autre mois ferait un détail qui ne correspond pas au chiffre cliqué'
      );
      assert.ok(body.mouvements.some((m) => m.client === clientNom));
    });

    test('un mois sans mouvement répond une liste vide, pas une erreur', async () => {
      const { status, body } = await mouvements('remboursements', '2019-01');
      assert.equal(status, 200);
      assert.deepEqual(body.mouvements, []);
      assert.equal(body.total, 0);
    });

    test('le même détail existe pour les autres coffres', async () => {
      for (const coffre of ['frais_agios', 'frais_dossier']) {
        const { status, body } = await mouvements(coffre);
        assert.equal(status, 200, `le coffre ${coffre} doit se détailler aussi`);
        assert.ok(Array.isArray(body.mouvements));
      }
    });

    test('un coffre inconnu et un mois mal formé sont refusés', async () => {
      const { status: c } = await mouvements('coffre_imaginaire');
      assert.equal(c, 422);
      const { status: m } = await mouvements('remboursements', '2026-13-01');
      assert.equal(m, 422, 'le format du mois est validé avant d’atteindre le service');
    });

    test('la caissière peut lire le détail, l’opératrice non', async () => {
      const { status: parCaissiere } = await mouvements('remboursements', null, caissierToken);
      assert.equal(parCaissiere, 200, 'elle a déjà coffres.lire sur le total');
      const { status: parOperatrice } = await mouvements('remboursements', null, operateurToken);
      assert.equal(parOperatrice, 403);
    });
  }
);
