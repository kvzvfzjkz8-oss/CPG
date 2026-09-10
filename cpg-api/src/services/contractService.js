import PDFDocument from 'pdfkit';

function formatFCFA(n) {
  const entier = Math.round(Number(n) || 0);
  // Les polices PDF standard (Helvetica) n'affichent pas correctement
  // l'espace fine insécable qu'Intl.NumberFormat('fr-FR') utilise par
  // défaut pour séparer les milliers — elle apparaît comme un « / ».
  // Un espace normal fonctionne dans toutes les polices standard.
  return String(entier).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

const FOREST = '#0B3D2E';
const GOLD = '#B8860B';
const INK = '#1A1F1C';
const MUTED = '#5B6B62';
const LINE = '#E4E9E3';

const moisFr = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

function formatDateFr(d) {
  const date = new Date(d);
  return `${date.getDate()} ${moisFr[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * Génère le PDF du contrat de prêt — conditions du crédit accordé et
 * tableau des échéances réellement suivies par le système (montant,
 * date, statut). Le prêt est à intérêt simple : chaque mensualité
 * couvre une part égale du capital et des intérêts, pas de tableau
 * d'amortissement dégressif à inventer ici — ce n'est pas comme ça
 * que le crédit est réellement comptabilisé.
 */
export function genererContratPDF({ credit, client, installments }) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });

  // ─── En-tête ────────────────────────────────────────────────────
  doc.fillColor(FOREST).fontSize(18).font('Helvetica-Bold')
    .text('CRÉDIT POPULAIRE DU GABON', { align: 'center' });
  doc.fillColor(MUTED).fontSize(10).font('Helvetica')
    .text('Contrat de prêt', { align: 'center' });
  doc.moveDown(0.3);
  doc.strokeColor(FOREST).lineWidth(1.5)
    .moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown(1);

  // ─── Référence et date ──────────────────────────────────────────
  doc.fillColor(INK).fontSize(9).font('Helvetica')
    .text(`Référence : ${credit.reference}`, { continued: true })
    .text(`     Établi le ${formatDateFr(new Date())}`, { align: 'right' });
  doc.moveDown(1);

  // ─── Parties ────────────────────────────────────────────────────
  doc.fillColor(FOREST).fontSize(12).font('Helvetica-Bold').text('Entre les soussignés');
  doc.moveDown(0.4);
  doc.fillColor(INK).fontSize(10).font('Helvetica')
    .text('Crédit Populaire du Gabon (CPG), ci-après désigné « le prêteur »,');
  doc.moveDown(0.3);
  doc.text('et', { continued: false });
  doc.moveDown(0.3);
  doc.font('Helvetica-Bold').text(client.full_name, { continued: true })
    .font('Helvetica').text(`, titulaire du compte ${client.client_number}`);
  if (client.job_title || client.employer) {
    doc.fillColor(MUTED).fontSize(9)
      .text([client.job_title, client.employer].filter(Boolean).join(' · '));
  }
  doc.fillColor(INK).fontSize(10).text('ci-après désigné « l\'emprunteur ».');
  doc.moveDown(1.2);

  // ─── Conditions du prêt ─────────────────────────────────────────
  doc.fillColor(FOREST).fontSize(12).font('Helvetica-Bold').text('Conditions du prêt accordé');
  doc.moveDown(0.5);

  const conditions = [
    ['Montant emprunté', `${formatFCFA(credit.amount)} FCFA`],
    ['Taux mensuel', `${(Number(credit.monthly_rate) * 100).toFixed(2).replace('.', ',')} %`],
    ['Durée', `${credit.duration_months} mois`],
    ['Mensualité', `${formatFCFA(installments[0]?.amount ?? 0)} FCFA`],
    ['Frais de dossier', `${formatFCFA(credit.file_fee ?? 0)} FCFA`],
    ['Motif du prêt', credit.purpose || '—'],
  ];

  const colLabelX = 50, colValueX = 220, rowH = 20;
  conditions.forEach(([label, value]) => {
    doc.fillColor(MUTED).fontSize(9).font('Helvetica').text(label, colLabelX, doc.y, { width: 160 });
    doc.fillColor(INK).fontSize(10).font('Helvetica-Bold').text(value, colValueX, doc.y - 12);
    doc.moveDown(0.6);
  });
  doc.moveDown(0.8);

  // ─── Tableau des échéances ──────────────────────────────────────
  doc.fillColor(FOREST).fontSize(12).font('Helvetica-Bold').text('Échéancier de remboursement');
  doc.moveDown(0.5);

  const tableTop = doc.y;
  const cols = [
    { label: 'N°', x: 50, w: 40 },
    { label: 'Date d\'échéance', x: 90, w: 140 },
    { label: 'Montant', x: 230, w: 120 },
    { label: 'Statut', x: 350, w: 145 },
  ];

  doc.fillColor('#fff').rect(50, tableTop, 495, 20).fill(FOREST);
  cols.forEach((c) => {
    doc.fillColor('#fff').fontSize(9).font('Helvetica-Bold').text(c.label, c.x + 4, tableTop + 6, { width: c.w - 8 });
  });

  let y = tableTop + 20;
  installments.forEach((ins, i) => {
    const statut = ins.status === 'payee' ? 'Payée' : ins.status === 'en_retard' ? 'En retard' : 'À échoir';
    const bg = i % 2 === 0 ? '#F7F9F6' : '#FFFFFF';
    doc.rect(50, y, 495, 18).fill(bg);
    doc.fillColor(INK).fontSize(9).font('Helvetica');
    doc.text(String(ins.sequence), cols[0].x + 4, y + 4, { width: cols[0].w - 8 });
    doc.text(formatDateFr(ins.due_date), cols[1].x + 4, y + 4, { width: cols[1].w - 8 });
    doc.text(`${formatFCFA(ins.amount)} FCFA`, cols[2].x + 4, y + 4, { width: cols[2].w - 8 });
    doc.fillColor(statut === 'Payée' ? FOREST : statut === 'En retard' ? '#B3261E' : MUTED)
      .text(statut, cols[3].x + 4, y + 4, { width: cols[3].w - 8 });
    y += 18;

    if (y > 720 && i < installments.length - 1) {
      doc.addPage();
      y = 50;
    }
  });

  doc.strokeColor(LINE).lineWidth(0.5).rect(50, tableTop, 495, y - tableTop).stroke();

  // ─── Signatures ─────────────────────────────────────────────────
  if (y > 650) { doc.addPage(); y = 60; } else { y += 50; }
  doc.fillColor(MUTED).fontSize(9).font('Helvetica')
    .text('Fait en deux exemplaires, chacune des parties reconnaissant en avoir reçu un original.', 50, y, { width: 495, align: 'center' });
  y += 50;

  doc.fillColor(INK).fontSize(10).font('Helvetica-Bold')
    .text('Pour le prêteur (CPG)', 80, y)
    .text('L\'emprunteur', 350, y);
  doc.fillColor(MUTED).fontSize(9).font('Helvetica')
    .text('Signature et cachet', 80, y + 60)
    .text('Signature', 350, y + 60);

  doc.end();
  return doc;
}
