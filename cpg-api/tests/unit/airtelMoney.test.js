import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMsisdn, mapStatus } from '../../src/services/operators/airtelHelpers.js';

describe('normalizeMsisdn', () => {
  test('retire l’indicatif gabonais', () => {
    assert.equal(normalizeMsisdn('+24106000001'), '06000001');
    assert.equal(normalizeMsisdn('24106000001'), '06000001');
  });

  test('laisse intact un numéro déjà national', () => {
    assert.equal(normalizeMsisdn('06000001'), '06000001');
  });

  test('retire espaces et séparateurs', () => {
    assert.equal(normalizeMsisdn('+241 06 00 00 01'), '06000001');
    assert.equal(normalizeMsisdn('241-06-00-00-01'), '06000001');
  });
});

describe('mapStatus', () => {
  test('reconnaît les succès', () => {
    for (const code of ['TS', 'SUCCESS', 'successful', 'COMPLETED']) {
      assert.equal(mapStatus(code), 'confirmee', code);
    }
  });

  test('reconnaît les échecs', () => {
    for (const code of ['TF', 'FAILED', 'rejected']) {
      assert.equal(mapStatus(code), 'echouee', code);
    }
  });

  test('un statut inconnu n’est JAMAIS traité comme un succès', () => {
    // Règle prudente : créditer un compte sur un statut mal interprété
    // donnerait de l'argent qui n'est jamais arrivé.
    for (const code of ['XYZ', '', null, undefined, 'OK', '200']) {
      assert.equal(mapStatus(code), 'en_attente', String(code));
    }
  });
});
