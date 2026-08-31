import { config } from '../config.js';
import { query } from '../db/index.js';

/**
 * ═══════════════════════════════════════════════════════════════════
 *  NOTIFICATIONS PUSH
 * ═══════════════════════════════════════════════════════════════════
 *
 * C'est ici que se ferme la boucle décrite dans les deux autres projets :
 *
 *   App mobile enregistre son token  ──►  table `devices`
 *   Back-office approuve un crédit   ──►  notifyUser()
 *   notifyUser()                     ──►  API Expo  ──►  APNs / FCM  ──►  téléphone
 *
 * Le back-office n'envoie jamais de push lui-même : il ne connaît pas
 * les tokens, et c'est voulu. Un seul endroit sait joindre les clients.
 */

/** Modèles de messages, pour garder un ton cohérent d'une alerte à l'autre. */
export const TEMPLATES = {
  credit_approuve: (data) => ({
    title: 'Crédit approuvé',
    body: `Votre crédit de ${formatFCFA(data.amount)} FCFA a été approuvé.`,
    data: { type: 'credit', screen: 'Crédits', reference: data.reference },
  }),
  credit_rejete: () => ({
    title: 'Demande de crédit',
    body: "Votre demande n'a pas été retenue. Un conseiller reste disponible.",
    data: { type: 'credit', screen: 'Crédits' },
  }),
  momo_confirme: (data) => ({
    title: data.direction === 'entrant' ? 'Dépôt confirmé' : 'Envoi confirmé',
    body: `${formatFCFA(data.amount)} FCFA via ${data.operator === 'airtel' ? 'Airtel Money' : 'Moov Money'}.`,
    data: { type: 'transaction', screen: 'Accueil', reference: data.reference },
  }),
  momo_echoue: (data) => ({
    title: 'Transaction échouée',
    body: `L'opération de ${formatFCFA(data.amount)} FCFA n'a pas abouti. Aucun montant n'a été débité.`,
    data: { type: 'transaction', screen: 'Mobile Money' },
  }),
  message_conseiller: (data) => ({
    title: 'Message de votre conseiller',
    body: data.preview ?? 'Vous avez reçu une réponse.',
    data: { type: 'message', screen: 'Messages' },
  }),
  echeance_proche: (data) => ({
    title: 'Échéance à venir',
    body: `Votre mensualité de ${formatFCFA(data.amount)} FCFA sera prélevée le ${data.dueDate}.`,
    data: { type: 'echeance', screen: 'Crédits' },
  }),
  retrait_caisse: (data) => ({
    title: 'Retrait effectué',
    body: `Un retrait de ${formatFCFA(data.amount)} FCFA a été effectué au guichet sur votre compte.`,
    data: { type: 'transaction', screen: 'Accueil' },
  }),
};

const formatFCFA = (n) =>
  Math.round(Number(n) || 0)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/**
 * Envoie une notification à tous les appareils d'un utilisateur.
 * Enregistre toujours la notification en base, même si l'envoi échoue :
 * le client la retrouvera dans l'écran Profil de l'application.
 *
 * @param {string} userId
 * @param {keyof TEMPLATES} type
 * @param {object} data
 */
export async function notifyUser(userId, type, data = {}) {
  const template = TEMPLATES[type];
  if (!template) throw new Error(`Modèle de notification inconnu : ${type}`);

  const { title, body, data: payload } = template(data);

  const { rows: saved } = await query(
    `INSERT INTO notifications (user_id, type, title, body, data)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [userId, type, title, body, payload]
  );

  const { rows: devices } = await query(
    'SELECT push_token FROM devices WHERE user_id = $1',
    [userId]
  );

  if (devices.length === 0) return { stored: true, sent: 0 };

  const messages = devices.map((d) => ({
    to: d.push_token,
    title,
    body,
    data: payload,
    sound: 'default',
    priority: 'high',
  }));

  try {
    const response = await fetch(config.push.expoUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    });

    const result = await response.json();

    // Expo signale les tokens périmés (téléphone réinitialisé, app
    // désinstallée). On les supprime, sinon la table gonfle indéfiniment
    // et chaque envoi traîne des destinataires morts.
    const tickets = result?.data ?? [];
    await Promise.all(
      tickets.map((ticket, i) => {
        if (ticket?.details?.error === 'DeviceNotRegistered') {
          return query('DELETE FROM devices WHERE push_token = $1', [devices[i].push_token]);
        }
        return null;
      })
    );

    await query('UPDATE notifications SET delivered = true WHERE id = $1', [saved[0].id]);
    return { stored: true, sent: tickets.length };
  } catch (error) {
    // Un échec d'envoi ne doit jamais faire échouer l'action métier :
    // un crédit approuvé reste approuvé même si la push ne part pas.
    console.error('[push] Envoi impossible :', error.message);
    return { stored: true, sent: 0, error: error.message };
  }
}

/**
 * Rappels d'échéance, à exécuter une fois par jour (tâche planifiée).
 * L'application programme aussi ses propres rappels locaux ; ceci est
 * la ceinture en plus des bretelles, utile si le client a réinstallé
 * l'app et perdu ses rappels programmés.
 */
export async function sendUpcomingInstallmentReminders(daysAhead = 3) {
  const { rows } = await query(
    `SELECT i.amount, i.due_date, c.user_id
     FROM installments i
     JOIN credit_requests c ON c.id = i.credit_id
     WHERE i.status = 'a_venir'
       AND i.due_date = CURRENT_DATE + $1::int`,
    [daysAhead]
  );

  for (const row of rows) {
    await notifyUser(row.user_id, 'echeance_proche', {
      amount: row.amount,
      dueDate: new Date(row.due_date).toLocaleDateString('fr-FR'),
    });
  }

  return rows.length;
}
