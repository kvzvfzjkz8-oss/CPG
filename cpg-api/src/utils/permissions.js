/**
 * ═══════════════════════════════════════════════════════════════════
 *  PERMISSIONS — l'autorité fait foi ICI, pas dans le navigateur
 * ═══════════════════════════════════════════════════════════════════
 *
 * Le back-office contient un fichier src/auth/roles.js qui ressemble
 * beaucoup à celui-ci. Ce n'est pas une duplication inutile : les deux
 * ont des rôles différents.
 *
 *   • Côté navigateur : masquer les onglets inutiles. Confort d'usage.
 *     Contournable par n'importe qui ouvrant les outils de développement.
 *
 *   • Côté serveur (ce fichier) : la vraie protection. Une requête
 *     forgée à la main, sans passer par l'interface, est rejetée ici.
 *
 * Toute route sensible DOIT passer par requirePermission(). Si vous
 * ajoutez une capacité au back-office, ajoutez-la ici aussi, sinon la
 * requête sera refusée — ce qui est le bon sens de l'échec.
 */

export const ROLES = {
  CLIENT: 'client',
  OPERATEUR: 'operateur',
  SUPERVISEUR: 'superviseur',
  DIRECTEUR: 'directeur',
  CAISSIER: 'caissier',
  ADMIN: 'admin',
};

export const PERMISSIONS = {
  [ROLES.CLIENT]: [
    'compte.lire_le_sien',
    'catalogue.lire_public',
    'credits.simuler',
    'credits.demander',
    'credits.lire_les_siens',
    'momo.initier',
    'messagerie.ecrire',
    'appareils.enregistrer',
  ],

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
    // finale du directeur qui suit (demandes.approuver_final).
    'demandes.valider_double',
    'commission.lire',

    // Opérations mensuelles : créditer la paie des agents et s'assurer
    // que les échéances de crédit et les agios ont bien été prélevés.
    // Le prélèvement lui-même est automatique (voir jobs/scheduler.js) ;
    // l'opérateur vérifie, et corrige au besoin. Une correction
    // d'échéance n'est qu'une proposition : elle attend la validation
    // du directeur (operations.decider_correction_echeance) avant de
    // s'appliquer — pas de self-service sur les dates d'échéance.
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
    // (cadence hebdomadaire), dépose les dossiers validés niveau 1 en
    // les annotant, et tient la séance en enregistrant les décisions.
    // L'octroi effectif des fonds ne lui appartient plus : depuis
    // l'introduction du comité, seul le directeur approuve au final
    // (demandes.approuver_final), après double validation de l'opérateur.
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
  // fixer un taux hors marge, trancher les propositions du gestionnaire.
  [ROLES.DIRECTEUR]: [
    'statistiques.lire',
    'demandes.lire',
    'demandes.rejeter',
    'utilisateurs.gerer',
    'momo.superviser',
    'audit.lire',

    // Approbation finale d'un crédit — désormais réservée au directeur
    // seul, dernière étape du circuit une fois le comité et la double
    // validation de l'opérateur passés. C'est elle qui débloque les
    // fonds. L'ancienne permission demandes.valider_final, partagée
    // avec le gestionnaire avant le comité, a disparu avec lui.
    'demandes.approuver_final',
    'commission.lire',

    // Seul le directeur peut autoriser, au cas par cas, un client déjà
    // en crédit à repasser en commission pour un second dossier.
    'commission.autoriser_exception',

    // Le code PIN back-office est une attribution, pas un self-service :
    // seul le directeur le définit, le modifie ou le supprime — même
    // le gestionnaire, qui gère pourtant les comptes au quotidien
    // (utilisateurs.gerer), n'a pas cette permission.
    'utilisateurs.gerer_pin',

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
    // l'opérateur — c'est la validation demandée, pas une formalité :
    // la contrainte no_self_decision_echeance l'impose aussi en base.
    'operations.decider_correction_echeance',

    // La Caisse : le directeur valide chaque retrait guichet et chaque
    // réapprovisionnement avant qu'ils aient un effet réel — jamais
    // d'argent qui bouge sur la seule initiative de la caissière.
    'caisse.valider',
    'caisse.consulter_toutes_caisses',
  ],

  // La caissière sert les retraits au guichet, dans la limite de son
  // budget en espèces. Elle ne peut ni créer de compte, ni consulter
  // les dossiers de crédit : uniquement solde, retrait et RIB.
  [ROLES.CAISSIER]: [
    'caisse.consulter_solde_client',
    'caisse.demander_retrait',
    'caisse.demander_appro',
    'caisse.consulter_sa_caisse',
    'caisse.imprimer_rib',
  ],

  // L'administrateur technique hérite de tout, mais reste tracé dans
  // audit_log comme les autres. Aucun compte n'échappe au journal.
  [ROLES.ADMIN]: null,
};

export function can(role, permission) {
  if (role === ROLES.ADMIN) return true;
  return PERMISSIONS[role]?.includes(permission) ?? false;
}

export function permissionsFor(role) {
  if (role === ROLES.ADMIN) {
    return [...new Set(Object.values(PERMISSIONS).filter(Boolean).flat())];
  }
  return PERMISSIONS[role] ?? [];
}
