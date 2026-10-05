import PDFDocument from 'pdfkit';

/**
 * ─────────────────────────────────────────────────────────────────────
 *  SITUATION DU COMPTE CLIENT — UNE PAGE, IMPRIMABLE
 * ─────────────────────────────────────────────────────────────────────
 *
 * « Les gestionnaires n'arrivent pas à visualiser la situation du
 *   compte de leur client : solde, crédit en cours et échéances
 *   restantes, de manière brève et imprimable. »
 *
 * L'historique des transactions (historiqueService) répond à une autre
 * question : ce qui s'est passé. Ici on répond à « où en est-on
 * aujourd'hui » — un état des lieux qu'on tend au client au guichet.
 *
 * Tenir sur une page est le but, pas une contrainte subie : seuls les
 * crédits encore vivants sont détaillés échéance par échéance ; les
 * dossiers clos ne sont rappelés qu'en une ligne.
 */

const FOREST = '#0B3D2E';
const MUTED = '#5B6B62';
const INK = '#1A1F1C';
const DANGER = '#B3261E';
const LINE = '#E4E9E3';
const PALE = '#F2F6F2';

const G = 50;            // marge gauche
const D = 545;           // marge droite
const L = D - G;         // largeur utile

function fcfa(n) {
  return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function jour(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const STATUT = {
  approuve: 'En cours', solde: 'Soldé', suspendu: 'Suspendu', annule: 'Annulé',
  rejete: 'Rejeté', en_verification: 'En vérification', valide_niveau1: 'Validé niveau 1',
  en_attente_commission: 'En attente de commission', valide_commission: 'Validé en commission',
  valide_double: 'Double validation faite',
};

const ETAT_ECHEANCE = { payee: 'Payée', en_retard: 'En retard', a_venir: 'À venir' };

/** Bandeau d'en-tête, repris du contrat et de l'historique. */
function entete(doc) {
  doc.fillColor(FOREST).fontSize(18).font('Helvetica-Bold')
    .text('CRÉDIT POPULAIRE DU GABON', { align: 'center' });
  doc.fillColor(MUTED).fontSize(10).font('Helvetica')
    .text('Situation du compte', { align: 'center' });
  doc.moveDown(0.3);
  doc.strokeColor(FOREST).lineWidth(1.5).moveTo(G, doc.y).lineTo(D, doc.y).stroke();
  doc.moveDown(0.8);
}

/** Un encadré « chiffre clé ». */
function tuile(doc, x, y, largeur, libelle, valeur, couleur) {
  doc.roundedRect(x, y, largeur, 46, 6).fillAndStroke(PALE, LINE);
  doc.fillColor(MUTED).fontSize(7.5).font('Helvetica-Bold')
    .text(libelle.toUpperCase(), x + 8, y + 8, { width: largeur - 16 });
  doc.fillColor(couleur ?? INK).fontSize(13).font('Helvetica-Bold')
    .text(valeur, x + 8, y + 22, { width: largeur - 16 });
}

export function genererSituationPDF({ client, credits, totaux, editePar }) {
  const doc = new PDFDocument({ size: 'A4', margin: G });
  entete(doc);

  // ── Identité ──────────────────────────────────────────────────────
  doc.fillColor(INK).fontSize(13).font('Helvetica-Bold').text(client.full_name);
  doc.fillColor(MUTED).fontSize(9).font('Helvetica')
    .text([
      client.client_number ?? '—',
      client.phone && !String(client.phone).startsWith('A-COMPLETER') ? client.phone : null,
      client.employer,
      client.job_title,
    ].filter(Boolean).join(' · '));
  doc.moveDown(0.8);

  // ── Chiffres clés ─────────────────────────────────────────────────
  const y0 = doc.y;
  const lt = (L - 2 * 10) / 3;
  tuile(doc, G, y0, lt, 'Solde du compte', `${fcfa(client.balance)} F`,
    Number(client.balance) < 0 ? DANGER : FOREST);
  tuile(doc, G + lt + 10, y0, lt, 'Reste à rembourser', `${fcfa(totaux.resteDu)} F`);
  tuile(doc, G + 2 * (lt + 10), y0, lt, 'Échéances en retard',
    String(totaux.enRetard), totaux.enRetard > 0 ? DANGER : INK);
  doc.y = y0 + 46 + 14;

  // ── Crédits en cours ──────────────────────────────────────────────
  const vivants = credits.filter((c) => ['approuve', 'suspendu'].includes(c.status));
  const clos = credits.filter((c) => !['approuve', 'suspendu'].includes(c.status));

  doc.fillColor(INK).fontSize(11).font('Helvetica-Bold')
    .text(vivants.length ? `Crédits en cours (${vivants.length})` : 'Crédits en cours', G, doc.y);
  doc.moveDown(0.4);

  if (!vivants.length) {
    doc.fillColor(MUTED).fontSize(9).font('Helvetica-Oblique')
      .text('Aucun crédit en cours pour ce client.', G, doc.y);
    doc.moveDown(0.6);
  }

  for (const c of vivants) {
    if (doc.y > 690) { doc.addPage(); entete(doc); }

    doc.roundedRect(G, doc.y, L, 20, 4).fill(FOREST);
    const yb = doc.y;
    doc.fillColor('#fff').fontSize(9.5).font('Helvetica-Bold')
      .text(`${c.reference}  —  ${fcfa(c.amount)} F sur ${c.duration_months} mois`, G + 8, yb + 6, { width: L - 150 });
    doc.fillColor('#fff').fontSize(9).font('Helvetica')
      .text(STATUT[c.status] ?? c.status, D - 150, yb + 6, { width: 142, align: 'right' });
    doc.y = yb + 26;

    doc.fillColor(MUTED).fontSize(8.5).font('Helvetica')
      .text(
        `Débloqué le ${jour(c.approved_at)}  ·  mensualité ${fcfa(c.monthly_payment)} F  ·  `
        + `${c.payees}/${c.total_echeances} échéances réglées  ·  reste ${fcfa(c.reste_du)} F`,
        G + 2, doc.y, { width: L - 4 });
    doc.moveDown(0.5);

    const aVenir = (c.echeances ?? []).filter((e) => e.status !== 'payee');
    if (aVenir.length) {
      const cols = [
        { l: 'N°', x: G + 2, w: 30 },
        { l: 'Échéance', x: G + 32, w: 90 },
        { l: 'Montant', x: G + 122, w: 100 },
        { l: 'État', x: G + 222, w: 90 },
      ];
      let y = doc.y;
      doc.rect(G, y, L, 15).fill(PALE);
      cols.forEach((col) => {
        doc.fillColor(MUTED).fontSize(7.5).font('Helvetica-Bold')
          .text(col.l.toUpperCase(), col.x + 2, y + 4.5, { width: col.w - 4 });
      });
      y += 15;

      for (const e of aVenir) {
        if (y > 740) { doc.addPage(); entete(doc); y = doc.y; }
        const retard = e.status === 'en_retard';
        doc.fillColor(INK).fontSize(8.5).font('Helvetica')
          .text(String(e.sequence), cols[0].x + 2, y + 3, { width: cols[0].w - 4 })
          .text(jour(e.due_date), cols[1].x + 2, y + 3, { width: cols[1].w - 4 });
        doc.font('Helvetica-Bold')
          .text(`${fcfa(e.amount)} F`, cols[2].x + 2, y + 3, { width: cols[2].w - 4 });
        doc.fillColor(retard ? DANGER : MUTED).font('Helvetica')
          .text(ETAT_ECHEANCE[e.status] ?? e.status, cols[3].x + 2, y + 3, { width: cols[3].w - 4 });
        doc.strokeColor(LINE).lineWidth(0.5).moveTo(G, y + 14).lineTo(D, y + 14).stroke();
        y += 15;
      }
      doc.y = y + 8;
    } else {
      doc.fillColor(MUTED).fontSize(8.5).font('Helvetica-Oblique')
        .text('Toutes les échéances sont réglées.', G + 2, doc.y);
      doc.moveDown(0.8);
    }
  }

  // ── Dossiers clos, en rappel ──────────────────────────────────────
  if (clos.length) {
    if (doc.y > 680) { doc.addPage(); entete(doc); }
    doc.moveDown(0.3);
    doc.fillColor(INK).fontSize(10).font('Helvetica-Bold')
      .text(`Autres dossiers (${clos.length})`, G, doc.y);
    doc.moveDown(0.3);
    for (const c of clos) {
      if (doc.y > 760) { doc.addPage(); entete(doc); }
      doc.fillColor(MUTED).fontSize(8.5).font('Helvetica')
        .text(`${c.reference} — ${fcfa(c.amount)} F sur ${c.duration_months} mois — ${STATUT[c.status] ?? c.status}`,
          G + 2, doc.y, { width: L - 4 });
      doc.moveDown(0.15);
    }
  }

  // ── Pied de page ──────────────────────────────────────────────────
  doc.moveDown(1);
  const yp = Math.min(doc.y, 780);
  doc.strokeColor(LINE).lineWidth(0.5).moveTo(G, yp).lineTo(D, yp).stroke();
  doc.fillColor(MUTED).fontSize(7.5).font('Helvetica')
    .text(
      `Situation arrêtée au ${jour(new Date())}${editePar ? ` · éditée par ${editePar}` : ''}`
      + ' · Document d’information, ne vaut pas quittance.',
      G, yp + 5, { width: L, align: 'center' });

  doc.end();
  return doc;
}
