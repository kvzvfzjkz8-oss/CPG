/**
 * ═══════════════════════════════════════════════════════════════════
 *  LE DÉCOUVERT AUTORISÉ
 * ═══════════════════════════════════════════════════════════════════
 *
 * « Ce produit, lorsqu'un client le prend ou le sollicite, suit le même
 *   cours que les autres crédits. Sa différence est dans sa
 *   récupération, car il est mis directement en négation du compte :
 *   son compte n'est pas crédité mais plutôt débité — c'est un débit
 *   autorisé en fait. »
 *
 * « Le client repart avec les billets : c'est le retrait au guichet qui
 *   met le compte en négatif, pas l'approbation. Le compte peut être en
 *   négatif, mais le quota autorisé peut faire en sorte que le client
 *   puisse toutefois prendre encore malgré son solde négatif. »
 *
 * Ce fichier fixe les cinq points où le découvert s'écarte d'un crédit,
 * et c'est tout ce qui le distingue :
 *
 *   • l'approbation ne verse rien : elle ouvre un droit à débit ;
 *   • le guichet peut alors servir le client sous zéro, jusqu'à la
 *     limite, en une ou plusieurs fois — et refuse au-delà ;
 *   • aucun échéancier n'est généré — la collecte ne prélève que sur un
 *     compte provisionné, un découvert aurait accumulé des retards
 *     perpétuels sans qu'un franc ne bouge ;
 *   • l'intérêt mensuel porte sur l'encours restant, et ne se prélève
 *     pas deux fois le même mois ;
 *   • le découvert est soldé dès que le compte repasse à flot — mais
 *     pas avant d'avoir été tiré.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer, stopTestServer, api, loginStaff, hasTestDatabase, fundCaissePrincipale,
} from '../helpers/testServer.js';
import {
  runInteretsDecouvert, soldeLesDecouvertsAFlot, fetchDecouvertsEnCours, encoursDecouvert,
  plafondNegatifAutorise, autorisationsDecouvert, neutraliserDecouvertAutorise,
} from '../../src/services/decouvertService.js';

let gestionnaireToken;
let directeurToken;
let operateurToken;
let caissierToken;
let produitDecouvertId;
let versionId;
let tauxMensuel;
/** Le découvert de référence du fichier, posé par le premier test. */
let dossier;

const MONTANT = 200000;
const DUREE = 2;

/** Le circuit complet d'un dossier, jusqu'à l'approbation du directeur. */
async function dossierApprouve(produitId, montant, duree, label) {
  const tel = `+24109${String(Math.floor(Math.random() * 900000) + 100000)}`;
  const { body: client } = await api('/v1/admin/utilisateurs', {
    method: 'POST', token: gestionnaireToken,
    body: {
      nomComplet: `Client Decouvert ${label}`, telephone: tel, role: 'client',
      codePin: '1234', confirmerDoublon: true,
    },
  });

  const { body: credit } = await api('/v1/admin/credits', {
    method: 'POST', token: gestionnaireToken,
    body: { clientId: client.id, produitId, montant, duree, motif: `Decouvert ${label}` },
  });
  assert.ok(credit.id, `le dossier doit être créé (${JSON.stringify(credit)})`);
  await api(`/v1/admin/credits/${credit.id}/valider-niveau1`, { method: 'POST', token: operateurToken });

  // La séance est partagée entre fichiers : on la vide et on la
  // remplace par la nôtre.
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
  const { status } = await api(`/v1/admin/credits/${credit.id}/approuver`, {
    method: 'POST', token: directeurToken,
  });
  assert.equal(status, 200, 'le dossier doit être approuvé');

  // L'identifiant du compte sert aux appels directs au service (limite
  // autorisée, autorisations par jour) ; le nom sert à la recherche de
  // la caissière.
  const { rows: comptes } = await (await import('../../src/db/index.js')).query(
    'SELECT id FROM accounts WHERE user_id = $1 ORDER BY created_at LIMIT 1',
    [client.id]
  );

  return {
    creditId: credit.id,
    clientId: client.id,
    accountId: comptes[0].id,
    nomClient: client.full_name ?? `Client Decouvert ${label}`,
    reference: credit.reference,
  };
}

const soldeClient = async (clientId) => {
  const { body } = await api(`/v1/caisse/clients/${clientId}/transactions`, { token: directeurToken });
  return Number(body.client.balance ?? body.client.solde ?? 0);
};

before(async () => {
  await startTestServer();
  if (!hasTestDatabase()) return;
  gestionnaireToken = await loginStaff('gestionnaire');
  directeurToken = await loginStaff('directeur');
  operateurToken = await loginStaff('operateur');

  const email = `caissiere.decouvert.${Date.now()}@cpg.ga`;
  const tel = `+24105${String(Math.floor(Math.random() * 900000) + 100000)}`;
  await api('/v1/admin/utilisateurs', {
    method: 'POST', token: gestionnaireToken,
    body: {
      nomComplet: `Caissière Decouvert ${Date.now()}`, telephone: tel, email,
      role: 'caissier', motDePasse: 'MotDePasseDemo2026!', confirmerDoublon: true,
    },
  });
  caissierToken = await loginStaff(email);
  await fundCaissePrincipale(20000000);

  // Sans especes dans son tiroir, la validation d'un retrait echoue et
  // le compte du client n'est jamais debite. Un test qui l'oublie
  // croit avoir tire sur le decouvert alors que rien n'a bouge.
  const { body: appro } = await api('/v1/caisse/appro', {
    method: 'POST', token: caissierToken,
    body: { montant: 2000000, motif: 'Test découvert' },
  });
  const { status: approValide } = await api(`/v1/caisse/operations/${appro.id}/valider`, {
    method: 'POST', token: directeurToken,
  });
  assert.equal(approValide, 200, 'la caisse doit être approvisionnée');

  // Le produit est livré en brouillon (migration 054) : fixer un taux
  // et activer appartiennent au directeur. Le test l'active donc
  // explicitement, comme il devra le faire en production.
  //
  // S'il est absent, on le crée : `npm run seed` fait un TRUNCATE sur
  // credit_products, et le produit né d'une migration disparaît donc
  // d'un environnement reseedé. Ce chemin couvre au passage la
  // création d'un produit de nature « decouvert » par le catalogue.
  const { body: catalogue } = await api('/v1/admin/catalogue/produits', { token: directeurToken });
  let decouvert = (catalogue.produits ?? catalogue).find((p) => p.code === 'DECOUVERT');

  if (!decouvert) {
    const { status, body: cree } = await api('/v1/admin/catalogue/produits', {
      method: 'POST', token: directeurToken,
      body: {
        code: 'DECOUVERT', nom: 'Découvert autorisé', nature: 'decouvert',
        bareme: {
          // Sous le plafond réglementaire `credit_monthly`, que le jeu
          // de données de test fixe à 3 % (la production est à 10 %).
          monthlyRate: 0.025, minAmount: 10000, maxAmount: 500000,
          minDuration: 1, maxDuration: 3,
        },
      },
    });
    assert.equal(status, 201, `le produit doit pouvoir être créé (${JSON.stringify(cree)})`);
    assert.equal(cree.product.nature, 'decouvert', 'la nature demandée doit être retenue');
    decouvert = cree.product;
  }

  assert.ok(decouvert, 'le produit DECOUVERT doit exister au catalogue');
  assert.equal(decouvert.nature, 'decouvert', 'et porter sa nature');
  produitDecouvertId = decouvert.id;

  const { status } = await api(`/v1/admin/catalogue/produits/${produitDecouvertId}/statut`, {
    method: 'PATCH', token: directeurToken, body: { statut: 'actif' },
  });
  assert.equal(status, 200, 'le directeur doit pouvoir activer le produit');

  const { body: actifs } = await api('/v1/admin/catalogue/produits/actifs', { token: gestionnaireToken });
  const actif = actifs.produits.find((p) => p.code === 'DECOUVERT');
  assert.ok(actif, 'le produit activé doit apparaître aux gestionnaires');
  assert.equal(actif.nature, 'decouvert', 'la nature doit remonter jusqu’à l’écran de saisie');
  versionId = actif.version_id;
  tauxMensuel = Number(actif.monthly_rate);
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
  // On remet le produit en brouillon : les autres fichiers de tests ne
  // doivent pas voir apparaître un produit de plus dans le catalogue
  // actif à cause de nous.
  if (produitDecouvertId) {
    await api(`/v1/admin/catalogue/produits/${produitDecouvertId}/statut`, {
      method: 'PATCH', token: directeurToken, body: { statut: 'brouillon' },
    });
  }
  await stopTestServer();
});

describe(
  'Découvert autorisé',
  { skip: !hasTestDatabase() && 'DATABASE_URL ne pointe pas vers une base de test' },
  () => {
    test('l’approbation ne verse rien : elle ouvre un droit à débit', async () => {
      const r = await dossierApprouve(produitDecouvertId, MONTANT, DUREE, `Droit ${Date.now()}`);
      dossier = r;

      const solde = await soldeClient(r.clientId);
      // Seule la commission d'octroi est passée. Le montant accordé,
      // lui, n'a pas bougé : débiter ici aurait mis le client en
      // négatif SANS qu'un billet ne quitte CPG, et le guichet lui
      // aurait ensuite refusé le retrait faute de solde.
      assert.ok(
        solde > -MONTANT,
        `le compte ne doit pas être débité du montant accordé, il est à ${solde}`
      );
      assert.ok(solde <= 0, 'seule la commission d’octroi peut l’avoir entamé');

      const { body: hist } = await api(`/v1/caisse/clients/${r.clientId}/transactions`, { token: directeurToken });
      assert.ok(
        !hist.transactions.some((t) => t.type === 'deblocage_credit'),
        'aucun déblocage de fonds : un découvert ne crédite pas le compte'
      );

      const { body: detail } = await api(`/v1/admin/credits/${r.creditId}`, { token: directeurToken });
      assert.equal(detail.credit.status, 'approuve');
      assert.equal(
        detail.installments.length, 0,
        'aucun échéancier : la collecte ne prélève que sur un compte provisionné, '
        + 'chaque échéance serait tombée en retard sans qu’un franc ne bouge'
      );
    });

    test('le guichet peut servir le client sous zéro, jusqu’à la limite', async () => {
      const { body: trouve } = await api(
        `/v1/caisse/rechercher-client?q=${encodeURIComponent(dossier.nomClient)}`,
        { token: caissierToken }
      );
      const vu = trouve.resultats.find((x) => x.id === dossier.clientId);
      assert.ok(vu, 'la caissière doit retrouver le client');
      assert.equal(
        Number(vu.decouvert_autorise) >= MONTANT, true,
        'son écran doit annoncer l’autorisation, sinon elle croit à une erreur du logiciel'
      );
      assert.equal(
        Number(vu.disponible), Number(vu.balance) + Number(vu.decouvert_autorise),
        'et le disponible doit être le solde plus la limite'
      );

      // Premier tirage, sur un compte à zéro (ou légèrement négatif).
      const avant = await soldeClient(dossier.clientId);
      const { status: premier, body: op1 } = await api('/v1/caisse/retraits', {
        method: 'POST', token: caissierToken,
        body: { clientId: dossier.clientId, montant: 120000, modePaiement: 'especes' },
      });
      assert.equal(premier, 201, `le retrait doit être accepté (${JSON.stringify(op1)})`);
      const { status: v1, body: r1 } = await api(`/v1/caisse/operations/${op1.id}/valider`, {
        method: 'POST', token: directeurToken,
      });
      // La validation est le moment ou l'argent sort vraiment. Sans
      // cette assertion, un echec silencieux laissait le compte intact
      // et le test passait grace a la seule commission d'octroi.
      assert.equal(v1, 200, `le retrait doit être validé (${JSON.stringify(r1)})`);

      const apres = await soldeClient(dossier.clientId);
      assert.equal(
        apres, avant - 120000,
        'c’est le retrait, et lui seul, qui met le compte en négatif'
      );
      assert.ok(apres < -100000, 'le compte est bien passé largement sous zéro');

      // Second tirage, cette fois sur un compte DÉJÀ négatif : « le
      // quota autorisé peut faire en sorte que le client puisse
      // toutefois prendre encore malgré son solde négatif ».
      const { status: second, body: op2 } = await api('/v1/caisse/retraits', {
        method: 'POST', token: caissierToken,
        body: { clientId: dossier.clientId, montant: 60000, modePaiement: 'especes' },
      });
      assert.equal(second, 201, `un compte négatif ne bloque pas dans la limite (${JSON.stringify(op2)})`);
      const { status: v2 } = await api(`/v1/caisse/operations/${op2.id}/valider`, {
        method: 'POST', token: directeurToken,
      });
      assert.equal(v2, 200);
      assert.equal(await soldeClient(dossier.clientId), apres - 60000);

      const suivi = (await fetchDecouvertsEnCours()).find((d) => d.reference === dossier.reference);
      assert.equal(suivi.tire, true, 'le découvert est désormais tiré');
      assert.equal(suivi.encours, 180000 + (0 - avant), 'et son encours est ce qui a été tiré, frais compris');
    });

    test('au-delà de la limite, le guichet refuse et le dit', async () => {
      const { body: compte } = await api(`/v1/caisse/clients/${dossier.clientId}/transactions`, { token: directeurToken });
      const solde = Number(compte.client.balance ?? compte.client.solde ?? 0);
      const plafond = await plafondNegatifAutorise(dossier.accountId);
      const disponible = solde + plafond;

      const { status, body } = await api('/v1/caisse/retraits', {
        method: 'POST', token: caissierToken,
        body: { clientId: dossier.clientId, montant: disponible + 10000, modePaiement: 'especes' },
      });
      assert.equal(status, 422);
      assert.match(body.error, /découvert autorisé/i, 'le message doit expliquer la limite, pas seulement refuser');
    });

    test('un crédit ordinaire continue de créditer le compte', async () => {
      // Garde-fou : la branche ajoutée pour le découvert ne doit pas
      // avoir touché au sens des crédits ordinaires.
      const { body: actifs } = await api('/v1/admin/catalogue/produits/actifs', { token: gestionnaireToken });
      const std = actifs.produits.find((p) => p.code === 'MICRO_STD');
      const r = await dossierApprouve(std.product_id, 100000, 4, `Temoin ${Date.now()}`);
      assert.ok(await soldeClient(r.clientId) > 0, 'un crédit crédite le compte');
      const { body: detail } = await api(`/v1/admin/credits/${r.creditId}`, { token: directeurToken });
      assert.equal(detail.installments.length, 4, 'et garde son échéancier');
    });

    test('une autorisation jamais tirée n’est pas déclarée soldée', async () => {
      // Depuis que l'approbation n'écrit plus rien, le compte reste à
      // zéro : le passage quotidien aurait fermé le dossier dès le
      // lendemain matin, avant que le client ait pu venir au guichet.
      const r = await dossierApprouve(produitDecouvertId, 50000, 1, `Vierge ${Date.now()}`);
      await soldeLesDecouvertsAFlot();
      const { body: detail } = await api(`/v1/admin/credits/${r.creditId}`, { token: directeurToken });
      assert.equal(detail.credit.status, 'approuve', 'le droit reste ouvert tant qu’il n’a pas servi');

      const encours = await fetchDecouvertsEnCours();
      const vierge = encours.find((d) => d.reference === r.reference);
      assert.ok(vierge, 'il reste au suivi');
      assert.equal(vierge.tire, false, 'et il est marqué comme pas encore tiré');
      // L'encours n'est pas nul pour autant : la commission d'octroi a
      // mis le compte en négatif de quelques centaines de francs, et ce
      // négatif est bien un découvert. Ce qui compte ici est qu'il soit
      // sans rapport avec l'autorisation, qui n'a pas servi.
      assert.ok(
        vierge.encours < 50000 / 10,
        `l’autorisation n’a pas été entamée, seuls les frais d’octroi pèsent (${vierge.encours})`
      );
    });

    test('l’encours est le négatif du compte, plafonné à l’autorisation', () => {
      // Fonction pure : le plafond n'est pas cosmétique. Un dépassement
      // est un découvert SUBI, qui relève des agios et non du produit.
      assert.equal(encoursDecouvert({ solde: -80000, montantAutorise: 100000 }), 80000);
      assert.equal(encoursDecouvert({ solde: -120000, montantAutorise: 100000 }), 100000);
      assert.equal(encoursDecouvert({ solde: 50000, montantAutorise: 100000 }), 0);
      assert.equal(encoursDecouvert({ solde: 0, montantAutorise: 100000 }), 0);
    });

    test('le découvert apparaît au suivi, avec son encours et son intérêt', async () => {
      const { body } = await api('/v1/admin/operations/decouverts', { token: directeurToken });
      assert.ok(body.decouverts.length >= 1);
      const d = body.decouverts.find((x) => x.reference === dossier.reference);
      assert.ok(d, 'notre découvert doit être suivi — il n’apparaît dans aucun écran d’échéances');
      assert.ok(d.encours > 0);
      assert.equal(d.tauxMensuel, tauxMensuel);
      assert.equal(d.dureeMois, DUREE);
    });

    test('l’intérêt mensuel porte sur l’encours, et ne passe qu’une fois', async () => {
      const avant = await fetchDecouvertsEnCours();
      const cible = avant.find((d) => d.reference === dossier.reference);
      const attendu = Math.round(cible.encours * cible.tauxMensuel);
      assert.ok(attendu > 0, 'le taux du produit doit produire un intérêt');

      const { body: staff } = await api('/v1/admin/operations/decouverts/interets', {
        method: 'POST', token: operateurToken,
      });
      const ligne = body_ligne(staff, cible.reference);
      assert.equal(ligne.action, 'interet');
      assert.equal(ligne.interet, attendu, 'l’intérêt doit être calculé sur l’encours, pas sur l’autorisation');

      // Relance : un intérêt prélevé deux fois est de l'argent pris au
      // client. La tâche peut être relancée après un échec, donc ce
      // garde-fou est indispensable.
      const { body: bis } = await api('/v1/admin/operations/decouverts/interets', {
        method: 'POST', token: operateurToken,
      });
      assert.equal(body_ligne(bis, cible.reference).action, 'deja_fait');
      assert.equal(body_ligne(bis, cible.reference).interet, 0);
    });

    test('l’intérêt du découvert ne déclenche pas d’agios sur lui-même', async () => {
      // Le piège : sur une autorisation entièrement tirée, l'intérêt
      // creuse le négatif au-delà de l'autorisation. Lu naïvement, cet
      // écart passerait pour un dépassement du client et porterait les
      // agios — l'intérêt se serait taxé lui-même, tous les mois.
      const { autorisationsDecouvert, neutraliserDecouvertAutorise } =
        await import('../../src/services/decouvertService.js');
      const decouverts = await fetchDecouvertsEnCours();
      const cible = decouverts.find((d) => d.reference === dossier.reference);

      const autorisations = await autorisationsDecouvert(cible.accountId);
      assert.ok(autorisations.length >= 1, 'le découvert doit déclarer ce qu’il a mis sur le compte');

      const aujourdhui = new Date().toISOString().slice(0, 10);
      const neutralises = neutraliserDecouvertAutorise(
        [{ date: aujourdhui, balance: cible.solde }],
        autorisations
      );
      assert.ok(
        neutralises[0].balance >= 0,
        `tout le négatif écrit par le découvert doit être neutralisé, il reste ${neutralises[0].balance}`
      );
    });

    test('le découvert ne s’affiche pas comme « reste à payer 0 F »', async () => {
      // Le défaut : les écrans calculent le reste dû comme la somme des
      // échéances impayées. Un découvert n'en a aucune, donc le comité
      // lisait « 1 crédit en cours · reste à payer 0 F » pour un client
      // qui devait encore la totalité de son découvert — exactement le
      // signal que le directeur regarde avant d'accorder un second
      // dossier.
      const decouverts = await fetchDecouvertsEnCours();
      const cible = decouverts.find((d) => d.reference === dossier.reference);

      assert.ok(cible.encours > 0, 'le découvert doit avoir été tiré à ce stade');

      const { body } = await api('/v1/admin/credits?statut=approuve&limit=200', { token: directeurToken });
      const ligne = (body.credits ?? body).find((c) => c.reference === cible.reference);
      assert.ok(ligne, 'le découvert doit figurer parmi les dossiers approuvés');
      assert.equal(
        Number(ligne.credits_en_cours_reste), cible.encours,
        'le reste dû doit être l’encours réel du découvert, pas la somme '
        + 'de ses échéances impayées — il n’en a aucune'
      );
    });

    test('le découvert est soldé dès que le compte repasse à flot', async () => {
      const decouverts = await fetchDecouvertsEnCours();
      const cible = decouverts.find((d) => d.reference === dossier.reference);
      assert.ok(cible.solde < 0, 'le compte doit encore être négatif à ce stade');

      // Le compte se renfloue comme en vrai : un versement au guichet.
      // C'est exactement ce que fait le salaire chaque mois, et c'est
      // toute la « récupération » du découvert — rien à prélever.
      const { status } = await api('/v1/caisse/encaissements', {
        method: 'POST', token: caissierToken,
        body: { clientId: cible.clientId, montant: Math.abs(cible.solde) + 1000 },
      });
      assert.equal(status, 201, 'le versement doit être enregistré');

      const { nombre } = await soldeLesDecouvertsAFlot();
      assert.ok(nombre >= 1, 'le découvert remboursé doit être éteint');

      const { body: detail } = await api(`/v1/admin/credits/${cible.id}`, { token: directeurToken });
      assert.equal(
        detail.credit.status, 'solde',
        'un découvert resté « approuvé » ferait apparaître le client comme encore engagé, '
        + 'et le bloquerait au dépôt d’un dossier en commission'
      );

      const { body: suivi } = await api('/v1/admin/operations/decouverts', { token: directeurToken });
      assert.ok(
        !suivi.decouverts.some((d) => d.reference === cible.reference),
        'et il quitte le suivi des découverts en cours'
      );
    });

  }
);

/** La ligne de résultat d'un découvert dans un passage d'intérêts. */
function body_ligne(resultat, reference) {
  const ligne = resultat.resultats.find((r) => r.reference === reference);
  assert.ok(ligne, `le découvert ${reference} doit figurer au résultat`);
  return ligne;
}
