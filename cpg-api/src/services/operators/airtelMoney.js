import crypto from 'node:crypto';
import { config } from '../../config.js';
import { normalizeMsisdn, mapStatus } from './airtelHelpers.js';

export { normalizeMsisdn, mapStatus };

/**
 * ═══════════════════════════════════════════════════════════════════
 *  ADAPTATEUR AIRTEL MONEY — Airtel Africa Open API
 * ═══════════════════════════════════════════════════════════════════
 *
 *  Portail développeur : https://developers.airtel.africa/
 *  Documentation       : https://developers.airtel.africa/docs
 *  Sandbox (UAT)       : https://openapiuat.airtel.africa
 *  Production          : https://openapi.airtel.africa
 *
 *  Le Gabon fait partie des marchés couverts. Code pays « GA »,
 *  devise « XAF ».
 *
 *  ⚠️ CE CODE N'A JAMAIS ÉTÉ EXÉCUTÉ CONTRE L'API RÉELLE.
 *
 *  Il est écrit d'après la documentation publique d'Airtel Africa.
 *  Trois raisons pour lesquelles il ne peut pas encore fonctionner :
 *
 *    1. Il faut un client_id et un client_secret, délivrés après
 *       inscription sur le portail développeur.
 *    2. Le passage en production exige un dossier KYC validé par
 *       Airtel — pour un établissement financier, comptez plusieurs
 *       semaines.
 *    3. Les décaissements exigent une clé publique RSA fournie par
 *       Airtel pour chiffrer le code PIN marchand.
 *
 *  Tant que ces éléments manquent, le service reste en mode simulé.
 *  Testez d'abord en sandbox : les identifiants UAT sont délivrés
 *  immédiatement à l'inscription, sans KYC.
 */

const COUNTRY = 'GA';
const CURRENCY = 'XAF';

/** Jeton OAuth2 mis en cache : il vaut environ une heure. */
let tokenCache = { value: null, expiresAt: 0 };

function baseUrl() {
  return config.momo.airtel.url || 'https://openapiuat.airtel.africa';
}

export function isConfigured() {
  const { clientId, clientSecret } = config.momo.airtel;
  return Boolean(clientId && clientSecret);
}

/**
 * Authentification OAuth2, flux « client credentials ».
 *
 * Le jeton est mis en cache avec 60 secondes de marge : demander un
 * jeton neuf à chaque transaction ferait tomber sous la limite de
 * débit d'Airtel dès que le trafic monte.
 */
export async function getAccessToken() {
  if (tokenCache.value && Date.now() < tokenCache.expiresAt) {
    return tokenCache.value;
  }

  const response = await fetch(`${baseUrl()}/auth/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: '*/*' },
    body: JSON.stringify({
      client_id: config.momo.airtel.clientId,
      client_secret: config.momo.airtel.clientSecret,
      grant_type: 'client_credentials',
    }),
  });

  if (!response.ok) {
    throw new Error(`Authentification Airtel refusée (HTTP ${response.status}).`);
  }

  const data = await response.json();
  const ttl = Number(data.expires_in ?? 3600);

  tokenCache = {
    value: data.access_token,
    expiresAt: Date.now() + (ttl - 60) * 1000,
  };

  return tokenCache.value;
}

function headers(token) {
  return {
    'Content-Type': 'application/json',
    Accept: '*/*',
    'X-Country': COUNTRY,
    'X-Currency': CURRENCY,
    Authorization: `Bearer ${token}`,
  };
}

/**
 * COLLECTION — encaissement.
 *
 * Airtel envoie un push USSD sur le téléphone du client, qui valide
 * avec son code secret. La réponse HTTP ne signifie donc PAS que
 * l'argent est arrivé : elle signifie que la demande est partie.
 * La confirmation arrive par callback, ou par interrogation.
 *
 * @param {{ reference: string, amount: number, phone: string }} params
 */
export async function requestCollection({ reference, amount, phone }) {
  const token = await getAccessToken();

  const response = await fetch(`${baseUrl()}/merchant/v1/payments/`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({
      reference,
      subscriber: {
        country: COUNTRY,
        currency: CURRENCY,
        msisdn: normalizeMsisdn(phone),
      },
      transaction: {
        amount,
        country: COUNTRY,
        currency: CURRENCY,
        id: reference, // notre référence, reprise dans le callback
      },
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data?.status?.success === false) {
    throw new Error(
      data?.status?.message ?? `Airtel a refusé l'encaissement (HTTP ${response.status}).`
    );
  }

  return {
    operatorRef: data?.data?.transaction?.id ?? null,
    status: data?.data?.transaction?.status ?? 'PENDING',
    raw: data,
  };
}

/**
 * Chiffre le code PIN marchand avec la clé publique RSA d'Airtel.
 * Obligatoire pour les décaissements : Airtel refuse un PIN en clair.
 */
export function encryptPin(pin, publicKeyBase64) {
  const pem = `-----BEGIN PUBLIC KEY-----\n${publicKeyBase64}\n-----END PUBLIC KEY-----`;

  return crypto
    .publicEncrypt(
      { key: pem, padding: crypto.constants.RSA_PKCS1_PADDING },
      Buffer.from(String(pin))
    )
    .toString('base64');
}

/**
 * DISBURSEMENT — décaissement vers le portefeuille du client.
 *
 * Opération sensible : elle sort de l'argent du compte marchand CPG.
 * Le solde du compte client doit avoir été vérifié en amont, et le
 * compte marchand Airtel doit être approvisionné.
 */
export async function requestDisbursement({ reference, amount, phone }) {
  const token = await getAccessToken();
  const { pin, publicKey } = config.momo.airtel;

  if (!pin || !publicKey) {
    throw new Error(
      'Décaissement impossible : code PIN marchand ou clé publique Airtel non configurés.'
    );
  }

  const response = await fetch(`${baseUrl()}/standard/v1/disbursements/`, {
    method: 'POST',
    headers: { ...headers(token), 'x-signature': '', 'x-key': '' },
    body: JSON.stringify({
      payee: { msisdn: normalizeMsisdn(phone) },
      reference,
      pin: encryptPin(pin, publicKey),
      transaction: {
        amount,
        id: reference,
      },
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data?.status?.success === false) {
    throw new Error(
      data?.status?.message ?? `Airtel a refusé le décaissement (HTTP ${response.status}).`
    );
  }

  return {
    operatorRef: data?.data?.transaction?.reference ?? null,
    status: data?.data?.transaction?.status ?? 'PENDING',
    raw: data,
  };
}

/**
 * Interrogation de l'état d'une transaction.
 *
 * Filet de sécurité : les callbacks se perdent (coupure réseau,
 * redéploiement du serveur). Sans interrogation périodique des
 * transactions restées en attente, un client peut avoir été débité
 * chez Airtel sans être crédité chez CPG.
 */
export async function getTransactionStatus(reference) {
  const token = await getAccessToken();

  const response = await fetch(`${baseUrl()}/standard/v1/payments/${reference}`, {
    method: 'GET',
    headers: headers(token),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`Interrogation Airtel impossible (HTTP ${response.status}).`);
  }

  return {
    status: data?.data?.transaction?.status ?? 'UNKNOWN',
    operatorRef: data?.data?.transaction?.airtel_money_id ?? null,
    raw: data,
  };
}
