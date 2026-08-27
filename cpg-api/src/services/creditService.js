/**
 * Calculs de crédit.
 *
 * Le barème appliqué ici doit être celui validé par la direction de CPG
 * et affiché au client. Toute divergence entre la simulation de
 * l'application et le montant réellement prélevé est un litige.
 */

export const DEFAULT_MONTHLY_RATE = 0.015; // 1,5 %/mois — à confirmer par CPG

/**
 * Intérêt simple : total = capital × (1 + taux × durée).
 * Formule volontairement lisible ; si CPG applique un amortissement
 * dégressif, c'est ici et seulement ici qu'il faut la remplacer.
 *
 * @returns {{ monthlyPayment: number, totalDue: number, totalInterest: number }}
 */
export function computeSchedule(amount, durationMonths, monthlyRate = DEFAULT_MONTHLY_RATE) {
  const totalDue = Math.round(amount * (1 + monthlyRate * durationMonths));
  const monthlyPayment = Math.ceil(totalDue / durationMonths);

  return {
    monthlyPayment,
    totalDue,
    totalInterest: totalDue - amount,
  };
}

/** Génère les dates d'échéance, une par mois à compter du déblocage. */
export function buildInstallments(startDate, durationMonths, monthlyPayment, totalDue) {
  const installments = [];
  let remaining = totalDue;

  for (let i = 1; i <= durationMonths; i += 1) {
    const due = new Date(startDate);
    due.setMonth(due.getMonth() + i);

    // La dernière échéance absorbe l'arrondi, pour que la somme des
    // mensualités soit exactement égale au total dû. Sans cela, le
    // client reste débiteur de quelques francs après son dernier paiement.
    const amount = i === durationMonths ? remaining : monthlyPayment;
    remaining -= amount;

    installments.push({ sequence: i, dueDate: due, amount });
  }

  return installments;
}

/**
 * Frais de dossier : part fixe + pourcentage du capital, tels que
 * définis par la version de produit signée.
 */
export function computeFileFee(amount, { fileFeeFixed = 0, fileFeeRate = 0 } = {}) {
  return Math.round(Number(fileFeeFixed) + Number(amount) * Number(fileFeeRate));
}

/**
 * Coût total pour le client : capital + intérêts + frais de dossier.
 * C'est ce montant qu'il faut afficher à la simulation. N'annoncer que
 * la mensualité laisse le client découvrir les frais à la signature,
 * ce qui est la première source de litige sur un microcrédit.
 */
export function computeTotalCost(amount, durationMonths, monthlyRate, feeScale = {}) {
  const { monthlyPayment, totalDue, totalInterest } = computeSchedule(
    amount,
    durationMonths,
    monthlyRate
  );
  const fileFee = computeFileFee(amount, feeScale);

  return {
    monthlyPayment,
    totalDue,
    totalInterest,
    fileFee,
    totalCost: totalDue + fileFee,
    netReceived: amount - fileFee,
  };
}

/** Référence lisible par les conseillers : CPG-4471. */
export function generateReference(prefix = 'CPG') {
  return `${prefix}-${Math.floor(1000 + Math.random() * 9000)}`;
}
