/**
 * ─────────────────────────────────────────────────────────────────────
 *  API BACK-OFFICE — À BRANCHER
 * ─────────────────────────────────────────────────────────────────────
 *
 * Toutes les actions du back-office passent par ce fichier. Les vues
 * n'appellent que ces fonctions, donc brancher le backend réel ne
 * demandera aucune modification d'interface.
 *
 * ⚠️ Le serveur doit revérifier le rôle à chaque appel. Les permissions
 * définies dans src/auth/roles.js ne protègent que l'affichage.
 */

import {
  clientAccounts, ledgerTransactions, installmentSchedules, seedPendingAdjustment,
  creditRequests, commissionSessionSeed, commissionCreditNotes, commissionItemsSeed,
  exceptionAuthorizationsSeed, STATUTS,
} from '../data/mockData.js';

export const API_BASE_URL = import.meta.env?.VITE_API_URL ?? 'https://api.cpg.ga';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Validation de premier niveau par un opérateur de crédit. */
export async function validateLevel1(requestId) {
  // TODO: POST ${API_BASE_URL}/credits/${requestId}/valider-niveau1
  await wait(500);
  const credit = creditRequests.find((c) => c.id === requestId);
  if (credit) credit.statut = STATUTS.VALIDE_NIVEAU1;
  return { id: requestId, statut: 'valide_niveau1' };
}

/**
 * Approbation finale — réservée au directeur depuis l'introduction du
 * comité de crédit. N'agit que sur un dossier déjà passé par la
 * commission puis la double validation de l'opérateur.
 */
export async function approveCredit(requestId) {
  // TODO: POST ${API_BASE_URL}/credits/${requestId}/approuver
  await wait(500);
  const credit = creditRequests.find((c) => c.id === requestId);
  if (credit) {
    if (credit.statut !== STATUTS.VALIDE_DOUBLE) {
      throw new Error('Ce dossier doit d’abord passer en commission puis être revalidé par un opérateur.');
    }
    credit.statut = STATUTS.APPROUVE;
  }
  await notifyClient(requestId, 'credit_approuve');
  return { id: requestId, statut: 'approuve' };
}

/** Rejet d'une demande, avec motif transmis au client. */
export async function rejectCredit(requestId, motif = '') {
  // TODO: POST ${API_BASE_URL}/credits/${requestId}/rejeter  body: { motif }
  await wait(500);
  const credit = creditRequests.find((c) => c.id === requestId);
  if (credit) credit.statut = STATUTS.REJETE;
  return { id: requestId, statut: 'rejete', motif };
}

/**
 * ─────────────────────────────────────────────────────────────────────
 *  DÉCLENCHEMENT DES NOTIFICATIONS PUSH
 * ─────────────────────────────────────────────────────────────────────
 *
 * C'est le BACKEND qui envoie les push, pas ce back-office : le serveur
 * détient les push tokens enregistrés par l'app mobile
 * (voir cpg-mobile/src/notifications/pushNotifications.js).
 *
 *   Back-office ──► Backend CPG ──► API Expo Push ──► APNs / FCM ──► client
 *
 * Exemple de requête que le backend adressera à Expo :
 *
 *   POST https://exp.host/--/api/v2/push/send
 *   {
 *     "to": "ExponentPushToken[xxxxxxxx]",
 *     "title": "Crédit approuvé",
 *     "body": "Votre crédit de 300 000 FCFA a été approuvé.",
 *     "data": { "type": "credit", "screen": "Crédits" }
 *   }
 *
 * Événements qui doivent déclencher une push :
 *   - crédit approuvé ou rejeté
 *   - transaction Mobile Money confirmée ou échouée
 *   - réponse d'un conseiller dans la messagerie
 *   - échéance à venir (rappel programmé localement côté app)
 */
export async function notifyClient(requestId, eventType, payload = {}) {
  // TODO: POST ${API_BASE_URL}/notifications
  //   body: { requestId, eventType, ...payload }
  await wait(200);
  console.log('[push] Événement à notifier :', { requestId, eventType, ...payload });
  return { queued: true };
}

/** Liste des utilisateurs (employés et clients). */
export async function fetchUsers() {
  // TODO: GET ${API_BASE_URL}/utilisateurs
  await wait(300);
  return null;
}

/** Suspension ou réactivation d'un compte. */
export async function setUserStatus(userId, statut) {
  // TODO: PATCH ${API_BASE_URL}/utilisateurs/${userId}  body: { statut }
  await wait(300);
  return { id: userId, statut };
}

/** Journal des transactions Mobile Money, pour supervision. */
export async function fetchMomoTransactions() {
  // TODO: GET ${API_BASE_URL}/momo/transactions
  await wait(300);
  return null;
}

/** Réponse d'un conseiller dans la messagerie client. */
export async function sendAdvisorReply(conversationId, text) {
  // TODO: POST ${API_BASE_URL}/conversations/${conversationId}/messages
  await wait(300);
  await notifyClient(conversationId, 'message_conseiller', { preview: text.slice(0, 60) });
  return { ok: true };
}

/**
 * ─────────────────────────────────────────────────────────────────────
 *  CATALOGUE — produits de crédit, services annexes, plafonds
 * ─────────────────────────────────────────────────────────────────────
 *
 * Chemins vérifiés contre l'API réelle (cpg-api/src/routes/catalog.routes.js,
 * montée sous /admin/catalogue). Le gestionnaire crée et ajuste dans sa
 * marge déléguée ; le directeur active, tranche les propositions hors
 * marge et gère seul les plafonds. Le serveur revérifie chaque permission
 * indépendamment de ce que montre l'écran — voir src/auth/roles.js.
 */

/** Catalogue complet des produits de crédit, brouillons inclus. */
export async function fetchProducts() {
  // TODO: GET ${API_BASE_URL}/admin/catalogue/produits
  await wait(300);
  return null;
}

/** Historique des barèmes d'un produit (versionnement, jamais écrasé). */
export async function fetchProductHistory(productId) {
  // TODO: GET ${API_BASE_URL}/admin/catalogue/produits/${productId}/historique
  await wait(300);
  return null;
}

/** Création d'un produit — toujours en brouillon, à activer ensuite. */
export async function createProduct({ code, nom, description, bareme }) {
  // TODO: POST ${API_BASE_URL}/admin/catalogue/produits
  //   body: { code, nom, description, bareme }
  await wait(500);
  return { product: { code, name: nom, status: 'brouillon' } };
}

/**
 * Ajustement du barème d'un produit. Le serveur décide seul si le
 * changement s'applique immédiatement (dans la marge déléguée, ou
 * émanant du directeur) ou s'il devient une proposition en attente —
 * la réponse contient `statut: 'applique' | 'a_valider'`.
 */
export async function adjustProductRate(productId, { bareme, motif }) {
  // TODO: PUT ${API_BASE_URL}/admin/catalogue/produits/${productId}/bareme
  //   body: { bareme, motif }
  await wait(500);
  return { statut: 'applique', motif: 'dans_la_marge_deleguee' };
}

/** Activation, suspension ou archivage d'un produit — réservé au directeur. */
export async function setProductStatus(productId, statut) {
  // TODO: PATCH ${API_BASE_URL}/admin/catalogue/produits/${productId}/statut
  //   body: { statut }
  await wait(400);
  return { id: productId, status: statut };
}

/** Services annexes et agios : mêmes règles que les produits de crédit. */
export async function fetchFees() {
  // TODO: GET ${API_BASE_URL}/admin/catalogue/services
  await wait(300);
  return null;
}

export async function createFee({ code, nom, description, basis, triggerOn, bareme }) {
  // TODO: POST ${API_BASE_URL}/admin/catalogue/services
  //   body: { code, nom, description, basis, triggerOn, bareme }
  await wait(500);
  return { fee: { code, name: nom, status: 'brouillon' } };
}

export async function adjustFeeRate(feeId, { bareme, motif }) {
  // TODO: PUT ${API_BASE_URL}/admin/catalogue/services/${feeId}/bareme
  //   body: { bareme, motif }
  await wait(500);
  return { statut: 'applique', motif: 'dans_la_marge_deleguee' };
}

export async function setFeeStatus(feeId, statut) {
  // TODO: PATCH ${API_BASE_URL}/admin/catalogue/services/${feeId}/statut
  //   body: { statut }
  await wait(400);
  return { id: feeId, status: statut };
}

/** Lancement du prélèvement des agios sur une période donnée. */
export async function runAgiosBatch(debut, fin) {
  // TODO: POST ${API_BASE_URL}/admin/catalogue/agios/executer
  //   body: { debut, fin }  (format AAAA-MM-JJ)
  await wait(600);
  return { applied: 0, total: 0 };
}

/**
 * Demandes de changement de barème hors marge déléguée, en attente
 * de l'arbitrage du directeur.
 */
export async function fetchChangeRequests() {
  // TODO: GET ${API_BASE_URL}/admin/catalogue/changements
  await wait(300);
  return null;
}

/** Décision du directeur : approuver applique le barème proposé, sinon il est écarté. */
export async function decideChangeRequest(requestId, approuver, note = '') {
  // TODO: POST ${API_BASE_URL}/admin/catalogue/changements/${requestId}/decider
  //   body: { approuver, note }
  await wait(500);
  return { statut: approuver ? 'approuve' : 'rejete' };
}

/**
 * Plafonds réglementaires. Garde-fou contre l'erreur de saisie sur un
 * taux : personne, pas même le directeur, ne les dépasse — le serveur
 * l'impose de toute façon, cet écran ne fait qu'en donner la maîtrise
 * à qui en a l'autorité.
 */
export async function fetchCeilings() {
  // TODO: GET ${API_BASE_URL}/admin/catalogue/plafonds
  await wait(300);
  return null;
}

export async function updateCeiling(scope, maxRate, note = '') {
  // TODO: PUT ${API_BASE_URL}/admin/catalogue/plafonds/${scope}
  //   body: { maxRate, note }
  await wait(400);
  return { scope, max_rate: maxRate, note };
}

/**
 * ─────────────────────────────────────────────────────────────────────
 *  OPÉRATIONS MENSUELLES — paie des agents, vérification, corrections
 * ─────────────────────────────────────────────────────────────────────
 *
 * Les agios et les échéances de crédit sont prélevés automatiquement
 * (tâche planifiée côté API : chaque jour pour les échéances, le 30 du
 * mois pour les agios). L'opérateur crédite la paie, vérifie ce que le
 * logiciel a fait tout seul, et corrige au besoin.
 *
 * La simulation ci-dessous reproduit fidèlement les règles réelles de
 * l'API (correspondance téléphone / numéro client / nom, blocage du
 * rejeu) : brancher le backend ne changera que les 4 lignes marquées
 * TODO, jamais la forme des données que les écrans consomment.
 */

function parseSalaryCsvClient(text) {
  const lines = (text ?? '').split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean);
  const entries = [];
  const erreurs = [];

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const fields = line.split(',').map((f) => f.trim());

    if (fields.length < 2) {
      erreurs.push({ ligne: lineNumber, motif: 'colonnes_manquantes', contenu: line });
      return;
    }

    const [identifiant, montantRaw] = fields;
    const montant = Number((montantRaw ?? '').replace(/[\s\u00A0]/g, ''));

    // En-tête probable : deuxième colonne non numérique, en première ligne.
    if (lineNumber === 1 && !Number.isInteger(montant) && /[a-zàâéèêëïîôùûç]/i.test(montantRaw ?? '')) {
      return;
    }
    if (!identifiant) {
      erreurs.push({ ligne: lineNumber, motif: 'identifiant_manquant', contenu: line });
      return;
    }
    if (!Number.isInteger(montant) || montant <= 0) {
      erreurs.push({ ligne: lineNumber, motif: 'montant_invalide', contenu: line });
      return;
    }
    entries.push({ identifiant, montant });
  });

  return { entries, erreurs };
}

function buildSalaryReference(employeur, periode) {
  return `PAIE-${employeur.toUpperCase().replace(/\s+/g, '_')}-${periode}`;
}

// Mémorise les lots déjà crédités durant la session de démonstration,
// pour simuler la protection anti-rejeu du serveur (même compte, même
// référence de lot).
const creditedBatches = new Set();

function resolveSalaryEntries(entries, employeur, periode) {
  const reference = buildSalaryReference(employeur, periode);
  const aCrediter = [];
  const notFound = [];

  for (const { identifiant, montant } of entries) {
    const looksLikePhoneOrNumber = /^\+?\d/.test(identifiant) || /^CPG-/i.test(identifiant);
    let matches = clientAccounts.filter((c) => c.phone === identifiant || c.clientNumber === identifiant);

    if (matches.length === 0 && !looksLikePhoneOrNumber) {
      matches = clientAccounts.filter((c) => c.nom.toLowerCase() === identifiant.toLowerCase());
      if (matches.length > 1) {
        notFound.push({ identifiant, motif: 'nom_ambigu' });
        continue;
      }
    }
    if (matches.length === 0) {
      notFound.push({ identifiant, motif: 'client_introuvable' });
      continue;
    }

    const client = matches[0];
    const dedupKey = `${reference}:${client.phone}`;
    if (creditedBatches.has(dedupKey)) {
      notFound.push({ identifiant, motif: 'deja_credite_ce_mois' });
      continue;
    }

    aCrediter.push({ identifiant, nom: client.nom, montant, dedupKey });
  }

  return { reference, aCrediter, notFound };
}

// Copie mutable pour la session de démonstration : annuler une
// transaction ou en créditer une nouvelle doit se refléter dans les
// écrans suivants sans recharger la page. Déclarée avant
// confirmSalaryImport, qui y ajoute une entrée à chaque crédit.
const sessionTransactions = [...ledgerTransactions];

/**
 * Étape 1/2 : aperçu du fichier de paie — ne crédite rien. Montre qui
 * serait crédité, qui est introuvable, et les lignes mal formées, pour
 * validation avant tout mouvement d'argent.
 */
export async function previewSalaryImport(file, employeur, periode) {
  // TODO: POST ${API_BASE_URL}/admin/operations/salaires/apercu
  //   multipart/form-data : fichier, employeur, periode
  await wait(500);
  const text = await file.text();
  const { entries, erreurs } = parseSalaryCsvClient(text);
  const { reference, aCrediter, notFound } = resolveSalaryEntries(entries, employeur, periode);

  return {
    reference,
    aCrediter: aCrediter.map(({ dedupKey, ...ligne }) => ligne),
    notFound,
    lignesInvalides: erreurs,
    total: aCrediter.reduce((sum, l) => sum + l.montant, 0),
  };
}

/**
 * Étape 2/2 : confirme le crédit des lignes retenues à l'aperçu.
 * Revalide indépendamment (comme le fera l'API réelle) plutôt que de
 * faire confiance à ce que l'aperçu a montré.
 */
export async function confirmSalaryImport(employeur, periode, lignes) {
  // TODO: POST ${API_BASE_URL}/admin/operations/salaires
  //   body: { employeur, periode, lignes }
  await wait(600);
  const { reference, aCrediter, notFound } = resolveSalaryEntries(lignes, employeur, periode);

  const credited = aCrediter.map(({ identifiant, nom, montant, dedupKey }) => {
    creditedBatches.add(dedupKey);
    const client = clientAccounts.find((c) => c.phone === identifiant || c.clientNumber === identifiant || c.nom === identifiant);
    if (client) client.solde += montant;

    // Reflète le crédit dans l'historique consulté par l'écran de
    // vérification : sans cette ligne, une paie tout juste confirmée
    // resterait invisible tant qu'on ne recharge pas la page.
    sessionTransactions.unshift({
      id: `tx-${Date.now()}-${identifiant}`, type: 'salaire', client: nom, montant,
      reference, effectuePar: 'Vous', date: new Date().toISOString(), annulee: false,
    });

    return { identifiant, nom, montant };
  });

  return { reference, credited, notFound, total: credited.reduce((sum, c) => sum + c.montant, 0) };
}

/** Relevé de contrôle : ce qui a été crédité, prélevé, ce qui reste en retard. */
export async function fetchMonthlyReport(debut, fin) {
  // TODO: GET ${API_BASE_URL}/admin/operations/releve?debut=${debut}&fin=${fin}
  await wait(400);
  const dansLaPeriode = (t) => t.date.slice(0, 10) >= debut && t.date.slice(0, 10) <= fin && !t.annulee;

  const salaires = sessionTransactions.filter((t) => t.type === 'salaire' && dansLaPeriode(t));
  const echeances = sessionTransactions.filter((t) => t.type === 'paiement_credit' && dansLaPeriode(t));
  const agios = sessionTransactions.filter((t) => t.type === 'frais' && dansLaPeriode(t));

  return {
    periode: { debut, fin },
    salairesCredites: { nombre: salaires.length, total: salaires.reduce((s, t) => s + t.montant, 0) },
    echeancesPrelevees: { nombre: echeances.length, total: echeances.reduce((s, t) => s + Math.abs(t.montant), 0) },
    echeancesEnRetard: { nombre: 0, total: 0 },
    agiosPreleves: { nombre: agios.length, total: agios.reduce((s, t) => s + Math.abs(t.montant), 0) },
  };
}

/** Détail des transactions sur la période, pour la relecture manuelle. */
export async function fetchTransactions(debut, fin, type) {
  // TODO: GET ${API_BASE_URL}/admin/operations/transactions?debut=${debut}&fin=${fin}&type=${type ?? ''}
  await wait(300);
  return sessionTransactions.filter((t) => {
    const dansLaPeriode = t.date.slice(0, 10) >= debut && t.date.slice(0, 10) <= fin;
    return dansLaPeriode && (!type || t.type === type);
  });
}

function lastDailyRunTime(hour) {
  const now = new Date();
  const run = new Date(now);
  run.setHours(hour, 0, 0, 0);
  if (run > now) run.setDate(run.getDate() - 1);
  return run.toISOString();
}

function lastMonthly30thRunTime(hour) {
  const now = new Date();
  let run = new Date(now.getFullYear(), now.getMonth(), 30, hour, 0, 0, 0);
  if (run > now) run = new Date(now.getFullYear(), now.getMonth() - 1, 30, hour, 0, 0, 0);
  return run.toISOString();
}

/**
 * Statut des tâches planifiées : dernière exécution de chacune. Le
 * logiciel prélève les échéances chaque jour et les agios le 30 du
 * mois sans intervention — cet indicateur permet de vérifier d'un
 * coup d'œil que ça a bien tourné, avant de contrôler le détail.
 */
export async function fetchSchedulerStatus() {
  // TODO: GET ${API_BASE_URL}/admin/operations/planificateur
  await wait(300);
  return {
    echeances: {
      derniereExecution: lastDailyRunTime(6),
      verifiees: 4, payees: 3, retards: 1, total: 122500,
    },
    agios: {
      derniereExecution: lastMonthly30thRunTime(3),
      comptes: 2, total: 480,
    },
  };
}

/**
 * Annule une transaction par écriture inverse — jamais de suppression.
 * Si c'est un paiement d'échéance qui est annulé, l'échéance concernée
 * redevient « à_venir » côté échéancier (voir fetchInstallmentsByReference).
 */
export async function reverseLedgerTransaction(transactionId, motif) {
  // TODO: POST ${API_BASE_URL}/admin/operations/transactions/${transactionId}/annuler
  //   body: { motif }
  await wait(500);
  const tx = sessionTransactions.find((t) => t.id === transactionId);
  if (!tx) throw new Error('Transaction introuvable.');
  if (tx.annulee) throw new Error('Cette transaction a déjà été annulée.');

  tx.annulee = true;

  let installmentRevert = null;
  if (tx.type === 'paiement_credit' && tx.reference) {
    const schedule = installmentSchedules[tx.reference];
    const installment = schedule?.find((i) => i.status === 'payee');
    if (installment) {
      installment.status = 'a_venir';
      installmentRevert = installment.id;
    }
  }

  return { reversalId: `rev-${transactionId}`, originalId: transactionId, originalType: tx.type, montantExtourne: -tx.montant, installmentRevert, motif };
}

/** Retrouve l'échéancier d'un crédit par sa référence (CPG-xxxx). */
export async function fetchInstallmentsByReference(reference) {
  // TODO: GET ${API_BASE_URL}/admin/operations/echeances?reference=${reference}
  await wait(300);
  const installments = installmentSchedules[reference];
  if (!installments) throw new Error('Dossier introuvable pour cette référence.');
  const client = clientAccounts.find((c) =>
    sessionTransactions.some((t) => t.reference === reference && t.client === c.nom)
  );
  return { credit: { reference, client: client?.nom ?? '—' }, installments };
}

// Demandes de correction d'échéance en attente de validation du
// directeur — l'opérateur propose, il n'applique jamais lui-même.
let adjustmentRequestSeq = 0;
const pendingAdjustments = [{ ...seedPendingAdjustment }];

/**
 * Propose une nouvelle date pour une échéance pas encore prélevée.
 * Ne change rien : la correction n'entre en vigueur qu'après décision
 * du directeur (decideInstallmentAdjustment).
 */
export async function proposeInstallmentAdjustment(installmentId, nouvelleDate, motif, demandeur = 'Vous') {
  // TODO: POST ${API_BASE_URL}/admin/operations/echeances/${installmentId}/proposer-correction
  //   body: { nouvelleDate, motif }
  await wait(400);

  let found = null;
  let creditReference = null;
  for (const [reference, schedule] of Object.entries(installmentSchedules)) {
    const installment = schedule.find((i) => i.id === installmentId);
    if (installment) { found = installment; creditReference = reference; break; }
  }
  if (!found) throw new Error('Échéance introuvable.');
  if (found.status !== 'a_venir') {
    throw new Error('Seule une échéance pas encore prélevée peut faire l’objet d’une correction.');
  }
  if (pendingAdjustments.some((r) => r.installmentId === installmentId && r.status === 'en_attente')) {
    throw new Error('Une demande de correction est déjà en attente pour cette échéance.');
  }

  adjustmentRequestSeq += 1;
  const request = {
    id: `adj-${adjustmentRequestSeq}`, installmentId, creditReference,
    sequence: found.sequence, dateActuelle: found.dueDate, nouvelleDate, motif,
    demandeur, status: 'en_attente', requestedAt: new Date().toISOString(),
  };
  pendingAdjustments.push(request);
  found.pendingRequestId = request.id;
  return request;
}

/** Demandes de correction en attente d'arbitrage du directeur. */
export async function fetchPendingInstallmentAdjustments() {
  // TODO: GET ${API_BASE_URL}/admin/operations/corrections-echeances
  await wait(300);
  return pendingAdjustments.filter((r) => r.status === 'en_attente');
}

/**
 * Le directeur tranche : approuver applique la correction, rejeter
 * l'écarte sans toucher à l'échéance.
 */
export async function decideInstallmentAdjustment(requestId, approuver, note = '') {
  // TODO: POST ${API_BASE_URL}/admin/operations/corrections-echeances/${requestId}/decider
  //   body: { approuver, note }
  await wait(500);
  const request = pendingAdjustments.find((r) => r.id === requestId);
  if (!request) throw new Error('Demande introuvable.');
  if (request.status !== 'en_attente') throw new Error('Cette demande a déjà été traitée.');

  request.status = approuver ? 'approuve' : 'rejete';
  request.decisionNote = note;

  let updatedInstallment = null;
  if (approuver) {
    const schedule = installmentSchedules[request.creditReference];
    const installment = schedule?.find((i) => i.id === request.installmentId);
    if (installment) {
      installment.originalDueDate = installment.originalDueDate ?? installment.dueDate;
      installment.dueDate = request.nouvelleDate;
      installment.pendingRequestId = null;
      updatedInstallment = { ...installment };
    }
  } else {
    const schedule = installmentSchedules[request.creditReference];
    const installment = schedule?.find((i) => i.id === request.installmentId);
    if (installment) installment.pendingRequestId = null;
  }

  return { statut: request.status, installment: updatedInstallment };
}

/**
 * ─────────────────────────────────────────────────────────────────────
 *  COMITÉ DE CRÉDIT ("COMMISSION")
 * ─────────────────────────────────────────────────────────────────────
 *
 * « Cette commission statue sur tous les types de crédits. Dossiers en
 *   difficultés ou demande exceptionnelle, etc. » Circuit : le
 * gestionnaire programme une séance hebdomadaire, y dépose des
 * nouveaux dossiers (valide_niveau1), des dossiers en difficulté
 * (crédits actifs en retard) et des demandes exceptionnelles, puis
 * tient la séance en tranchant chaque point. Le nouveau crédit validé
 * passe ensuite par la double validation de l'opérateur puis
 * l'approbation finale du directeur.
 */

let session = commissionSessionSeed ? { ...commissionSessionSeed } : null;
let sessionSeq = 1;
const items = commissionItemsSeed.map((i) => ({ ...i }));
let itemSeq = items.length;
const exceptionAuthorizations = exceptionAuthorizationsSeed.map((a) => ({ ...a }));
void commissionCreditNotes; // conservé pour référence, la note vit sur le crédit lui-même une fois déposé

/** Séance actuellement programmée, s'il y en a une. */
export async function fetchCommissionSession() {
  // TODO: GET ${API_BASE_URL}/admin/commission/seance
  await wait(300);
  return session;
}

/** Programme une nouvelle séance — une seule à la fois. */
export async function scheduleCommissionSession(dateHeure) {
  // TODO: POST ${API_BASE_URL}/admin/commission/seance  body: { dateHeure }
  await wait(400);
  if (session?.status === 'planifiee') {
    throw new Error('Une commission est déjà programmée. Tenez-la ou annulez-la avant d’en programmer une nouvelle.');
  }
  sessionSeq += 1;
  session = { id: `sess-${sessionSeq}`, scheduledFor: dateHeure, status: 'planifiee', scheduledBy: 'Vous' };
  return session;
}

/** Annule la séance programmée. */
export async function cancelCommissionSession(sessionId) {
  // TODO: DELETE ${API_BASE_URL}/admin/commission/seance/${sessionId}
  await wait(300);
  if (!session || session.id !== sessionId || session.status !== 'planifiee') {
    throw new Error('Cette séance ne peut plus être annulée.');
  }
  session.status = 'annulee';
  return session;
}

/** Dossiers validés niveau 1, prêts à être déposés en commission. */
export async function fetchLevel1Credits() {
  // TODO: GET ${API_BASE_URL}/admin/credits?statut=valide_niveau1
  await wait(300);
  return creditRequests.filter((c) => c.statut === STATUTS.VALIDE_NIVEAU1);
}

/** Dépose un nouveau dossier de crédit dans la file de la séance programmée. */
export async function depositCreditToCommission(creditId, note = '') {
  // TODO: POST ${API_BASE_URL}/admin/commission/credits/${creditId}/deposer  body: { note }
  await wait(400);
  if (!session || session.status !== 'planifiee') {
    throw new Error('Aucune commission n’est programmée. Programmez une commission avant de déposer un dossier.');
  }
  const credit = creditRequests.find((c) => c.id === creditId);
  if (!credit || credit.statut !== STATUTS.VALIDE_NIVEAU1) {
    throw new Error('Seul un dossier validé en premier niveau peut être déposé en commission.');
  }
  credit.statut = STATUTS.EN_ATTENTE_COMMISSION;
  credit.commissionSessionId = session.id;
  credit.commissionNote = note;
  return { id: credit.id, statut: credit.statut };
}

/** Retire un dossier de la file avant la séance. */
export async function withdrawCreditFromCommission(creditId) {
  // TODO: POST ${API_BASE_URL}/admin/commission/credits/${creditId}/retirer
  await wait(300);
  const credit = creditRequests.find((c) => c.id === creditId);
  if (!credit || credit.statut !== STATUTS.EN_ATTENTE_COMMISSION) {
    throw new Error('Ce dossier n’est pas en attente de commission.');
  }
  credit.statut = STATUTS.VALIDE_NIVEAU1;
  credit.commissionSessionId = null;
  return { id: credit.id, statut: credit.statut };
}

/** Dépose un crédit ACTIF en difficulté (au moins une échéance en retard) devant le comité. */
export async function depositDifficultyCase(creditId, note = '') {
  // TODO: POST ${API_BASE_URL}/admin/commission/credits/${creditId}/deposer-difficulte  body: { note }
  await wait(400);
  if (!session || session.status !== 'planifiee') {
    throw new Error('Aucune commission n’est programmée. Programmez une commission avant de déposer un dossier.');
  }
  const credit = creditRequests.find((c) => c.id === creditId);
  if (!credit) throw new Error('Dossier introuvable.');
  itemSeq += 1;
  const item = {
    id: `item-${itemSeq}`, sessionId: session.id, type: 'dossier_difficulte',
    creditId: credit.id, creditReference: credit.id, client: credit.client,
    titre: `Dossier en difficulté — ${credit.id} (${credit.client})`,
    note, status: 'en_attente',
  };
  items.push(item);
  return item;
}

/** Dépose une demande exceptionnelle, rattachée à un client. */
export async function depositExceptionalRequest(clientId, titre, note = '') {
  // TODO: POST ${API_BASE_URL}/admin/commission/demandes-exceptionnelles  body: { clientId, titre, note }
  await wait(400);
  if (!session || session.status !== 'planifiee') {
    throw new Error('Aucune commission n’est programmée. Programmez une commission avant de déposer une demande.');
  }
  if (!clientId) throw new Error('Une demande exceptionnelle doit être rattachée à un client.');
  if (!titre || titre.trim().length < 3) throw new Error('Un titre est requis pour une demande exceptionnelle.');
  const client = clientAccounts.find((c) => c.clientNumber === clientId || c.phone === clientId);

  itemSeq += 1;
  const item = {
    id: `item-${itemSeq}`, sessionId: session.id, type: 'demande_exceptionnelle',
    creditId: null, client: client?.nom ?? clientId,
    titre: titre.trim(), note, status: 'en_attente',
  };
  items.push(item);
  return item;
}

/** Retire un point (difficulté ou demande exceptionnelle) avant la séance. */
export async function withdrawCommissionItem(itemId) {
  // TODO: POST ${API_BASE_URL}/admin/commission/items/${itemId}/retirer
  await wait(300);
  const index = items.findIndex((i) => i.id === itemId && i.status === 'en_attente');
  if (index === -1) throw new Error('Ce point n’est pas en attente de commission.');
  items.splice(index, 1);
  return { id: itemId };
}

/** Ordre du jour complet de la séance : nouveaux crédits + dossiers en difficulté + demandes exceptionnelles. */
export async function fetchCommissionAgenda(sessionId) {
  // TODO: GET ${API_BASE_URL}/admin/commission/file-attente/${sessionId}
  //   + GET ${API_BASE_URL}/admin/commission/items/${sessionId}
  await wait(300);
  const credits = creditRequests.filter(
    (c) => c.statut === STATUTS.EN_ATTENTE_COMMISSION && c.commissionSessionId === sessionId
  );
  const pointsEnAttente = items.filter((i) => i.sessionId === sessionId && i.status === 'en_attente');
  return { credits, points: pointsEnAttente };
}

/**
 * Tient la séance : enregistre une décision pour chaque point de
 * l'ordre du jour. Chaque décision est `{ kind: 'credit'|'item', id, decision, note }`.
 */
export async function holdCommissionSession(sessionId, decisions) {
  // TODO: POST ${API_BASE_URL}/admin/commission/seance/${sessionId}/tenir  body: { decisions }
  await wait(600);
  if (!session || session.id !== sessionId || session.status !== 'planifiee') {
    throw new Error('Cette séance a déjà été tenue ou annulée.');
  }

  const agenda = await fetchCommissionAgenda(sessionId);
  const decidedCreditIds = new Set(decisions.filter((d) => d.kind === 'credit').map((d) => d.id));
  const decidedItemIds = new Set(decisions.filter((d) => d.kind === 'item').map((d) => d.id));
  const manquants = [
    ...agenda.credits.filter((c) => !decidedCreditIds.has(c.id)),
    ...agenda.points.filter((p) => !decidedItemIds.has(p.id)),
  ];
  if (manquants.length > 0) {
    throw new Error(`${manquants.length} point(s) de l’ordre du jour n’ont pas de décision.`);
  }

  const resultats = [];
  for (const { kind, id, decision, note } of decisions) {
    if (kind === 'credit') {
      const credit = creditRequests.find((c) => c.id === id);
      if (credit) {
        credit.statut = decision === 'valide' ? STATUTS.VALIDE_COMMISSION : STATUTS.REJETE;
        credit.commissionDecisionNote = note;
      }
      resultats.push({ kind, id, statut: credit?.statut });
    } else {
      const item = items.find((i) => i.id === id);
      if (item) {
        item.status = decision === 'valide' ? 'valide' : 'rejete';
        item.decisionNote = note;
      }
      resultats.push({ kind, id, statut: item?.status });
    }
  }

  session.status = 'tenue';
  return { sessionId, resultats };
}

/** Dossiers validés par le comité, en attente de la double validation de l'opérateur. */
export async function fetchDoubleValidationQueue() {
  // TODO: GET ${API_BASE_URL}/admin/credits?statut=valide_commission
  await wait(300);
  return creditRequests.filter((c) => c.statut === STATUTS.VALIDE_COMMISSION);
}

/** Double validation par l'opérateur, après le comité — ne débloque rien, l'approbation finale du directeur suit. */
export async function doubleValidateCredit(creditId) {
  // TODO: POST ${API_BASE_URL}/admin/commission/credits/${creditId}/valider-double
  await wait(400);
  const credit = creditRequests.find((c) => c.id === creditId);
  if (!credit || credit.statut !== STATUTS.VALIDE_COMMISSION) {
    throw new Error('Ce dossier doit d’abord être validé par le comité de crédit.');
  }
  credit.statut = STATUTS.VALIDE_DOUBLE;
  return { id: credit.id, statut: credit.statut };
}

/** Dossiers prêts pour l'approbation finale du directeur. */
export async function fetchFinalApprovalQueue() {
  // TODO: GET ${API_BASE_URL}/admin/credits?statut=valide_double
  await wait(300);
  return creditRequests.filter((c) => c.statut === STATUTS.VALIDE_DOUBLE);
}

/** Le directeur autorise, au cas par cas, un client déjà en crédit à repasser en commission. */
export async function grantExceptionAuthorization(clientId, motif) {
  // TODO: POST ${API_BASE_URL}/admin/commission/autorisations  body: { clientId, motif }
  await wait(400);
  if (!motif || motif.trim().length < 5) throw new Error('Un motif est requis (5 caractères minimum).');
  const client = clientAccounts.find((c) => c.clientNumber === clientId || c.phone === clientId);
  const authorization = {
    id: `auth-${exceptionAuthorizations.length + 1}`, clientId,
    client: client?.nom ?? clientId, motif: motif.trim(), grantedAt: new Date().toISOString(),
  };
  exceptionAuthorizations.push(authorization);
  return authorization;
}

/** Autorisations d'exception non encore consommées. */
export async function fetchExceptionAuthorizations() {
  // TODO: GET ${API_BASE_URL}/admin/commission/autorisations
  await wait(300);
  return [...exceptionAuthorizations];
}
