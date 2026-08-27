import { createApp } from '../../src/app.js';
import { pool } from '../../src/db/index.js';

/**
 * Harnais d'intégration sans dépendance externe.
 *
 * Pas de supertest : on démarre l'application sur un port éphémère et
 * on l'interroge avec fetch, natif depuis Node 18. Une dépendance de
 * moins à maintenir, et le test emprunte exactement le même chemin
 * réseau qu'un vrai client.
 *
 * ⚠️ Ces tests écrivent dans la base pointée par DATABASE_URL.
 * Utilisez une base dédiée aux tests :
 *
 *   createdb cpg_test
 *   DATABASE_URL=postgresql://.../cpg_test npm run test:integration
 */

let server;
let baseUrl;

export async function startTestServer() {
  if (server) return baseUrl;

  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
  return baseUrl;
}

export async function stopTestServer() {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = null;
  }
  await pool.end().catch(() => {});
}

/**
 * Appel HTTP typé.
 * @returns {Promise<{ status: number, body: any }>}
 */
export async function api(path, { method = 'GET', body, token } = {}) {
  const url = `${baseUrl}${path}`;

  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  let payload = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  return { status: response.status, body: payload };
}

/**
 * Variante multipart, pour les routes d'upload (import de fichier de
 * paie). FormData fixe elle-même l'en-tête Content-Type avec sa
 * frontière : le préciser à la main casserait l'envoi.
 */
export async function apiUpload(path, { token, fields = {}, fileField, fileContent, fileName = 'fichier.csv' } = {}) {
  const url = `${baseUrl}${path}`;
  const form = new FormData();

  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value);
  }
  if (fileField) {
    form.append(fileField, new Blob([fileContent], { type: 'text/csv' }), fileName);
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: form,
  });

  let payload = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  return { status: response.status, body: payload };
}

const DEMO_PASSWORD = 'MotDePasseDemo2026!';

export const ACCOUNTS = {
  operateur: 'sylvie@cpg.ga',
  operateur2: 'eric@cpg.ga',
  gestionnaire: 'david@cpg.ga',
  directeur: 'direction@cpg.ga',
  admin: 'admin@cpg.ga',
};

const tokenCache = new Map();

/**
 * Connecte un agent et renvoie son jeton d'accès.
 *
 * Mis en cache par rôle : la limite de connexion (10 tentatives par
 * IP toutes les 15 minutes, cf. loginLimiter dans auth.routes.js)
 * s'épuise vite si chaque test se reconnecte. Un jeton d'accès vit
 * 15 minutes (ACCESS_TOKEN_TTL) : le réutiliser dans cette fenêtre
 * reflète aussi mieux l'usage réel d'un client qui ne se reconnecte
 * pas à chaque appel.
 */
export async function loginStaff(who) {
  if (tokenCache.has(who)) return tokenCache.get(who);

  const { status, body } = await api('/v1/auth/connexion-agent', {
    method: 'POST',
    body: { email: ACCOUNTS[who] ?? who, password: DEMO_PASSWORD },
  });

  if (status !== 200) {
    throw new Error(
      `Connexion impossible pour ${who} (${status}). Avez-vous lancé « npm run seed » sur la base de test ?`
    );
  }
  tokenCache.set(who, body.accessToken);
  return body.accessToken;
}

let clientTokenCache = null;

/** Connecte un client mobile et renvoie son jeton, mis en cache. */
export async function loginClient(phone = '+24106000001', pin = '1234') {
  const cacheKey = `${phone}:${pin}`;
  if (clientTokenCache?.key === cacheKey) return clientTokenCache.token;

  const { status, body } = await api('/v1/auth/connexion-client', {
    method: 'POST',
    body: { phone, pin },
  });

  if (status !== 200) throw new Error(`Connexion client impossible (${status}).`);
  clientTokenCache = { key: cacheKey, token: body.accessToken };
  return body.accessToken;
}

/** Indique si une base de test est configurée, pour ignorer proprement. */
export function hasTestDatabase() {
  return Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.includes('test'));
}
