import { query, withTransaction } from '../db/index.js';
import {
  validateProductScale,
  classifyRateChange,
  RateError,
} from '../utils/rateVersioning.js';

/**
 * ═══════════════════════════════════════════════════════════════════
 *  CATALOGUE DES PRODUITS DE CRÉDIT
 * ═══════════════════════════════════════════════════════════════════
 *
 * Règle qui gouverne tout ce fichier : on ne modifie jamais un barème
 * sur place. Changer un taux clôture la version en cours et en ouvre
 * une nouvelle. Les crédits déjà signés pointent vers leur version
 * d'origine et gardent donc leur taux jusqu'à leur terme.
 */

/** Plafond réglementaire applicable à un périmètre donné. */
export async function getCeiling(scope) {
  const { rows } = await query('SELECT max_rate FROM rate_ceilings WHERE scope = $1', [scope]);
  return rows[0] ? Number(rows[0].max_rate) : null;
}

/** Produits proposables aux clients : actifs uniquement. */
export async function listActiveProducts() {
  const { rows } = await query(
    `SELECT * FROM current_product_versions WHERE status = 'actif' ORDER BY name`
  );
  return rows;
}

/** Catalogue complet, y compris brouillons et suspendus. */
export async function listAllProducts() {
  const { rows } = await query(
    `SELECT p.id, p.code, p.name, p.description, p.status, p.created_at, p.activated_at,
            v.id AS version_id, v.version, v.monthly_rate, v.min_amount, v.max_amount,
            v.min_duration, v.max_duration, v.file_fee_fixed, v.file_fee_rate,
            v.late_penalty_rate, v.effective_from
     FROM credit_products p
     LEFT JOIN product_versions v ON v.product_id = p.id AND v.effective_to IS NULL
     ORDER BY p.created_at DESC`
  );
  return rows;
}

/** Historique complet des barèmes d'un produit. */
export async function getProductHistory(productId) {
  const { rows } = await query(
    `SELECT v.*, u.full_name AS cree_par, a.full_name AS approuve_par
     FROM product_versions v
     LEFT JOIN users u ON u.id = v.created_by
     LEFT JOIN users a ON a.id = v.approved_by
     WHERE v.product_id = $1
     ORDER BY v.version DESC`,
    [productId]
  );
  return rows;
}

/**
 * Crée un produit avec sa première version de barème.
 * Le produit naît en brouillon : il faut une activation explicite par
 * le directeur pour qu'il soit proposé aux clients.
 */
export async function createProduct({ code, name, description, scale, actorId }) {
  const ceiling = await getCeiling('credit_monthly');
  validateProductScale(scale, ceiling);

  return withTransaction(async (client) => {
    const { rows: product } = await client.query(
      `INSERT INTO credit_products (code, name, description, status, created_by)
       VALUES ($1, $2, $3, 'brouillon', $4)
       RETURNING id, code, name, status`,
      [code, name, description ?? null, actorId]
    );

    const { rows: version } = await client.query(
      `INSERT INTO product_versions
         (product_id, version, monthly_rate, min_amount, max_amount, min_duration, max_duration,
          file_fee_fixed, file_fee_rate, late_penalty_rate, created_by, note)
       VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'Barème initial')
       RETURNING *`,
      [
        product[0].id,
        scale.monthlyRate,
        scale.minAmount,
        scale.maxAmount,
        scale.minDuration,
        scale.maxDuration,
        scale.fileFeeFixed ?? 0,
        scale.fileFeeRate ?? 0,
        scale.latePenaltyRate ?? 0,
        actorId,
      ]
    );

    return { product: product[0], version: version[0] };
  });
}

/**
 * Applique un nouveau barème : clôture la version courante et en crée
 * une suivante. Ne touche à aucun crédit existant.
 */
export async function applyNewVersion({ productId, scale, actorId, approvedBy = null, note }) {
  const ceiling = await getCeiling('credit_monthly');
  validateProductScale(scale, ceiling);

  return withTransaction(async (client) => {
    // FOR UPDATE : si deux gestionnaires modifient le même produit en
    // même temps, le second attend et repart du barème réellement à
    // jour, au lieu d'écraser le travail du premier.
    const { rows: current } = await client.query(
      `SELECT * FROM product_versions
       WHERE product_id = $1 AND effective_to IS NULL
       FOR UPDATE`,
      [productId]
    );

    if (!current[0]) throw new RateError('Ce produit n’a pas de barème en vigueur.', 'sans_version');

    const now = new Date();

    await client.query('UPDATE product_versions SET effective_to = $2 WHERE id = $1', [
      current[0].id,
      now,
    ]);

    const { rows: created } = await client.query(
      `INSERT INTO product_versions
         (product_id, version, monthly_rate, min_amount, max_amount, min_duration, max_duration,
          file_fee_fixed, file_fee_rate, late_penalty_rate, effective_from,
          created_by, approved_by, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [
        productId,
        current[0].version + 1,
        scale.monthlyRate,
        scale.minAmount,
        scale.maxAmount,
        scale.minDuration,
        scale.maxDuration,
        scale.fileFeeFixed ?? 0,
        scale.fileFeeRate ?? 0,
        scale.latePenaltyRate ?? 0,
        now,
        actorId,
        approvedBy,
        note ?? null,
      ]
    );

    return { previous: current[0], created: created[0] };
  });
}

/**
 * Point d'entrée du gestionnaire pour changer un taux.
 *
 * Selon son rôle et l'ampleur du changement, le barème est appliqué
 * directement ou transformé en demande soumise au directeur.
 */
export async function requestScaleChange({ productId, scale, actor, reason }) {
  const ceiling = await getCeiling('credit_monthly');
  validateProductScale(scale, ceiling);

  const { rows } = await query(
    'SELECT monthly_rate FROM product_versions WHERE product_id = $1 AND effective_to IS NULL',
    [productId]
  );
  if (!rows[0]) throw new RateError('Produit introuvable ou sans barème.', 'sans_version');

  const currentRate = Number(rows[0].monthly_rate);
  const decision = classifyRateChange({
    role: actor.role,
    currentRate,
    proposedRate: scale.monthlyRate,
    ceiling,
  });

  if (decision.outcome === 'refus') {
    throw new RateError(
      decision.reason === 'plafond_depasse'
        ? 'Ce taux dépasse le plafond réglementaire enregistré.'
        : 'Votre poste ne permet pas de modifier les barèmes.',
      decision.reason
    );
  }

  if (decision.outcome === 'applique') {
    const result = await applyNewVersion({
      productId,
      scale,
      actorId: actor.id,
      approvedBy: actor.role === 'directeur' || actor.role === 'admin' ? actor.id : null,
      note: reason,
    });
    return { statut: 'applique', motif: decision.reason, version: result.created };
  }

  // Hors marge déléguée : on enregistre une demande, on n'applique rien.
  const { rows: request } = await query(
    `INSERT INTO rate_change_requests (target_type, target_id, payload, reason, requested_by)
     VALUES ('produit', $1, $2, $3, $4)
     RETURNING id, status, requested_at`,
    [productId, scale, reason, actor.id]
  );

  return {
    statut: 'a_valider',
    motif: decision.reason,
    demande: request[0],
    message: 'Ce changement dépasse votre marge déléguée. Il attend la validation du directeur.',
  };
}

/** Décision du directeur sur une demande de changement de barème. */
export async function decideChangeRequest({ requestId, approve, actor, note }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT * FROM rate_change_requests WHERE id = $1 FOR UPDATE',
      [requestId]
    );
    const request = rows[0];

    if (!request) throw new RateError('Demande introuvable.', 'introuvable');
    if (request.status !== 'en_attente') {
      throw new RateError('Cette demande a déjà été traitée.', 'deja_traitee');
    }

    // Séparation des tâches : on ne valide pas sa propre proposition.
    // La contrainte existe aussi en base ; la vérifier ici permet un
    // message clair plutôt qu'une erreur SQL brute.
    if (request.requested_by === actor.id) {
      throw new RateError(
        'Vous ne pouvez pas valider votre propre proposition de barème.',
        'auto_validation'
      );
    }

    await client.query(
      `UPDATE rate_change_requests
       SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4
       WHERE id = $1`,
      [requestId, approve ? 'approuve' : 'rejete', actor.id, note ?? null]
    );

    if (!approve) return { statut: 'rejete', targetType: request.target_type };

    return {
      statut: 'approuve',
      targetType: request.target_type,
      targetId: request.target_id,
      payload: request.payload,
    };
  });
}

/** Activation ou suspension d'un produit — réservé au directeur. */
export async function setProductStatus({ productId, status, actorId }) {
  // Casts explicites sur $2 : sans eux, Postgres ne peut pas concilier
  // son usage comme valeur de l'enum product_status (SET status = $2)
  // et comme texte comparé dans les CASE WHEN, et rejette la requête
  // avec « inconsistent types deduced for parameter $2 ».
  const { rows } = await query(
    `UPDATE credit_products
     SET status = $2::product_status,
         activated_by = CASE WHEN $2::text = 'actif' THEN $3 ELSE activated_by END,
         activated_at = CASE WHEN $2::text = 'actif' THEN now() ELSE activated_at END
     WHERE id = $1
     RETURNING id, code, name, status`,
    [productId, status, actorId]
  );

  if (!rows[0]) throw new RateError('Produit introuvable.', 'introuvable');
  return rows[0];
}

/**
 * Barème à appliquer à une nouvelle demande.
 * Refuse les produits non actifs : un brouillon mal réglé ne doit
 * jamais servir de base à un contrat.
 */
export async function getActiveScale(productId) {
  const { rows } = await query(
    `SELECT * FROM current_product_versions WHERE product_id = $1 AND status = 'actif'`,
    [productId]
  );
  return rows[0] ?? null;
}
