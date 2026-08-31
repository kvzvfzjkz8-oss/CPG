import { initiateMomoTransaction, fetchMomoTransaction } from './clientApi';

/**
 * Habillage de lecture au-dessus de clientApi.js (qui appelle le vrai
 * backend CPG) : les noms « dépôt / retrait » sont plus clairs dans
 * l'écran Mobile Money que le vocabulaire « entrant / sortant » du
 * serveur. Toute la vraie logique (écriture en base, bascule Airtel
 * automatique dès que les identifiants marchands sont configurés) vit
 * côté serveur — voir src/services/mobileMoneyService.js dans cpg-api.
 */

export const OPERATORS = [
  { id: 'airtel', label: 'Airtel Money' },
  { id: 'moov', label: 'Moov Money' },
];

/** @param {{ operator: string, amount: number, phone: string }} params */
export async function requestDeposit({ operator, amount, phone }) {
  const data = await initiateMomoTransaction({
    operateur: operator, sens: 'entrant', montant: amount, telephone: phone,
  });
  return { reference: data.reference, status: data.statut, amount, operator };
}

/** @param {{ operator: string, amount: number, phone: string }} params */
export async function requestWithdrawal({ operator, amount, phone }) {
  const data = await initiateMomoTransaction({
    operateur: operator, sens: 'sortant', montant: amount, telephone: phone,
  });
  return { reference: data.reference, status: data.statut, amount, operator };
}

/** @param {string} reference */
export async function getTransactionStatus(reference) {
  return fetchMomoTransaction(reference);
}
