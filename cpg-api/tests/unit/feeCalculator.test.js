import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeFee,
  computeAgios,
  buildDailyBalances,
  applyBounds,
  computeLatePenalty,
  FEE_BASIS,
} from '../../src/services/feeCalculator.js';

describe('applyBounds', () => {
  test('applique le plancher', () => {
    assert.equal(applyBounds(200, { minAmount: 500 }), 500);
  });

  test('applique le plafond', () => {
    assert.equal(applyBounds(9000, { maxAmount: 5000 }), 5000);
  });

  test('l’exonération l’emporte sur le plancher', () => {
    // Un compte sous le seuil d'exonération ne paie rien, même si un
    // montant minimum de frais est défini. L'ordre inverse ferait payer
    // le minimum à des clients censés être exonérés.
    const result = applyBounds(200, { minAmount: 500, exemptBelow: 10000 }, 5000);
    assert.equal(result, 0);
  });

  test('un montant nul ou négatif ne produit aucun frais', () => {
    assert.equal(applyBounds(0, { minAmount: 500 }), 0);
    assert.equal(applyBounds(-100, {}), 0);
  });
});

describe('computeFee — frais ponctuels', () => {
  test('frais fixe', () => {
    const version = { basis: FEE_BASIS.FIXE, amount: 500 };
    assert.equal(computeFee(version, 50000), 500);
  });

  test('frais en pourcentage', () => {
    const version = { basis: FEE_BASIS.POURCENTAGE, rate: 0.01 };
    assert.equal(computeFee(version, 50000), 500);
  });

  test('pourcentage plafonné', () => {
    const version = { basis: FEE_BASIS.POURCENTAGE, rate: 0.01, maxAmount: 2000 };
    assert.equal(computeFee(version, 1000000), 2000);
  });

  test('petite opération exonérée', () => {
    const version = { basis: FEE_BASIS.POURCENTAGE, rate: 0.01, exemptBelow: 5000 };
    assert.equal(computeFee(version, 3000), 0);
    assert.equal(computeFee(version, 8000), 80);
  });

  test('accepte les noms de colonnes SQL', () => {
    // Les lignes venant de PostgreSQL arrivent en snake_case.
    const version = { basis: FEE_BASIS.POURCENTAGE, rate: 0.01, max_amount: 2000 };
    assert.equal(computeFee(version, 1000000), 2000);
  });

  test('renvoie zéro sans version', () => {
    assert.equal(computeFee(null, 50000), 0);
  });
});

describe('buildDailyBalances', () => {
  test('produit un solde par jour de la période', () => {
    const balances = buildDailyBalances(10000, [], '2026-03-01', '2026-03-05');
    assert.equal(balances.length, 5);
  });

  test('reporte le solde les jours sans mouvement', () => {
    const balances = buildDailyBalances(10000, [], '2026-03-01', '2026-03-03');
    assert.deepEqual(balances.map((b) => b.balance), [10000, 10000, 10000]);
  });

  test('applique les mouvements au bon jour', () => {
    const entries = [{ created_at: '2026-03-02T10:00:00Z', amount: -15000 }];
    const balances = buildDailyBalances(10000, entries, '2026-03-01', '2026-03-03');
    assert.deepEqual(balances.map((b) => b.balance), [10000, -5000, -5000]);
  });

  test('cumule plusieurs mouvements du même jour', () => {
    const entries = [
      { created_at: '2026-03-02T09:00:00Z', amount: -5000 },
      { created_at: '2026-03-02T15:00:00Z', amount: -3000 },
    ];
    const balances = buildDailyBalances(10000, entries, '2026-03-01', '2026-03-02');
    assert.equal(balances[1].balance, 2000);
  });

  test('renvoie une liste vide si la période est inversée', () => {
    assert.deepEqual(buildDailyBalances(0, [], '2026-03-10', '2026-03-01'), []);
  });
});

describe('computeAgios', () => {
  const version = { rate: 0.0005 }; // 0,05 %/jour

  test('aucun agios sur un compte toujours créditeur', () => {
    const balances = buildDailyBalances(50000, [], '2026-03-01', '2026-03-31');
    const result = computeAgios(balances, version);
    assert.equal(result.amount, 0);
    assert.equal(result.debitDays, 0);
  });

  test('facture chaque jour de découvert', () => {
    // −200 000 pendant 10 jours à 0,05 %/jour = 200 000 × 0,0005 × 10 = 1 000
    const balances = Array.from({ length: 10 }, (_, i) => ({
      date: `2026-03-${String(i + 1).padStart(2, '0')}`,
      balance: -200000,
    }));
    const result = computeAgios(balances, version);
    assert.equal(result.amount, 1000);
    assert.equal(result.debitDays, 10);
  });

  test('le solde de fin de mois ne reflète pas les agios dus', () => {
    // C'est le cœur du sujet. Un client à découvert 29 jours qui
    // renfloue la veille de l'arrêté a un solde final positif, mais
    // doit bien près d'un mois d'agios. Calculer sur le solde final
    // donnerait zéro et ferait perdre de l'argent à l'établissement ;
    // le calcul journalier est le seul défendable.
    const balances = [
      ...Array.from({ length: 29 }, (_, i) => ({ date: `j${i}`, balance: -100000 })),
      { date: 'j29', balance: 50000 },
    ];

    const result = computeAgios(balances, version);
    assert.equal(result.debitDays, 29);
    assert.equal(result.amount, 1450); // 100 000 × 0,0005 × 29
    assert.ok(result.amount > 0, 'le solde final positif ne doit pas annuler les agios');
  });

  test('un découvert d’un seul jour coûte un seul jour', () => {
    const balances = [
      { date: '2026-03-01', balance: 10000 },
      { date: '2026-03-02', balance: -100000 },
      { date: '2026-03-03', balance: 10000 },
    ];
    const result = computeAgios(balances, version);
    assert.equal(result.debitDays, 1);
    assert.equal(result.amount, 50);
  });

  test('la franchise épargne les petits découverts', () => {
    const withFranchise = { rate: 0.0005, exemptBelow: 5000 };
    const balances = Array.from({ length: 30 }, () => ({ date: 'j', balance: -2000 }));
    assert.equal(computeAgios(balances, withFranchise).amount, 0);
  });

  test('la franchise ne s’applique pas au-dessus du seuil', () => {
    const withFranchise = { rate: 0.0005, exemptBelow: 5000 };
    const balances = Array.from({ length: 10 }, () => ({ date: 'j', balance: -20000 }));
    assert.equal(computeAgios(balances, withFranchise).amount, 100);
  });

  test('respecte le plafond mensuel', () => {
    const capped = { rate: 0.0005, maxAmount: 500 };
    const balances = Array.from({ length: 30 }, () => ({ date: 'j', balance: -500000 }));
    assert.equal(computeAgios(balances, capped).amount, 500);
  });

  test('arrondit une seule fois, à la fin', () => {
    // Arrondir chaque jour puis additionner introduit un écart qui
    // grandit avec la durée. Ici 30 jours à 33,33 francs : l'arrondi
    // quotidien donnerait 30 × 33 = 990, l'arrondi final 1 000.
    const balances = Array.from({ length: 30 }, () => ({ date: 'j', balance: -66666 }));
    const result = computeAgios(balances, { rate: 0.0005 });
    assert.equal(result.amount, 1000);
  });

  test('renvoie le détail jour par jour pour justification', () => {
    const balances = [
      { date: '2026-03-01', balance: -100000 },
      { date: '2026-03-02', balance: 5000 },
      { date: '2026-03-03', balance: -50000 },
    ];
    const result = computeAgios(balances, version);
    assert.equal(result.detail.length, 2);
    assert.equal(result.detail[0].date, '2026-03-01');
    assert.equal(result.detail[1].balance, -50000);
  });

  test('gère une entrée vide sans planter', () => {
    assert.equal(computeAgios([], version).amount, 0);
    assert.equal(computeAgios(null, version).amount, 0);
    assert.equal(computeAgios([{ balance: -1000 }], null).amount, 0);
  });
});

describe('computeLatePenalty', () => {
  test('proratise selon les jours de retard', () => {
    // 45 000 à 5 %/mois, 15 jours de retard = 45 000 × 0,05 × 0,5 = 1 125
    assert.equal(computeLatePenalty(45000, 15, 0.05), 1125);
  });

  test('un jour de retard ne coûte pas un mois entier', () => {
    const unJour = computeLatePenalty(45000, 1, 0.05);
    const unMois = computeLatePenalty(45000, 30, 0.05);
    assert.ok(unJour < unMois / 20, 'la pénalité doit être proportionnelle');
  });

  test('aucune pénalité sans retard', () => {
    assert.equal(computeLatePenalty(45000, 0, 0.05), 0);
    assert.equal(computeLatePenalty(45000, -3, 0.05), 0);
  });

  test('aucune pénalité si le taux est nul', () => {
    assert.equal(computeLatePenalty(45000, 30, 0), 0);
  });
});
