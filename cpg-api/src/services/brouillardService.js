import PDFDocument from 'pdfkit';

const FOREST = '#0B3D2E';
const MUTED = '#5B6B62';
const INK = '#1A1F1C';
const DANGER = '#B3261E';
const LINE = '#E4E9E3';

function formatFCFA(n) {
  const entier = Math.round(Number(n) || 0);
  return String(entier).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

const moisFr = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

function formatDateFr(d) {
  const date = new Date(d);
  return `${date.getDate()} ${moisFr[date.getMonth()]} ${date.getFullYear()}`;
}

const LABELS = {
  encaissement_client: 'Réception client',
  retrait_client: 'Paiement à un client',
  appro: 'Réapprovisionnement',
  depense: 'Dépense de fonctionnement',
  retour_excedent: "Retour d'excédent",
};

const ENTREE = new Set(['encaissement_client', 'appro']);

/**
 * Brouillard de caisse — relevé quotidien d'une caissière : solde
 * d'ouverture, chaque opération validée de la journée avec le solde
 * courant après chacune, solde de clôture. Un seul document par
 * caissière et par jour, pour archive et vérification par le
 * directeur.
 */
export function genererBrouillardPDF({ caissiere, date, soldeOuverture, operations }) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });

  doc.fillColor(FOREST).fontSize(18).font('Helvetica-Bold')
    .text('CRÉDIT POPULAIRE DU GABON', { align: 'center' });
  doc.fillColor(MUTED).fontSize(10).font('Helvetica')
    .text('Brouillard de caisse', { align: 'center' });
  doc.moveDown(0.3);
  doc.strokeColor(FOREST).lineWidth(1.5).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown(1);

  doc.fillColor(INK).fontSize(10).font('Helvetica-Bold').text(caissiere, { continued: true })
    .font('Helvetica').text(`     ${formatDateFr(date)}`, { align: 'right' });
  doc.moveDown(1.2);

  let solde = soldeOuverture;
  const lignes = [['—', 'Solde d\'ouverture', '', formatFCFA(solde)]];
  operations.forEach((op) => {
    const signe = ENTREE.has(op.type) ? 1 : -1;
    solde += signe * op.montant;
    const heure = new Date(op.decidee_le ?? op.demandee_le).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    lignes.push([
      heure,
      LABELS[op.type] ?? op.type,
      `${signe > 0 ? '+' : '-'}${formatFCFA(op.montant)} F`,
      `${formatFCFA(solde)} F`,
    ]);
  });
  const soldeCloture = solde;

  const tableTop = doc.y;
  const cols = [
    { label: 'Heure', x: 50, w: 60 },
    { label: 'Opération', x: 110, w: 230 },
    { label: 'Montant', x: 340, w: 100 },
    { label: 'Solde', x: 440, w: 105 },
  ];
  doc.rect(50, tableTop, 495, 20).fill(FOREST);
  cols.forEach((c) => {
    doc.fillColor('#fff').fontSize(9).font('Helvetica-Bold').text(c.label, c.x + 4, tableTop + 6, { width: c.w - 8 });
  });

  let y = tableTop + 20;
  lignes.forEach(([heure, label, montant, soldeLigne], i) => {
    const bg = i % 2 === 0 ? '#F7F9F6' : '#FFFFFF';
    doc.rect(50, y, 495, 18).fill(bg);
    doc.fillColor(INK).fontSize(9).font(i === 0 ? 'Helvetica-Bold' : 'Helvetica');
    doc.text(heure, cols[0].x + 4, y + 4, { width: cols[0].w - 8 });
    doc.text(label, cols[1].x + 4, y + 4, { width: cols[1].w - 8 });
    doc.fillColor(montant.startsWith('-') ? DANGER : FOREST)
      .text(montant, cols[2].x + 4, y + 4, { width: cols[2].w - 8 });
    doc.fillColor(INK).text(soldeLigne, cols[3].x + 4, y + 4, { width: cols[3].w - 8 });
    y += 18;
    if (y > 720 && i < lignes.length - 1) { doc.addPage(); y = 50; }
  });
  doc.strokeColor(LINE).lineWidth(0.5).rect(50, tableTop, 495, y - tableTop).stroke();

  y += 20;
  doc.fillColor(FOREST).fontSize(11).font('Helvetica-Bold')
    .text(`Solde de clôture : ${formatFCFA(soldeCloture)} F`, 50, y);
  doc.fillColor(MUTED).fontSize(9).font('Helvetica')
    .text(`${operations.length} opération(s) validée(s) sur la journée.`, 50, y + 18);

  y += 70;
  doc.fillColor(INK).fontSize(10).font('Helvetica-Bold').text('Caissière', 80, y).text('Vérifié par (Directeur)', 350, y);
  doc.fillColor(MUTED).fontSize(9).font('Helvetica').text('Signature', 80, y + 55).text('Signature', 350, y + 55);

  doc.end();
  return doc;
}
