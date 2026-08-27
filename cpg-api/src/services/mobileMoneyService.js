import crypto from 'node:crypto';
import { config } from '../config.js';
import { query, withTransaction } from '../db/index.js';
import { notifyUser } from './pushService.js';
import * as airtel from './operators/airtelMoney.js';

/**
 * ═══════════════════════════════════════════════════════════════════
 *  MOBILE MONEY — POINT D'INTÉGRATION OPÉRATEUR
 * ═══════════════════════════════════════════════════════════════════
 *
 * Ce fichier est le seul endroit à remplir pour brancher Airtel Money
 * et Moov Money. Les routes n'appellent que initiateTransaction() et
 * handleWebhook().
 *
 * Chaîne complète :
 *
 *   App mobile ──► cette API ──► API opérateur ──► push USSD au client
 *                                       │
 *                                       ▼  (le client saisit son code)
 *                              webhook opérateur
 *                                       │
 *                                       ▼
 *                       écriture au journal + push de confirmation
 *
 * ⚠️ Ne créditez JAMAIS le compte au moment de l'initiation. Le client
 * n'a pas encore confirmé, et l'opérateur peut refuser. L'écriture au
 * journal n'a lieu qu'à la réception du webhook confirmant l'opération.
 *
 * À obtenir auprès des opérateurs : identifiants marchands, URL d'API,
 * endpoints collection (entrant) et disbursement (sortant), URL de
 * webhook à leur déclarer, et le mode de signature des webhooks.
 */

const OPERATOR_LABELS = { airtel: 'Airtel Money', moov: 'Moov Money' };

/**
 * Initie une opération auprès de l'opérateur.
 * La transaction est enregistrée en statut `en_attente` : rien n'est
 * crédité ni débité tant que le webhook n'a pas confirmé.
 */
export async function initiateTransaction({ userId, accountId, operator, direction, amount, phone, idempotencyKey }) {
  // Rejeu : si l'app renvoie la même requête après un timeout réseau,
  // on renvoie la transaction d'origine au lieu d'en créer une seconde.
  if (idempotencyKey) {
    const { rows: existing } = await query(
      'SELECT * FROM momo_transactions WHERE idempotency_key = $1',
      [idempotencyKey]
    );
    if (existing[0]) return existing[0];
  }

  // Pour un envoi sortant, vérifier le solde AVANT d'appeler l'opérateur.
  if (direction === 'sortant') {
    const { rows } = await query(
      'SELECT balance FROM account_balances WHERE account_id = $1',
      [accountId]
    );
    if (!rows[0] || rows[0].balance < amount) {
      const error = new Error('Solde insuffisant pour cette opération.');
      error.status = 400;
      throw error;
    }
  }

  const reference = `TX-${crypto.randomInt(1000, 9999)}`;

  const { rows } = await query(
    `INSERT INTO momo_transactions
       (reference, user_id, account_id, operator, direction, amount, phone, status, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'en_attente', $8)
     RETURNING *`,
    [reference, userId, accountId, operator, direction, amount, phone, idempotencyKey ?? null]
  );

  const transaction = rows[0];

  // ─── Appel à l'opérateur ────────────────────────────────────────
  //
  // Airtel est branché sur l'API réelle dès que les identifiants sont
  // présents dans l'environnement. Sinon, et pour Moov qui n'est pas
  // encore intégré, on reste en simulation : le prototype doit rester
  // démontrable sans compte marchand.

  if (operator === 'airtel' && airtel.isConfigured()) {
    try {
      const result =
        direction === 'entrant'
          ? await airtel.requestCollection({ reference, amount, phone })
          : await airtel.requestDisbursement({ reference, amount, phone });

      await query(
        'UPDATE momo_transactions SET operator_ref = $2, status = $3 WHERE id = $1',
        [transaction.id, result.operatorRef, airtel.mapStatus(result.status)]
      );

      return { ...transaction, operator_ref: result.operatorRef };
    } catch (error) {
      // L'échec est enregistré, pas avalé : une transaction qui reste
      // « en attente » pour toujours bloque le client sans explication.
      await query(
        "UPDATE momo_transactions SET status = 'echouee', failure_reason = $2 WHERE id = $1",
        [transaction.id, error.message.slice(0, 300)]
      );
      error.status = error.status ?? 502;
      throw error;
    }
  }

  console.log(
    `[momo] Mode simulé (${operator}) : ${direction} de ${amount} FCFA — ${reference}`
  );

  return transaction;
}

/**
 * Vérifie la signature d'un webhook opérateur.
 *
 * Sans cette vérification, n'importe qui connaissant l'URL peut envoyer
 * une fausse confirmation et faire créditer un compte. C'est la faille
 * la plus grave possible sur une API de paiement.
 *
 * La méthode exacte dépend de l'opérateur : demandez-leur le format.
 */
export function verifyWebhookSignature(rawBody, signature) {
  if (!signature) return false;

  const expected = crypto
    .createHmac('sha256', config.momo.webhookSecret)
    .update(rawBody)
    .digest('hex');

  // Comparaison à temps constant : une comparaison classique fuite de
  // l'information par son temps d'exécution.
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Traite la confirmation (ou l'échec) envoyée par l'opérateur.
 * C'est ici, et seulement ici, que l'argent bouge dans le journal.
 */
export async function handleWebhook({ reference, status, operatorRef, failureReason }) {
  return withTransaction(async (client) => {
    // FOR UPDATE verrouille la ligne : si l'opérateur envoie deux fois
    // le même webhook, le second attend et verra le statut déjà confirmé.
    const { rows } = await client.query(
      'SELECT * FROM momo_transactions WHERE reference = $1 FOR UPDATE',
      [reference]
    );
    const tx = rows[0];

    if (!tx) throw new Error(`Transaction inconnue : ${reference}`);
    if (tx.status === 'confirmee' || tx.status === 'echouee') {
      return tx; // déjà traitée, on ignore sans erreur
    }

    if (status !== 'confirmee') {
      const { rows: failed } = await client.query(
        `UPDATE momo_transactions
         SET status = 'echouee', failure_reason = $2, operator_ref = $3
         WHERE id = $1 RETURNING *`,
        [tx.id, failureReason ?? 'Refusée par l’opérateur', operatorRef ?? null]
      );
      await notifyUser(tx.user_id, 'momo_echoue', {
        amount: tx.amount,
        operator: tx.operator,
        reference: tx.reference,
      });
      return failed[0];
    }

    // Écriture au journal : positive pour un dépôt, négative pour un envoi.
    const signedAmount = tx.direction === 'entrant' ? tx.amount : -tx.amount;
    const label =
      tx.direction === 'entrant'
        ? `Dépôt ${OPERATOR_LABELS[tx.operator]}`
        : `Envoi ${OPERATOR_LABELS[tx.operator]}`;

    const { rows: entry } = await client.query(
      `INSERT INTO ledger_entries (account_id, type, amount, label, reference)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [tx.account_id, tx.direction === 'entrant' ? 'depot' : 'retrait', signedAmount, label, tx.reference]
    );

    const { rows: confirmed } = await client.query(
      `UPDATE momo_transactions
       SET status = 'confirmee', confirmed_at = now(), operator_ref = $2, ledger_entry_id = $3
       WHERE id = $1 RETURNING *`,
      [tx.id, operatorRef ?? null, entry[0].id]
    );

    await notifyUser(tx.user_id, 'momo_confirme', {
      amount: tx.amount,
      operator: tx.operator,
      direction: tx.direction,
      reference: tx.reference,
    });

    return confirmed[0];
  });
}
