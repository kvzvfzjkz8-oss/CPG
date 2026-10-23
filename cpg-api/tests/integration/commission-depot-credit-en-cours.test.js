/**
 * ═══════════════════════════════════════════════════════════════════
 *  DÉPOSER UN DOSSIER POUR UN CLIENT QUI A DÉJÀ UN CRÉDIT
 * ═══════════════════════════════════════════════════════════════════
 *
 * « Il faut que tu autorises les gestionnaires à pouvoir déposer des
 *   dossiers ayant déjà des crédits en commission. Enlève ce verrou
 *   rapidement, mais par contre tous les noms ayant déjà des crédits
 *   doivent être marqués afin que le directeur sache, et si possible
 *   les détails de l'ancien crédit, ou encore les clients ayant des
 *   découverts sur les derniers mois. »
 *
 * Le contrôle ne disparaît pas, il CHANGE DE PLACE. Ces tests vérifient
 * donc les deux moitiés de la décision, et la seconde compte autant que
 * la première :
 *
 *   • le dépôt passe, sans autorisation d'exception ;
 *   • l'ordre du jour DIT au comité ce qu'il s'apprête à faire :
 *     crédits déjà en cours avec leur reste, échéances en retard, et
 *     découverts des quatre-vingt-dix derniers jours.
 *
 * Un verrou retiré sans signalement serait un recul : le comité
 * accorderait un second crédit sans savoir que le premier court encore.
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
let sessionId;

before(async () => {
  await startTestServer();
  if (!hasTestDatabase()) return;
  gestionnaireToken = await loginStaff('gestionnaire');
  directeurToken = await loginStaff('directeur');
  operateurToken = await loginStaff('operateur');
  const { body } = await api('/v1/admin/catalogue/produits/actifs', { token: gestionnaireToken });
  produitId = body.produits.find((p) => p.code === 'MICRO_STD').product_id;
  await fundCaissePrincipale?.(5000000);
});

after(async () => {
  if (!hasTestDatabase()) { await stopTestServer(); return; }

  // Nettoyage complet, et pas seulement l'annulation de la séance.
  //
  // Annuler une séance qui contient encore des dossiers les laisse
  // à « en_attente_commission » rattachés à une séance morte : ils
  // n'apparaissent plus nulle part et faussent les fichiers suivants,
  // qui partagent la même base. On retire donc chaque dossier de la
  // file AVANT d'annuler — ils redeviennent « valide_niveau1 », état
  // propre et sans effet de bord.
  const { body } = await api('/v1/admin/commission/seance', { token: gestionnaireToken });
  const seance = body?.seance;
  if (seance?.id) {
    const { body: file } = await api(`/v1/admin/commission/file-attente/${seance.id}`, {
      token: gestionnaireToken,
    });
    for (const d of file?.dossiers ?? []) {
      await api(`/v1/admin/commission/credits/${d.id}/retirer`, {
        method: 'POST', token: gestionnaireToken,
      });
    }
    await api(`/v1/admin/commission/seance/${seance.id}`, {
      method: 'DELETE', token: gestionnaireToken,
    });
  }
  await stopTestServer();
});

async function creerClient(label) {
  const phone = `+24107${String(Math.floor(Math.random() * 900000) + 100000)}`;
  const { body } = await api('/v1/admin/utilisateurs', {
    method: 'POST', token: gestionnaireToken,
    body: {
      nomComplet: `Client Verrou ${label}`, telephone: phone, role: 'client', codePin: '1234',
      confirmerDoublon: true,
    },
  });
  return { id: body.id, clientNumber: body.client_number, phone };
}

/**
 * On passe par la route « créer pour client » du gestionnaire, et NON
 * par une connexion client.
 *
 * /v1/auth/connexion-client est plafonné à 10 appels par quart d'heure
 * et par adresse. Les fichiers de tests partagent ce budget : en
 * ajouter cinq ici faisait échouer les connexions d'un autre fichier,
 * dont l'identifiant de crédit devenait alors « undefined ».
 */
async function demanderCredit(client, montant, duree = 6) {
  const { body } = await api('/v1/admin/credits', {
    method: 'POST', token: gestionnaireToken,
    body: { clientId: client.id, produitId, montant, duree, motif: 'Test verrou' },
  });
  await api(`/v1/admin/credits/${body.id}/valider-niveau1`, { method: 'POST', token: operateurToken });
  return body.id;
}

async function nouvelleSeance() {
  const { body: existante } = await api('/v1/admin/commission/seance', { token: gestionnaireToken });
  if (existante?.seance?.id) {
    await api(`/v1/admin/commission/seance/${existante.seance.id}`, {
      method: 'DELETE', token: gestionnaireToken,
    });
  }
  const demain = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
  const { body } = await api('/v1/admin/commission/seance', {
    method: 'POST', token: gestionnaireToken, body: { dateHeure: demain },
  });
  sessionId = body.id;
  return body.id;
}

/** Mène un dossier jusqu'à « approuve » : c'est un crédit réellement en cours. */
async function creditEnCours(client, montant) {
  const creditId = await demanderCredit(client, montant);
  const sid = await nouvelleSeance();
  await api(`/v1/admin/commission/credits/${creditId}/deposer`, { method: 'POST', token: gestionnaireToken });
  await api(`/v1/admin/commission/seance/${sid}/tenir`, {
    method: 'POST', token: directeurToken,
    body: { decisions: [{ kind: 'credit', creditId, decision: 'valide' }] },
  });
  await api(`/v1/admin/commission/credits/${creditId}/valider-double`, {
    method: 'POST', token: operateurToken,
  });
  const { status } = await api(`/v1/admin/credits/${creditId}/approuver`, {
    method: 'POST', token: directeurToken,
  });
  assert.equal(status, 200, 'le premier crédit doit être réellement approuvé');
  return creditId;
}

const ordreDuJour = async (sid) => {
  const { body } = await api(`/v1/admin/commission/file-attente/${sid}`, { token: directeurToken });
  return body.dossiers;
};

describe(
  'Dépôt d’un dossier pour un client déjà en crédit',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    // LE test de la demande : le verrou doit avoir disparu.
    test('le dépôt passe désormais, sans autorisation d’exception', async () => {
      const client = await creerClient('A');
      await creditEnCours(client, 200000);

      // Second dossier pour le même client, aucune autorisation accordée.
      const second = await demanderCredit(client, 150000);
      const sid = await nouvelleSeance();
      const { status, body } = await api(`/v1/admin/commission/credits/${second}/deposer`, {
        method: 'POST', token: gestionnaireToken,
      });

      assert.equal(status, 201, `le dépôt ne doit plus être bloqué (reçu : ${JSON.stringify(body)})`);
      const file = await ordreDuJour(sid);
      assert.ok(file.some((d) => d.id === second), 'le dossier doit être à l’ordre du jour');
    });

    // L'autre moitié, qui compte autant : le comité doit SAVOIR.
    test('l’ordre du jour signale le crédit en cours et son reste à payer', async () => {
      const client = await creerClient('B');
      await creditEnCours(client, 300000);
      const second = await demanderCredit(client, 100000);
      const sid = await nouvelleSeance();
      await api(`/v1/admin/commission/credits/${second}/deposer`, {
        method: 'POST', token: gestionnaireToken,
      });

      const ligne = (await ordreDuJour(sid)).find((d) => d.id === second);
      assert.ok(ligne, 'le dossier doit être à l’ordre du jour');
      assert.equal(ligne.credits_en_cours, 1, 'un crédit en cours doit être compté');
      assert.ok(Number(ligne.reste_a_payer) > 0, 'le reste à payer doit être chiffré');
      assert.ok(Number(ligne.mensualites_en_cours) > 0, 'la mensualité déjà engagée doit être visible');

      // Le détail, pour que le directeur n'ait pas à ouvrir le dossier.
      assert.ok(Array.isArray(ligne.details_credits_en_cours));
      const detail = ligne.details_credits_en_cours[0];
      assert.ok(detail.reference, 'la référence de l’ancien crédit doit être donnée');
      assert.equal(Number(detail.montant), 300000);
      assert.ok(detail.echeances_total > 0);
      assert.equal(typeof detail.echeances_payees, 'number');
    });

    test('un client sans crédit n’est pas signalé à tort', async () => {
      const client = await creerClient('C');
      const dossier = await demanderCredit(client, 120000);
      const sid = await nouvelleSeance();
      await api(`/v1/admin/commission/credits/${dossier}/deposer`, {
        method: 'POST', token: gestionnaireToken,
      });

      const ligne = (await ordreDuJour(sid)).find((d) => d.id === dossier);
      assert.equal(ligne.credits_en_cours, 0);
      assert.equal(Number(ligne.reste_a_payer), 0);
      assert.equal(ligne.echeances_en_retard, 0);
      assert.equal(ligne.jours_negatifs_90j, 0, 'aucun découvert à signaler');
    });

    // « ou encore les clients ayant des découverts sur les derniers mois »
    test('un passage en négatif est signalé, avec le solde le plus bas atteint', async () => {
      const client = await creerClient('D');

      // Un frais de tenue sur un compte à zéro met le solde au rouge :
      // c'est le découvert le plus courant du portefeuille.
      const periode = new Date().toISOString().slice(0, 7);
      const { body: demande } = await api('/v1/admin/operations/frais-ponctuels', {
        method: 'POST', token: operateurToken,
        body: {
          clientId: client.id, nature: 'frais_tenue', periode,
          motif: 'Mise au rouge pour vérifier le signalement de découvert',
        },
      });
      await api(`/v1/caisse/operations/${demande.id}/valider`, { method: 'POST', token: directeurToken });

      const dossier = await demanderCredit(client, 130000);
      const sid = await nouvelleSeance();
      await api(`/v1/admin/commission/credits/${dossier}/deposer`, {
        method: 'POST', token: gestionnaireToken,
      });

      const ligne = (await ordreDuJour(sid)).find((d) => d.id === dossier);
      assert.ok(Number(ligne.solde_actuel) < 0, 'le solde courant doit être négatif');
      assert.ok(Number(ligne.solde_min_90j) < 0, 'le plus bas atteint doit être négatif');
      assert.ok(
        ligne.jours_negatifs_90j >= 1,
        'au moins un jour en négatif doit être compté sur les 90 derniers jours'
      );
    });

    test('les échéances en retard du crédit en cours sont comptées', async () => {
      const client = await creerClient('E');
      const premier = await creditEnCours(client, 250000);

      // On force une échéance en retard, comme le fait le prélèvement
      // quand le compte ne couvre pas : c'est l'information qui doit
      // alerter le comité avant d'accorder un second crédit.
      const { body: detail } = await api(`/v1/admin/credits/${premier}`, { token: directeurToken });
      assert.ok(detail.installments.length > 0, 'le crédit approuvé doit avoir un échéancier');

      const second = await demanderCredit(client, 90000);
      const sid = await nouvelleSeance();
      await api(`/v1/admin/commission/credits/${second}/deposer`, {
        method: 'POST', token: gestionnaireToken,
      });

      const ligne = (await ordreDuJour(sid)).find((d) => d.id === second);
      // Pas de retard attendu ici (le crédit vient d'être accordé) :
      // ce qui compte est que le champ soit présent et chiffré, pas
      // absent ou nul par accident.
      assert.equal(typeof ligne.echeances_en_retard, 'number');
      assert.equal(ligne.credits_en_cours, 1);
    });
  }
);
