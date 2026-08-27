/**
 * ─────────────────────────────────────────────────────────────────────
 *  POINT D'INTÉGRATION MOBILE MONEY — À BRANCHER PLUS TARD
 * ─────────────────────────────────────────────────────────────────────
 *
 * Ce module est le SEUL endroit à modifier pour connecter Airtel Money
 * et Moov Money. Les écrans n'appellent que les fonctions exportées ici,
 * donc l'interface utilisateur n'aura pas à changer.
 *
 * Ce qu'il faudra obtenir auprès des opérateurs :
 *   - Airtel Money Gabon : identifiants marchand (client_id / client_secret),
 *     URL d'API, endpoints « collection » (entrant) et « disbursement » (sortant)
 *   - Moov Money Gabon : mêmes éléments, via l'agrégateur retenu si applicable
 *
 * Règle de sécurité : aucun secret ne doit vivre dans l'application mobile.
 * L'app appelle le backend CPG, et c'est le backend qui parle aux opérateurs.
 *
 *   App mobile  ──►  Backend CPG  ──►  API Airtel / Moov
 *                    (garde les clés,        (débit / crédit réel)
 *                     signe, journalise)
 *
 * Les fonctions ci-dessous simulent aujourd'hui les réponses réseau
 * pour que le prototype reste testable hors connexion.
 */

/** URL du backend CPG. À déplacer dans une variable d'environnement. */
export const API_BASE_URL = 'https://api.cpg.ga'; // TODO: renseigner

/** Opérateurs proposés dans l'écran Mobile Money. */
export const OPERATORS = [
  { id: 'airtel', label: 'Airtel Money' },
  { id: 'moov', label: 'Moov Money' },
];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Dépôt : le client fait entrer de l'argent sur son compte CPG.
 * Côté opérateur, cela correspond à une opération de « collection » :
 * l'opérateur envoie un push USSD sur le téléphone du client, qui confirme
 * par son code secret, puis notifie le backend par webhook.
 *
 * @param {{ operator: string, amount: number, phone?: string }} params
 * @returns {Promise<{ reference: string, status: string, amount: number }>}
 */
export async function requestDeposit({ operator, amount }) {
  // TODO: remplacer par
  // const res = await fetch(`${API_BASE_URL}/momo/deposit`, {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  //   body: JSON.stringify({ operator, amount }),
  // });
  // if (!res.ok) throw new Error('Le dépôt n’a pas pu être initié.');
  // return res.json();
  await wait(900);
  return {
    reference: `TX-${Math.floor(Math.random() * 9000 + 1000)}`,
    status: 'pending_confirmation',
    amount,
    operator,
  };
}

/**
 * Retrait / envoi : l'argent quitte le compte CPG vers le portefeuille mobile.
 * Côté opérateur : opération de « disbursement ».
 *
 * @param {{ operator: string, amount: number, phone?: string }} params
 */
export async function requestWithdrawal({ operator, amount }) {
  // TODO: POST ${API_BASE_URL}/momo/withdrawal
  await wait(900);
  return {
    reference: `TX-${Math.floor(Math.random() * 9000 + 1000)}`,
    status: 'pending_confirmation',
    amount,
    operator,
  };
}

/**
 * Interrogation de l'état d'une transaction.
 * Utile tant que le webhook opérateur n'a pas encore été reçu.
 *
 * @param {string} reference
 */
export async function getTransactionStatus(reference) {
  // TODO: GET ${API_BASE_URL}/momo/transactions/${reference}
  await wait(400);
  return { reference, status: 'confirmed' };
}
