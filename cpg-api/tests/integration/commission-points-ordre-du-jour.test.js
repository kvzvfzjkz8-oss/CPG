/**
 * ═══════════════════════════════════════════════════════════════════
 *  DEMANDE EXCEPTIONNELLE — CIRCUIT COMPLET
 * ═══════════════════════════════════════════════════════════════════
 *
 * Un client qui a déjà un crédit en cours ne peut pas être redéposé en
 * commission. La demande exceptionnelle est le moyen de lever ce
 * verrou : dès que le directeur l'a validée en séance, elle VAUT
 * autorisation et le dossier redevient déposable comme un dossier
 * normal — sans passer par la double validation de l'opérateur, qui
 * n'ajouterait aucun contrôle à une décision déjà prise par le
 * directeur lui-même.
 *
 * Ces tests couvrent la régression qui avait bloqué 5 dossiers :
 * valider la demande en séance ne produisait aucune autorisation, le
 * dépôt restait refusé par un 403, et la demande elle-même sortait de
 * tous les écrans sans laisser de trace exploitable.
 *
 * Fichier séparé de commission.test.js à dessein : l'application
 * limite chaque fenêtre de 60 secondes à 120 requêtes (src/app.js), et
 * les deux séries réunies dépassaient ce plafond. « node --test »
 * exécute un processus par fichier, donc chaque fichier repart avec
 * son propre compteur.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer, stopTestServer, api, loginStaff, hasTestDatabase, fundCaissePrincipale,
} from '../helpers/testServer.js';

before(async () => {
  await startTestServer();
});

/**
 * Les fichiers d'intégration partagent une seule base et s'exécutent
 * dans l'ordre alphabétique : celui-ci passe avant commission.test.js,
 * dont le premier test exige qu'aucune séance ne soit « planifiee » au
 * départ. On rend donc la base dans l'état où on l'a trouvée — retirer
 * le dossier de la file, puis annuler la séance restante.
 */
async function libererLeCreneau() {
  try {
    const gestionnaireToken = await loginStaff('gestionnaire');
    const { body } = await api('/v1/admin/commission/seance', { token: gestionnaireToken });
    if (!body?.seance || body.seance.status !== 'planifiee') return;

    const { body: file } = await api(`/v1/admin/commission/file-attente/${body.seance.id}`, {
      token: gestionnaireToken,
    });
    for (const dossier of file?.dossiers ?? []) {
      await api(`/v1/admin/commission/credits/${dossier.id}/retirer`, {
        method: 'POST', token: gestionnaireToken,
      });
    }
    await api(`/v1/admin/commission/seance/${body.seance.id}`, {
      method: 'DELETE', token: gestionnaireToken,
    });
  } catch {
    // Le nettoyage ne doit jamais faire échouer la série elle-même.
  }
}

after(async () => {
  await libererLeCreneau();
  await stopTestServer();
});

/** Fait approuver un crédit de bout en bout, pour donner au client un crédit actif. */
async function fullyApproveCredit(clientToken, produitId, montant, duree) {
  const operateurToken = await loginStaff('operateur');
  const gestionnaireToken = await loginStaff('gestionnaire');
  const directeurToken = await loginStaff('directeur');

  const { body: created } = await api('/v1/client/credits', {
    method: 'POST', token: clientToken,
    body: { produitId, montant, duree, motif: 'Premier crédit' },
  });
  await api(`/v1/admin/credits/${created.id}/valider-niveau1`, { method: 'POST', token: operateurToken });

  const { status: seanceStatus, body: seance } = await api('/v1/admin/commission/seance', {
    method: 'POST', token: gestionnaireToken, body: { dateHeure: '2026-11-03T09:00' },
  });
  if (seanceStatus !== 201) {
    throw new Error(`Impossible de programmer la séance (${seanceStatus}) — un créneau est resté occupé.`);
  }
  await api(`/v1/admin/commission/credits/${created.id}/deposer`, { method: 'POST', token: gestionnaireToken });
  await api(`/v1/admin/commission/seance/${seance.id}/tenir`, {
    method: 'POST', token: directeurToken,
    body: { decisions: [{ kind: 'credit', creditId: created.id, decision: 'valide' }] },
  });
  await api(`/v1/admin/commission/credits/${created.id}/valider-double`, { method: 'POST', token: operateurToken });

  await fundCaissePrincipale();
  await api(`/v1/admin/credits/${created.id}/approuver`, { method: 'POST', token: directeurToken });
  return created.id;
}

describe(
  'une demande exceptionnelle validée par le directeur débloque le dépôt du dossier',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    const NOM_CLIENT = 'Client Exception Circuit';
    let produitId;
    let clientId;
    let secondCreditId;
    let itemId;

    before(async () => {
      const gestionnaireToken = await loginStaff('gestionnaire');
      const { body: cat } = await api('/v1/admin/catalogue/produits/actifs', { token: gestionnaireToken });
      produitId = cat.produits.find((p) => p.code === 'MICRO_STD').product_id;

      // La situation exacte des dossiers bloqués : un client avec un
      // crédit actif, et un second dossier arrêté à « valide_niveau1 ».
      const phone = `+24106${String(Math.floor(Math.random() * 900000) + 100000)}`;
      const { body: cree } = await api('/v1/admin/utilisateurs', {
        method: 'POST', token: gestionnaireToken,
        body: { nomComplet: NOM_CLIENT, telephone: phone, role: 'client', codePin: '1234' },
      });
      clientId = cree.id;

      const { body: session } = await api('/v1/auth/connexion-client', {
        method: 'POST', body: { phone, pin: '1234' },
      });
      await fullyApproveCredit(session.accessToken, produitId, 150000, 6);

      const { body: second } = await api('/v1/client/credits', {
        method: 'POST', token: session.accessToken,
        body: { produitId, montant: 90000, duree: 4, motif: 'Rentrée scolaire' },
      });
      secondCreditId = second.id;
      await api(`/v1/admin/credits/${second.id}/valider-niveau1`, {
        method: 'POST', token: await loginStaff('operateur'),
      });
    });

    test('sans autorisation, le dépôt du second dossier est refusé', async () => {
      const gestionnaireToken = await loginStaff('gestionnaire');
      await api('/v1/admin/commission/seance', {
        method: 'POST', token: gestionnaireToken, body: { dateHeure: '2026-11-10T09:00' },
      });

      const { status } = await api(`/v1/admin/commission/credits/${secondCreditId}/deposer`, {
        method: 'POST', token: gestionnaireToken,
      });
      assert.equal(status, 403);
    });

    test('le dossier reste listé, signalé comme bloqué faute d’autorisation', async () => {
      const { body } = await api('/v1/admin/credits?statut=valide_niveau1', {
        token: await loginStaff('gestionnaire'),
      });
      const ligne = body.credits.find((c) => c.id === secondCreditId);
      assert.ok(ligne, 'le dossier doit rester visible dans la liste de dépôt');
      assert.equal(ligne.credit_en_cours, true);
      assert.equal(ligne.autorisation_exception_disponible, false);
    });

    test('la validation en séance crée l’autorisation d’exception', async () => {
      const gestionnaireToken = await loginStaff('gestionnaire');
      const { body: seance } = await api('/v1/admin/commission/seance', { token: gestionnaireToken });

      const { body: demande } = await api('/v1/admin/commission/demandes-exceptionnelles', {
        method: 'POST', token: gestionnaireToken,
        body: { clientId, titre: 'Demande de crédit rentrée scolaire', note: 'ce client a déjà un crédit en cours' },
      });
      itemId = demande.id;

      const { status } = await api(`/v1/admin/commission/seance/${seance.seance.id}/tenir`, {
        method: 'POST', token: await loginStaff('directeur'),
        body: { decisions: [{ kind: 'item', itemId: demande.id, decision: 'valide' }] },
      });
      assert.equal(status, 200);

      const { body: autorisations } = await api('/v1/admin/commission/autorisations', { token: gestionnaireToken });
      assert.ok(
        autorisations.autorisations.some((a) => a.client === NOM_CLIENT),
        'valider la demande en séance doit créer une autorisation non consommée'
      );
    });

    test('aucun point ne passe plus par la double validation de l’opérateur', async () => {
      const operateurToken = await loginStaff('operateur');

      // Les deux endpoints ont été retirés : plus de file à revalider,
      // plus de revalidation possible. La décision du directeur en
      // séance est définitive, pour un dossier en difficulté comme pour
      // une demande exceptionnelle.
      // La route a disparu : « a-double-valider » n'est plus interprété
      // comme un identifiant de séance valide (422), et la revalidation
      // n'existe plus (404). Seul compte ici qu'aucune des deux ne
      // réponde encore.
      const { status: fileStatus } = await api('/v1/admin/commission/items/a-double-valider', {
        token: operateurToken,
      });
      assert.ok(fileStatus >= 400, `la file ne doit plus répondre, reçu ${fileStatus}`);

      const { status: revalidationStatus } = await api(
        `/v1/admin/commission/items/${itemId}/valider-double`,
        { method: 'POST', token: operateurToken }
      );
      assert.ok(revalidationStatus >= 400, `la revalidation ne doit plus répondre, reçu ${revalidationStatus}`);
    });

    test('le dossier est alors signalé comme déposable', async () => {
      const { body } = await api('/v1/admin/credits?statut=valide_niveau1', {
        token: await loginStaff('gestionnaire'),
      });
      const ligne = body.credits.find((c) => c.id === secondCreditId);
      assert.equal(ligne.credit_en_cours, true);
      assert.equal(ligne.autorisation_exception_disponible, true);
    });

    test('le dépôt réussit et consomme l’autorisation', async () => {
      const gestionnaireToken = await loginStaff('gestionnaire');
      await api('/v1/admin/commission/seance', {
        method: 'POST', token: gestionnaireToken, body: { dateHeure: '2026-11-17T09:00' },
      });

      const { status, body } = await api(`/v1/admin/commission/credits/${secondCreditId}/deposer`, {
        method: 'POST', token: gestionnaireToken,
      });
      assert.equal(status, 201);
      assert.equal(body.status, 'en_attente_commission');

      // Une autorisation ne sert qu'une fois.
      const { body: restantes } = await api('/v1/admin/commission/autorisations', { token: gestionnaireToken });
      assert.ok(!restantes.autorisations.some((a) => a.client === NOM_CLIENT));
    });
  }
);

describe(
  'un dossier en difficulté suit le même circuit : la séance tranche, rien n’attend l’opérateur',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    let produitId;
    let creditActifId;
    let itemId;
    let sessionId;

    before(async () => {
      // Le bloc précédent laisse une séance programmée : la libérer
      // avant de reprendre la main, une seule séance pouvant être
      // « planifiee » à la fois (contrainte en base).
      await libererLeCreneau();

      const gestionnaireToken = await loginStaff('gestionnaire');
      const { body: cat } = await api('/v1/admin/catalogue/produits/actifs', { token: gestionnaireToken });
      produitId = cat.produits.find((p) => p.code === 'MICRO_STD').product_id;

      const phone = `+24106${String(Math.floor(Math.random() * 900000) + 100000)}`;
      await api('/v1/admin/utilisateurs', {
        method: 'POST', token: gestionnaireToken,
        body: { nomComplet: 'Client Difficulte Circuit', telephone: phone, role: 'client', codePin: '1234' },
      });
      const { body: session } = await api('/v1/auth/connexion-client', {
        method: 'POST', body: { phone, pin: '1234' },
      });
      creditActifId = await fullyApproveCredit(session.accessToken, produitId, 200000, 6);
    });

    test('le gestionnaire dépose le dossier en difficulté', async () => {
      const gestionnaireToken = await loginStaff('gestionnaire');
      const { status: seanceStatus, body: seance } = await api('/v1/admin/commission/seance', {
        method: 'POST', token: gestionnaireToken, body: { dateHeure: '2026-11-24T09:00' },
      });
      assert.equal(seanceStatus, 201);
      sessionId = seance.id;

      const { status, body } = await api(`/v1/admin/commission/credits/${creditActifId}/deposer-difficulte`, {
        method: 'POST', token: gestionnaireToken, body: { note: 'Deux échéances en retard' },
      });
      assert.equal(status, 201);
      itemId = body.id;
    });

    test('le directeur tranche en séance : la décision est définitive', async () => {
      const { status, body } = await api(`/v1/admin/commission/seance/${sessionId}/tenir`, {
        method: 'POST', token: await loginStaff('directeur'),
        body: { decisions: [{ kind: 'item', itemId, decision: 'valide', note: 'Rééchelonnement accordé' }] },
      });
      assert.equal(status, 200);
      assert.equal(body.resultats[0].status, 'valide');
    });

    test('il ne reste rien à revalider pour l’opérateur', async () => {
      const operateurToken = await loginStaff('operateur');

      // La route a disparu : « a-double-valider » n'est plus interprété
      // comme un identifiant de séance valide (422), et la revalidation
      // n'existe plus (404). Seul compte ici qu'aucune des deux ne
      // réponde encore.
      const { status: fileStatus } = await api('/v1/admin/commission/items/a-double-valider', {
        token: operateurToken,
      });
      assert.ok(fileStatus >= 400, `la file ne doit plus répondre, reçu ${fileStatus}`);

      const { status: revalidationStatus } = await api(
        `/v1/admin/commission/items/${itemId}/valider-double`,
        { method: 'POST', token: operateurToken }
      );
      assert.ok(revalidationStatus >= 400, `la revalidation ne doit plus répondre, reçu ${revalidationStatus}`);
    });

    test('le point a quitté l’ordre du jour de la séance', async () => {
      const { body } = await api(`/v1/admin/commission/items/${sessionId}`, {
        token: await loginStaff('gestionnaire'),
      });
      assert.ok(!body.points.some((p) => p.id === itemId));
    });
  }
);
