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
/**
 * `n` mois après une date, renvoyé à midi UTC.
 *
 * Deux pièges de dates, tous les deux déjà rencontrés dans ce projet :
 *
 *   • `new Date('2026-01-31').setMonth(+1)` donne le 3 mars : février
 *     n'a pas de 31e jour, et JavaScript reporte sur le mois suivant au
 *     lieu de s'arrêter au dernier jour. Une échéance du 31 janvier
 *     sautait donc février entièrement. On borne au dernier jour du
 *     mois visé.
 *
 *   • la date renvoyée est fixée à MIDI UTC. `due_date` est une colonne
 *     DATE : une date à minuit heure locale (UTC+1 au Gabon) devient la
 *     veille après conversion en UTC, et l'échéance se retrouve datée
 *     d'un jour plus tôt. C'est le même défaut qui avait fait prélever
 *     le mauvais mois sur les frais ponctuels. À midi, aucun fuseau
 *     plausible ne fait changer le jour.
 *
 * `depuis` accepte une chaîne « AAAA-MM-JJ » — lue comme un jour
 * calendaire, sans fuseau — ou un objet Date, dont on prend le jour
 * local : c'est ce que faisait l'ancien calcul pour `new Date()`, et
 * changer cela aurait décalé les crédits approuvés avant 1 h du matin.
 */
function moisApres(depuis, n) {
  let annee;
  let mois;
  let jour;

  if (typeof depuis === 'string') {
    [annee, mois, jour] = depuis.split('-').map(Number);
    mois -= 1;
  } else {
    const d = new Date(depuis);
    annee = d.getFullYear();
    mois = d.getMonth();
    jour = d.getDate();
  }

  const dernierJour = new Date(Date.UTC(annee, mois + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(annee, mois + n, Math.min(jour, dernierJour), 12));
}

export function buildInstallments(
  startDate, durationMonths, monthlyPayment, totalDue, premiereEcheance = null
) {
  const installments = [];
  let remaining = totalDue;

  for (let i = 1; i <= durationMonths; i += 1) {
    // `premiereEcheance` vient de la séance de commission : le
    // directeur fixe la date du premier prélèvement pour tout ce qui y
    // est validé. Sans elle, l'échéancier part de la date
    // d'approbation + 1 mois — ce qui a obligé à redater à la main les
    // 25 dossiers du 23/10/2026, leur première échéance tombant au 23
    // novembre alors que la direction voulait le 3.
    const due = premiereEcheance
      ? moisApres(premiereEcheance, i - 1)
      : moisApres(startDate, i);

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

/**
 * Une référence de dossier qui n'existe pas déjà.
 *
 * `generateReference()` tire au hasard parmi 9 000 valeurs — CPG-1000 à
 * CPG-9999. Avec 253 dossiers en production au 04/11/2026, 2,8 % des
 * demandes tombaient sur une référence déjà prise et échouaient sur la
 * contrainte d'unicité, avec un message incompréhensible pour le
 * gestionnaire : « Cette entrée existe déjà. » La proportion monte à
 * chaque dossier accordé.
 *
 * On vérifie donc avant d'insérer, et on élargit à six chiffres après
 * quelques essais : 900 000 valeurs au lieu de 9 000. Le format court
 * reste privilégié pour que les références déjà imprimées sur les
 * contrats gardent la même allure.
 *
 * Reste une course possible entre deux demandes simultanées ; la
 * contrainte d'unicité en base demeure le dernier mot, et c'est bien
 * ainsi — mais elle ne sera plus atteinte qu'exceptionnellement.
 */
export async function genererReferenceUnique(run, prefix = 'CPG') {
  for (let essai = 0; essai < 12; essai += 1) {
    const reference = essai < 8
      ? generateReference(prefix)
      : `${prefix}-${Math.floor(100000 + Math.random() * 900000)}`;
    const { rows } = await run(
      'SELECT 1 FROM credit_requests WHERE reference = $1',
      [reference]
    );
    if (!rows[0]) return reference;
  }
  // Douze tirages infructueux : on ne boucle pas indéfiniment, et un
  // suffixe horodaté est unique par construction.
  return `${prefix}-${Date.now().toString().slice(-7)}`;
}
