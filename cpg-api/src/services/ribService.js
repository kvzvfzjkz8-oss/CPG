import PDFDocument from 'pdfkit';

/**
 * ─────────────────────────────────────────────────────────────────────
 *  RELEVÉ D'IDENTITÉ DU COMPTE — une demi-page, à détacher
 * ─────────────────────────────────────────────────────────────────────
 *
 * « Il faut que dans l'onglet utilisateur, on puisse avoir la
 *   possibilité d'imprimer le RIB de chaque client. »
 *   (direction, 14/11/2026)
 *
 * CE QUE CE DOCUMENT EST, ET CE QU'IL N'EST PAS
 *
 * CPG n'a pas de code banque attribué — la direction l'a confirmé le
 * 14/11/2026. Ce document n'est donc PAS un RIB bancaire normalisé : il
 * n'a ni code banque, ni code guichet, ni clé de contrôle, et aucun
 * établissement tiers ne pourra l'utiliser pour un virement
 * interbancaire.
 *
 * C'est un relevé d'identité INTERNE : il dit qui est le titulaire et
 * sous quel numéro CPG tient son compte, pour qu'un employeur, un
 * organisme ou un proche sache où verser. C'est le besoin réel, et le
 * document le dit lui-même en toutes lettres plutôt que de laisser
 * croire à une normalisation qu'on n'a pas — un faux RIB qui circule
 * finit toujours par être présenté à une vraie banque.
 *
 * Le numéro client EST l'identifiant du compte : la table `accounts` ne
 * porte qu'un identifiant technique (un UUID), illisible et inutile à
 * dicter au téléphone.
 */

const FOREST = '#0B3D2E';
const MUTED = '#5B6B62';
const INK = '#1A1F1C';
const LINE = '#E4E9E3';
const PALE = '#F2F6F2';

const G = 50;
const D = 545;
const L = D - G;

function jour(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Une ligne « libellé / valeur », alignée en colonnes. */
function ligne(doc, y, libelle, valeur, options = {}) {
  doc.fillColor(MUTED).fontSize(8.5).font('Helvetica-Bold')
    .text(libelle.toUpperCase(), G + 14, y, { width: 150 });
  doc.fillColor(options.couleur ?? INK)
    .fontSize(options.taille ?? 11)
    .font(options.gras ? 'Helvetica-Bold' : 'Helvetica')
    .text(valeur ?? '—', G + 170, y - 2, { width: L - 184 });
  return y + (options.hauteur ?? 24);
}

export function genererRibPDF({ client, compte, editePar }) {
  const doc = new PDFDocument({ size: 'A4', margin: G });

  // ── En-tête, repris des autres documents de la maison ────────────
  doc.fillColor(FOREST).fontSize(18).font('Helvetica-Bold')
    .text('CRÉDIT POPULAIRE DU GABON', { align: 'center' });
  doc.fillColor(MUTED).fontSize(10).font('Helvetica')
    .text('Relevé d’identité de compte', { align: 'center' });
  doc.moveDown(0.3);
  doc.strokeColor(FOREST).lineWidth(1.5).moveTo(G, doc.y).lineTo(D, doc.y).stroke();
  doc.moveDown(1.2);

  // ── Le cadre, pensé pour être découpé et collé ───────────────────
  const haut = doc.y;
  const hauteur = 196;
  doc.roundedRect(G, haut, L, hauteur, 8).fillAndStroke(PALE, LINE);

  let y = haut + 20;
  y = ligne(doc, y, 'Titulaire du compte', client.full_name, { gras: true, taille: 13, hauteur: 30 });
  y = ligne(doc, y, 'Numéro de compte', client.client_number, {
    gras: true, taille: 15, couleur: FOREST, hauteur: 32,
  });
  y = ligne(doc, y, 'Téléphone', client.phone);
  y = ligne(doc, y, 'Employeur', client.employer?.trim() || '—');
  y = ligne(doc, y, 'Devise', compte?.currency ? `${compte.currency} — franc CFA` : 'XAF — franc CFA');
  y = ligne(doc, y, 'Compte ouvert le', jour(compte?.created_at));

  // ── L'avertissement, en clair ────────────────────────────────────
  doc.y = haut + hauteur + 18;
  doc.fillColor(INK).fontSize(9.5).font('Helvetica-Bold')
    .text('Comment verser sur ce compte', G, doc.y);
  doc.moveDown(0.3);
  doc.fillColor(MUTED).fontSize(9).font('Helvetica').text(
    `Les versements se font au guichet du Crédit Populaire du Gabon, en indiquant le numéro `
    + `de compte ${client.client_number} et le nom du titulaire. Un virement d’employeur peut `
    + `également être transmis par fichier de paie, le numéro de compte servant d’identifiant.`,
    G, doc.y, { width: L, align: 'justify' }
  );

  doc.moveDown(0.8);
  doc.fillColor(MUTED).fontSize(8).font('Helvetica-Oblique').text(
    'Ce relevé identifie un compte tenu par le Crédit Populaire du Gabon. Il ne constitue pas '
    + 'un relevé d’identité bancaire normalisé : il ne comporte ni code banque, ni code guichet, '
    + 'ni clé de contrôle, et ne peut pas servir à un virement interbancaire.',
    G, doc.y, { width: L, align: 'justify' }
  );

  // ── Pied de page ─────────────────────────────────────────────────
  doc.fillColor(MUTED).fontSize(8).font('Helvetica').text(
    `Édité le ${jour(new Date())}${editePar ? ` par ${editePar}` : ''}`,
    G, 760, { width: L, align: 'center' }
  );

  doc.end();
  return doc;
}
