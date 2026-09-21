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

const LABELS = {
  depot: 'Dépôt',
  retrait: 'Retrait',
  paiement_credit: 'Paiement de crédit',
  deblocage_credit: 'Déblocage de crédit',
  frais: 'Frais',
  ajustement: 'Ajustement',
  annulation: 'Annulation',
  salaire: 'Salaire crédité',
};

const ENTREE = new Set(['depot', 'deblocage_credit', 'ajustement', 'salaire']);

/**
 * Historique complet des transactions d'un client, imprimable par la
 * caissière au guichet — un seul document, du plus récent au plus
 * ancien.
 */
export function genererHistoriquePDF({ client, transactions }) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });

  doc.fillColor(FOREST).fontSize(18).font('Helvetica-Bold')
    .text('CRÉDIT POPULAIRE DU GABON', { align: 'center' });
  doc.fillColor(MUTED).fontSize(10).font('Helvetica')
    .text('Historique des transactions', { align: 'center' });
  doc.moveDown(0.3);
  doc.strokeColor(FOREST).lineWidth(1.5).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown(1);

  doc.fillColor(INK).fontSize(11).font('Helvetica-Bold').text(client.full_name);
  doc.fillColor(MUTED).fontSize(9).font('Helvetica')
    .text(`${client.client_number ?? '—'} · ${client.phone ?? ''}`);
  doc.fillColor(FOREST).fontSize(10).font('Helvetica-Bold')
    .text(`Solde actuel : ${formatFCFA(client.balance)} F`);
  doc.moveDown(1);

  const cols = [
    { label: 'Date', x: 50, w: 90 },
    { label: 'Opération', x: 140, w: 220 },
    { label: 'Référence', x: 360, w: 90 },
    { label: 'Montant', x: 450, w: 95 },
  ];
  let y = doc.y;
  doc.rect(50, y, 495, 20).fill(FOREST);
  cols.forEach((c) => {
    doc.fillColor('#fff').fontSize(9).font('Helvetica-Bold').text(c.label, c.x + 4, y + 6, { width: c.w - 8 });
  });
  y += 20;

  transactions.forEach((t, i) => {
    if (y > 760) { doc.addPage(); y = 50; }
    const bg = i % 2 === 0 ? '#F7F9F6' : '#FFFFFF';
    doc.rect(50, y, 495, 18).fill(bg);
    const entree = ENTREE.has(t.type);
    const montant = `${entree ? '+' : '-'}${formatFCFA(Math.abs(t.amount))} F`;
    doc.fillColor(INK).fontSize(8).font('Helvetica');
    doc.text(new Date(t.created_at).toLocaleDateString('fr-FR'), cols[0].x + 4, y + 5, { width: cols[0].w - 8 });
    doc.text(t.label ?? LABELS[t.type] ?? t.type, cols[1].x + 4, y + 5, { width: cols[1].w - 8 });
    doc.text(t.reference ?? '—', cols[2].x + 4, y + 5, { width: cols[2].w - 8 });
    doc.fillColor(entree ? FOREST : DANGER).text(montant, cols[3].x + 4, y + 5, { width: cols[3].w - 8 });
    y += 18;
  });

  doc.strokeColor(LINE).lineWidth(0.5).rect(50, doc.y - (transactions.length * 18) - 20, 495, (transactions.length * 18) + 20).stroke();

  y += 16;
  doc.fillColor(MUTED).fontSize(8).font('Helvetica')
    .text(`${transactions.length} transaction(s) · Document généré le ${new Date().toLocaleDateString('fr-FR')}`, 50, y);

  doc.end();
  return doc;
}
