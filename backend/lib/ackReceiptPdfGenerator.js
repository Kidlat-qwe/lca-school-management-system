/**
 * Acknowledgement Receipt PDF generation (shared by HTTP route and payment emails).
 */
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { query } from '../config/database.js';
import {
  ACK_RECEIPT_PAGE_MARGIN,
  ACK_RECEIPT_PDF_OPTIONS,
  drawArCutGuideLines,
} from './ackReceiptPdfLayout.js';

export const ACK_RECEIPT_PDF_SELECT_SQL = `
  SELECT ar.*,
         TO_CHAR(ar.issue_date, 'YYYY-MM-DD')         AS issue_date_fmt,
         TO_CHAR(ar.issue_date, 'YYYY-MM-DD')        AS prepared_by_date_ymd,
         prep_u.full_name                             AS prepared_by_name,
         b.branch_address,
         b.branch_phone_number,
         b.branch_email,
         COALESCE(b.branch_nickname, b.branch_name)   AS branch_display_name,
         p.package_name       AS pkg_join_name,
         p.downpayment_amount AS pkg_join_downpayment,
         p.package_price      AS pkg_join_monthly
  FROM acknowledgement_receiptstbl ar
  LEFT JOIN branchestbl b ON ar.branch_id = b.branch_id
  LEFT JOIN packagestbl p ON ar.package_id = p.package_id
  LEFT JOIN userstbl prep_u ON prep_u.user_id = ar.created_by
  WHERE ar.ack_receipt_id = $1
`;

export function isDualPackageInstallmentPairForPdf(a, b) {
  if (!a || !b) return false;
  if (Number(a.ack_receipt_id) === Number(b.ack_receipt_id)) return false;
  if (String(a.ar_type || '').toLowerCase() !== 'package') return false;
  if (String(b.ar_type || '').toLowerCase() !== 'package') return false;
  if (Number(a.branch_id) !== Number(b.branch_id)) return false;
  if (Number(a.package_id || 0) !== Number(b.package_id || 0)) return false;
  const d1 = String(a.issue_date_fmt || '').slice(0, 10);
  const d2 = String(b.issue_date_fmt || '').slice(0, 10);
  if (!d1 || d1 !== d2) return false;
  if (String(a.prospect_student_name || '').trim() !== String(b.prospect_student_name || '').trim()) return false;
  if (String(a.reference_number || '').trim() !== String(b.reference_number || '').trim()) return false;

  if (Number(a.paired_ack_receipt_id) === Number(b.ack_receipt_id)) return true;
  if (Number(b.paired_ack_receipt_id) === Number(a.ack_receipt_id)) return true;

  const optA = String(a.installment_option || '').toLowerCase();
  const optB = String(b.installment_option || '').toLowerCase();
  const aDp = optA === 'downpayment_only';
  const bDp = optB === 'downpayment_only';
  return aDp !== bDp;
}

export function orderDualPackageArRowsForPdf(a, b) {
  if (Number(a.paired_ack_receipt_id) === Number(b.ack_receipt_id)) return [a, b];
  if (Number(b.paired_ack_receipt_id) === Number(a.ack_receipt_id)) return [b, a];
  const aDp = String(a.installment_option || '').toLowerCase() === 'downpayment_only';
  return aDp ? [a, b] : [b, a];
}

export function buildVirtualDualInstallmentPdfRowsFromSingleAr(ar, dpAmt, moAmt) {
  const pkgDisp = String(ar.pkg_join_name || '').trim() || 'Installment';
  const stud = String(ar.prospect_student_name || '').trim() || 'N/A';
  const lvl = String(ar.level_tag || '').trim() || '-';
  const tip = parseFloat(ar.tip_amount || 0) || 0;
  const dpDesc = `Downpayment for ${pkgDisp}`;
  const phDesc = `(Phase 1) Installment plan for ${stud} - ${lvl}`;
  const base = { ...ar };
  return [
    {
      ...base,
      payment_amount: dpAmt,
      tip_amount: tip,
      package_name_snapshot: dpDesc,
      package_amount_snapshot: dpAmt,
    },
    {
      ...base,
      payment_amount: moAmt,
      tip_amount: 0,
      package_name_snapshot: phDesc,
      package_amount_snapshot: moAmt,
    },
  ];
}

export function drawAcknowledgementReceiptPage(doc, ar, logoPath, hasLogo) {
  const isMerchandise = (ar.ar_type || '').toLowerCase() === 'merchandise';
  const paymentAmount = parseFloat(ar.payment_amount || 0) || 0;
  const tipAmount = parseFloat(ar.tip_amount || 0) || 0;
  const totalAmount = paymentAmount + tipAmount;

  let itemDescriptions = [];
  if (isMerchandise && ar.merchandise_items_snapshot) {
    try {
      const snapItems =
        typeof ar.merchandise_items_snapshot === 'string'
          ? JSON.parse(ar.merchandise_items_snapshot)
          : ar.merchandise_items_snapshot;
      if (Array.isArray(snapItems) && snapItems.length > 0) {
        for (const item of snapItems) {
          const name = item.merchandise_name || 'Item';
          const size = item.size ? ` (${item.size})` : '';
          itemDescriptions.push(`${name}${size}`);
        }
      }
    } catch {
      /* ignore malformed snapshot */
    }
  }

  const packageDesc = ar.package_name_snapshot;
  const mergedDesc =
    itemDescriptions.length > 0
      ? itemDescriptions.join(' | ')
      : packageDesc || 'Acknowledgement Receipt';

  const arNumber =
    ar.ack_receipt_number != null && String(ar.ack_receipt_number).trim() !== ''
      ? String(ar.ack_receipt_number).trim()
      : ar.ack_receipt_id
        ? `AR-${ar.ack_receipt_id}`
        : 'N/A';
  const studentName = (ar.prospect_student_name || 'N/A').trim();
  const classLabel = (ar.level_tag || '-').trim();

  const rawDateStr = ar.issue_date_fmt || '';
  const formatDate = (ymd) => {
    if (!ymd) return '-';
    const [year, month, day] = String(ymd).slice(0, 10).split('-');
    if (!year || !month || !day) return ymd;
    return `${day}/${month}/${year}`;
  };
  const arDate = formatDate(rawDateStr);

  const formatCurrency = (value) =>
    `PHP ${(Number(value) || 0).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  const pageWidth = doc.page.width;
  const left = ACK_RECEIPT_PAGE_MARGIN;
  const right = pageWidth - ACK_RECEIPT_PAGE_MARGIN;
  const contentWidth = right - left;
  const titleY = ACK_RECEIPT_PAGE_MARGIN - 4;
  doc
    .font('Helvetica-Bold')
    .fontSize(20)
    .fillColor('#111827')
    .text('ACKNOWLEDGEMENT RECEIPT', left, titleY, {
      width: contentWidth,
      align: 'center',
    });

  let y = titleY + 40;

  if (hasLogo) {
    doc.image(logoPath, left, y + 2, { width: 42, height: 42 });
  }
  doc
    .font('Helvetica-Bold')
    .fontSize(13)
    .fillColor('#111827')
    .text('Little Champions Academy Inc.', hasLogo ? left + 52 : left, y + 4, { width: 360 });
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#374151')
    .text(ar.branch_address || '-', hasLogo ? left + 52 : left, y + 22, { width: 360 });
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#374151')
    .text(`Contact: ${ar.branch_phone_number || '-'}`, hasLogo ? left + 52 : left, y + 34, { width: 360 });
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#374151')
    .text(`Email: ${ar.branch_email || '-'}`, hasLogo ? left + 52 : left, y + 46, { width: 360 });

  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor('#111827')
    .text(`No. ${arNumber}`, right - 180, y + 28, { width: 180, align: 'right' });
  y += 74;

  const metaStartY = y;
  doc.font('Helvetica').fontSize(10).fillColor('#111827');
  doc.text(`DATE: ${arDate}`, right - 230, metaStartY, { width: 230, align: 'right' });
  doc.text(`STUDENT NAME: ${studentName}`, left, metaStartY, {
    width: contentWidth - 20,
  });
  y += 20;
  doc.text(`CLASS: ${classLabel}`, left, y, { width: 320 });
  y += 24;

  const tLeft = left;
  const tWidth = contentWidth;
  const rowH = 24;
  const headerH = 24;
  const detailRows = 4;
  const footerRows = 1;
  const totalRows = detailRows + footerRows;
  const descW = tWidth * 0.5;
  const rateW = tWidth * 0.25;
  const amountW = tWidth - descW - rateW;
  const xDesc = tLeft + 8;
  const xRate = tLeft + descW + 8;
  const xAmount = tLeft + descW + rateW + 8;

  doc.save();
  doc.rect(tLeft, y, tWidth, headerH).fill('#f3f4f6');
  doc.restore();
  doc
    .rect(tLeft, y, tWidth, headerH + rowH * totalRows)
    .lineWidth(1)
    .strokeColor('#111827')
    .stroke();
  doc
    .moveTo(tLeft + descW, y)
    .lineTo(tLeft + descW, y + headerH + rowH * totalRows)
    .stroke();
  doc
    .moveTo(tLeft + descW + rateW, y)
    .lineTo(tLeft + descW + rateW, y + headerH + rowH * totalRows)
    .stroke();

  for (let i = 1; i <= totalRows; i += 1) {
    const yLine = y + headerH + rowH * i;
    doc.moveTo(tLeft, yLine).lineTo(tLeft + tWidth, yLine).stroke();
  }

  doc.font('Helvetica-Bold').fontSize(9).fillColor('#111827');
  doc.text('DESCRIPTION', xDesc, y + 8, { width: descW - 16, align: 'center' });
  doc.text('RATE', xRate, y + 8, { width: rateW - 16, align: 'center' });
  doc.text('AMOUNT', xAmount, y + 8, { width: amountW - 16, align: 'center' });

  doc.font('Helvetica').fontSize(9).fillColor('#111827');
  doc.text(mergedDesc, xDesc, y + headerH + 8, { width: descW - 16 });
  doc.text(formatCurrency(paymentAmount), xRate, y + headerH + 8, {
    width: rateW - 16,
    align: 'right',
  });
  doc.text(formatCurrency(totalAmount), xAmount, y + headerH + 8, {
    width: amountW - 16,
    align: 'right',
  });

  const footerRowY = y + headerH + rowH * detailRows + 8;
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor('#111827')
    .text(`TOTAL  ${formatCurrency(totalAmount)}`, xRate, footerRowY, {
      width: rateW + amountW - 16,
      align: 'right',
    });
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor('#111827')
    .text('T  H  A  N  K    Y  O  U  !', xDesc, footerRowY, {
      width: descW - 16,
      align: 'center',
    });

  y += headerH + rowH * totalRows + 20;
  doc.font('Helvetica').fontSize(9).fillColor('#111827');

  const preparedByName = String(ar.prepared_by_name || '').trim();
  const receivedByName = String(ar.prospect_student_contact || '').trim();

  doc.text('Prepared by:', left, y);
  doc.text(preparedByName || '-', left + 68, y + 1, { width: 182 });
  doc.moveTo(left + 68, y + 10).lineTo(left + 250, y + 10).stroke();
  doc.text('Received by:', right - 200, y);
  doc.text(receivedByName || '-', right - 118, y + 1, { width: 110 });
  doc.moveTo(right - 118, y + 10).lineTo(right, y + 10).stroke();

  drawArCutGuideLines(doc, y + 30, left);
}

export function renderAckReceiptPdfToBuffer(pageRows) {
  const logoPath = path.resolve(process.cwd(), '../frontend/public/LCA Icon.png');
  const hasLogo = fs.existsSync(logoPath);
  const doc = new PDFDocument({ ...ACK_RECEIPT_PDF_OPTIONS });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  for (let i = 0; i < pageRows.length; i += 1) {
    if (i > 0) {
      doc.addPage({ ...ACK_RECEIPT_PDF_OPTIONS });
    }
    drawAcknowledgementReceiptPage(doc, pageRows[i], logoPath, hasLogo);
  }
  doc.end();
  return done;
}

/**
 * @param {number} ackReceiptId
 * @param {Function} queryFn - pg query function (client.query or query)
 * @param {{ pairedAckReceiptId?: number|null }} [options]
 */
export async function buildAckReceiptPdfPageRows(ackReceiptId, queryFn = query, options = {}) {
  const idNum = Number(ackReceiptId);
  const pairedNum =
    options.pairedAckReceiptId != null && Number(options.pairedAckReceiptId) > 0
      ? Number(options.pairedAckReceiptId)
      : null;

  const arResult = await queryFn(ACK_RECEIPT_PDF_SELECT_SQL, [idNum]);
  if (arResult.rows.length === 0) {
    throw new Error('Acknowledgement receipt not found');
  }

  const ar = arResult.rows[0];
  let pageRows = [ar];

  if (pairedNum != null && Number.isInteger(pairedNum) && pairedNum > 0 && pairedNum !== idNum) {
    const ar2Result = await queryFn(ACK_RECEIPT_PDF_SELECT_SQL, [pairedNum]);
    if (ar2Result.rows.length === 0) {
      throw new Error('Paired acknowledgement receipt not found');
    }
    const ar2 = ar2Result.rows[0];
    if (!isDualPackageInstallmentPairForPdf(ar, ar2)) {
      throw new Error('These two receipts cannot be combined in one PDF.');
    }
    pageRows = orderDualPackageArRowsForPdf(ar, ar2);
  } else if (ar.paired_ack_receipt_id) {
    const ar2Result = await queryFn(ACK_RECEIPT_PDF_SELECT_SQL, [ar.paired_ack_receipt_id]);
    if (ar2Result.rows.length === 0) {
      throw new Error('Paired acknowledgement receipt not found');
    }
    const ar2 = ar2Result.rows[0];
    if (!isDualPackageInstallmentPairForPdf(ar, ar2)) {
      throw new Error('Invalid Downpayment + Phase 1 acknowledgement receipt pair.');
    }
    pageRows = orderDualPackageArRowsForPdf(ar, ar2);
  } else if (
    pairedNum == null &&
    String(ar.ar_type || '').toLowerCase() === 'package' &&
    String(ar.installment_option || '').toLowerCase() === 'downpayment_plus_phase1' &&
    ar.package_id != null
  ) {
    const dpAmt = parseFloat(ar.pkg_join_downpayment) || 0;
    const moAmt = parseFloat(ar.pkg_join_monthly) || 0;
    if (dpAmt > 0 && moAmt > 0) {
      pageRows = buildVirtualDualInstallmentPdfRowsFromSingleAr(ar, dpAmt, moAmt);
    }
  }

  return { pageRows, ar, idNum };
}

export function buildAckReceiptPdfFilename(pageRows, ar, idNum) {
  const pairedIdForName = ar.paired_ack_receipt_id ? Number(ar.paired_ack_receipt_id) : null;
  if (pageRows.length > 1) {
    return pairedIdForName
      ? `acknowledgement-receipt-${idNum}-and-${pairedIdForName}.pdf`
      : `acknowledgement-receipt-${idNum}-dp-phase1.pdf`;
  }
  const arNum = String(ar.ack_receipt_number || '').trim();
  if (arNum) {
    return `acknowledgement-receipt-${arNum}.pdf`;
  }
  return `acknowledgement-receipt-${idNum}.pdf`;
}

export async function generateAckReceiptPdfBuffer(ackReceiptId, queryFn = query, options = {}) {
  const { pageRows, ar, idNum } = await buildAckReceiptPdfPageRows(ackReceiptId, queryFn, options);
  const buffer = await renderAckReceiptPdfToBuffer(pageRows);
  const filename = buildAckReceiptPdfFilename(pageRows, ar, idNum);
  return { buffer, filename, ar };
}
