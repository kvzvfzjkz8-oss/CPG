/**
 * ─────────────────────────────────────────────────────────────────────
 *  RÔLES ET PERMISSIONS — cahier des charges §3
 * ─────────────────────────────────────────────────────────────────────
 *
 * « Chaque collaborateur ne voit que ce qui concerne son poste. »
 *
 * Ce fichier est la source unique de vérité pour l'affichage. Les vues
 * ne construisent leur menu qu'à partir de PERMISSIONS : ajouter un
 * onglet à un rôle se fait ici, nulle part ailleurs.
 *
 * Ces trois rôles et leurs permissions sont le miroir exact de
 * src/utils/permissions.js côté API (cpg-api). Un back-office qui
 * dérive de cette liste risque de proposer un bouton pour une action
 * que le serveur refusera — gardez les deux fichiers synchronisés.
 *
 * ⚠️ Point de sécurité à ne pas contourner :
 * masquer un onglet dans le navigateur n'est PAS une protection. Un
 * utilisateur peut modifier le JavaScript de la page. Le backend doit
 * vérifier le rôle à CHAQUE requête — approuver un crédit, lister les
 * utilisateurs, consulter les transactions. Ce fichier gère le confort
 * d'usage ; le serveur gère la sécurité.
 */

export const ROLES = {
  OPERATEUR: 'operateur',
  SUPERVISEUR: 'superviseur',
  DIRECTEUR: 'directeur',
  CAISSIER: 'caissier',
};

export const ROLE_LABELS = {
  [ROLES.OPERATEUR]: 'Opérateur de crédit / Conseiller',
  [ROLES.SUPERVISEUR]: 'Gestionnaire / Superviseur',
  [ROLES.DIRECTEUR]: 'Directeur',
  [ROLES.CAISSIER]: 'Caissière',
};

export const ROLE_DESCRIPTIONS = {
  [ROLES.OPERATEUR]:
    'Traitement des demandes, vérification client, opérations mensuelles (paie, échéances, agios), messagerie',
  [ROLES.SUPERVISEUR]:
    'Statistiques, validation finale, gestion des utilisateurs, catalogue et supervision Mobile Money',
  [ROLES.DIRECTEUR]:
    'Tout le périmètre du gestionnaire, plus l\'activation des produits, l\'arbitrage des barèmes et les plafonds réglementaires',
  [ROLES.CAISSIER]:
    'Retraits au guichet, réapprovisionnement de caisse et remise de RIB — dans la limite de son budget en espèces',
};

/** Capacités accordées à chaque rôle. */
export const PERMISSIONS = {
  [ROLES.OPERATEUR]: [
    'demandes.lire',
    'demandes.valider_niveau1',
    'demandes.rejeter',
    'clients.verifier',
    'messagerie.repondre',
    'catalogue.lire_public',

    // Double validation après le comité de crédit : le dossier doit
    // avoir été validé en commission avant que l'opérateur puisse la
    // faire, et c'est encore une étape différente de l'approbation
    // finale du directeur qui suit.
    'demandes.valider_double',
    'commission.lire',

    // Opérations mensuelles : créditer la paie des agents (fichier
    // joint) et vérifier ce que le logiciel a fait seul — les agios
    // et les échéances sont prélevés automatiquement (tâche planifiée
    // côté API), l'opérateur contrôle et corrige si besoin. Corriger
    // une échéance reste une proposition : elle n'entre en vigueur
    // qu'après validation du directeur (operations.decider_correction_echeance).
    'operations.crediter_salaires',
    'operations.executer_echeances',
    'operations.lire',
    'operations.annuler_transaction',
    'operations.modifier_echeance',
  ],
  [ROLES.SUPERVISEUR]: [
    'statistiques.lire',
    'demandes.lire',
    'demandes.rejeter',
    'utilisateurs.gerer',
    'momo.superviser',
    'audit.lire',

    // Comité de crédit : le gestionnaire programme les séances
    // (cadence hebdomadaire), dépose les dossiers (nouveaux crédits,
    // dossiers en difficulté, demandes exceptionnelles) et tient la
    // séance en tranchant chaque point. L'octroi effectif des fonds ne
    // lui appartient plus depuis l'introduction du comité : seul le
    // directeur approuve au final, après double validation de
    // l'opérateur (demandes.approuver_final).
    'commission.lire',
    'commission.programmer',
    'commission.deposer',
    'commission.tenir',

    // Catalogue : le gestionnaire crée les produits et services et
    // ajuste les barèmes dans la marge déléguée par la direction.
    // Au-delà, il propose et le directeur tranche.
    'catalogue.lire',
    'catalogue.lire_public',
    'catalogue.creer',
    'catalogue.ajuster_dans_marge',
    'catalogue.proposer_hors_marge',
    'frais.appliquer',

    // Lecture du relevé de contrôle mensuel, pour la supervision — le
    // déclenchement au jour le jour reste au poste de l'opérateur.
    'operations.lire',
  ],
  // Le directeur ajoute l'autorité de barème : activer un produit,
  // fixer un taux hors marge, trancher les propositions du gestionnaire,
  // et seul à pouvoir toucher aux plafonds réglementaires.
  [ROLES.DIRECTEUR]: [
    'statistiques.lire',
    'demandes.lire',
    'demandes.rejeter',
    'utilisateurs.gerer',
    'momo.superviser',
    'audit.lire',

    // Approbation finale d'un crédit — réservée au directeur seul,
    // dernière étape une fois le comité et la double validation de
    // l'opérateur passés. C'est elle qui débloque les fonds.
    'demandes.approuver_final',
    'commission.lire',

    // Seul le directeur peut autoriser, au cas par cas, un client déjà
    // en crédit à repasser en commission pour un second dossier.
    'commission.autoriser_exception',

    'catalogue.lire',
    'catalogue.lire_public',
    'catalogue.creer',
    'catalogue.ajuster_dans_marge',
    'catalogue.ajuster_hors_marge',
    'catalogue.activer',
    'catalogue.decider_changement',
    'plafonds.gerer',
    'frais.appliquer',
    'operations.lire',

    // Seul le directeur valide une correction d'échéance proposée par
    // l'opérateur — l'API l'impose aussi en base (contrainte
    // no_self_decision_echeance), pas seulement ici.
    'operations.decider_correction_echeance',

    // Le code PIN back-office est une attribution, pas un self-service :
    // seul le directeur le définit, le modifie ou le supprime.
    'utilisateurs.gerer_pin',

    // La Caisse : le directeur valide chaque retrait guichet et
    // chaque réapprovisionnement — jamais d'argent qui bouge sur la
    // seule initiative de la caissière.
    'caisse.valider',
    'caisse.consulter_toutes_caisses',
  ],

  // La caissière sert les retraits au guichet, dans la limite de son
  // budget en espèces. Elle ne voit ni les dossiers de crédit ni la
  // gestion des utilisateurs — uniquement solde, retrait et RIB.
  [ROLES.CAISSIER]: [
    'caisse.consulter_solde_client',
    'caisse.demander_retrait',
    'caisse.demander_appro',
    'caisse.consulter_sa_caisse',
    'caisse.imprimer_rib',
  ],
};

export const can = (role, permission) => PERMISSIONS[role]?.includes(permission) ?? false;

/** Comptes de démonstration. À remplacer par l'authentification réelle. */
export const DEMO_ACCOUNTS = {
  [ROLES.OPERATEUR]: { name: 'Sylvie Mabiala', initials: 'SM' },
  [ROLES.SUPERVISEUR]: { name: 'David Nzue', initials: 'DN' },
  [ROLES.DIRECTEUR]: { name: 'Direction CPG', initials: 'DC' },
};
