/**
 * ═══════════════════════════════════════════════════════════════════
 *  VERSIONNEMENT DES BARÈMES ET MARGES DÉLÉGUÉES — logique pure
 * ═══════════════════════════════════════════════════════════════════
 *
 * Aucun import : testable sans base de données.
 *
 * Qui peut changer quoi, et jusqu'où :
 *
 *   GESTIONNAIRE   ajuste librement dans la marge déléguée par la
 *                  direction (par défaut ±20 % relatif du taux en
 *                  vigueur). Au-delà, il propose et attend l'aval.
 *
 *   DIRECTEUR      fixe n'importe quel taux sous le plafond
 *                  réglementaire, active et suspend les produits,
 *                  tranche les demandes du gestionnaire.
 *
 * Personne, pas même le directeur, ne dépasse le plafond enregistré
 * dans `rate_ceilings`. C'est le garde-fou contre l'erreur de saisie :
 * un zéro de trop transforme 1,5 %/mois en 15 %/mois, et aucune
 * relecture humaine ne rattrape cela après signature.
 */

/** Marge d'ajustement déléguée au gestionnaire, en relatif. */
export const DELEGATION_MARGIN = 0.20;

export class RateError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
    this.status = 422;
  }
}

/**
 * Sélectionne la version applicable à une date donnée.
 *
 * Sert à deux choses : connaître le barème du jour, et surtout
 * retrouver celui qui était en vigueur le jour où un crédit a été
 * signé — indispensable pour justifier une mensualité six mois plus
 * tard.
 */
export function resolveVersionAt(versions, date = new Date()) {
  const target = new Date(date).getTime();

  const applicable = (versions ?? []).filter((v) => {
    const from = new Date(v.effective_from ?? v.effectiveFrom).getTime();
    const toRaw = v.effective_to ?? v.effectiveTo ?? null;
    const to = toRaw ? new Date(toRaw).getTime() : Infinity;
    return from <= target && target < to;
  });

  if (applicable.length === 0) return null;

  // En cas de chevauchement (ne devrait pas arriver, l'index unique
  // l'empêche côté base), on prend la plus récemment entrée en vigueur.
  return applicable.sort(
    (a, b) =>
      new Date(b.effective_from ?? b.effectiveFrom) - new Date(a.effective_from ?? a.effectiveFrom)
  )[0];
}

/**
 * Un gestionnaire peut-il appliquer ce taux sans l'aval du directeur ?
 *
 * @param {number} currentRate taux en vigueur
 * @param {number} proposedRate taux souhaité
 * @param {number} margin marge relative déléguée
 */
export function isWithinDelegation(currentRate, proposedRate, margin = DELEGATION_MARGIN) {
  if (currentRate === 0) return proposedRate === 0;

  const relativeChange = Math.abs(proposedRate - currentRate) / currentRate;
  return relativeChange <= margin + 1e-9;
}

/**
 * Vérifie qu'un barème proposé est cohérent et sous le plafond.
 * Lève une RateError explicite plutôt que de renvoyer un booléen :
 * le message doit pouvoir être affiché tel quel au gestionnaire.
 */
export function validateProductScale(scale, ceiling) {
  const {
    monthlyRate, minAmount, maxAmount, minDuration, maxDuration,
    fileFeeRate = 0, latePenaltyRate = 0,
  } = scale;

  if (!Number.isFinite(monthlyRate) || monthlyRate < 0) {
    throw new RateError('Le taux mensuel doit être un nombre positif.', 'taux_invalide');
  }

  if (ceiling !== undefined && ceiling !== null && monthlyRate > ceiling) {
    throw new RateError(
      `Le taux mensuel demandé (${(monthlyRate * 100).toFixed(2)} %) dépasse le plafond autorisé de ${(ceiling * 100).toFixed(2)} %.`,
      'plafond_depasse'
    );
  }

  if (minAmount <= 0) {
    throw new RateError('Le montant minimum doit être supérieur à zéro.', 'montant_invalide');
  }
  if (maxAmount < minAmount) {
    throw new RateError('Le montant maximum ne peut pas être inférieur au minimum.', 'bornes_incoherentes');
  }
  if (minDuration < 1) {
    throw new RateError('La durée minimale est de un mois.', 'duree_invalide');
  }
  if (maxDuration < minDuration) {
    throw new RateError('La durée maximale ne peut pas être inférieure à la durée minimale.', 'bornes_incoherentes');
  }
  if (fileFeeRate < 0 || latePenaltyRate < 0) {
    throw new RateError('Les taux de frais ne peuvent pas être négatifs.', 'taux_invalide');
  }

  return true;
}

/**
 * Vérifie qu'un montant et une durée entrent dans les bornes du produit.
 * Appelé à la simulation ET à la demande : simuler hors bornes puis
 * réussir à déposer la demande serait incohérent pour le client.
 */
export function validateAgainstScale(amount, duration, scale) {
  if (amount < scale.min_amount || amount > scale.max_amount) {
    throw new RateError(
      `Ce produit accepte des montants de ${scale.min_amount} à ${scale.max_amount} FCFA.`,
      'hors_bornes_montant'
    );
  }
  if (duration < scale.min_duration || duration > scale.max_duration) {
    throw new RateError(
      `Ce produit accepte des durées de ${scale.min_duration} à ${scale.max_duration} mois.`,
      'hors_bornes_duree'
    );
  }
  return true;
}

/** Décide de la suite à donner à un changement de barème. */
export function classifyRateChange({ role, currentRate, proposedRate, ceiling, margin }) {
  if (ceiling !== undefined && ceiling !== null && proposedRate > ceiling) {
    return { outcome: 'refus', reason: 'plafond_depasse' };
  }

  if (role === 'directeur' || role === 'admin') {
    return { outcome: 'applique', reason: 'autorite_directeur' };
  }

  if (role !== 'superviseur') {
    return { outcome: 'refus', reason: 'role_insuffisant' };
  }

  return isWithinDelegation(currentRate, proposedRate, margin)
    ? { outcome: 'applique', reason: 'dans_la_marge_deleguee' }
    : { outcome: 'a_valider', reason: 'hors_marge_deleguee' };
}
