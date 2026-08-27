import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSchedule,
  buildInstallments,
  computeFileFee,
  computeTotalCost,
  generateReference,
  DEFAULT_MONTHLY_RATE,
} from '../../src/services/creditService.js';

describe('computeSchedule', () => {
  test('applique l’intérêt simple sur la durée', () => {
    // 500 000 à 1,5 %/mois sur 12 mois : 500 000 × (1 + 0,015 × 12) = 590 000
    const { totalDue, totalInterest } = computeSchedule(500000, 12, 0.015);
    assert.equal(totalDue, 590000);
    assert.equal(totalInterest, 90000);
  });

  test('arrondit la mensualité au franc supérieur', () => {
    // 590 000 / 12 = 49 166,67 → 49 167
    const { monthlyPayment } = computeSchedule(500000, 12, 0.015);
    assert.equal(monthlyPayment, 49167);
  });

  test('un taux nul ne produit aucun intérêt', () => {
    const { totalDue, totalInterest } = computeSchedule(100000, 6, 0);
    assert.equal(totalDue, 100000);
    assert.equal(totalInterest, 0);
  });

  test('ne renvoie jamais de valeur à virgule', () => {
    const { monthlyPayment, totalDue } = computeSchedule(333333, 7, 0.0175);
    assert.ok(Number.isInteger(monthlyPayment), 'mensualité entière');
    assert.ok(Number.isInteger(totalDue), 'total entier');
  });
});

describe('buildInstallments', () => {
  test('génère une échéance par mois', () => {
    const { monthlyPayment, totalDue } = computeSchedule(500000, 12, 0.015);
    const installments = buildInstallments(new Date('2026-01-15'), 12, monthlyPayment, totalDue);
    assert.equal(installments.length, 12);
    assert.equal(installments[0].sequence, 1);
    assert.equal(installments[11].sequence, 12);
  });

  test('la somme des échéances égale exactement le total dû', () => {
    // Point critique : avec un arrondi au franc supérieur sur chaque
    // mensualité, additionner 12 × 49 167 donne 590 004, soit 4 francs
    // de trop. La dernière échéance doit absorber l'écart, sinon le
    // client reste débiteur après son dernier paiement.
    const { monthlyPayment, totalDue } = computeSchedule(500000, 12, 0.015);
    const installments = buildInstallments(new Date('2026-01-15'), 12, monthlyPayment, totalDue);

    const sum = installments.reduce((acc, i) => acc + i.amount, 0);
    assert.equal(sum, totalDue);
  });

  test('la dernière échéance absorbe l’arrondi', () => {
    const { monthlyPayment, totalDue } = computeSchedule(500000, 12, 0.015);
    const installments = buildInstallments(new Date('2026-01-15'), 12, monthlyPayment, totalDue);

    const last = installments[11];
    assert.ok(last.amount < monthlyPayment, 'la dernière échéance est réduite');
    assert.ok(last.amount > 0, 'la dernière échéance reste positive');
  });

  test('les échéances se suivent de mois en mois', () => {
    const installments = buildInstallments(new Date('2026-01-15'), 3, 1000, 3000);
    assert.equal(installments[0].dueDate.getMonth(), 1); // février
    assert.equal(installments[1].dueDate.getMonth(), 2); // mars
    assert.equal(installments[2].dueDate.getMonth(), 3); // avril
  });

  test('aucune échéance négative sur une durée courte', () => {
    const { monthlyPayment, totalDue } = computeSchedule(50000, 3, 0.015);
    const installments = buildInstallments(new Date(), 3, monthlyPayment, totalDue);
    for (const i of installments) {
      assert.ok(i.amount > 0, `échéance ${i.sequence} positive`);
    }
  });
});

describe('computeFileFee', () => {
  test('additionne part fixe et pourcentage', () => {
    // 5 000 fixe + 1 % de 300 000 = 5 000 + 3 000 = 8 000
    assert.equal(computeFileFee(300000, { fileFeeFixed: 5000, fileFeeRate: 0.01 }), 8000);
  });

  test('renvoie zéro sans barème de frais', () => {
    assert.equal(computeFileFee(300000), 0);
  });

  test('gère une part fixe seule', () => {
    assert.equal(computeFileFee(300000, { fileFeeFixed: 2500 }), 2500);
  });
});

describe('computeTotalCost', () => {
  test('le net reçu est amputé des frais de dossier', () => {
    const result = computeTotalCost(300000, 12, 0.015, { fileFeeFixed: 5000, fileFeeRate: 0.01 });
    assert.equal(result.fileFee, 8000);
    assert.equal(result.netReceived, 292000);
  });

  test('le coût total inclut intérêts et frais', () => {
    const result = computeTotalCost(300000, 12, 0.015, { fileFeeFixed: 5000, fileFeeRate: 0.01 });
    // 300 000 × 1,18 = 354 000, plus 8 000 de frais
    assert.equal(result.totalDue, 354000);
    assert.equal(result.totalCost, 362000);
  });

  test('sans frais, coût total et total dû coïncident', () => {
    const result = computeTotalCost(300000, 12, 0.015);
    assert.equal(result.totalCost, result.totalDue);
    assert.equal(result.netReceived, 300000);
  });
});

describe('generateReference', () => {
  test('respecte le format CPG-XXXX', () => {
    assert.match(generateReference(), /^CPG-\d{4}$/);
  });
});

describe('DEFAULT_MONTHLY_RATE', () => {
  test('reste un taux plausible pour du microcrédit', () => {
    assert.ok(DEFAULT_MONTHLY_RATE > 0 && DEFAULT_MONTHLY_RATE < 0.05);
  });
});
