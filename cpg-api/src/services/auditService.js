import { query } from '../db/index.js';

/**
 * Journal d'audit — exigence réglementaire.
 *
 * On doit pouvoir répondre à « qui a approuvé ce crédit, quand, depuis
 * quelle adresse ». La table est en ajout seul : aucune route n'expose
 * de suppression, et le compte applicatif PostgreSQL ne devrait pas
 * avoir le droit DELETE dessus.
 *
 * À tracer systématiquement : décisions de crédit, gestion des
 * utilisateurs, consultation de données client par un employé,
 * connexions et échecs de connexion.
 */
export async function audit(req, { action, entityType, entityId, metadata = {} }) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() ?? req.ip;

  await query(
    `INSERT INTO audit_log (actor_id, actor_role, action, entity_type, entity_id, metadata, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      req.user?.id ?? null,
      req.user?.role ?? null,
      action,
      entityType ?? null,
      entityId ? String(entityId) : null,
      metadata,
      ip ?? null,
    ]
  );
}

/**
 * Variante de audit() pour les actions déclenchées sans requête HTTP —
 * les tâches planifiées (prélèvement automatique des échéances et des
 * agios). Le compte technique agit sous sa propre identité pour rester
 * traçable dans le journal exactement comme s'il avait appelé la route
 * à la main ; il n'y a pas d'adresse IP à enregistrer puisqu'il n'y a
 * pas de requête.
 */
export async function auditAutomated({ actorId, actorRole, action, entityType, entityId, metadata = {} }) {
  await query(
    `INSERT INTO audit_log (actor_id, actor_role, action, entity_type, entity_id, metadata, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, NULL)`,
    [
      actorId ?? null,
      actorRole ?? null,
      action,
      entityType ?? null,
      entityId ? String(entityId) : null,
      metadata,
    ]
  );
}
