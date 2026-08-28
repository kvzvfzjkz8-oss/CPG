import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * expo-secure-store ne fonctionne que sur un vrai appareil (Android /
 * iOS) — pas dans un navigateur. Sur le web (utile pour un test rapide
 * ou une démonstration), on retombe sur localStorage. Moins strict en
 * sécurité, mais uniquement pour ce cas d'usage : sur un vrai
 * téléphone, la version SecureStore (chiffrée par le système) reste
 * celle utilisée.
 */
const storage = Platform.OS === 'web'
  ? {
      getItemAsync: async (key) => localStorage.getItem(key),
      setItemAsync: async (key, value) => localStorage.setItem(key, value),
      deleteItemAsync: async (key) => localStorage.removeItem(key),
    }
  : SecureStore;


/**
 * ─────────────────────────────────────────────────────────────────────
 *  CLIENT API — CPG MOBILE
 * ─────────────────────────────────────────────────────────────────────
 *
 * Point d'entrée unique vers le backend réel (cpg-api). Les écrans
 * n'appellent jamais fetch() directement : ils passent par les
 * fonctions de src/api/clientApi.js, qui elles-mêmes passent par ce
 * fichier — un seul endroit gère le jeton, son rafraîchissement, et la
 * mise en forme des erreurs.
 *
 * ⚠️ À renseigner avant tout test sur un vrai appareil : l'adresse du
 * serveur. En développement (Expo Go via tunnel ou LAN), on ne peut
 * pas utiliser "localhost" — ce serait le téléphone lui-même, pas
 * l'ordinateur qui fait tourner l'API. Voir le README de ce dossier
 * pour la marche à suivre.
 */
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://cpg-production.up.railway.app';

const TOKEN_KEY = 'cpg_access_token';
const REFRESH_KEY = 'cpg_refresh_token';
const PHONE_KEY = 'cpg_phone';

let accessToken = null;
let refreshToken = null;

/** Charge les jetons déjà stockés (au démarrage de l'app). */
export async function loadStoredSession() {
  const [storedAccess, storedRefresh, storedPhone] = await Promise.all([
    storage.getItemAsync(TOKEN_KEY),
    storage.getItemAsync(REFRESH_KEY),
    storage.getItemAsync(PHONE_KEY),
  ]);
  accessToken = storedAccess;
  refreshToken = storedRefresh;
  return { hasSession: Boolean(storedRefresh), phone: storedPhone };
}

/** Enregistre une nouvelle session après connexion. */
export async function persistSession({ accessToken: at, refreshToken: rt, phone }) {
  accessToken = at;
  refreshToken = rt;
  await storage.setItemAsync(TOKEN_KEY, at);
  await storage.setItemAsync(REFRESH_KEY, rt);
  if (phone) await storage.setItemAsync(PHONE_KEY, phone);
}

/** Efface la session (déconnexion, ou jeton de rafraîchissement rejeté). */
export async function clearSession() {
  accessToken = null;
  refreshToken = null;
  await Promise.all([
    storage.deleteItemAsync(TOKEN_KEY),
    storage.deleteItemAsync(REFRESH_KEY),
  ]);
}

export async function getStoredPhone() {
  return storage.getItemAsync(PHONE_KEY);
}

export class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Échange le refresh token contre une nouvelle paire de jetons. Le
 * serveur fait une rotation à chaque appel (l'ancien refresh token est
 * révoqué) : on met donc systématiquement à jour ce qu'on a stocké.
 */
async function refreshSession() {
  if (!refreshToken) throw new ApiError(401, 'Session expirée.');

  const response = await fetch(`${API_BASE_URL}/v1/auth/rafraichir`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });

  if (!response.ok) {
    await clearSession();
    throw new ApiError(401, 'Session expirée. Reconnectez-vous.');
  }

  const data = await response.json();
  accessToken = data.accessToken;
  refreshToken = data.refreshToken;
  await storage.setItemAsync(TOKEN_KEY, accessToken);
  await storage.setItemAsync(REFRESH_KEY, refreshToken);
  return accessToken;
}

/**
 * Appel HTTP authentifié. Rafraîchit automatiquement le jeton une fois
 * en cas de 401, puis rejoue la requête — l'écran appelant n'a jamais
 * à se soucier de l'expiration du jeton d'accès (15 minutes).
 */
export async function apiRequest(path, { method = 'GET', body, skipAuth = false, retry = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (!skipAuth && accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (networkError) {
    throw new ApiError(0, 'Impossible de joindre le serveur CPG. Vérifiez votre connexion.');
  }

  if (response.status === 401 && !skipAuth && retry) {
    await refreshSession();
    return apiRequest(path, { method, body, skipAuth, retry: false });
  }

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new ApiError(response.status, payload?.error ?? 'Une erreur est survenue.', payload?.code);
  }
  return payload;
}
