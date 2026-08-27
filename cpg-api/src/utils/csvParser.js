/**
 * ═══════════════════════════════════════════════════════════════════
 *  LECTURE DU FICHIER DE PAIE
 * ═══════════════════════════════════════════════════════════════════
 *
 * Format attendu, deux colonnes, avec ou sans en-tête :
 *
 *   identifiant,montant
 *   +24106000001,412500
 *   CPG-00933,230000
 *
 * L'identifiant est un numéro de téléphone, un numéro client (CPG-xxxxx)
 * ou, à défaut, le nom complet tel qu'il apparaît dans le dossier client
 * — certains employeurs ne transmettent que des noms. Aucune dépendance
 * externe : le format est trop simple pour le justifier, et une fonction
 * pure se teste sans toucher au disque ni à la base.
 */

/** Découpe une ligne CSV en respectant les champs entre guillemets. */
function splitCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

/** Un montant peut arriver avec des espaces comme séparateur de milliers. */
function parseMontant(raw) {
  const cleaned = raw.replace(/[\s\u00A0]/g, '');
  if (!/^\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * @param {string} text  Contenu brut du fichier.
 * @returns {{ entries: Array<{identifiant: string, montant: number}>, erreurs: Array<{ligne: number, motif: string, contenu: string}> }}
 */
export function parseSalaryCsv(text) {
  const entries = [];
  const erreurs = [];

  const lines = (text ?? '')
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const fields = splitCsvLine(line);

    if (fields.length < 2) {
      erreurs.push({ ligne: lineNumber, motif: 'colonnes_manquantes', contenu: line });
      return;
    }

    const [identifiantRaw, montantRaw] = fields;
    const identifiant = identifiantRaw.trim();
    const montant = parseMontant(montantRaw);

    // En-tête probable : la deuxième colonne ne ressemble pas à un
    // montant, sur la toute première ligne. On l'ignore sans erreur.
    if (lineNumber === 1 && montant === null && /[a-zàâéèêëïîôùûç]/i.test(montantRaw)) {
      return;
    }

    if (!identifiant) {
      erreurs.push({ ligne: lineNumber, motif: 'identifiant_manquant', contenu: line });
      return;
    }
    if (montant === null) {
      erreurs.push({ ligne: lineNumber, motif: 'montant_invalide', contenu: line });
      return;
    }

    entries.push({ identifiant, montant });
  });

  return { entries, erreurs };
}
