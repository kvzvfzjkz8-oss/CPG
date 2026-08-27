import { apiRequest, persistSession } from './client';

/**
 * ─────────────────────────────────────────────────────────────────────
 *  AUTHENTIFICATION
 * ─────────────────────────────────────────────────────────────────────
 */

/** Connexion par téléphone + code PIN. Stocke la session en cas de succès. */
export async function loginWithPin(phone, pin) {
  const data = await apiRequest('/v1/auth/connexion-client', {
    method: 'POST',
    body: { phone, pin },
    skipAuth: true,
  });
  await persistSession({ accessToken: data.accessToken, refreshToken: data.refreshToken, phone });
  return data.user;
}

/** Profil de l'utilisateur connecté. */
export async function fetchMe() {
  return apiRequest('/v1/auth/moi');
}

export async function logout() {
  await apiRequest('/v1/auth/deconnexion', { method: 'POST' });
}

/**
 * ─────────────────────────────────────────────────────────────────────
 *  COMPTE ET TRANSACTIONS
 * ─────────────────────────────────────────────────────────────────────
 */

/** Solde et informations du compte principal. */
export async function fetchAccount() {
  return apiRequest('/v1/client/compte');
}

/** Historique des transactions, pagination par curseur. */
export async function fetchTransactions({ limite = 20, avant } = {}) {
  const params = new URLSearchParams({ limite: String(limite) });
  if (avant) params.set('avant', avant);
  return apiRequest(`/v1/client/transactions?${params.toString()}`);
}

/**
 * ─────────────────────────────────────────────────────────────────────
 *  CRÉDITS
 * ─────────────────────────────────────────────────────────────────────
 */

export async function fetchProducts() {
  return apiRequest('/v1/client/produits');
}

export async function simulateCredit({ produitId, montant, duree }) {
  return apiRequest('/v1/client/credits/simulation', {
    method: 'POST',
    body: { produitId, montant, duree },
  });
}

export async function requestCredit({ produitId, montant, duree, motif }) {
  return apiRequest('/v1/client/credits', {
    method: 'POST',
    body: { produitId, montant, duree, motif },
  });
}

export async function fetchCredits() {
  return apiRequest('/v1/client/credits');
}

/**
 * ─────────────────────────────────────────────────────────────────────
 *  MOBILE MONEY
 * ─────────────────────────────────────────────────────────────────────
 */

export async function initiateMomoTransaction({ operateur, sens, montant, telephone, cleIdempotence }) {
  return apiRequest('/v1/client/momo', {
    method: 'POST',
    body: { operateur, sens, montant, telephone, cleIdempotence },
  });
}

export async function fetchMomoTransaction(reference) {
  return apiRequest(`/v1/client/momo/${reference}`);
}

/**
 * ─────────────────────────────────────────────────────────────────────
 *  MESSAGERIE
 * ─────────────────────────────────────────────────────────────────────
 */

export async function fetchMessages() {
  return apiRequest('/v1/client/messages');
}

export async function sendMessage(texte) {
  return apiRequest('/v1/client/messages', { method: 'POST', body: { texte } });
}

/**
 * ─────────────────────────────────────────────────────────────────────
 *  APPAREIL ET NOTIFICATIONS
 * ─────────────────────────────────────────────────────────────────────
 */

export async function registerDevice(pushToken, plateforme) {
  return apiRequest('/v1/client/appareils', { method: 'POST', body: { pushToken, plateforme } });
}

export async function unregisterDevice(pushToken) {
  return apiRequest(`/v1/client/appareils/${encodeURIComponent(pushToken)}`, { method: 'DELETE' });
}

export async function fetchNotifications() {
  return apiRequest('/v1/client/notifications');
}
