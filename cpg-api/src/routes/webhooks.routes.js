import { Router } from 'express';
import { verifyWebhookSignature, handleWebhook } from '../services/mobileMoneyService.js';

const router = Router();

/**
 * POST /webhooks/momo/:operateur
 *
 * Appelé par Airtel ou Moov quand le client a confirmé (ou refusé)
 * l'opération sur son téléphone. C'est le seul moment où l'argent bouge.
 *
 * ⚠️ Cette route est publique : elle doit l'être, l'opérateur ne peut pas
 * s'authentifier avec un jeton CPG. La protection repose entièrement sur
 * la vérification de signature. Sans elle, n'importe qui peut se faire
 * créditer en devinant l'URL.
 *
 * Le corps brut est nécessaire au calcul de la signature : voir
 * express.raw() monté sur cette route dans app.js.
 */
router.post('/momo/:operateur', async (req, res) => {
  const signature = req.headers['x-signature'] ?? req.headers['x-callback-signature'];
  const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : JSON.stringify(req.body);

  if (!verifyWebhookSignature(rawBody, signature)) {
    req.log?.warn({ operateur: req.params.operateur }, 'Webhook à signature invalide rejeté');
    return res.status(401).json({ error: 'Signature invalide.' });
  }

  let payload;
  try {
    payload = typeof req.body === 'object' && !(req.body instanceof Buffer)
      ? req.body
      : JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'Corps de requête illisible.' });
  }

  // Adapter ces champs au format exact de chaque opérateur.
  const reference = payload.reference ?? payload.externalId ?? payload.transactionId;
  const status = ['SUCCESS', 'SUCCESSFUL', 'COMPLETED'].includes(String(payload.status).toUpperCase())
    ? 'confirmee'
    : 'echouee';

  try {
    await handleWebhook({
      reference,
      status,
      operatorRef: payload.operatorTransactionId ?? payload.id,
      failureReason: payload.message ?? payload.reason,
    });

    // Répondre 200 rapidement : les opérateurs réessaient en cas de
    // timeout, ce qui provoquerait des webhooks en double.
    res.json({ received: true });
  } catch (error) {
    req.log?.error({ err: error, reference }, 'Traitement du webhook impossible');
    res.status(500).json({ error: 'Traitement impossible.' });
  }
});

export default router;
