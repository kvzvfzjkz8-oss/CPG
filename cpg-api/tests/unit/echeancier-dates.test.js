/**
 * ═══════════════════════════════════════════════════════════════════
 *  LES DATES DE L'ÉCHÉANCIER
 * ═══════════════════════════════════════════════════════════════════
 *
 * « Les dossiers qui vont être validés demain seront prélevés le 03 du
 *   mois de novembre. »
 *
 * Le logiciel posait la première échéance à la date d'approbation
 * + 1 mois : les 25 dossiers du 23/10/2026 ont reçu un 23 novembre, et
 * il a fallu les redater à la main quatre jours avant le prélèvement.
 * La séance porte désormais la date du premier prélèvement.
 *
 * Deux pièges de dates sont figés ici, parce qu'ils se sont déjà
 * produits dans ce projet et qu'ils ne se voient pas à la lecture :
 * le débordement de setMonth() sur les mois courts, et la dérive d'un
 * jour quand une date à minuit local est enregistrée dans une colonne
 * DATE.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildInstallments, computeSchedule } from '../../src/services/creditService.js';

const jour = (d) => d.toISOString().slice(0, 10);

describe('Échéancier — les dates', () => {
  test('sans date de séance, la première échéance reste à l’approbation + 1 mois', () => {
    const { monthlyPayment, totalDue } = computeSchedule(300000, 3, 0.05);
    const ech = buildInstallments(new Date('2026-10-23T14:00:00Z'), 3, monthlyPayment, totalDue);
    assert.deepEqual(ech.map((e) => jour(e.dueDate)), ['2026-11-23', '2026-12-23', '2027-01-23']);
  });

  test('avec une date de séance, tout l’échéancier s’y aligne', () => {
    // Le cas réel : validé le 23/10, prélevé le 3 novembre, puis le 3
    // de chaque mois.
    const { monthlyPayment, totalDue } = computeSchedule(300000, 3, 0.05);
    const ech = buildInstallments(
      new Date('2026-10-23T14:00:00Z'), 3, monthlyPayment, totalDue, '2026-11-03'
    );
    assert.deepEqual(ech.map((e) => jour(e.dueDate)), ['2026-11-03', '2026-12-03', '2027-01-03']);
  });

  test('un 31 ne saute pas le mois court — il se borne à sa fin', () => {
    // `setMonth(+1)` sur un 31 janvier donnait le 3 mars : février
    // disparaissait de l'échéancier.
    const { monthlyPayment, totalDue } = computeSchedule(400000, 4, 0.05);
    const ech = buildInstallments(null, 4, monthlyPayment, totalDue, '2027-01-31');
    assert.deepEqual(
      ech.map((e) => jour(e.dueDate)),
      ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30']
    );
  });

  test('le 29 février d’une année bissextile est respecté', () => {
    const { monthlyPayment, totalDue } = computeSchedule(200000, 2, 0.05);
    const ech = buildInstallments(null, 2, monthlyPayment, totalDue, '2028-01-29');
    assert.deepEqual(ech.map((e) => jour(e.dueDate)), ['2028-01-29', '2028-02-29']);
  });

  test('la date n’est jamais à minuit — sinon elle dérive d’un jour', () => {
    // due_date est une colonne DATE : une date a minuit heure locale
    // devient la veille en UTC, et l'echeance se retrouve datee d'un
    // jour plus tot. A midi, aucun fuseau plausible ne change le jour.
    const { monthlyPayment, totalDue } = computeSchedule(100000, 2, 0.05);
    for (const e of buildInstallments(null, 2, monthlyPayment, totalDue, '2026-11-03')) {
      assert.equal(e.dueDate.getUTCHours(), 12, 'midi UTC, pour qu’aucun fuseau ne décale le jour');
    }
  });

  test('la somme des échéances reste exactement le total dû', () => {
    // Garde-fou inchangé : la dernière échéance absorbe l'arrondi.
    const { monthlyPayment, totalDue } = computeSchedule(300001, 3, 0.0921);
    const ech = buildInstallments(null, 3, monthlyPayment, totalDue, '2026-11-03');
    assert.equal(ech.reduce((s, e) => s + e.amount, 0), totalDue);
  });
});
