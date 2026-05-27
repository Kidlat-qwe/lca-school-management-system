/** A4 portrait — receipt uses top ~half; lower area has cut guides. */
export const ACK_RECEIPT_PDF_OPTIONS = { margin: 40, size: 'A4', layout: 'portrait' };

export const ACK_RECEIPT_PAGE_MARGIN = 40;

/**
 * Single dashed cut guide line (horizontal) with label below.
 * @param {import('pdfkit').PDFDocument} doc
 * @param {number} startY - Y position where the dashed line starts
 * @param {number} [margin]
 */
export function drawArCutGuideLines(doc, startY, margin = ACK_RECEIPT_PAGE_MARGIN) {
  const left = margin;
  const right = doc.page.width - margin;

  doc.save();
  doc.lineWidth(0.65);
  doc.strokeColor('#9ca3af');
  doc.dash(5, { space: 4 });
  doc.moveTo(left, startY).lineTo(right, startY).stroke();
  doc.undash();

  doc.font('Helvetica').fontSize(8).fillColor('#9ca3af');
  doc.text('Cut along dotted lines', left, startY + 6, {
    width: right - left,
    align: 'center',
  });
  doc.restore();
}
