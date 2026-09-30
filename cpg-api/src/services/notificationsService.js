/**
 * ═══════════════════════════════════════════════════════════════════
 *  NOTIFICATIONS — tâches en attente et messages non lus, à la connexion
 * ═══════════════════════════════════════════════════════════════════
 *
 * « Il faut des notifications lorsqu'un agent se connecte. Il doit
 *   recevoir les notifications des tâches en attente et aussi les
 *   notifications des messages en attente. »
 *
 * Pas de table dédiée : on interroge directement les files d'attente
 * déjà existantes (déjà utilisées par les écrans de chaque rôle), une
 * par une, chacune filtrée sur le rôle courant — ce qu'un opérateur
 * doit traiter n'est pas ce qu'un directeur doit traiter. Un agent
 * dont le rôle n'a accès à aucune de ces files ne reçoit tout
 * simplement aucune tâche (tableau vide), jamais d'erreur.
 */

import { query } from '../db/index.js';

async function count(sql, params = []) {
  const { rows } = await query(sql, params);
  return Number(rows[0]?.n ?? 0);
}

/**
 * Messages en attente : messages du canal d'équipe ou adressés
 * directement à l'agent, envoyés par quelqu'un d'autre, depuis la
 * dernière fois qu'il a ouvert la messagerie interne (colonne
 * users.messages_internes_vus_at, mise à jour à l'ouverture — voir
 * PATCH /admin/messages-internes/vus). Jamais ouvert = tout compte.
 */
async function fetchUnreadMessagesCount(actorId) {
  return count(
    `SELECT count(*)::int AS n
     FROM staff_messages m
     JOIN users u ON u.id = m.sender_id
     WHERE m.sender_id <> $1
       AND (m.recipient_id = $1 OR m.recipient_id IS NULL)
       AND m.created_at > COALESCE((SELECT messages_internes_vus_at FROM users WHERE id = $1), 'epoch'::timestamptz)`,
    [actorId]
  );
}

/**
 * Tâches en attente, propres à ce que le rôle a réellement à traiter.
 * Chaque entrée : { cle, libelle, nombre }. Une requête qui échoue
 * (permission DB, table absente sur un environnement pas encore migré)
 * ne doit jamais faire tomber les autres — best effort, comme pour le
 * reste des notifications.
 */
async function fetchTasksForRole(role) {
  const taches = [];
  const add = async (cle, libelle, sql, params) => {
    try {
      const n = await count(sql, params);
      if (n > 0) taches.push({ cle, libelle, nombre: n });
    } catch {
      // Best effort : une file indisponible ne doit pas bloquer les autres.
    }
  };

  if (role === 'operateur') {
    await add(
      'demandes_niveau1', 'Demandes à valider (niveau 1)',
      `SELECT count(*)::int AS n FROM credit_requests WHERE status = 'en_verification'`
    );
    await add(
      'double_validation_credits', 'Dossiers de crédit à revalider',
      `SELECT count(*)::int AS n FROM credit_requests WHERE status = 'valide_commission'`
    );
    await add(
      'double_validation_items', 'Dossiers difficulté/exceptionnels à revalider',
      `SELECT count(*)::int AS n FROM commission_items WHERE status = 'valide'`
    );
    await add(
      'echeances_en_retard', 'Échéances en retard à relancer',
      `SELECT count(*)::int AS n FROM installments WHERE status = 'en_retard'`
    );
  }

  if (role === 'superviseur' || role === 'directeur') {
    await add(
      'seance_a_tenir', 'Séance de commission planifiée, non tenue',
      `SELECT count(*)::int AS n FROM commission_sessions WHERE status = 'planifiee' AND scheduled_for <= now()`
    );
  }

  if (role === 'directeur') {
    await add(
      'approbation_finale', 'Crédits en attente d\'approbation finale',
      `SELECT count(*)::int AS n FROM credit_requests WHERE status = 'valide_double'`
    );
    await add(
      'corrections_echeances', 'Corrections d\'échéance à arbitrer',
      `SELECT count(*)::int AS n FROM installment_adjustment_requests WHERE status = 'en_attente'`
    );
    await add(
      'suppressions_credits', 'Suppressions de crédit à confirmer',
      `SELECT count(*)::int AS n FROM credit_deletion_requests WHERE status = 'en_attente'`
    );
    await add(
      'suppressions_items', 'Suppressions (difficulté/exceptionnelle) à confirmer',
      `SELECT count(*)::int AS n FROM commission_item_deletion_requests WHERE status = 'en_attente'`
    );
    await add(
      'caisse_operations', 'Retraits et réapprovisionnements à valider',
      `SELECT count(*)::int AS n FROM caisse_operations WHERE statut = 'en_attente'`
    );
  }

  return taches;
}

export async function fetchNotifications({ actorId, role }) {
  const [taches, messagesEnAttente] = await Promise.all([
    fetchTasksForRole(role),
    fetchUnreadMessagesCount(actorId).catch(() => 0),
  ]);
  const totalTaches = taches.reduce((sum, t) => sum + t.nombre, 0);
  return { taches, totalTaches, messagesEnAttente };
}

export async function markMessagesInternesVus(actorId) {
  await query(`UPDATE users SET messages_internes_vus_at = now() WHERE id = $1`, [actorId]);
}
