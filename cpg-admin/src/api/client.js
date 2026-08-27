/**
 * ─────────────────────────────────────────────────────────────────────
 *  CLIENT API — CPG BACK-OFFICE
 * ─────────────────────────────────────────────────────────────────────
 *
 * Miroir du client construit pour l'app mobile (src/api/client.js dans
 * cpg-mobile) : un seul endroit gère l'adresse du serveur, le jeton, et
 * son rafraîchissement automatique. Les écrans passent par les
 * fonctions de src/api/adminApi.js, jamais par fetch() directement.
 *
 * L'adresse du serveur se règle via une variable d'environnement Vite
 * (VITE_API_URL) — voir le fichier .env de ce dossier, ou les réglages
 * de variables d'environnement sur Vercel une fois en ligne.
 */
export const API_BASE_URL = import.meta.env?.VITE_API_URL ?? 'https://cpg-production.up.railway.app';

const TOKEN_KEY = 'cpg_admin_access_token';
const REFRESH_KEY = 'cpg_admin_refresh_token';

let accessToken = localStorage.getItem(TOKEN_KEY);
let refreshToken = localStorage.getItem(REFRESH_KEY);

export function hasStoredSession() {
  return Boolean(refreshToken);
}

export function persistSession({ accessToken: at, refreshToken: rt }) {
  accessToken = at;
  refreshToken = rt;
  localStorage.setItem(TOKEN_KEY, at);
  localStorage.setItem(REFRESH_KEY, rt);
}

export function clearSession() {
  accessToken = null;
  refreshToken = null;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function refreshSession() {
  if (!refreshToken) throw new ApiError(401, 'Session expirée.');

  const response = await fetch(`${API_BASE_URL}/v1/auth/rafraichir`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });

  if (!response.ok) {
    clearSession();
    throw new ApiError(401, 'Session expirée. Reconnectez-vous.');
  }

  const data = await response.json();
  persistSession({ accessToken: data.accessToken, refreshToken: data.refreshToken });
  return data.accessToken;
}

/**
 * Appel HTTP authentifié. Rafraîchit automatiquement le jeton une fois
 * en cas de 401, puis rejoue la requête.
 *
 * `isFormData: true` envoie `body` tel quel (un FormData, pour l'envoi
 * de fichiers) au lieu de le sérialiser en JSON — nécessaire pour
 * l'import du fichier de paie, qui joint un vrai fichier CSV.
 */
export async function apiRequest(path, { method = 'GET', body, skipAuth = false, retry = true, isFormData = false } = {}) {
  const headers = {};
  if (!isFormData) headers['Content-Type'] = 'application/json';
  if (!skipAuth && accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      ...(body ? { body: isFormData ? body : JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(0, 'Impossible de joindre le serveur CPG. Vérifiez votre connexion.');
  }

  if (response.status === 401 && !skipAuth && retry) {
    await refreshSession();
    return apiRequest(path, { method, body, skipAuth, retry: false, isFormData });
  }

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new ApiError(response.status, payload?.error ?? 'Une erreur est survenue.', payload?.code);
  }
  return payload;
}
