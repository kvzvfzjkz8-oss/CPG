/**
 * ═══════════════════════════════════════════════════════════════════
 *  LE 30 DU MOIS — ET LES MOIS QUI N'EN ONT PAS
 * ═══════════════════════════════════════════════════════════════════
 *
 * « Tous les 30 de chaque mois les frais de tenue doivent être
 *   prélevés. » (direction, 03/11/2026)
 *
 * Une expression cron en « 30 de chaque mois » saute février
 * entièrement : 1 287 000 F de frais perdus chaque année, sans que
 * personne ne le voie. La tâche est donc programmée du 28 au 31 et
 * c'est ce garde qui choisit le jour.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { estLeTrenteOuFinDeMois } from '../../src/jobs/scheduler.js';

// Midi UTC : à cette heure, Libreville (UTC+1) est le même jour, et le
// test ne dépend pas du fuseau de la machine qui l'exécute.
const le = (iso) => new Date(`${iso}T12:00:00Z`);

describe('Frais de tenue — le jour du prélèvement', () => {
  test('le 30 d’un mois de 31 jours : oui', () => {
    assert.equal(estLeTrenteOuFinDeMois(le('2026-01-30')), true);
    assert.equal(estLeTrenteOuFinDeMois(le('2026-12-30')), true);
  });

  test('le 31 : non — le prélèvement a déjà eu lieu la veille', () => {
    assert.equal(estLeTrenteOuFinDeMois(le('2026-01-31')), false);
    assert.equal(estLeTrenteOuFinDeMois(le('2026-12-31')), false);
  });

  test('le 30 d’un mois de 30 jours : oui, et c’est aussi sa fin', () => {
    assert.equal(estLeTrenteOuFinDeMois(le('2026-04-30')), true);
    assert.equal(estLeTrenteOuFinDeMois(le('2026-11-30')), true);
  });

  test('février, qui n’a pas de 30 : son dernier jour', () => {
    // LE cas pour lequel ce garde existe.
    assert.equal(estLeTrenteOuFinDeMois(le('2026-02-28')), true, 'février 2026 : 28 jours');
    assert.equal(estLeTrenteOuFinDeMois(le('2026-02-27')), false);

    assert.equal(estLeTrenteOuFinDeMois(le('2028-02-29')), true, 'février 2028 : bissextile');
    assert.equal(estLeTrenteOuFinDeMois(le('2028-02-28')), false, 'le 28 n’est pas la fin en 2028');
  });

  test('les autres jours de la plage 28-31 : non', () => {
    for (const j of ['2026-01-28', '2026-01-29', '2026-04-28', '2026-04-29']) {
      assert.equal(estLeTrenteOuFinDeMois(le(j)), false, `${j} ne doit pas déclencher`);
    }
  });

  test('le jour se lit à Libreville, pas sur le serveur', () => {
    // Railway tourne en UTC. Le 29 novembre à 23 h 30 UTC, il est déjà
    // le 30 à Libreville (UTC+1) : c'est l'heure de l'agence qui compte.
    assert.equal(
      estLeTrenteOuFinDeMois(new Date('2026-11-29T23:30:00Z')), true,
      'minuit passé au Gabon, donc le 30'
    );
    assert.equal(
      estLeTrenteOuFinDeMois(new Date('2026-11-30T23:30:00Z')), false,
      'et le 30 à 23 h 30 UTC, il est déjà le 1er décembre au Gabon'
    );
  });
});
