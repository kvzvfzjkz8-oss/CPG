import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseSalaryCsv } from '../../src/utils/csvParser.js';

describe('parseSalaryCsv', () => {
  test('lit un fichier simple sans en-tête', () => {
    const { entries, erreurs } = parseSalaryCsv('+24106000001,412500\nCPG-00933,230000');
    assert.equal(erreurs.length, 0);
    assert.deepEqual(entries, [
      { identifiant: '+24106000001', montant: 412500 },
      { identifiant: 'CPG-00933', montant: 230000 },
    ]);
  });

  test('ignore une ligne d\'en-tête reconnaissable', () => {
    const { entries, erreurs } = parseSalaryCsv('Identifiant,Montant\n+24106000001,412500');
    assert.equal(erreurs.length, 0);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].identifiant, '+24106000001');
  });

  test('accepte les noms complets comme identifiant', () => {
    const { entries } = parseSalaryCsv('Jean-Paul Ndong,412500');
    assert.equal(entries[0].identifiant, 'Jean-Paul Ndong');
  });

  test('gère les guillemets pour un nom contenant une virgule', () => {
    const { entries } = parseSalaryCsv('"Ndong, Jean-Paul",412500');
    assert.equal(entries[0].identifiant, 'Ndong, Jean-Paul');
  });

  test('accepte les espaces comme séparateur de milliers', () => {
    const { entries } = parseSalaryCsv('+24106000001,412 500');
    assert.equal(entries[0].montant, 412500);
  });

  test('signale une ligne avec un montant invalide, sans bloquer les autres', () => {
    const { entries, erreurs } = parseSalaryCsv(
      '+24106000001,412500\n+24106000002,pas-un-montant\n+24106000003,50000'
    );
    assert.equal(entries.length, 2);
    assert.equal(erreurs.length, 1);
    assert.equal(erreurs[0].ligne, 2);
    assert.equal(erreurs[0].motif, 'montant_invalide');
  });

  test('signale une colonne manquante', () => {
    const { erreurs } = parseSalaryCsv('+24106000001');
    assert.equal(erreurs[0].motif, 'colonnes_manquantes');
  });

  test('rejette un montant négatif ou nul', () => {
    const { erreurs } = parseSalaryCsv('+24106000001,0\n+24106000002,-5000');
    assert.equal(erreurs.length, 2);
    assert.ok(erreurs.every((e) => e.motif === 'montant_invalide'));
  });

  test('ignore les lignes vides', () => {
    const { entries } = parseSalaryCsv('+24106000001,412500\n\n\nCPG-00933,230000\n');
    assert.equal(entries.length, 2);
  });

  test('fichier vide renvoie des listes vides', () => {
    const { entries, erreurs } = parseSalaryCsv('');
    assert.equal(entries.length, 0);
    assert.equal(erreurs.length, 0);
  });

  test('gère les fins de ligne Windows (CRLF)', () => {
    const { entries } = parseSalaryCsv('+24106000001,412500\r\nCPG-00933,230000\r\n');
    assert.equal(entries.length, 2);
  });
});
