/**
 * ─────────────────────────────────────────────────────────────────────
 *  API BACK-OFFICE — entièrement branchée sur le vrai serveur cpg-api
 * ─────────────────────────────────────────────────────────────────────
 *
 * Chaque fonction ci-dessous appelle réellement le backend en ligne
 * (voir API_BASE_URL dans src/api/client.js). Les chemins et formats
 * ont été vérifiés directement contre le code source des routes
 * (cpg-api/src/routes/*.routes.js) au moment de l'écriture.
 */

import { apiRequest } from './client.js';

export { API_BASE_URL } from './client.js';

/**
 * ─────────────────────────────────────────────────────────────────────
 *  CYCLE DE VIE D'UN CRÉDIT
 * ─────────────────────────────────────────────────────────────────────
 */

/** Demandes de crédit, éventuellement filtrées par statut. */
export async function fetchCreditRequests(statut) {
  const params = statut ? `?statut=${encodeURIComponent(statut)}` : '';
  const { credits } = await apiRequest(`/v1/admin/credits${params}`);
  return credits;
}

/** Dossier complet, avec pièces justificatives et échéancier. */
export async function fetchCreditDetail(creditId) {
  return apiRequest(`/v1/admin/credits/${creditId}`);
}

/** Validation de premier niveau par un opérateur de crédit. */
export async function validateLevel1(requestId) {
  return apiRequest(`/v1/admin/credits/${requestId}/valider-niveau1`, { method: 'POST' });
}

/**
 * Approbation finale — réservée au directeur depuis l'introduction du
 * comité de crédit. N'agit que sur un dossier déjà passé par la
 * commission puis la double validation de l'opérateur.
 */
export async function approveCredit(requestId) {
  return apiRequest(`/v1/admin/credits/${requestId}/approuver`, { method: 'POST' });
}

/** Rejet d'une demande, avec motif transmis au client. */
export async function rejectCredit(requestId, motif = '') {
  return apiRequest(`/v1/admin/credits/${requestId}/rejeter`, { method: 'POST', body: { motif } });
}

/**
 * ─────────────────────────────────────────────────────────────────────
 *  UTILISATEURS — Superviseur et Directeur
 * ─────────────────────────────────────────────────────────────────────
 */

/** Liste des utilisateurs (employés et clients). */
export async function fetchUsers() {
  const { utilisateurs } = await apiRequest('/v1/admin/utilisateurs');
  return utilisateurs;
}

/** Création d'un compte employé ou client. */
export async function createUser({ nomComplet, telephone, email, role, motDePasse, codePin, employeur, poste }) {
  return apiRequest('/v1/admin/utilisateurs', {
    method: 'POST',
    body: {
      nomComplet, telephone, role,
      // Les champs optionnels ne doivent jamais partir en chaîne
      // vide : la validation du serveur les refuserait (format email,
      // longueur minimale, 4-6 chiffres...). Un client créé sans PIN
      // pourra l'activer lui-même depuis l'app avec son numéro client.
      ...(email ? { email } : {}),
      ...(motDePasse ? { motDePasse } : {}),
      ...(codePin ? { codePin } : {}),
      ...(employeur ? { employeur } : {}),
      ...(poste ? { poste } : {}),
    },
  });
}

/** Suspension ou réactivation d'un compte. */
export async function setUserStatus(userId, statut) {
  return apiRequest(`/v1/admin/utilisateurs/${userId}/statut`, { method: 'PATCH', body: { statut } });
}

/**
 * Efface le PIN d'un client qui l'a oublié — il pourra en recréer un
 * lui-même depuis l'app, avec son numéro client. Accessible au
 * gestionnaire (pas besoin du directeur, contrairement au PIN
 * back-office).
 */
export async function resetClientPin(userId) {
  return apiRequest(`/v1/admin/utilisateurs/${userId}/reinitialiser-pin-client`, { method: 'POST' });
}

/**
 * Code PIN back-office — réservé au directeur (« Seul le Directeur
 * pourra modifier, supprimer ou mettre à jour un pin »).
 */
export async function setBackofficePin(userId, pin) {
  return apiRequest(`/v1/admin/utilisateurs/${userId}/pin`, { method: 'PUT', body: { pin } });
}

export async function removeBackofficePin(userId) {
  return apiRequest(`/v1/admin/utilisateurs/${userId}/pin`, { method: 'DELETE' });
}

/**
 * ─────────────────────────────────────────────────────────────────────
 *  MOBILE MONEY — supervision
 * ─────────────────────────────────────────────────────────────────────
 */

/** Journal des transactions Mobile Money, pour supervision. */
export async function fetchMomoTransactions() {
  const { transactions } = await apiRequest('/v1/admin/momo');
  return transactions;
}

/**
 * ─────────────────────────────────────────────────────────────────────
 *  MESSAGERIE — Opérateur
 * ─────────────────────────────────────────────────────────────────────
 */

export async function fetchConversations() {
  const { conversations } = await apiRequest('/v1/admin/conversations');
  return conversations;
}

/** Historique complet des messages d'une conversation. */
export async function fetchConversationMessages(conversationId) {
  const { messages } = await apiRequest(`/v1/admin/conversations/${conversationId}/messages`);
  return messages;
}

/** Réponse d'un conseiller dans la messagerie client. */
export async function sendAdvisorReply(conversationId, text) {
  return apiRequest(`/v1/admin/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: { texte: text },
  });
}

/**
 * ─────────────────────────────────────────────────────────────────────
 *  STATISTIQUES — vue d'ensemble
 * ─────────────────────────────────────────────────────────────────────
 */

export async function fetchStatistics() {
  return apiRequest('/v1/admin/statistiques');
}

/**
 * ─────────────────────────────────────────────────────────────────────
 *  CATALOGUE — produits de crédit, services annexes, plafonds
 * ─────────────────────────────────────────────────────────────────────
 *
 * Le gestionnaire crée et ajuste dans sa marge déléguée ; le directeur
 * active, tranche les propositions hors marge et gère seul les
 * plafonds. Le serveur revérifie chaque permission indépendamment de
 * ce que montre l'écran — voir src/auth/roles.js.
 */

/** Catalogue complet des produits de crédit, brouillons inclus. */
export async function fetchProducts() {
  const { produits } = await apiRequest('/v1/admin/catalogue/produits');
  return produits;
}

/** Historique des barèmes d'un produit (versionnement, jamais écrasé). */
export async function fetchProductHistory(productId) {
  const { versions } = await apiRequest(`/v1/admin/catalogue/produits/${productId}/historique`);
  return versions;
}

/** Création d'un produit — toujours en brouillon, à activer ensuite. */
export async function createProduct({ code, nom, description, bareme }) {
  return apiRequest('/v1/admin/catalogue/produits', {
    method: 'POST',
    body: { code, nom, description, bareme },
  });
}

/**
 * Ajustement du barème d'un produit. Le serveur décide seul si le
 * changement s'applique immédiatement (dans la marge déléguée, ou
 * émanant du directeur) ou s'il devient une proposition en attente —
 * la réponse contient `statut: 'applique' | 'a_valider'`.
 */
export async function adjustProductRate(productId, { bareme, motif }) {
  return apiRequest(`/v1/admin/catalogue/produits/${productId}/bareme`, {
    method: 'PUT',
    body: { bareme, motif },
  });
}

/** Activation, suspension ou archivage d'un produit — réservé au directeur. */
export async function setProductStatus(productId, statut) {
  return apiRequest(`/v1/admin/catalogue/produits/${productId}/statut`, { method: 'PATCH', body: { statut } });
}

/** Services annexes et agios : mêmes règles que les produits de crédit. */
export async function fetchFees() {
  const { services } = await apiRequest('/v1/admin/catalogue/services');
  return services;
}

export async function fetchFeeHistory(feeId) {
  const { versions } = await apiRequest(`/v1/admin/catalogue/services/${feeId}/historique`);
  return versions;
}

export async function createFee({ code, nom, description, basis, triggerOn, bareme }) {
  return apiRequest('/v1/admin/catalogue/services', {
    method: 'POST',
    body: { code, nom, description, basis, triggerOn, bareme },
  });
}

export async function adjustFeeRate(feeId, { bareme, motif }) {
  return apiRequest(`/v1/admin/catalogue/services/${feeId}/bareme`, { method: 'PUT', body: { bareme, motif } });
}

export async function setFeeStatus(feeId, statut) {
  return apiRequest(`/v1/admin/catalogue/services/${feeId}/statut`, { method: 'PATCH', body: { statut } });
}

/** Lancement du prélèvement des agios sur une période donnée. */
export async function runAgiosBatch(debut, fin) {
  return apiRequest('/v1/admin/catalogue/agios/executer', { method: 'POST', body: { debut, fin } });
}

/** Frais et agios déjà prélevés, pour contrôle. */
export async function fetchAppliedFees() {
  const { operations } = await apiRequest('/v1/admin/catalogue/frais-preleves');
  return operations;
}

/**
 * Demandes de changement de barème hors marge déléguée, en attente
 * de l'arbitrage du directeur.
 */
export async function fetchChangeRequests() {
  const { demandes } = await apiRequest('/v1/admin/catalogue/changements');
  return demandes;
}

/** Décision du directeur : approuver applique le barème proposé, sinon il est écarté. */
export async function decideChangeRequest(requestId, approuver, note = '') {
  return apiRequest(`/v1/admin/catalogue/changements/${requestId}/decider`, {
    method: 'POST',
    body: { approuver, note },
  });
}

/**
 * Plafonds réglementaires. Garde-fou contre l'erreur de saisie sur un
 * taux : personne, pas même le directeur, ne les dépasse — le serveur
 * l'impose de toute façon, cet écran ne fait qu'en donner la maîtrise
 * à qui en a l'autorité.
 */
export async function fetchCeilings() {
  const { plafonds } = await apiRequest('/v1/admin/catalogue/plafonds');
  return plafonds;
}

export async function updateCeiling(scope, maxRate, note = '') {
  return apiRequest(`/v1/admin/catalogue/plafonds/${scope}`, {
    method: 'PUT',
    body: { maxRate, note },
  });
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
 */

/**
 * Étape 1/2 : aperçu du fichier de paie — ne crédite rien. Montre qui
 * serait crédité, qui est introuvable, et les lignes mal formées, pour
 * validation avant tout mouvement d'argent.
 */
export async function previewSalaryImport(file, employeur, periode) {
  const formData = new FormData();
  formData.append('fichier', file);
  formData.append('employeur', employeur);
  formData.append('periode', periode);
  return apiRequest('/v1/admin/operations/salaires/apercu', { method: 'POST', body: formData, isFormData: true });
}

/**
 * Étape 2/2 : confirme le crédit des lignes retenues à l'aperçu.
 * Le serveur revalide indépendamment de ce que l'aperçu a montré,
 * plutôt que de faire confiance à cet écran.
 */
export async function confirmSalaryImport(employeur, periode, lignes) {
  return apiRequest('/v1/admin/operations/salaires', { method: 'POST', body: { employeur, periode, lignes } });
}

/** Relevé de contrôle : ce qui a été crédité, prélevé, ce qui reste en retard. */
export async function fetchMonthlyReport(debut, fin) {
  return apiRequest(`/v1/admin/operations/releve?debut=${debut}&fin=${fin}`);
}

/** Détail des transactions sur la période, pour la relecture manuelle. */
export async function fetchTransactions(debut, fin, type) {
  const params = new URLSearchParams({ debut, fin });
  if (type) params.set('type', type);
  const { transactions } = await apiRequest(`/v1/admin/operations/transactions?${params.toString()}`);
  return transactions;
}

/** Statut des tâches planifiées : dernière exécution de chacune. */
export async function fetchSchedulerStatus() {
  return apiRequest('/v1/admin/operations/planificateur');
}

/**
 * Annule une transaction par écriture inverse — jamais de suppression.
 */
export async function reverseLedgerTransaction(transactionId, motif) {
  return apiRequest(`/v1/admin/operations/transactions/${transactionId}/annuler`, {
    method: 'POST',
    body: { motif },
  });
}

/** Retrouve l'échéancier d'un crédit par sa référence (CPG-xxxx). */
export async function fetchInstallmentsByReference(reference) {
  return apiRequest(`/v1/admin/operations/echeances?reference=${encodeURIComponent(reference)}`);
}

/**
 * Propose une nouvelle date pour une échéance — n'applique rien tant
 * que le directeur n'a pas validé (voir decideInstallmentAdjustment).
 */
export async function proposeInstallmentAdjustment(installmentId, nouvelleDate, motif) {
  return apiRequest(`/v1/admin/operations/echeances/${installmentId}/proposer-correction`, {
    method: 'POST',
    body: { nouvelleDate, motif },
  });
}

/** Demandes de correction en attente d'arbitrage du directeur. */
export async function fetchPendingInstallmentAdjustments() {
  const { demandes } = await apiRequest('/v1/admin/operations/corrections-echeances');
  return demandes;
}

/** Le directeur tranche : approuver applique la correction, rejeter l'écarte. */
export async function decideInstallmentAdjustment(requestId, approuver, note = '') {
  return apiRequest(`/v1/admin/operations/corrections-echeances/${requestId}/decider`, {
    method: 'POST',
    body: { approuver, note },
  });
}

/**
 * ─────────────────────────────────────────────────────────────────────
 *  COMITÉ DE CRÉDIT ("COMMISSION")
 * ─────────────────────────────────────────────────────────────────────
 */

/** Séance actuellement programmée, s'il y en a une. */
export async function fetchCommissionSession() {
  const { seance } = await apiRequest('/v1/admin/commission/seance');
  return seance;
}

/** Programme une nouvelle séance — une seule à la fois. */
export async function scheduleCommissionSession(dateHeure) {
  return apiRequest('/v1/admin/commission/seance', { method: 'POST', body: { dateHeure } });
}

/** Annule la séance programmée. */
export async function cancelCommissionSession(sessionId) {
  return apiRequest(`/v1/admin/commission/seance/${sessionId}`, { method: 'DELETE' });
}

/** Dossiers validés niveau 1, prêts à être déposés en commission. */
export async function fetchLevel1Credits() {
  const { credits } = await apiRequest('/v1/admin/credits?statut=valide_niveau1');
  return credits;
}

/** Dépose un nouveau dossier de crédit dans la file de la séance programmée. */
export async function depositCreditToCommission(creditId, note = '') {
  return apiRequest(`/v1/admin/commission/credits/${creditId}/deposer`, { method: 'POST', body: { note } });
}

/** Retire un dossier de la file avant la séance. */
export async function withdrawCreditFromCommission(creditId) {
  return apiRequest(`/v1/admin/commission/credits/${creditId}/retirer`, { method: 'POST' });
}

/** Dépose un crédit ACTIF en difficulté (au moins une échéance en retard) devant le comité. */
export async function depositDifficultyCase(creditId, note = '') {
  return apiRequest(`/v1/admin/commission/credits/${creditId}/deposer-difficulte`, {
    method: 'POST',
    body: { note },
  });
}

/** Dépose une demande exceptionnelle, rattachée à un client. */
export async function depositExceptionalRequest(clientId, titre, note = '') {
  return apiRequest('/v1/admin/commission/demandes-exceptionnelles', {
    method: 'POST',
    body: { clientId, titre, note },
  });
}

/** Retire un point (difficulté ou demande exceptionnelle) avant la séance. */
export async function withdrawCommissionItem(itemId) {
  return apiRequest(`/v1/admin/commission/items/${itemId}/retirer`, { method: 'POST' });
}

/** Ordre du jour complet de la séance : nouveaux crédits + dossiers en difficulté + demandes exceptionnelles. */
export async function fetchCommissionAgenda(sessionId) {
  const [fileAttente, items] = await Promise.all([
    apiRequest(`/v1/admin/commission/file-attente/${sessionId}`),
    apiRequest(`/v1/admin/commission/items/${sessionId}`),
  ]);
  return { credits: fileAttente.dossiers, points: items.points };
}

/**
 * Tient la séance : enregistre une décision pour chaque point de
 * l'ordre du jour. Chaque décision est `{ kind: 'credit'|'item', id, decision, note }` ;
 * le serveur accepte aussi les formes `{ creditId, ... }` / `{ itemId, ... }`.
 */
export async function holdCommissionSession(sessionId, decisions) {
  const payload = decisions.map(({ kind, id, decision, note }) => (
    kind === 'credit' ? { kind, creditId: id, decision, note } : { kind, itemId: id, decision, note }
  ));
  return apiRequest(`/v1/admin/commission/seance/${sessionId}/tenir`, {
    method: 'POST',
    body: { decisions: payload },
  });
}

/** Dossiers validés par le comité, en attente de la double validation de l'opérateur. */
export async function fetchDoubleValidationQueue() {
  const { credits } = await apiRequest('/v1/admin/credits?statut=valide_commission');
  return credits;
}

/** Double validation par l'opérateur, après le comité — ne débloque rien, l'approbation finale du directeur suit. */
export async function doubleValidateCredit(creditId) {
  return apiRequest(`/v1/admin/commission/credits/${creditId}/valider-double`, { method: 'POST' });
}

/** Dossiers prêts pour l'approbation finale du directeur. */
export async function fetchFinalApprovalQueue() {
  const { credits } = await apiRequest('/v1/admin/credits?statut=valide_double');
  return credits;
}

/** Le directeur autorise, au cas par cas, un client déjà en crédit à repasser en commission. */
export async function grantExceptionAuthorization(clientId, motif) {
  return apiRequest('/v1/admin/commission/autorisations', { method: 'POST', body: { clientId, motif } });
}

/** Autorisations d'exception non encore consommées. */
export async function fetchExceptionAuthorizations() {
  const { autorisations } = await apiRequest('/v1/admin/commission/autorisations');
  return autorisations;
}

/**
 * ─────────────────────────────────────────────────────────────────────
 *  LA CAISSE
 * ─────────────────────────────────────────────────────────────────────
 */

/** Recherche un client par nom ou numéro de compte. */
export async function searchCaisseClient(q) {
  const { resultats } = await apiRequest(`/v1/caisse/rechercher-client?q=${encodeURIComponent(q)}`);
  return resultats;
}

/** Solde courant de la caisse de l'agent connecté, et bilan du jour. */
export async function fetchMaCaisse() {
  return apiRequest('/v1/caisse/ma-caisse');
}

/** Historique des demandes de la caissière connectée. */
export async function fetchMesOperationsCaisse() {
  const { operations } = await apiRequest('/v1/caisse/mes-operations');
  return operations;
}

/** Dépose une demande de retrait guichet pour un client. */
export async function demanderRetraitCaisse(clientId, montant, motif, modePaiement = 'especes', telephonePaiement) {
  return apiRequest('/v1/caisse/retraits', {
    method: 'POST',
    body: { clientId, montant, motif, modePaiement, telephonePaiement },
  });
}

/** Demande un réapprovisionnement de sa caisse. */
export async function demanderApproCaisse(montant, motif) {
  return apiRequest('/v1/caisse/appro', { method: 'POST', body: { montant, motif } });
}

/** RIB imprimable : nom, numéro de compte, gestionnaire. */
export async function fetchRib(clientId) {
  return apiRequest(`/v1/caisse/rib/${clientId}`);
}

/** Directeur : toutes les demandes de caisse en attente, tous guichets confondus. */
export async function fetchDemandesCaisseEnAttente() {
  const { demandes } = await apiRequest('/v1/caisse/demandes-en-attente');
  return demandes;
}

/** Directeur : valide une demande (retrait ou appro). */
export async function validerOperationCaisse(id) {
  return apiRequest(`/v1/caisse/operations/${id}/valider`, { method: 'POST' });
}

/** Directeur : rejette une demande, avec motif obligatoire. */
export async function rejeterOperationCaisse(id, motif) {
  return apiRequest(`/v1/caisse/operations/${id}/rejeter`, { method: 'POST', body: { motif } });
}

/** Journal d'audit — qui a fait quoi, quand. Gestionnaire et directeur seulement. */
export async function fetchAuditLog() {
  const { entrees } = await apiRequest('/v1/admin/audit');
  return entrees;
}

/** Directeur : solde et mouvements de la caisse principale de l'entreprise. */
export async function fetchCaissePrincipale() {
  return apiRequest('/v1/caisse/principale');
}

/** Directeur : injecte des fonds dans la caisse principale. */
export async function alimenterCaissePrincipale(montant, motif) {
  return apiRequest('/v1/caisse/principale/alimenter', { method: 'POST', body: { montant, motif } });
}

/** Caissière : dépense de fonctionnement (pas un client), soumise à validation. */
export async function demanderDepenseCaisse(montant, motif) {
  return apiRequest('/v1/caisse/depenses', { method: 'POST', body: { montant, motif } });
}

/** Caissière : un client dépose des espèces — appliqué immédiatement. */
export async function encaisserClient(clientId, montant, motif) {
  return apiRequest('/v1/caisse/encaissements', { method: 'POST', body: { clientId, montant, motif } });
}

/** Caissière : consulte si elle a déjà clôturé aujourd'hui, et le montant de base attendu. */
export async function fetchClotureDuJour() {
  return apiRequest('/v1/caisse/cloture-du-jour');
}

/** Caissière : clôture la journée, renvoie l'excédent au-delà du montant de base. */
export async function cloturerCaisse() {
  return apiRequest('/v1/caisse/clore', { method: 'POST' });
}
