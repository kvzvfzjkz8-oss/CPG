import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ROLES, can, permissionsFor } from '../../src/utils/permissions.js';
import {
  resolveVersionAt,
  isWithinDelegation,
  validateProductScale,
  validateAgainstScale,
  classifyRateChange,
  RateError,
  DELEGATION_MARGIN,
} from '../../src/utils/rateVersioning.js';

describe('matrice des permissions', () => {
  test('un client ne peut pas approuver de crédit', () => {
    assert.equal(can(ROLES.CLIENT, 'demandes.valider_final'), false);
    assert.equal(can(ROLES.CLIENT, 'demandes.valider_niveau1'), false);
  });

  test('un opérateur ne peut pas faire la validation finale', () => {
    // Séparation des niveaux : c'est ce qui empêche un seul employé de
    // débloquer des fonds de bout en bout.
    assert.equal(can(ROLES.OPERATEUR, 'demandes.valider_niveau1'), true);
    assert.equal(can(ROLES.OPERATEUR, 'demandes.valider_final'), false);
  });

  test('un opérateur ne gère pas les utilisateurs', () => {
    assert.equal(can(ROLES.OPERATEUR, 'utilisateurs.gerer'), false);
  });

  test('un gestionnaire crée des produits mais ne les active pas', () => {
    assert.equal(can(ROLES.SUPERVISEUR, 'catalogue.creer'), true);
    assert.equal(can(ROLES.SUPERVISEUR, 'catalogue.activer'), false);
  });

  test('un gestionnaire n’ajuste pas hors marge déléguée', () => {
    assert.equal(can(ROLES.SUPERVISEUR, 'catalogue.ajuster_dans_marge'), true);
    assert.equal(can(ROLES.SUPERVISEUR, 'catalogue.ajuster_hors_marge'), false);
    assert.equal(can(ROLES.SUPERVISEUR, 'catalogue.proposer_hors_marge'), true);
  });

  test('un gestionnaire ne tranche pas ses propres propositions', () => {
    assert.equal(can(ROLES.SUPERVISEUR, 'catalogue.decider_changement'), false);
    assert.equal(can(ROLES.DIRECTEUR, 'catalogue.decider_changement'), true);
  });

  test('le directeur détient l’autorité de barème', () => {
    assert.equal(can(ROLES.DIRECTEUR, 'catalogue.activer'), true);
    assert.equal(can(ROLES.DIRECTEUR, 'catalogue.ajuster_hors_marge'), true);
    assert.equal(can(ROLES.DIRECTEUR, 'plafonds.gerer'), true);
  });

  test('l’administrateur hérite de tout', () => {
    assert.equal(can(ROLES.ADMIN, 'catalogue.activer'), true);
    assert.equal(can(ROLES.ADMIN, 'demandes.valider_final'), true);
  });

  test('une permission inconnue est toujours refusée', () => {
    assert.equal(can(ROLES.SUPERVISEUR, 'permission.inventee'), false);
    assert.equal(can('role_inexistant', 'demandes.lire'), false);
  });

  test('permissionsFor renvoie une liste non vide pour chaque rôle', () => {
    for (const role of Object.values(ROLES)) {
      assert.ok(permissionsFor(role).length > 0, `${role} a des permissions`);
    }
  });

  test('aucun rôle métier ne cumule les deux niveaux de validation', () => {
    for (const role of [ROLES.OPERATEUR, ROLES.SUPERVISEUR, ROLES.DIRECTEUR]) {
      const perms = permissionsFor(role);
      const cumul = perms.includes('demandes.valider_niveau1') && perms.includes('demandes.valider_final');
      assert.equal(cumul, false, `${role} ne doit pas cumuler les deux validations`);
    }
  });
});

describe('resolveVersionAt', () => {
  const versions = [
    { version: 1, monthly_rate: 0.015, effective_from: '2026-01-01', effective_to: '2026-04-01' },
    { version: 2, monthly_rate: 0.018, effective_from: '2026-04-01', effective_to: null },
  ];

  test('retrouve le barème en vigueur aujourd’hui', () => {
    const v = resolveVersionAt(versions, '2026-06-15');
    assert.equal(v.version, 2);
    assert.equal(v.monthly_rate, 0.018);
  });

  test('retrouve le barème d’une date passée', () => {
    // C'est ce qui permet de justifier six mois plus tard la mensualité
    // d'un crédit signé sous l'ancien barème.
    const v = resolveVersionAt(versions, '2026-02-10');
    assert.equal(v.version, 1);
    assert.equal(v.monthly_rate, 0.015);
  });

  test('la borne de fin est exclusive', () => {
    const v = resolveVersionAt(versions, '2026-04-01');
    assert.equal(v.version, 2, 'le jour du basculement relève de la nouvelle version');
  });

  test('renvoie null avant toute version', () => {
    assert.equal(resolveVersionAt(versions, '2025-12-01'), null);
  });

  test('gère une liste vide', () => {
    assert.equal(resolveVersionAt([], '2026-01-01'), null);
    assert.equal(resolveVersionAt(null, '2026-01-01'), null);
  });
});

describe('isWithinDelegation', () => {
  test('un ajustement de 10 % reste dans la marge', () => {
    assert.equal(isWithinDelegation(0.015, 0.0165), true); // +10 %
  });

  test('un ajustement de 20 % est à la limite acceptée', () => {
    assert.equal(isWithinDelegation(0.015, 0.018), true); // +20 % exactement
  });

  test('un ajustement de 30 % sort de la marge', () => {
    assert.equal(isWithinDelegation(0.015, 0.0195), false);
  });

  test('la marge s’applique aussi à la baisse', () => {
    assert.equal(isWithinDelegation(0.015, 0.012), true); // −20 %
    assert.equal(isWithinDelegation(0.015, 0.010), false); // −33 %
  });

  test('la marge est paramétrable', () => {
    assert.equal(isWithinDelegation(0.015, 0.0195, 0.5), true);
  });

  test('depuis un taux nul, seul zéro reste dans la marge', () => {
    // Sans ce cas, la division par zéro produirait NaN et la
    // comparaison laisserait passer n'importe quel taux.
    assert.equal(isWithinDelegation(0, 0), true);
    assert.equal(isWithinDelegation(0, 0.01), false);
  });

  test('la marge par défaut est bien de 20 %', () => {
    assert.equal(DELEGATION_MARGIN, 0.2);
  });
});

describe('validateProductScale', () => {
  const valide = {
    monthlyRate: 0.015,
    minAmount: 50000,
    maxAmount: 2000000,
    minDuration: 3,
    maxDuration: 36,
  };

  test('accepte un barème cohérent', () => {
    assert.equal(validateProductScale(valide, 0.03), true);
  });

  test('refuse un taux au-dessus du plafond', () => {
    // Le cas de l'erreur de saisie : 15 % au lieu de 1,5 %.
    assert.throws(
      () => validateProductScale({ ...valide, monthlyRate: 0.15 }, 0.03),
      (err) => err instanceof RateError && err.code === 'plafond_depasse'
    );
  });

  test('refuse un taux négatif', () => {
    assert.throws(
      () => validateProductScale({ ...valide, monthlyRate: -0.01 }, 0.03),
      (err) => err.code === 'taux_invalide'
    );
  });

  test('refuse un maximum inférieur au minimum', () => {
    assert.throws(
      () => validateProductScale({ ...valide, maxAmount: 10000 }, 0.03),
      (err) => err.code === 'bornes_incoherentes'
    );
  });

  test('refuse une durée maximale incohérente', () => {
    assert.throws(
      () => validateProductScale({ ...valide, minDuration: 24, maxDuration: 6 }, 0.03),
      (err) => err.code === 'bornes_incoherentes'
    );
  });

  test('le message d’erreur est affichable au gestionnaire', () => {
    try {
      validateProductScale({ ...valide, monthlyRate: 0.15 }, 0.03);
      assert.fail('aurait dû lever');
    } catch (err) {
      assert.match(err.message, /15,00 %|15\.00 %/);
      assert.match(err.message, /plafond/i);
    }
  });
});

describe('validateAgainstScale', () => {
  const scale = { min_amount: 50000, max_amount: 500000, min_duration: 3, max_duration: 24 };

  test('accepte une demande dans les bornes', () => {
    assert.equal(validateAgainstScale(300000, 12, scale), true);
  });

  test('refuse un montant trop élevé', () => {
    assert.throws(
      () => validateAgainstScale(900000, 12, scale),
      (err) => err.code === 'hors_bornes_montant'
    );
  });

  test('refuse une durée trop longue', () => {
    assert.throws(
      () => validateAgainstScale(300000, 36, scale),
      (err) => err.code === 'hors_bornes_duree'
    );
  });

  test('les bornes sont inclusives', () => {
    assert.equal(validateAgainstScale(50000, 3, scale), true);
    assert.equal(validateAgainstScale(500000, 24, scale), true);
  });
});

describe('classifyRateChange', () => {
  test('le gestionnaire applique dans la marge', () => {
    const result = classifyRateChange({
      role: 'superviseur', currentRate: 0.015, proposedRate: 0.016, ceiling: 0.03,
    });
    assert.equal(result.outcome, 'applique');
  });

  test('le gestionnaire doit faire valider hors marge', () => {
    const result = classifyRateChange({
      role: 'superviseur', currentRate: 0.015, proposedRate: 0.025, ceiling: 0.03,
    });
    assert.equal(result.outcome, 'a_valider');
    assert.equal(result.reason, 'hors_marge_deleguee');
  });

  test('le directeur applique sans passer par la validation', () => {
    const result = classifyRateChange({
      role: 'directeur', currentRate: 0.015, proposedRate: 0.028, ceiling: 0.03,
    });
    assert.equal(result.outcome, 'applique');
  });

  test('personne ne dépasse le plafond, pas même le directeur', () => {
    const result = classifyRateChange({
      role: 'directeur', currentRate: 0.015, proposedRate: 0.05, ceiling: 0.03,
    });
    assert.equal(result.outcome, 'refus');
    assert.equal(result.reason, 'plafond_depasse');
  });

  test('un opérateur ne touche pas aux barèmes', () => {
    const result = classifyRateChange({
      role: 'operateur', currentRate: 0.015, proposedRate: 0.016, ceiling: 0.03,
    });
    assert.equal(result.outcome, 'refus');
    assert.equal(result.reason, 'role_insuffisant');
  });

  test('un client non plus', () => {
    const result = classifyRateChange({
      role: 'client', currentRate: 0.015, proposedRate: 0.001, ceiling: 0.03,
    });
    assert.equal(result.outcome, 'refus');
  });
});
