/**
 * Fonctions pures de l'adaptateur Airtel — aucun import.
 *
 * Séparées volontairement de airtelMoney.js, qui charge la
 * configuration et ne peut donc pas être importé dans un test unitaire
 * sans base ni variables d'environnement. Ces deux fonctions portent
 * la logique qui casse silencieusement en production : elles doivent
 * être testables seules.
 */

/**
 * Airtel attend le numéro NATIONAL, sans indicatif pays.
 * Envoyer « +24106000001 » au lieu de « 06000001 » fait échouer la
 * transaction avec une erreur peu explicite.
 */
export function normalizeMsisdn(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return digits.startsWith('241') ? digits.slice(3) : digits;
}

/**
 * Traduit les statuts Airtel vers les nôtres.
 *
 * Règle prudente : tout statut inconnu devient « en attente », jamais
 * « confirmée ». Créditer un compte sur un statut mal interprété
 * donnerait de l'argent qui n'est jamais arrivé.
 */
export function mapStatus(airtelStatus) {
  const code = String(airtelStatus ?? '').toUpperCase();

  if (['TS', 'SUCCESS', 'SUCCESSFUL', 'COMPLETED'].includes(code)) return 'confirmee';
  if (['TF', 'FAILED', 'FAILURE', 'REJECTED'].includes(code)) return 'echouee';
  if (['TA', 'TIP', 'PENDING', 'IN_PROGRESS'].includes(code)) return 'en_attente';

  return 'en_attente';
}
