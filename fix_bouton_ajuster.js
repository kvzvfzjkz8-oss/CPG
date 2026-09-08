const fs = require('fs');
const path = process.argv[2] || '/Users/pierredavidndobakoumba/Documents/CPG-old/cpg-admin/src/views/CatalogView.jsx';

let content = fs.readFileSync(path, 'utf8');

const oldStr = `        <button
          onClick={submit}
          disabled={busy || form.motif.trim().length < 5 || (isTaux ? !form.rate : !form.amount)}
          style={actionBtn(colors.forest, '#fff')}
        >
          Appliquer
        </button>`;

const newStr = `        <button
          onClick={submit}
          disabled={disabled}
          style={{ ...actionBtn(colors.forest, '#fff'), opacity: disabled ? 0.4 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
        >
          Appliquer
        </button>`;

if (!content.includes(oldStr)) {
  console.error("Le texte attendu n'a pas été trouvé — le fichier a peut-être déjà été modifié. Aucun changement appliqué.");
  process.exit(1);
}

content = content.replace(oldStr, newStr);

// Calcule "disabled" une seule fois, juste avant le rendu, pour éviter
// de répéter la condition et pour pouvoir aussi afficher un message
// clair sous le champ motif.
const anchor = `  const submit = () => {`;
const injected = `  const disabled = form.motif.trim().length < 5 || (isTaux ? !form.rate : !form.amount);

  const submit = () => {`;

if (!content.includes(anchor)) {
  console.error("Point d'insertion pour 'disabled' introuvable.");
  process.exit(1);
}
content = content.replace(anchor, injected);

// Message clair sous le champ motif quand il est trop court.
const motifBlock = `        <Field span={4}>
          <label style={label}>Motif (obligatoire)</label>
          <input
            style={input} value={form.motif} onChange={set('motif')}
            placeholder="Pourquoi ce changement ?"
          />
        </Field>`;

const motifBlockNew = `        <Field span={4}>
          <label style={label}>Motif (obligatoire — 5 caractères minimum)</label>
          <input
            style={input} value={form.motif} onChange={set('motif')}
            placeholder="Pourquoi ce changement ?"
          />
          {form.motif.length > 0 && form.motif.trim().length < 5 && (
            <p style={{ margin: '4px 0 0', fontSize: 10, color: colors.danger, fontFamily: fonts.body }}>
              Encore {5 - form.motif.trim().length} caractère(s) au moins.
            </p>
          )}
        </Field>`;

if (content.includes(motifBlock)) {
  content = content.replace(motifBlock, motifBlockNew);
} else {
  console.warn("Bloc du champ motif non trouvé tel quel — cette partie du correctif est ignorée (le bouton reste corrigé).");
}

fs.writeFileSync(path, content, 'utf8');
console.log('Correctif appliqué avec succès.');
