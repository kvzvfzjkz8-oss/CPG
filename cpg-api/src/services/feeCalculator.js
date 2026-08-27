/**
 * ═══════════════════════════════════════════════════════════════════
 *  CALCUL DES FRAIS ET AGIOS — logique pure
 * ═══════════════════════════════════════════════════════════════════
 *
 * Ce fichier n'importe rien : ni base de données, ni configuration.
 * C'est délibéré. Le calcul des frais est la partie du système où une
 * erreur coûte de l'argent réel à des clients, donc elle doit être
 * testable en isolation, sans PostgreSQL ni serveur.
 *
 * Tout est en francs CFA entiers. Aucun flottant n'est conservé : les
 * arrondis sont explicites et faits au dernier moment.
 */

export const FEE_BASIS = {
  FIXE: 'fixe',
  POURCENTAGE: 'pourcentage',
  JOURNALIER_SOLDE: 'journalier_solde',
};

/**
 * Applique les bornes d'une version de frais à un montant brut.
 *
 * Ordre : exonération, puis plancher, puis plafond. Cet ordre compte —
 * si on appliquait le plancher avant l'exonération, un compte censé
 * être exonéré paierait quand même le minimum.
 */
export function applyBounds(rawAmount, { minAmount = 0, maxAmount = null, exemptBelow = 0 } = {}, basisValue = 0) {
  if (exemptBelow > 0 && basisValue < exemptBelow) return 0;

  let amount = Math.round(rawAmount);
  if (amount <= 0) return 0;

  if (minAmount > 0) amount = Math.max(amount, minAmount);
  if (maxAmount !== null && maxAmount !== undefined) amount = Math.min(amount, maxAmount);

  return amount;
}

/**
 * Calcule un frais ponctuel (retrait, dépôt, transfert, tenue de compte).
 *
 * @param {object} version version de frais { basis, amount, rate, minAmount, maxAmount, exemptBelow }
 * @param {number} operationAmount montant de l'opération, en FCFA
 * @returns {number} frais en FCFA
 */
export function computeFee(version, operationAmount = 0) {
  if (!version) return 0;

  const bounds = {
    minAmount: version.minAmount ?? version.min_amount ?? 0,
    maxAmount: version.maxAmount ?? version.max_amount ?? null,
    exemptBelow: version.exemptBelow ?? version.exempt_below ?? 0,
  };

  const basis = version.basis;
  const rate = Number(version.rate ?? 0);
  const fixed = Number(version.amount ?? 0);

  if (basis === FEE_BASIS.FIXE) {
    return applyBounds(fixed, bounds, operationAmount);
  }

  if (basis === FEE_BASIS.POURCENTAGE) {
    return applyBounds(operationAmount * rate, bounds, operationAmount);
  }

  // Le calcul journalier ne se fait pas ici : il a besoin d'une période
  // entière de soldes. Voir computeAgios().
  return 0;
}

/**
 * ─────────────────────────────────────────────────────────────────
 *  AGIOS SUR SOLDE DÉBITEUR
 * ─────────────────────────────────────────────────────────────────
 *
 * Les agios se calculent sur les soldes JOURNALIERS, jamais sur le
 * solde de fin de mois. La différence n'est pas cosmétique :
 *
 *   Un client à −200 000 FCFA pendant 29 jours qui remet son compte
 *   à zéro la veille de l'arrêté paie zéro agios si l'on regarde le
 *   solde final. Il en doit près d'un mois si l'on regarde chaque jour.
 *
 * L'inverse est vrai aussi : un découvert d'un seul jour ne doit pas
 * être facturé comme un mois entier. Le calcul jour par jour est le
 * seul qui soit défendable devant un client comme devant un contrôleur.
 *
 * @param {Array<{date: string|Date, balance: number}>} dailyBalances soldes de chaque jour
 * @param {object} version version de frais { rate, minAmount, maxAmount, exemptBelow }
 * @returns {{ amount: number, debitDays: number, totalDebitBalance: number, detail: Array }}
 */
export function computeAgios(dailyBalances, version) {
  if (!Array.isArray(dailyBalances) || dailyBalances.length === 0 || !version) {
    return { amount: 0, debitDays: 0, totalDebitBalance: 0, detail: [] };
  }

  const rate = Number(version.rate ?? 0);
  const exemptBelow = version.exemptBelow ?? version.exempt_below ?? 0;

  let accrued = 0;
  let debitDays = 0;
  let totalDebitBalance = 0;
  const detail = [];

  for (const day of dailyBalances) {
    const balance = Number(day.balance);

    // Seuls les soldes négatifs génèrent des agios.
    if (balance >= 0) continue;

    const debit = Math.abs(balance);

    // Franchise : un petit découvert accidentel de quelques centaines
    // de francs ne se facture pas. Le seuil est paramétrable par le
    // gestionnaire, pas codé en dur.
    if (exemptBelow > 0 && debit < exemptBelow) continue;

    const dayCharge = debit * rate;
    accrued += dayCharge;
    debitDays += 1;
    totalDebitBalance += debit;

    detail.push({
      date: typeof day.date === 'string' ? day.date : day.date.toISOString().slice(0, 10),
      balance,
      charge: dayCharge,
    });
  }

  // Arrondi une seule fois, à la fin. Arrondir chaque jour puis
  // additionner introduit un écart qui grandit avec la durée.
  const bounds = {
    minAmount: version.minAmount ?? version.min_amount ?? 0,
    maxAmount: version.maxAmount ?? version.max_amount ?? null,
    exemptBelow: 0, // franchise déjà appliquée jour par jour
  };

  const amount = accrued > 0 ? applyBounds(accrued, bounds, accrued) : 0;

  return { amount, debitDays, totalDebitBalance, detail };
}

/**
 * Reconstitue le solde de chaque jour d'une période à partir du solde
 * d'ouverture et des écritures.
 *
 * Les jours sans mouvement comptent : un découvert du 3 au 20 se
 * facture sur dix-huit jours, même si aucune opération n'a eu lieu
 * entre-temps.
 *
 * @param {number} openingBalance solde la veille de periodStart
 * @param {Array<{created_at: string|Date, amount: number}>} entries écritures de la période
 * @param {Date|string} periodStart
 * @param {Date|string} periodEnd inclus
 */
export function buildDailyBalances(openingBalance, entries, periodStart, periodEnd) {
  const start = new Date(periodStart);
  const end = new Date(periodEnd);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  if (end < start) return [];

  const movementsByDay = new Map();
  for (const entry of entries ?? []) {
    const key = new Date(entry.created_at).toISOString().slice(0, 10);
    movementsByDay.set(key, (movementsByDay.get(key) ?? 0) + Number(entry.amount));
  }

  const balances = [];
  let running = Number(openingBalance);

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    running += movementsByDay.get(key) ?? 0;
    balances.push({ date: key, balance: running });
  }

  return balances;
}

/**
 * Pénalité de retard sur une échéance impayée.
 * Prorata des jours de retard, pour éviter qu'un retard d'un jour
 * coûte autant qu'un retard d'un mois.
 */
export function computeLatePenalty(installmentAmount, daysLate, monthlyPenaltyRate) {
  if (daysLate <= 0 || monthlyPenaltyRate <= 0) return 0;
  return Math.round(installmentAmount * monthlyPenaltyRate * (daysLate / 30));
}
