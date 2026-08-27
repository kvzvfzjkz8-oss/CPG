/**
 * Données de démonstration du back-office.
 * Chaque export correspond à un futur endpoint du backend CPG.
 */

export const STATUTS = {
  EN_VERIFICATION: 'en_verification',
  VALIDE_NIVEAU1: 'valide_niveau1',
  EN_ATTENTE_COMMISSION: 'en_attente_commission',
  VALIDE_COMMISSION: 'valide_commission',
  VALIDE_DOUBLE: 'valide_double',
  APPROUVE: 'approuve',
  REJETE: 'rejete',
};

export const STATUT_LABELS = {
  [STATUTS.EN_VERIFICATION]: 'À vérifier',
  [STATUTS.VALIDE_NIVEAU1]: 'Validé niveau 1',
  [STATUTS.EN_ATTENTE_COMMISSION]: 'En attente de commission',
  [STATUTS.VALIDE_COMMISSION]: 'Validé par le comité',
  [STATUTS.VALIDE_DOUBLE]: 'Double validation faite',
  [STATUTS.APPROUVE]: 'Approuvé',
  [STATUTS.REJETE]: 'Rejeté',
};

export const creditRequests = [
  {
    id: 'CPG-4471',
    client: 'Jean-Paul Ndong',
    poste: 'Agent de la voie · SETRAG',
    montant: 300000,
    duree: 12,
    statut: STATUTS.EN_VERIFICATION,
    date: '22 août',
    pieces: {
      "Pièce d'identité": 'ok',
      'Justificatif de revenu': 'ok',
      'Justificatif de domicile': 'attente',
      'Antécédents CPG': 'ok',
    },
  },
  {
    id: 'CPG-4472',
    client: 'Alice Mintsa',
    poste: 'Institutrice',
    montant: 150000,
    duree: 6,
    statut: STATUTS.EN_VERIFICATION,
    date: '22 août',
    pieces: {
      "Pièce d'identité": 'ok',
      'Justificatif de revenu': 'attente',
      'Justificatif de domicile': 'ok',
      'Antécédents CPG': 'ok',
    },
  },
  {
    id: 'CPG-4468',
    client: 'Serge Obiang',
    poste: 'Agent de la voie · SETRAG',
    montant: 500000,
    duree: 18,
    statut: STATUTS.VALIDE_NIVEAU1,
    date: '21 août',
  },
  {
    id: 'CPG-4460',
    client: 'Marie Ella',
    poste: 'Commerçante',
    montant: 200000,
    duree: 9,
    statut: STATUTS.VALIDE_NIVEAU1,
    date: '20 août',
  },
  {
    id: 'CPG-4441',
    client: 'Sylvain Nze',
    poste: 'Agent de la voie · SETRAG',
    montant: 250000,
    duree: 10,
    statut: STATUTS.VALIDE_COMMISSION,
    date: '19 août',
  },
  {
    id: 'CPG-4432',
    client: 'Chantal Biyoghe',
    poste: 'Aide-soignante',
    montant: 180000,
    duree: 8,
    statut: STATUTS.VALIDE_DOUBLE,
    date: '18 août',
  },
  {
    id: 'CPG-4451',
    client: 'Paul Ondo',
    poste: 'Agent de la voie · SETRAG',
    montant: 700000,
    duree: 24,
    statut: STATUTS.APPROUVE,
    date: '18 août',
  },
];

/**
 * ─────────────────────────────────────────────────────────────────────
 *  COMITÉ DE CRÉDIT — état de démonstration
 * ─────────────────────────────────────────────────────────────────────
 * Une seule séance « planifiee » à la fois, comme côté API réelle.
 */
export const commissionSessionSeed = {
  id: 'sess-1', scheduledFor: '2026-09-02T09:00:00.000Z', status: 'planifiee',
  scheduledBy: 'David Nzue',
};

/** CPG-4468 et CPG-4460 (ci-dessus, valide_niveau1) sont déposés dans cette séance dès le départ. */
export const commissionCreditNotes = {
  'CPG-4468': 'Bon profil, ancienneté SETRAG confirmée',
  'CPG-4460': '',
};

export const commissionItemsSeed = [
  {
    id: 'item-1', sessionId: 'sess-1', type: 'dossier_difficulte',
    creditId: 'CPG-4451', creditReference: 'CPG-4451', client: 'Paul Ondo',
    titre: 'Dossier en difficulté — CPG-4451 (Paul Ondo)',
    note: 'Deux échéances consécutives en retard, à examiner en séance.',
    status: 'en_attente',
  },
];

export const exceptionAuthorizationsSeed = [];


export const conversations = [
  { id: 'c1', client: 'Jean-Paul Ndong', last: 'Où en est ma demande de crédit ?', ago: '12 min', unread: 2 },
  { id: 'c2', client: 'Alice Mintsa', last: 'Merci pour votre retour.', ago: '1 h', unread: 0 },
  { id: 'c3', client: 'Serge Obiang', last: 'Je peux passer à l’agence demain ?', ago: '3 h', unread: 1 },
];

export const monthlyCredits = [
  { mois: 'Mars', credits: 42 },
  { mois: 'Avr', credits: 55 },
  { mois: 'Mai', credits: 61 },
  { mois: 'Juin', credits: 58 },
  { mois: 'Juil', credits: 74 },
  { mois: 'Août', credits: 81 },
];

export const clientSegments = [
  { name: 'Agents de la voie', value: 48, color: '#0B3D2E' },
  { name: 'Fonction publique', value: 24, color: '#145C3F' },
  { name: 'Commerce', value: 16, color: '#E8B93B' },
  { name: 'Autres', value: 12, color: '#E1E7E1' },
];

export const kpis = [
  { label: 'Crédits actifs', value: '1 284', delta: '+6,2 % vs juillet', up: true },
  { label: 'Encours total', value: '486 M FCFA', delta: '+3,8 %', up: true },
  { label: 'Volume Mobile Money', value: '92 M FCFA', delta: '+11 %', up: true },
  { label: "Taux d'impayés", value: '2,1 %', delta: '−0,4 pt', up: true },
];

export const users = [
  { id: 'u1', nom: 'Sylvie Mabiala', role: 'Opérateur de crédit', statut: 'Actif', type: 'employé' },
  { id: 'u2', nom: 'David Nzue', role: 'Gestionnaire', statut: 'Actif', type: 'employé' },
  { id: 'u3', nom: 'Jean-Paul Ndong', role: 'Client', statut: 'Actif', type: 'client' },
  { id: 'u4', nom: 'Alice Mintsa', role: 'Client', statut: 'Actif', type: 'client' },
  { id: 'u5', nom: 'Éric Moussavou', role: 'Opérateur de crédit', statut: 'Suspendu', type: 'employé' },
];

export const momoTransactions = [
  { id: 'TX-9021', client: 'Jean-Paul Ndong', operateur: 'Airtel Money', sens: 'Entrant', montant: 120000, statut: 'Confirmée' },
  { id: 'TX-9022', client: 'Marie Ella', operateur: 'Moov Money', sens: 'Sortant', montant: 45000, statut: 'Confirmée' },
  { id: 'TX-9023', client: 'Serge Obiang', operateur: 'Airtel Money', sens: 'Entrant', montant: 300000, statut: 'En attente' },
  { id: 'TX-9024', client: 'Alice Mintsa', operateur: 'Moov Money', sens: 'Sortant', montant: 15000, statut: 'Échouée' },
];

/**
 * ─────────────────────────────────────────────────────────────────────
 *  OPÉRATIONS MENSUELLES — comptes clients pour la simulation
 * ─────────────────────────────────────────────────────────────────────
 * Réplique volontairement le format réel (téléphone, numéro client,
 * nom, solde courant) : c'est ce que adminApi.js utilise pour simuler
 * la résolution d'un fichier de paie exactement comme le fera l'API
 * une fois branchée (même règles de correspondance, même comportement
 * en cas d'homonyme ou de doublon).
 */
export const clientAccounts = [
  { phone: '+24106000001', clientNumber: 'CPG-00931', nom: 'Jean-Paul Ndong', solde: 882500 },
  { phone: '+24106000002', clientNumber: 'CPG-00932', nom: 'Alice Mintsa', solde: 145000 },
  { phone: '+24106000003', clientNumber: 'CPG-00933', nom: 'Serge Obiang', solde: 62000 },
  { phone: '+24106000004', clientNumber: 'CPG-00934', nom: 'Marie Ella', solde: 51000 },
];

/** Historique des écritures, pour l'écran de vérification. */
export const ledgerTransactions = [
  {
    id: 'tx1', type: 'salaire', client: 'Jean-Paul Ndong', montant: 412500,
    reference: 'PAIE-SETRAG-2026-08', effectuePar: 'Sylvie Mabiala',
    date: '2026-08-05T09:12:00Z', annulee: false,
  },
  {
    id: 'tx2', type: 'paiement_credit', client: 'Alice Mintsa', montant: -49167,
    reference: 'CPG-4471', effectuePar: 'Compte technique',
    date: '2026-08-06T06:00:00Z', annulee: false,
  },
  {
    id: 'tx3', type: 'frais', client: 'Serge Obiang', montant: -240,
    reference: null, effectuePar: 'Compte technique',
    date: '2026-08-08T03:00:00Z', annulee: false,
  },
  {
    id: 'tx4', type: 'paiement_credit', client: 'Marie Ella', montant: -25223,
    reference: 'CPG-4460', effectuePar: 'Compte technique',
    date: '2026-08-06T06:00:00Z', annulee: true,
  },
];

/** Échéanciers de démonstration, indexés par référence de crédit. */
export const installmentSchedules = {
  'CPG-4471': [
    { id: 'ech-4471-1', sequence: 1, dueDate: '2026-08-25', originalDueDate: null, amount: 49167, status: 'a_venir' },
    {
      id: 'ech-4471-2', sequence: 2, dueDate: '2026-09-25', originalDueDate: null, amount: 49167,
      status: 'a_venir', pendingRequestId: 'adj-seed-1',
    },
    { id: 'ech-4471-3', sequence: 3, dueDate: '2026-10-25', originalDueDate: null, amount: 49167, status: 'a_venir' },
  ],
  'CPG-4460': [
    { id: 'ech-4460-1', sequence: 1, dueDate: '2026-07-25', originalDueDate: null, amount: 25223, status: 'payee' },
    { id: 'ech-4460-2', sequence: 2, dueDate: '2026-08-25', originalDueDate: null, amount: 25223, status: 'a_venir' },
  ],
};

/**
 * Demande de correction déjà en attente à l'ouverture de la démo, pour
 * que l'écran directeur ne parte pas d'une liste vide — reflète
 * exactement ech-4471-2 ci-dessus (même pendingRequestId).
 */
export const seedPendingAdjustment = {
  id: 'adj-seed-1', installmentId: 'ech-4471-2', creditReference: 'CPG-4471',
  sequence: 2, dateActuelle: '2026-09-25', nouvelleDate: '2026-10-10',
  motif: 'Le client a demandé un report exceptionnel, difficultés passagères',
  demandeur: 'Sylvie Mabiala', status: 'en_attente', requestedAt: '2026-08-20T09:12:00Z',
};

/**
 * ─────────────────────────────────────────────────────────────────────
 *  CATALOGUE — reflète les champs réels de l'API (cpg-api)
 * ─────────────────────────────────────────────────────────────────────
 * Champs en snake_case là où l'API les renvoie tels quels (monthly_rate,
 * min_amount…) : quand adminApi.js sera branché, aucune traduction de
 * forme ne sera nécessaire entre la réponse du serveur et ces mocks.
 */

export const creditProducts = [
  {
    id: 'p1', code: 'MICRO_STD', name: 'Microcrédit standard',
    description: 'Produit généraliste, tout public.',
    status: 'actif', version: 3,
    monthly_rate: 0.0150, min_amount: 50000, max_amount: 2000000,
    min_duration: 3, max_duration: 24,
    file_fee_fixed: 5000, file_fee_rate: 0.0100, late_penalty_rate: 0.0500,
  },
  {
    id: 'p2', code: 'CHEMINOT', name: 'Microcrédit cheminot',
    description: 'Réservé aux agents de la voie, taux préférentiel et durée étendue.',
    status: 'actif', version: 2,
    monthly_rate: 0.0120, min_amount: 50000, max_amount: 3000000,
    min_duration: 3, max_duration: 36,
    file_fee_fixed: 2500, file_fee_rate: 0.0050, late_penalty_rate: 0.0300,
  },
  {
    id: 'p3', code: 'EXPRESS', name: 'Crédit express',
    description: 'Petits montants, déblocage sous 24 h.',
    status: 'actif', version: 1,
    monthly_rate: 0.0250, min_amount: 20000, max_amount: 300000,
    min_duration: 1, max_duration: 6,
    file_fee_fixed: 3000, file_fee_rate: 0, late_penalty_rate: 0.0800,
  },
  {
    id: 'p4', code: 'SCOLAIRE', name: 'Crédit scolaire',
    description: 'Rentrée des classes. En cours de validation.',
    status: 'brouillon', version: 1,
    monthly_rate: 0.0100, min_amount: 25000, max_amount: 500000,
    min_duration: 3, max_duration: 12,
    file_fee_fixed: 1000, file_fee_rate: 0, late_penalty_rate: 0,
  },
];

export const fees = [
  {
    id: 'f1', code: 'AGIOS_DECOUVERT', name: 'Agios sur découvert',
    description: 'Prélevés quotidiennement sur solde débiteur.',
    status: 'actif', basis: 'taux', trigger_on: 'solde_journalier',
    rate: 0.0008, amount: 0, min_amount: 0, max_amount: null, exempt_below: 5000,
  },
  {
    id: 'f2', code: 'FRAIS_TENUE', name: 'Frais de tenue de compte',
    description: 'Prélevés mensuellement, montant fixe.',
    status: 'actif', basis: 'fixe', trigger_on: 'mensuel',
    rate: 0, amount: 500, min_amount: 0, max_amount: null, exempt_below: 0,
  },
];

export const changeRequests = [
  {
    id: 'r1', cible: 'Microcrédit cheminot', target_type: 'produit',
    demandeur: 'David Nzue', reason: 'Repositionnement tarifaire, hors marge déléguée',
    payload: { monthlyRate: 0.018 }, status: 'en_attente',
    requested_at: '2026-08-24T09:12:00Z',
  },
];

export const rateCeilings = [
  { scope: 'credit_monthly', max_rate: 0.0300, note: 'Plafond interne du taux mensuel de crédit. À aligner sur le taux d\'usure BEAC en vigueur.' },
  { scope: 'agios_daily', max_rate: 0.0010, note: 'Plafond du taux journalier d\'agios sur solde débiteur.' },
  { scope: 'fee_percentage', max_rate: 0.0500, note: 'Plafond des commissions exprimées en pourcentage.' },
];
