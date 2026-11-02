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
 * Les frais de tenue du mois sont-ils encore à prélever, et la paie
 * est-elle arrivée ?
 *
 * « Nous sommes en novembre et les salaires arrivent, alors mets une
 *   notification chez l'opérateur pour la récupération de tous les
 *   frais de tenue de compte. »
 *
 * La tâche planifiée ne passe que le 25 (décision du 14/10/2026 : au
 * 1er la plupart des comptes sont vides, prélever avant la paie mettait
 * des agents à découvert pour un forfait de 6 500 F). Rien ne disait
 * donc à l'opératrice qu'un prélèvement manuel était attendu plus tôt
 * quand la paie tombe en avance.
 *
 * Le libellé porte l'état de la paie, et c'est le point important : une
 * notification qui dirait seulement « 196 comptes à prélever » dès le
 * 1er du mois pousserait exactement à l'erreur que la décision du 14/10
 * voulait éviter.
 */
async function fetchFraisTenueDuMois() {
  const { rows } = await query(
    `SELECT
       (SELECT count(*)::int FROM accounts a
         JOIN users u ON u.id = a.user_id
        WHERE u.role = 'client' AND u.status = 'actif'
          AND NOT EXISTS (
            SELECT 1 FROM applied_fees af
            JOIN fee_versions fv ON fv.id = af.fee_version_id
            JOIN fee_definitions fd ON fd.id = fv.fee_id
            WHERE af.account_id = a.id AND fd.code = 'FRAIS_TENUE'
              AND af.period_start = date_trunc('month', now())::date
          )) AS restants,
       (SELECT count(*)::int FROM ledger_entries
        WHERE type = 'salaire' AND created_at >= date_trunc('month', now())) AS salaires`
  );
  return { restants: Number(rows[0].restants), salaires: Number(rows[0].salaires) };
}

/**
 * Pose la tâche « frais de tenue » si le mois n'est pas encore prélevé.
 *
 * Deux libellés pour un même compteur, selon que la paie est arrivée ou
 * non : l'opératrice doit savoir si c'est à faire maintenant ou s'il
 * faut attendre les salaires.
 */
async function ajouterFraisTenue(taches) {
  try {
    const { restants, salaires } = await fetchFraisTenueDuMois();
    if (restants === 0) return;

    const mois = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    taches.push({
      cle: 'frais_tenue',
      libelle: salaires > 0
        ? `Frais de tenue de compte à prélever — ${mois}`
        : `Frais de tenue de compte — ${mois}, à prélever après le versement des salaires`,
      nombre: restants,
    });
  } catch {
    // Best effort, comme les autres files.
  }
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
    // Plus de file « points à revalider » : ni un dossier en difficulté
    // ni une demande exceptionnelle n'attendent l'opérateur, la décision
    // du directeur en séance étant définitive pour les deux.
    await add(
      'echeances_en_retard', 'Échéances en retard à relancer',
      `SELECT count(*)::int AS n FROM installments WHERE status = 'en_retard'`
    );
    await ajouterFraisTenue(taches);
  }

  if (role === 'directeur') {
    // Le directeur voit la même tâche : c'est lui qui décide du moment,
    // l'opératrice exécute.
    await ajouterFraisTenue(taches);
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
