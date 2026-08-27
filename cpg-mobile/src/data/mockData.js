/**
 * Données de démonstration.
 * Chaque export ici correspond à un futur appel au backend CPG.
 * Remplacer par des appels réseau ne devrait toucher que ce fichier
 * et src/api/, pas les écrans.
 */

export const account = {
  holder: 'Jean-Paul Ndong',
  job: 'Agent de la voie · SETRAG',
  clientNumber: 'CPG-00931',
  memberSince: 2022,
  balance: 412500,
};

export const activeLoan = {
  ref: 'CPG-4471',
  initialAmount: 500000,
  remaining: 320000,
  monthlyPayment: 45000,
  totalMonths: 12,
  paidMonths: 5,
  nextDueDate: '30 août',
};

export const transactions = [
  { id: '1', label: 'Paiement mensualité crédit', date: '22 août', amount: -45000 },
  { id: '2', label: 'Dépôt Airtel Money', date: '20 août', amount: 120000 },
  { id: '3', label: 'Retrait agence Owendo', date: '17 août', amount: -30000 },
  { id: '4', label: 'Virement salaire SETRAG', date: '14 août', amount: 380000 },
  { id: '5', label: 'Paiement mensualité crédit', date: '22 juillet', amount: -45000 },
  { id: '6', label: 'Dépôt Moov Money', date: '11 juillet', amount: 60000 },
];

export const notifications = [
  {
    id: 'n1',
    icon: 'credit-card',
    title: 'Échéance à venir',
    body: 'Votre mensualité de 45 000 FCFA sera prélevée le 30 août.',
  },
  {
    id: 'n2',
    icon: 'arrow-down-left',
    title: 'Dépôt confirmé',
    body: '120 000 FCFA reçus via Airtel Money.',
  },
  {
    id: 'n3',
    icon: 'message-circle',
    title: 'Message de votre conseillère',
    body: 'Sylvie M. vous a répondu.',
  },
];

export const initialMessages = [
  {
    id: 'm1',
    from: 'advisor',
    text: 'Bonjour Jean-Paul, je suis Sylvie, votre conseillère CPG. Comment puis-je vous aider ?',
  },
  { id: 'm2', from: 'me', text: 'Bonjour, je voudrais savoir où en est ma demande de crédit.' },
  {
    id: 'm3',
    from: 'advisor',
    text: 'Votre dossier #CPG-4471 est en cours de validation finale, réponse sous 24h.',
  },
];

/** Taux indicatif utilisé par le simulateur. À aligner sur le barème réel CPG. */
export const MONTHLY_RATE = 0.015;
