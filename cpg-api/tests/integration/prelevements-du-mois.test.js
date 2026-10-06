/**
 * ═══════════════════════════════════════════════════════════════════
 *  PRÉLÈVEMENTS DU MOIS — PILOTÉS PAR L'OPÉRATEUR
 * ═══════════════════════════════════════════════════════════════════
 *
 * L'opérateur doit pouvoir voir qui est prélevable ce mois-ci,
 * chercher les agents d'une entreprise donnée, et lancer les
 * prélèvements un par un ou pour toute l'entreprise — sans attendre
 * la collecte globale de fin de mois.
 *
 * Fichier séparé : l'application plafonne chaque fenêtre de 60 s à
 * 120 requêtes (src/app.js), et « node --test » exécute un processus
 * par fichier, donc chaque fichier repart avec son propre compteur.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer, stopTestServer, api, loginStaff, hasTestDatabase, fundCaissePrincipale,
} from '../helpers/testServer.js';

before(async () => {
  await startTestServer();
});

after(async () => {
  await stopTestServer();
});

const EMPLOYEUR = `RAILSTEST${Date.now()}`;

/** Crée un client rattaché à EMPLOYEUR et lui fait approuver un crédit. */
async function clientAvecCredit(nom, montant, duree, codeProduit = 'MICRO_STD') {
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
  const produitId = cat.produits.find((p) => p.code === codeProduit).product_id;

  const { body: credit } = await api('/v1/client/credits', {
    method: 'POST', token: session.accessToken,
    body: { produitId, montant, duree, motif: 'Test prélèvements' },
  });
  await api(`/v1/admin/credits/${credit.id}/valider-niveau1`, { method: 'POST', token: operateurToken });

  const { status: seanceStatus, body: seance } = await api('/v1/admin/commission/seance', {
    method: 'POST', token: gestionnaireToken, body: { dateHeure: '2026-12-01T09:00' },
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

  return { id: credit.id, reference: approuve.reference, clientId: cree.id, nom, numero: cree.client_number };
}

describe(
  'prélèvements du mois : lister, chercher par entreprise, prélever individuellement',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    // Approuver un crédit verse le capital sur le compte du client :
    // un agent est donc provisionné par construction. Pour obtenir un
    // cas réellement à découvert, on prend un crédit EXPRESS sur un
    // seul mois — l'unique échéance (capital + intérêts) dépasse le
    // montant débloqué, net des frais de dossier et de la commission.
    let agentA;   // provisionné — prélèvement individuel
    let agentB;   // provisionné — prélèvement par entreprise
    let agentC;   // à découvert, sans salaire versé
    let agentD;   // à découvert, salaire versé mais insuffisant
    /**
     * Un crédit approuvé aujourd'hui a sa première échéance le mois
     * suivant : on interroge donc le mois de cette échéance, via le
     * paramètre asOf que la route expose. Ça vérifie du même coup le
     * calcul des bornes du mois.
     */
    let asOf;
    let premiereEcheance;

    const duMois = async (token, recherche = EMPLOYEUR) => api(
      `/v1/admin/operations/echeances/du-mois?asOf=${asOf}`
      + `&recherche=${encodeURIComponent(recherche)}`,
      { token }
    );

    before(async () => {
      agentA = await clientAvecCredit('Agent Rails Alpha', 120000, 4);
      agentB = await clientAvecCredit('Agent Rails Beta', 120000, 4);
      agentC = await clientAvecCredit('Agent Rails Demuni', 100000, 1, 'EXPRESS');
      agentD = await clientAvecCredit('Agent Rails Decouvert', 100000, 1, 'EXPRESS');

      const { body: echeancier } = await api(
        `/v1/admin/operations/echeances?reference=${agentA.reference}`,
        { token: await loginStaff('operateur') }
      );
      premiereEcheance = echeancier.installments[0].due_date.slice(0, 10);
      // Les échéances pas encore échues ne s'affichent qu'à partir du 25
      // du mois : on se place à cette date pour voir tout le mois.
      asOf = `${premiereEcheance.slice(0, 8)}25`;

      // Seuls A et B reçoivent leur salaire. C reste à découvert, ce
      // qui doit être signalé sans rien débiter.
      await api('/v1/admin/operations/salaires', {
        method: 'POST', token: await loginStaff('operateur'),
        body: {
          employeur: EMPLOYEUR,
          periode: new Date().toISOString().slice(0, 7),
          lignes: [
            { identifiant: agentA.numero, montant: 500000 },
            { identifiant: agentB.numero, montant: 500000 },
          ],
        },
      });
    });

    test('avant le 25, une échéance pas encore échue n’apparaît pas', async () => {
      const operateurToken = await loginStaff('operateur');
      const debutDeMois = `${premiereEcheance.slice(0, 8)}01`;
      const { body } = await api(
        `/v1/admin/operations/echeances/du-mois?asOf=${debutDeMois}`
        + `&recherche=${encodeURIComponent(EMPLOYEUR)}`,
        { token: operateurToken }
      );
      assert.equal(body.moisOuvert, false, 'le mois ne doit pas encore être ouvert');
      assert.equal(body.jourOuverture, 25);
      assert.ok(
        body.echeances.every((e) => e.due_date.slice(0, 10) <= debutDeMois),
        'aucune échéance postérieure au jour consulté ne doit remonter'
      );

      const { body: ouvert } = await api(
        `/v1/admin/operations/echeances/du-mois?asOf=${asOf}`
        + `&recherche=${encodeURIComponent(EMPLOYEUR)}`,
        { token: operateurToken }
      );
      assert.equal(ouvert.moisOuvert, true);
      assert.ok(
        ouvert.echeances.length >= body.echeances.length,
        'le 25 doit montrer au moins autant d’échéances que le 1er'
      );
    });

    test('la recherche par entreprise sort les agents de cette entreprise', async () => {
      const { status, body } = await duMois(await loginStaff('operateur'));
      assert.equal(status, 200);
      assert.ok(body.echeances.length >= 2, 'les deux agents doivent remonter');
      assert.ok(
        body.echeances.every((e) => e.employer === EMPLOYEUR),
        'la recherche ne doit ramener que les agents de cette entreprise'
      );
      assert.ok(body.mois, 'le mois couvert doit être renvoyé');
    });

    test('chaque ligne porte le solde du compte et si le prélèvement passera', async () => {
      const { body } = await duMois(await loginStaff('operateur'));
      const provisionne = body.echeances.find((e) => e.client === agentA.nom);
      const demuni = body.echeances.find((e) => e.client === agentC.nom);

      assert.ok(provisionne, 'l’agent provisionné doit être listé');
      assert.equal(provisionne.prelevable, true);
      assert.equal(provisionne.provision_suffisante, true);
      assert.ok(Number(provisionne.solde) > 0);

      assert.ok(demuni, 'l’agent sans provision doit être listé aussi');
      assert.equal(demuni.prelevable, true, 'il reste prélevable au sens du crédit');
      assert.equal(demuni.provision_suffisante, false, 'mais sa provision est insuffisante');
    });

    test('un gestionnaire ne peut pas lancer de prélèvement', async () => {
      const { body } = await duMois(await loginStaff('operateur'));
      const cible = body.echeances.find((e) => e.client === agentA.nom);
      const { status } = await api('/v1/admin/operations/echeances/prelever', {
        method: 'POST', token: await loginStaff('gestionnaire'),
        body: { echeanceIds: [cible.id] },
      });
      assert.equal(status, 403);
    });

    test('l’opérateur prélève une échéance isolément', async () => {
      const operateurToken = await loginStaff('operateur');
      const { body: avant } = await duMois(operateurToken);
      const cible = avant.echeances.find((e) => e.client === agentA.nom && e.status !== 'payee');

      const { status, body } = await api('/v1/admin/operations/echeances/prelever', {
        method: 'POST', token: operateurToken, body: { echeanceIds: [cible.id] },
      });
      assert.equal(status, 200);
      assert.equal(body.preleves.length, 1);
      assert.equal(body.echecs.length, 0);
      assert.equal(Number(body.totalPreleve), Number(cible.amount));

      const { body: apres } = await duMois(operateurToken);
      const relue = apres.echeances.find((e) => e.id === cible.id);
      assert.equal(relue.status, 'payee', 'l’échéance doit être marquée payée');
      assert.ok(relue.paid_at, 'avec sa date de prélèvement');
    });

    test('prélever la même échéance une seconde fois est refusé, sans double débit', async () => {
      const operateurToken = await loginStaff('operateur');
      const { body } = await duMois(operateurToken);
      const dejaPayee = body.echeances.find((e) => e.status === 'payee');

      const { body: r } = await api('/v1/admin/operations/echeances/prelever', {
        method: 'POST', token: operateurToken, body: { echeanceIds: [dejaPayee.id] },
      });
      assert.equal(r.preleves.length, 0);
      assert.equal(r.echecs.length, 1);
      assert.match(r.echecs[0].motif, /déjà réglée/);
    });

    test('sans salaire versé ce mois-ci, une provision insuffisante bloque le prélèvement', async () => {
      const operateurToken = await loginStaff('operateur');
      const { body } = await duMois(operateurToken);
      const cible = body.echeances.find((e) => e.client === agentC.nom && e.status !== 'payee');
      assert.ok(cible, 'l’échéance de l’agent à découvert doit être listée');

      const { body: r } = await api('/v1/admin/operations/echeances/prelever', {
        method: 'POST', token: operateurToken, body: { echeanceIds: [cible.id] },
      });
      assert.equal(r.preleves.length, 0, 'rien ne doit être prélevé');
      assert.equal(r.echecs.length, 1);
      assert.match(r.echecs[0].motif, /salaire/, 'le motif doit pointer le salaire manquant');
      assert.equal(Number(r.totalPreleve), 0);
    });

    test('salaire versé mais insuffisant : le prélèvement passe et met le compte à découvert', async () => {
      const operateurToken = await loginStaff('operateur');

      // On verse à l'agent D un salaire volontairement trop faible pour
      // couvrir son échéance : c'est exactement le cas que la direction
      // veut voir basculer en découvert. L'agent C reste sans salaire,
      // pour les tests suivants.
      const { status: paie } = await api('/v1/admin/operations/salaires', {
        method: 'POST', token: operateurToken,
        body: {
          employeur: EMPLOYEUR,
          periode: new Date().toISOString().slice(0, 7),
          lignes: [{ identifiant: agentD.numero, montant: 1000 }],
        },
      });
      assert.equal(paie, 201);

      const { body } = await duMois(operateurToken);
      const cible = body.echeances.find((e) => e.client === agentD.nom && e.status !== 'payee');
      assert.ok(cible, 'l’échéance doit toujours être listée');
      assert.equal(cible.provision_suffisante, false, 'la provision reste insuffisante');

      const { body: r } = await api('/v1/admin/operations/echeances/prelever', {
        method: 'POST', token: operateurToken, body: { echeanceIds: [cible.id] },
      });
      assert.equal(r.echecs.length, 0, 'plus aucun refus une fois le salaire versé');
      assert.equal(r.preleves.length, 1);
      assert.equal(r.preleves[0].decouvert, true, 'le prélèvement doit être signalé comme à découvert');
      assert.ok(r.preleves[0].soldeApres < 0, 'le compte doit finir au négatif');
      assert.equal(r.enDecouvert.length, 1);
    });

    test('un lot mêlant une échéance prélevable et une autre qui ne l’est pas traite chacune pour ce qu’elle est', async () => {
      const operateurToken = await loginStaff('operateur');
      const { body } = await duMois(operateurToken);
      const prelevable = body.echeances.find(
        (e) => e.client === agentB.nom && e.status !== 'payee' && e.provision_suffisante
      );
      const bloquee = body.echeances.find((e) => e.client === agentC.nom && e.status !== 'payee');
      assert.ok(prelevable, 'l’agent B doit encore avoir une échéance prélevable');
      assert.ok(bloquee, 'l’agent C doit encore avoir une échéance non provisionnée');

      const { body: r } = await api('/v1/admin/operations/echeances/prelever', {
        method: 'POST', token: operateurToken,
        body: { echeanceIds: [prelevable.id, bloquee.id] },
      });
      assert.equal(r.preleves.length, 1, 'la ligne prélevable passe');
      assert.equal(r.echecs.length, 1, 'l’autre échoue sans annuler la première');
    });

    test('une échéance inexistante est signalée, pas une erreur serveur', async () => {
      const { status, body } = await api('/v1/admin/operations/echeances/prelever', {
        method: 'POST', token: await loginStaff('operateur'),
        body: { echeanceIds: ['00000000-0000-0000-0000-000000000000'] },
      });
      assert.equal(status, 200);
      assert.equal(body.preleves.length, 0);
      assert.equal(body.echecs.length, 1);
      assert.match(body.echecs[0].motif, /introuvable/);
    });

    test('une liste vide ou un identifiant mal formé est rejeté', async () => {
      const operateurToken = await loginStaff('operateur');
      const { status: vide } = await api('/v1/admin/operations/echeances/prelever', {
        method: 'POST', token: operateurToken, body: { echeanceIds: [] },
      });
      assert.equal(vide, 422);

      const { status: malforme } = await api('/v1/admin/operations/echeances/prelever', {
        method: 'POST', token: operateurToken, body: { echeanceIds: ['pas-un-uuid'] },
      });
      assert.equal(malforme, 422);
    });

    test('un crédit suspendu n’est plus prélevable', async () => {
      const operateurToken = await loginStaff('operateur');
      const { body: avant } = await duMois(operateurToken);
      const cible = avant.echeances.find((e) => e.client === agentC.nom && e.status !== 'payee');

      await api(`/v1/admin/operations/credits/${cible.credit_id}/suspendre`, {
        method: 'POST', token: await loginStaff('gestionnaire'),
        body: { motif: 'Vérification en cours — test' },
      });

      const { body: r } = await api('/v1/admin/operations/echeances/prelever', {
        method: 'POST', token: operateurToken, body: { echeanceIds: [cible.id] },
      });
      assert.equal(r.preleves.length, 0);
      assert.match(r.echecs[0].motif, /suspendu/);

      // Et il disparaît de la liste des prélevables.
      const { body: apres } = await duMois(operateurToken);
      const relue = apres.echeances.find((e) => e.id === cible.id);
      if (relue) assert.equal(relue.prelevable, false, 'une échéance de crédit suspendu n’est pas prélevable');
    });
  }
);
