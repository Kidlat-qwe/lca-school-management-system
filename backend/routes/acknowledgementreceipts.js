import express from 'express';
import { body, param, query as queryValidator } from 'express-validator';
import { verifyFirebaseToken, requireRole, requireBranchAccess } from '../middleware/auth.js';
import { handleValidationErrors } from '../middleware/validation.js';
import { query, getClient } from '../config/database.js';
import { formatYmdLocal } from '../utils/dateUtils.js';
import { allocateNextArStyleNumber } from '../utils/invoiceArNumber.js';
import {
  determineEnrollmentStatus as detEnrollmentStatus,
  determineRejoinAwarePhaseStatus,
  ensurePendingEnrollmentAfterDownpaymentPaid,
} from '../utils/enrollmentStatus.js';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { paymenttblHasActionOwnerUserIdColumn } from '../utils/paymentSchema.js';
import {
  sendArPaymentConfirmationByAckId,
  sendInvoicePaymentConfirmationByInvoiceId,
} from '../utils/paymentConfirmationEmailService.js';
import { ackReceiptHasPairedAckReceiptIdColumn } from '../lib/ackReceiptPairedColumn.js';
import { invoiceHasRejectedPayment } from '../utils/invoicePaymentStatus.js';

const router = express.Router();
const ALLOWED_AR_PAYMENT_METHODS = ['Cash', 'Online Banking', 'Credit Card', 'E-wallets'];
let ackVerifierColumnsKnownTrue = false;
let announcementTargetUserIdKnownTrue = false;

const ackReceiptHasVerifierColumns = async () => {
  if (ackVerifierColumnsKnownTrue) return true;
  try {
    const r = await query(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'acknowledgement_receiptstbl'
         AND column_name IN ('verified_by_user_id', 'verified_at')
       GROUP BY table_name
       HAVING COUNT(DISTINCT column_name) = 2
       LIMIT 1`
    );
    if (r.rows.length > 0) {
      ackVerifierColumnsKnownTrue = true;
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
};

const announcementstblHasTargetUserIdColumn = async () => {
  if (announcementTargetUserIdKnownTrue) return true;
  try {
    const r = await query(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'announcementstbl'
         AND column_name = 'target_user_id'
       LIMIT 1`
    );
    if (r.rows.length > 0) {
      announcementTargetUserIdKnownTrue = true;
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
};

// All routes require authentication and branch access
router.use(verifyFirebaseToken);
router.use(requireBranchAccess);

/** Strip internal ack_receipt_number from API payloads (still stored for uniqueness). */
function omitAckReceiptNumber(row) {
  if (!row || typeof row !== 'object') return row;
  const { ack_receipt_number: _n, ...rest } = row;
  return rest;
}

/** Row shape for AR PDF: acknowledgement_receiptstbl + issue_date_fmt + branch_* + package pricing for dual-page PDF */
const ACK_RECEIPT_PDF_SELECT_SQL = `
  SELECT ar.*,
         TO_CHAR(ar.issue_date, 'YYYY-MM-DD')         AS issue_date_fmt,
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
  WHERE ar.ack_receipt_id = $1
`;

/**
 * Validates two Package AR rows for a combined Downpayment + Phase 1 PDF:
 * - Linked via paired_ack_receipt_id (leader → phase), or
 * - Legacy pair: one row installment_option downpayment_only, sibling without that option.
 */
function isDualPackageInstallmentPairForPdf(a, b) {
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

/** Returns [downpaymentRow, phaseRow] for a valid pair. */
function orderDualPackageArRowsForPdf(a, b) {
  if (Number(a.paired_ack_receipt_id) === Number(b.ack_receipt_id)) return [a, b];
  if (Number(b.paired_ack_receipt_id) === Number(a.ack_receipt_id)) return [b, a];
  const aDp = String(a.installment_option || '').toLowerCase() === 'downpayment_only';
  return aDp ? [a, b] : [b, a];
}

/** Two virtual row shapes for PDF pages from one AR (Downpayment + Phase 1 single row). */
function buildVirtualDualInstallmentPdfRowsFromSingleAr(ar, dpAmt, moAmt) {
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

function drawAcknowledgementReceiptPage(doc, ar, logoPath, hasLogo) {
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

  const arNumber = ar.ack_receipt_number || `AR-${ar.ack_receipt_id}`;
  const studentName = (ar.prospect_student_name || 'N/A').trim();
  const classLabel = (ar.level_tag || '-').trim();

  const rawDateStr = ar.issue_date_fmt || '';
  const formatDate = (ymd) => {
    if (!ymd) return '-';
    const [year, month, day] = ymd.split('-');
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
  const left = 40;
  const right = pageWidth - 40;
  const contentWidth = right - left;
  let y = 42;

  doc
    .font('Helvetica-Bold')
    .fontSize(19)
    .fillColor('#111827')
    .text('ACKNOWLEDGEMENT RECEIPT', left, y, { width: contentWidth, align: 'right' });
  y += 6;

  if (hasLogo) {
    doc.image(logoPath, left, y + 4, { width: 42, height: 42 });
  }
  doc
    .font('Helvetica-Bold')
    .fontSize(13)
    .fillColor('#111827')
    .text('Little Champions Academy Inc.', hasLogo ? left + 52 : left, y + 6, { width: 360 });
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#374151')
    .text(ar.branch_address || '-', hasLogo ? left + 52 : left, y + 24, { width: 360 });
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#374151')
    .text(`Contact: ${ar.branch_phone_number || '-'}`, hasLogo ? left + 52 : left, y + 36, { width: 360 });
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#374151')
    .text(`Email: ${ar.branch_email || '-'}`, hasLogo ? left + 52 : left, y + 48, { width: 360 });

  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor('#111827')
    .text(`No. ${arNumber}`, right - 180, y + 34, { width: 180, align: 'right' });
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
  const detailRows = 5;
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

  y += headerH + rowH * totalRows + 24;
  doc.font('Helvetica').fontSize(9).fillColor('#111827');
  doc.text('Prepared by:', left, y);
  doc.moveTo(left + 68, y + 10).lineTo(left + 250, y + 10).stroke();
  doc.text('Received by:', right - 200, y);
  doc.moveTo(right - 118, y + 10).lineTo(right, y + 10).stroke();
}

const createArSubmissionNotification = async ({
  ackReceiptId,
  branchId,
  createdByUserId,
  studentName,
  arType,
  paymentMethod,
  status,
}) => {
  try {
    const branchRes = await query(
      `SELECT COALESCE(branch_nickname, branch_name) AS branch_name FROM branchestbl WHERE branch_id = $1`,
      [branchId]
    );
    const branchName = branchRes.rows[0]?.branch_name || `Branch ${branchId}`;
    const title = 'Acknowledgement Receipt submitted';
    const verificationState =
      status === 'Verified'
        ? 'Auto-verified (Cash payment).'
        : 'Awaiting Finance/Superfinance verification.';
    const body = `${studentName || 'Student'} - ${arType} Acknowledgement Receipt (payment: ${paymentMethod || 'Cash'}) was created at ${branchName}. ${verificationState}`;

    await query(
      `INSERT INTO announcementstbl (title, body, recipient_groups, status, priority, branch_id, created_by, navigation_key, navigation_query)
       VALUES ($1, $2, $3, 'Active', 'Medium', $4, $5, $6, $7)`,
      [
        title,
        body,
        ['Finance'],
        branchId,
        createdByUserId,
        'acknowledgement-receipts',
        'page=1',
      ]
    );
  } catch (err) {
    console.error('createArSubmissionNotification:', err?.message || err);
  }
};

const notifyArReturnedToCreator = async ({
  ackReceiptId,
  branchId,
  returnedByUserId,
  creatorUserId,
  studentName,
  reason,
}) => {
  try {
    if (!branchId || !creatorUserId) return;
    const hasTargetUserIdColumn = await announcementstblHasTargetUserIdColumn();
    const [branchRes, returnerRes] = await Promise.all([
      query(
        `SELECT COALESCE(branch_nickname, branch_name) AS branch_name FROM branchestbl WHERE branch_id = $1`,
        [branchId]
      ),
      query(`SELECT full_name, email FROM userstbl WHERE user_id = $1`, [returnedByUserId]),
    ]);
    const branchName = branchRes.rows[0]?.branch_name || `Branch ${branchId}`;
    const returnedBy = returnerRes.rows[0]?.full_name || returnerRes.rows[0]?.email || 'Finance';
    const studentLabel = studentName || 'Student';
    const reasonText = reason && String(reason).trim() ? ` Note from Finance: ${String(reason).trim()}` : '';
    const body = `Acknowledgement Receipt #${ackReceiptId} (${studentLabel}) was returned by ${returnedBy} at ${branchName} for correction.${reasonText}`;

    if (!hasTargetUserIdColumn) {
      await query(
        `INSERT INTO announcementstbl (title, body, recipient_groups, status, priority, branch_id, created_by, navigation_key, navigation_query)
         VALUES ($1, $2, $3, 'Active', 'Medium', $4, $5, $6, $7)`,
        [
          'Acknowledgement Receipt returned — action needed',
          body,
          ['Admin'],
          branchId,
          returnedByUserId,
          'acknowledgement-receipts',
          'status=Returned&page=1',
        ]
      );
      return;
    }

    await query(
      `INSERT INTO announcementstbl (title, body, recipient_groups, status, priority, branch_id, created_by, target_user_id, navigation_key, navigation_query)
       VALUES ($1, $2, $3, 'Active', 'Medium', $4, $5, $6, $7, $8)`,
      [
        'Acknowledgement Receipt returned — action needed',
        body,
        ['All'],
        branchId,
        returnedByUserId,
        creatorUserId,
        'acknowledgement-receipts',
        'status=Returned&page=1',
      ]
    );
  } catch (err) {
    console.error('notifyArReturnedToCreator:', err?.message || err);
  }
};

const notifyArRejectedToCreator = async ({
  ackReceiptId,
  branchId,
  rejectedByUserId,
  creatorUserId,
  studentName,
  reason,
}) => {
  try {
    if (!branchId || !creatorUserId) return;
    const hasTargetUserIdColumn = await announcementstblHasTargetUserIdColumn();
    const [branchRes, rejecterRes] = await Promise.all([
      query(
        `SELECT COALESCE(branch_nickname, branch_name) AS branch_name FROM branchestbl WHERE branch_id = $1`,
        [branchId]
      ),
      query(`SELECT full_name, email FROM userstbl WHERE user_id = $1`, [rejectedByUserId]),
    ]);
    const branchName = branchRes.rows[0]?.branch_name || `Branch ${branchId}`;
    const rejectedBy = rejecterRes.rows[0]?.full_name || rejecterRes.rows[0]?.email || 'Finance';
    const studentLabel = studentName || 'Student';
    const reasonText = reason && String(reason).trim() ? ` Reason: ${String(reason).trim()}.` : '';
    const body = `Acknowledgement Receipt #${ackReceiptId} (${studentLabel}) was rejected by ${rejectedBy} at ${branchName}.${reasonText} Please create and submit a new acknowledgement receipt to continue.`;

    if (!hasTargetUserIdColumn) {
      await query(
        `INSERT INTO announcementstbl (title, body, recipient_groups, status, priority, branch_id, created_by, navigation_key, navigation_query)
         VALUES ($1, $2, $3, 'Active', 'High', $4, $5, $6, $7)`,
        [
          'Acknowledgement Receipt rejected — please recreate',
          body,
          ['Admin'],
          branchId,
          rejectedByUserId,
          'acknowledgement-receipts',
          'status=Rejected&page=1',
        ]
      );
      return;
    }

    await query(
      `INSERT INTO announcementstbl (title, body, recipient_groups, status, priority, branch_id, created_by, target_user_id, navigation_key, navigation_query)
       VALUES ($1, $2, $3, 'Active', 'High', $4, $5, $6, $7, $8)`,
      [
        'Acknowledgement Receipt rejected — please recreate',
        body,
        ['All'],
        branchId,
        rejectedByUserId,
        creatorUserId,
        'acknowledgement-receipts',
        'status=Rejected&page=1',
      ]
    );
  } catch (err) {
    console.error('notifyArRejectedToCreator:', err?.message || err);
  }
};

/**
 * GET /api/sms/acknowledgement-receipts
 * List acknowledgement receipts with optional filters
 * Access: Superadmin, Admin, Finance, Superfinance
 */
router.get(
  '/',
  [
    queryValidator('status').optional().isString().withMessage('Status must be a string'),
    queryValidator('branch_id').optional().isInt().withMessage('Branch ID must be an integer'),
    queryValidator('search').optional().isString().withMessage('Search term must be a string'),
    queryValidator('payment_method')
      .optional()
      .isIn(ALLOWED_AR_PAYMENT_METHODS)
      .withMessage(`payment_method must be one of: ${ALLOWED_AR_PAYMENT_METHODS.join(', ')}`),
    queryValidator('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    queryValidator('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    queryValidator('payment_date_from')
      .optional()
      .isISO8601()
      .withMessage('payment_date_from must be YYYY-MM-DD'),
    queryValidator('payment_date_to')
      .optional()
      .isISO8601()
      .withMessage('payment_date_to must be YYYY-MM-DD'),
    queryValidator('issue_date_from')
      .optional()
      .isISO8601()
      .withMessage('issue_date_from must be YYYY-MM-DD'),
    queryValidator('issue_date_to')
      .optional()
      .isISO8601()
      .withMessage('issue_date_to must be YYYY-MM-DD'),
    queryValidator('created_date_from')
      .optional()
      .isISO8601()
      .withMessage('created_date_from must be YYYY-MM-DD'),
    queryValidator('created_date_to')
      .optional()
      .isISO8601()
      .withMessage('created_date_to must be YYYY-MM-DD'),
    queryValidator('only_unused')
      .optional()
      .isIn(['0', '1', 'true', 'false'])
      .withMessage('only_unused must be 0, 1, true, or false'),
    queryValidator('exclude_status').optional().isString().withMessage('exclude_status must be a string'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin', 'Finance', 'Superfinance'),
  async (req, res, next) => {
    try {
      const {
        status,
        branch_id,
        search,
        payment_method,
        page = 1,
        limit = 20,
        only_unused,
        exclude_status,
        payment_date_from: paymentDateFrom,
        payment_date_to: paymentDateTo,
        issue_date_from: issueDateFrom,
        issue_date_to: issueDateTo,
        created_date_from: createdDateFrom,
        created_date_to: createdDateTo,
      } = req.query;
      const paymentFrom = paymentDateFrom ? String(paymentDateFrom).trim().slice(0, 10) : '';
      const paymentTo = paymentDateTo ? String(paymentDateTo).trim().slice(0, 10) : '';
      if (paymentFrom && paymentTo && paymentFrom > paymentTo) {
        return res.status(400).json({
          success: false,
          message: 'payment_date_from must be on or before payment_date_to',
        });
      }
      const arFrom = issueDateFrom ? String(issueDateFrom).trim().slice(0, 10) : '';
      const arTo = issueDateTo ? String(issueDateTo).trim().slice(0, 10) : '';
      if (arFrom && arTo && arFrom > arTo) {
        return res.status(400).json({
          success: false,
          message: 'issue_date_from must be on or before issue_date_to',
        });
      }
      const createdFrom = createdDateFrom ? String(createdDateFrom).trim().slice(0, 10) : '';
      const createdTo = createdDateTo ? String(createdDateTo).trim().slice(0, 10) : '';
      if (createdFrom && createdTo && createdFrom > createdTo) {
        return res.status(400).json({
          success: false,
          message: 'created_date_from must be on or before created_date_to',
        });
      }
      const onlyUnusedList =
        String(only_unused || '') === '1' || String(only_unused || '').toLowerCase() === 'true';
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 20;
      const offset = (pageNum - 1) * limitNum;

      const hidePairedPhaseRows = await ackReceiptHasPairedAckReceiptIdColumn();

      const listPairJoin = hidePairedPhaseRows
        ? `
        LEFT JOIN acknowledgement_receiptstbl ar_pair ON ar_pair.ack_receipt_id = ar.paired_ack_receipt_id`
        : '';

      const listPairSelect = hidePairedPhaseRows
        ? `,
          (COALESCE(ar.payment_amount, 0) + COALESCE(ar.tip_amount, 0) + COALESCE(ar_pair.payment_amount, 0) + COALESCE(ar_pair.tip_amount, 0)) AS list_line_total_amount,
          (COALESCE(ar.package_amount_snapshot, 0) + COALESCE(ar_pair.package_amount_snapshot, 0)) AS list_combined_package_amount,
          CASE
            WHEN ar.paired_ack_receipt_id IS NOT NULL THEN
              CONCAT(
                'Downpayment + Phase 1',
                CASE
                  WHEN p.package_name IS NOT NULL AND LENGTH(TRIM(p.package_name::text)) > 0
                  THEN CONCAT(' — ', TRIM(p.package_name::text))
                  ELSE ''
                END
              )
            ELSE COALESCE(ar.package_name_snapshot::text, p.package_name::text, 'N/A')
          END AS list_package_primary_label`
        : '';

      let sql = `
        SELECT
          ar.*,
          COALESCE(b.branch_nickname, b.branch_name) AS branch_name,
          p.package_name,
          u.full_name AS student_name
          ${listPairSelect}
        FROM acknowledgement_receiptstbl ar
        LEFT JOIN branchestbl b ON ar.branch_id = b.branch_id
        LEFT JOIN packagestbl p ON ar.package_id = p.package_id
        LEFT JOIN userstbl u ON ar.student_id = u.user_id
        ${listPairJoin}
        WHERE 1=1
      `;

      if (hidePairedPhaseRows) {
        sql += ` AND NOT EXISTS (
          SELECT 1 FROM acknowledgement_receiptstbl ar_parent
          WHERE ar_parent.paired_ack_receipt_id = ar.ack_receipt_id
        )`;
      }

      const params = [];
      let paramCount = 0;

      // Receipts that are not already consumed (enrollment: one use per AR)
      if (onlyUnusedList) {
        sql += ` AND ar.invoice_id IS NULL AND ar.payment_id IS NULL AND (ar.status IS NULL OR UPPER(TRIM(ar.status)) != 'APPLIED')`;
      }

      // Branch restriction for non-superadmin users
      if (req.user.userType !== 'Superadmin' && req.user.branchId) {
        paramCount += 1;
        sql += ` AND ar.branch_id = $${paramCount}`;
        params.push(req.user.branchId);
      } else if (branch_id) {
        paramCount += 1;
        sql += ` AND ar.branch_id = $${paramCount}`;
        params.push(branch_id);
      }

      if (status) {
        const statuses = String(status).split(',').map((s) => s.trim()).filter(Boolean);
        if (statuses.length > 0) {
          paramCount += 1;
          sql += ` AND ar.status = ANY($${paramCount}::text[])`;
          params.push(statuses);
        }
      }

      if (exclude_status) {
        const excluded = String(exclude_status)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        if (excluded.length > 0) {
          paramCount += 1;
          sql += ` AND (ar.status IS NULL OR NOT (ar.status = ANY($${paramCount}::text[])))`;
          params.push(excluded);
        }
      }

      if (search) {
        paramCount += 1;
        const likeParam = `%${search}%`;
        sql += ` AND (
          ar.prospect_student_name ILIKE $${paramCount}
          OR COALESCE(ar.prospect_student_contact, '') ILIKE $${paramCount}
          OR COALESCE(ar.reference_number, '') ILIKE $${paramCount}
        )`;
        params.push(likeParam);
      }

      if (payment_method) {
        paramCount += 1;
        sql += ` AND ar.payment_method = $${paramCount}`;
        params.push(payment_method);
      }

      if (paymentFrom) {
        paramCount += 1;
        sql += ` AND ar.issue_date >= $${paramCount}::date`;
        params.push(paymentFrom);
      }
      if (paymentTo) {
        paramCount += 1;
        sql += ` AND ar.issue_date <= $${paramCount}::date`;
        params.push(paymentTo);
      }

      if (arFrom) {
        paramCount += 1;
        sql += ` AND ar.issue_date >= $${paramCount}::date`;
        params.push(arFrom);
      }
      if (arTo) {
        paramCount += 1;
        sql += ` AND ar.issue_date <= $${paramCount}::date`;
        params.push(arTo);
      }

      if (createdFrom) {
        paramCount += 1;
        sql += ` AND ar.created_at::date >= $${paramCount}::date`;
        params.push(createdFrom);
      }
      if (createdTo) {
        paramCount += 1;
        sql += ` AND ar.created_at::date <= $${paramCount}::date`;
        params.push(createdTo);
      }

      sql += ` ORDER BY ar.ack_receipt_id DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
      params.push(limitNum, offset);

      const result = await query(sql, params);

      // Total count for pagination
      let countSql = `SELECT COUNT(*) AS total FROM acknowledgement_receiptstbl ar WHERE 1=1`;
      if (hidePairedPhaseRows) {
        countSql += ` AND NOT EXISTS (
          SELECT 1 FROM acknowledgement_receiptstbl ar_parent
          WHERE ar_parent.paired_ack_receipt_id = ar.ack_receipt_id
        )`;
      }
      const countParams = [];
      let countParamCount = 0;

      if (req.user.userType !== 'Superadmin' && req.user.branchId) {
        countParamCount += 1;
        countSql += ` AND ar.branch_id = $${countParamCount}`;
        countParams.push(req.user.branchId);
      } else if (branch_id) {
        countParamCount += 1;
        countSql += ` AND ar.branch_id = $${countParamCount}`;
        countParams.push(branch_id);
      }

      if (onlyUnusedList) {
        countSql += ` AND ar.invoice_id IS NULL AND ar.payment_id IS NULL AND (ar.status IS NULL OR UPPER(TRIM(ar.status)) != 'APPLIED')`;
      }

      if (status) {
        const statuses = String(status).split(',').map((s) => s.trim()).filter(Boolean);
        if (statuses.length > 0) {
          countParamCount += 1;
          countSql += ` AND ar.status = ANY($${countParamCount}::text[])`;
          countParams.push(statuses);
        }
      }

      if (exclude_status) {
        const excluded = String(exclude_status)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        if (excluded.length > 0) {
          countParamCount += 1;
          countSql += ` AND (ar.status IS NULL OR NOT (ar.status = ANY($${countParamCount}::text[])))`;
          countParams.push(excluded);
        }
      }

      if (search) {
        countParamCount += 1;
        const likeParam = `%${search}%`;
        countSql += ` AND (
          ar.prospect_student_name ILIKE $${countParamCount}
          OR COALESCE(ar.prospect_student_contact, '') ILIKE $${countParamCount}
          OR COALESCE(ar.reference_number, '') ILIKE $${countParamCount}
        )`;
        countParams.push(likeParam);
      }

      if (payment_method) {
        countParamCount += 1;
        countSql += ` AND ar.payment_method = $${countParamCount}`;
        countParams.push(payment_method);
      }

      if (paymentFrom) {
        countParamCount += 1;
        countSql += ` AND ar.issue_date >= $${countParamCount}::date`;
        countParams.push(paymentFrom);
      }
      if (paymentTo) {
        countParamCount += 1;
        countSql += ` AND ar.issue_date <= $${countParamCount}::date`;
        countParams.push(paymentTo);
      }

      if (arFrom) {
        countParamCount += 1;
        countSql += ` AND ar.issue_date >= $${countParamCount}::date`;
        countParams.push(arFrom);
      }
      if (arTo) {
        countParamCount += 1;
        countSql += ` AND ar.issue_date <= $${countParamCount}::date`;
        countParams.push(arTo);
      }

      if (createdFrom) {
        countParamCount += 1;
        countSql += ` AND ar.created_at::date >= $${countParamCount}::date`;
        countParams.push(createdFrom);
      }
      if (createdTo) {
        countParamCount += 1;
        countSql += ` AND ar.created_at::date <= $${countParamCount}::date`;
        countParams.push(createdTo);
      }

      const countResult = await query(countSql, countParams);
      const total = parseInt(countResult.rows[0].total, 10) || 0;
      const sumLineExpr = hidePairedPhaseRows
        ? `COALESCE(ar.payment_amount, 0) + COALESCE(ar.tip_amount, 0) + COALESCE((
             SELECT COALESCE(pay.payment_amount, 0) + COALESCE(pay.tip_amount, 0)
             FROM acknowledgement_receiptstbl pay
             WHERE pay.ack_receipt_id = ar.paired_ack_receipt_id
           ), 0)`
        : `COALESCE(ar.payment_amount, 0) + COALESCE(ar.tip_amount, 0)`;
      const sumSql = countSql.replace(
        /SELECT COUNT\(\*\) AS total/i,
        `SELECT COALESCE(SUM(${sumLineExpr}), 0)::numeric AS total_line_amount`
      );
      const sumResult = await query(sumSql, countParams);
      const filterTotalLineAmount = parseFloat(sumResult.rows[0]?.total_line_amount ?? 0) || 0;

      res.json({
        success: true,
        data: result.rows.map(omitAckReceiptNumber),
        filterTotalLineAmount,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/sms/acknowledgement-receipts
 * Create a new acknowledgement receipt (front-desk fast payment)
 * Supports Package (enrollment) and Merchandise (buy merchandise) types
 * Access: Superadmin, Admin (branch admin) - Merchandise; Superadmin, Admin, Finance, Superfinance - Package
 */
router.post(
  '/',
  [
    body('ar_type')
      .optional({ nullable: true })
      .isIn(['Package', 'Merchandise'])
      .withMessage('ar_type must be Package or Merchandise'),
    body('prospect_student_name').notEmpty().isString().withMessage('Student name is required'),
    body('prospect_student_contact').optional({ nullable: true }).isString().withMessage('Guardian name must be a string'),
    body('prospect_student_email').optional({ nullable: true, checkFalsy: true }).isEmail().withMessage('Client email must be a valid email'),
    body('prospect_student_notes').optional().isString().withMessage('Notes must be a string'),
    body('package_id').optional({ nullable: true }).isInt().withMessage('Package ID must be an integer'),
    body('payment_amount').optional({ nullable: true }).isFloat({ min: 0.01 }).withMessage('Payment amount must be greater than 0'),
    body('tip_amount').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('Tip amount must be 0 or greater'),
    body('issue_date').isISO8601().withMessage('Issue date is required and must be a valid date'),
    body('payment_method')
      .optional({ nullable: true })
      .isIn(ALLOWED_AR_PAYMENT_METHODS)
      .withMessage('payment_method must be Cash, Online Banking, Credit Card, or E-wallets'),
    body('reference_number')
      .trim()
      .notEmpty()
      .withMessage('Reference number is required')
      .isString()
      .withMessage('Reference number must be a string'),
    body('payment_attachment_url')
      .custom((value) => typeof value === 'string' && value.trim().length > 0)
      .withMessage('Attachment image is required'),
    body('level_tag').optional({ nullable: true }).isString().withMessage('Level tag must be a string'),
    body('installment_option')
      .optional({ nullable: true })
      .isIn(['downpayment_only', 'downpayment_plus_phase1'])
      .withMessage('installment_option must be downpayment_only or downpayment_plus_phase1'),
    body('merchandise_items').optional().isArray().withMessage('merchandise_items must be an array'),
    body('merchandise_items.*.merchandise_id').optional().isInt().withMessage('merchandise_id must be an integer'),
    body('merchandise_items.*.quantity').optional().isInt({ min: 1 }).withMessage('quantity must be a positive integer'),
    body('student_id').optional({ nullable: true }).isInt().withMessage('student_id must be an integer'),
    handleValidationErrors,
  ],
    requireRole('Superadmin', 'Admin', 'Finance', 'Superfinance'),
  async (req, res, next) => {
    const arType = req.body.ar_type || 'Package';
    const isMerchandise = arType === 'Merchandise';

    // Merchandise AR: Superadmin and Admin only (branch admin)
    if (isMerchandise) {
      const allowed = ['Superadmin', 'Admin'];
      if (!allowed.includes(req.user?.userType)) {
        return res.status(403).json({
          success: false,
          message: 'Only Superadmin and Branch Admin can create merchandise acknowledgement receipts',
        });
      }
    }

    const client = await getClient();
    try {
      await client.query('BEGIN');

      const {
        prospect_student_name,
        prospect_student_contact,
        prospect_student_email,
        prospect_student_notes,
        package_id,
        issue_date,
        payment_method,
        tip_amount,
        reference_number,
        payment_attachment_url,
        level_tag,
        installment_option,
        branch_id: bodyBranchId,
        merchandise_items = [],
        student_id: linkedStudentId,
      } = req.body;

      let branchId = bodyBranchId || req.user.branchId || null;
      /** When true, create two Package AR rows (sequential AR numbers); leader links phase via paired_ack_receipt_id. */
      let isSplitDualPackageAr = false;
      let splitDownpaymentAmt = 0;
      let splitMonthlyAmt = 0;
      let splitPackageDisplayName = null;
      const normalizedPaymentMethod = ALLOWED_AR_PAYMENT_METHODS.includes(String(payment_method || '').trim())
        ? String(payment_method).trim()
        : 'Cash';
      let packageNameSnapshot = null;
      let packageAmountSnapshot = null;
      let pkgId = null;
      let totalPaymentAmount = 0;
      let merchandiseItemsSnapshot = null;

      if (isMerchandise) {
        // ── MERCHANDISE AR ─────────────────────────────────────────────────
        if (!merchandise_items || merchandise_items.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: 'At least one merchandise item is required for merchandise acknowledgement receipt',
          });
        }

        if (!bodyBranchId && !req.user.branchId) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: 'Branch is required for merchandise acknowledgement receipt',
          });
        }

        const merchSnapshots = [];
        let totalAmount = 0;

        for (const item of merchandise_items) {
          const merchId = item.merchandise_id;
          const qty = Math.max(1, parseInt(item.quantity, 10) || 1);

          const merchResult = await client.query(
            `SELECT merchandise_id, merchandise_name, size, quantity, price, branch_id
             FROM merchandisestbl WHERE merchandise_id = $1`,
            [merchId]
          );

          if (merchResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
              success: false,
              message: `Merchandise ID ${merchId} not found`,
            });
          }

          const merch = merchResult.rows[0];
          const price = parseFloat(merch.price) || 0;
          const itemTotal = price * qty;
          totalAmount += itemTotal;

          if (merch.branch_id && branchId && merch.branch_id !== branchId) {
            await client.query('ROLLBACK');
            return res.status(400).json({
              success: false,
              message: `Merchandise "${merch.merchandise_name}" belongs to a different branch`,
            });
          }

          const availableQty = merch.quantity != null ? parseInt(merch.quantity, 10) : null;
          if (availableQty !== null && availableQty < qty) {
            await client.query('ROLLBACK');
            return res.status(400).json({
              success: false,
              message: `Insufficient stock for ${merch.merchandise_name}${merch.size ? ` (${merch.size})` : ''}. Available: ${availableQty}, Requested: ${qty}`,
            });
          }

          merchSnapshots.push({
            merchandise_id: merch.merchandise_id,
            merchandise_name: merch.merchandise_name,
            size: merch.size,
            quantity: qty,
            price,
            branch_id: merch.branch_id || branchId,
          });
        }

        merchandiseItemsSnapshot = merchSnapshots;
        totalPaymentAmount = totalAmount;

        if (totalPaymentAmount <= 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: 'Payment amount must be greater than 0. Check merchandise prices and quantities.',
          });
        }
      } else {
        // ── PACKAGE AR ─────────────────────────────────────────────────────
        if (!prospect_student_contact || !prospect_student_contact.trim()) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: 'Guardian name is required for package acknowledgement receipt',
          });
        }

        if (!package_id) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: 'Package ID is required for package acknowledgement receipt',
          });
        }

        const pkgResult = await client.query(
          `SELECT package_id, package_name, package_price, branch_id, package_type, downpayment_amount, payment_option
           FROM packagestbl WHERE package_id = $1`,
          [package_id]
        );

        if (pkgResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({
            success: false,
            message: 'Package not found',
          });
        }

        const pkg = pkgResult.rows[0];
        pkgId = pkg.package_id;
        packageNameSnapshot = pkg.package_name;
        packageAmountSnapshot = pkg.package_price;
        branchId = branchId || pkg.branch_id || null;

        const isInstallmentPkg =
          (pkg.package_type || '').toLowerCase() === 'installment' ||
          (pkg.package_type === 'Phase' && (pkg.payment_option || '').toLowerCase() === 'installment');
        const downpayment = parseFloat(pkg.downpayment_amount ?? 0) || 0;
        const monthly = parseFloat(pkg.package_price ?? 0) || 0;

        if (isInstallmentPkg && downpayment > 0) {
          const opt =
            installment_option === 'downpayment_plus_phase1' ? 'downpayment_plus_phase1' : 'downpayment_only';
          totalPaymentAmount = opt === 'downpayment_plus_phase1' ? downpayment + monthly : downpayment;
          if (opt === 'downpayment_plus_phase1') {
            isSplitDualPackageAr = true;
            splitDownpaymentAmt = downpayment;
            splitMonthlyAmt = monthly;
            splitPackageDisplayName = pkg.package_name;
          }
        } else {
          totalPaymentAmount = monthly;
        }

        if (!branchId) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: 'Branch is required to create an acknowledgement receipt',
          });
        }

        if (totalPaymentAmount <= 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: 'Payment amount must be greater than 0. Check package pricing.',
          });
        }
      }

      // Verify branch exists
      const branchCheck = await client.query('SELECT branch_id FROM branchestbl WHERE branch_id = $1', [branchId]);
      if (branchCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Branch not found',
        });
      }

      const createdBy = req.user.userId || null;
      // Business rule (Package AR):
      //   * Cash payment method  -> auto-verified at creation time. No
      //     separate Finance/Superfinance verification step is needed,
      //     regardless of who creates the AR (Admin, Superadmin, Finance,
      //     or Superfinance).
      //   * Any other method (Online Banking, Credit Card, E-wallets) ->
      //     status = 'Submitted'. Finance/Superfinance must verify via
      //     PUT /:id/verify before the AR can be applied to an invoice.
      // Merchandise ARs follow a separate auto-paid flow below and are
      // unaffected by this rule.
      const autoVerifyCashAr =
        !isMerchandise && normalizedPaymentMethod === 'Cash';
      const initialPackageStatus = autoVerifyCashAr ? 'Verified' : 'Submitted';
      const hasVerifierCols = await ackReceiptHasVerifierColumns();

      const arVerifiedByOnCreate =
        !isMerchandise && initialPackageStatus === 'Verified' ? createdBy : null;
      const arVerifiedAtOnCreate = arVerifiedByOnCreate ? new Date() : null;

      let ackReceipt;
      let pairedAckReceipt = null;

      const insertAcknowledgementRow = async ({
        ackNum,
        statusVal,
        arTypeVal,
        payAmt,
        tipAmt,
        pkgSnapName,
        pkgSnapAmt,
        merchJson,
        installmentOpt,
      }) => {
        const insertParams = [
          ackNum,
          statusVal,
          arTypeVal,
          prospect_student_name,
          prospect_student_contact?.trim() || null,
          prospect_student_email?.trim()?.toLowerCase() || null,
          prospect_student_notes?.trim() || null,
          linkedStudentId || null,
          branchId,
          pkgId,
          pkgSnapName,
          pkgSnapAmt,
          merchJson,
          payAmt,
          tipAmt,
          issue_date,
          normalizedPaymentMethod,
          reference_number?.trim() || null,
          payment_attachment_url || null,
          level_tag?.trim() || null,
          installmentOpt,
          createdBy,
        ];
        const insertParamsWithVerifier = hasVerifierCols
          ? [...insertParams, arVerifiedByOnCreate, arVerifiedAtOnCreate]
          : insertParams;
        const insResult = hasVerifierCols
          ? await client.query(
              `INSERT INTO acknowledgement_receiptstbl (
               ack_receipt_number,
               status,
               ar_type,
               prospect_student_name,
               prospect_student_contact,
               prospect_student_email,
               prospect_student_notes,
               student_id,
               branch_id,
               package_id,
               package_name_snapshot,
               package_amount_snapshot,
               merchandise_items_snapshot,
               payment_amount,
               tip_amount,
               issue_date,
               payment_method,
               reference_number,
               payment_attachment_url,
               level_tag,
               installment_option,
               invoice_id,
               payment_id,
               created_by,
               verified_by_user_id,
               verified_at
             )
             VALUES (
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
               $13, $14, $15, $16, $17, $18, $19, $20, $21, NULL, NULL, $22,
               $23, $24
             )
             RETURNING *`,
              insertParamsWithVerifier
            )
          : await client.query(
              `INSERT INTO acknowledgement_receiptstbl (
               ack_receipt_number,
               status,
               ar_type,
               prospect_student_name,
               prospect_student_contact,
               prospect_student_email,
               prospect_student_notes,
               student_id,
               branch_id,
               package_id,
               package_name_snapshot,
               package_amount_snapshot,
               merchandise_items_snapshot,
               payment_amount,
               tip_amount,
               issue_date,
               payment_method,
               reference_number,
               payment_attachment_url,
               level_tag,
               installment_option,
               invoice_id,
               payment_id,
               created_by
             )
             VALUES (
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
               $13, $14, $15, $16, $17, $18, $19, $20, $21, NULL, NULL, $22
             )
             RETURNING *`,
              insertParams
            );
        return insResult.rows[0];
      };

      if (isSplitDualPackageAr && !isMerchandise) {
        const hasPairedCol = await ackReceiptHasPairedAckReceiptIdColumn();
        if (!hasPairedCol) {
          await client.query('ROLLBACK');
          return res.status(503).json({
            success: false,
            message:
              'Run database migration 109_add_paired_ack_receipt_id.sql (paired_ack_receipt_id on acknowledgement_receiptstbl) before creating Downpayment + Phase 1 receipts.',
          });
        }
        const n1 = await allocateNextArStyleNumber(client);
        const n2 = await allocateNextArStyleNumber(client);
        const stud = String(prospect_student_name || '').trim();
        const lvl = String(level_tag || '').trim() || '-';
        const dpDesc = `Downpayment for ${splitPackageDisplayName || 'Installment'}`;
        const phDesc = `(Phase 1) Installment plan for ${stud} - ${lvl}`;
        const tipVal = parseFloat(tip_amount || 0) || 0;

        ackReceipt = await insertAcknowledgementRow({
          ackNum: n1,
          statusVal: initialPackageStatus,
          arTypeVal: 'Package',
          payAmt: splitDownpaymentAmt,
          tipAmt: tipVal,
          pkgSnapName: dpDesc,
          pkgSnapAmt: splitDownpaymentAmt,
          merchJson: null,
          installmentOpt: 'downpayment_plus_phase1',
        });
        pairedAckReceipt = await insertAcknowledgementRow({
          ackNum: n2,
          statusVal: initialPackageStatus,
          arTypeVal: 'Package',
          payAmt: splitMonthlyAmt,
          tipAmt: 0,
          pkgSnapName: phDesc,
          pkgSnapAmt: splitMonthlyAmt,
          merchJson: null,
          installmentOpt: null,
        });
        await client.query(
          `UPDATE acknowledgement_receiptstbl SET paired_ack_receipt_id = $1 WHERE ack_receipt_id = $2`,
          [pairedAckReceipt.ack_receipt_id, ackReceipt.ack_receipt_id]
        );
      } else {
        const ackNumber = await allocateNextArStyleNumber(client);
        ackReceipt = await insertAcknowledgementRow({
          ackNum: ackNumber,
          statusVal: isMerchandise ? 'Pending' : initialPackageStatus,
          arTypeVal: isMerchandise ? 'Merchandise' : 'Package',
          payAmt: totalPaymentAmount,
          tipAmt: tip_amount || 0,
          pkgSnapName: packageNameSnapshot,
          pkgSnapAmt: packageAmountSnapshot,
          merchJson: merchandiseItemsSnapshot ? JSON.stringify(merchandiseItemsSnapshot) : null,
          installmentOpt: isMerchandise ? null : installment_option || null,
        });
      }

      // ── For Merchandise AR: auto-generate invoice ─────────────────────────
      if (isMerchandise && merchandiseItemsSnapshot) {
        let studentIdForInvoice = linkedStudentId;

        if (!studentIdForInvoice) {
          // Use or auto-create Walk-in Customer for unregistered students (no migration needed)
          const walkInResult = await client.query(
            `SELECT user_id FROM userstbl WHERE email = 'walkin@merchandise.psms.internal' LIMIT 1`
          );
          if (walkInResult.rows.length > 0) {
            studentIdForInvoice = walkInResult.rows[0].user_id;
          } else {
            // Auto-create Walk-in Customer (idempotent: ON CONFLICT reuses existing)
            const insertResult = await client.query(
              `INSERT INTO userstbl (email, full_name, user_type) 
               VALUES ('walkin@merchandise.psms.internal', 'Walk-in Customer', 'Student') 
               ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
               RETURNING user_id`
            );
            studentIdForInvoice = insertResult.rows[0].user_id;
          }
        }

        const invoiceDesc = 'Merchandise (acknowledgement receipt)';

        const invoiceResult = await client.query(
          `INSERT INTO invoicestbl (invoice_description, branch_id, amount, status, remarks, issue_date, due_date, created_by, ack_receipt_id, invoice_ar_number)
           VALUES ($1, $2, $3, 'Unpaid', $4, $5, $6, $7, $8, $9)
           RETURNING *`,
          [
            invoiceDesc,
            branchId,
            totalPaymentAmount,
            `Merchandise purchase (acknowledgement receipt) — ${prospect_student_name}`,
            issue_date,
            issue_date,
            createdBy,
            ackReceipt.ack_receipt_id,
            ackReceipt.ack_receipt_number,
          ]
        );

        const newInvoice = invoiceResult.rows[0];

        for (const item of merchandiseItemsSnapshot) {
          const desc = `Merchandise: ${item.merchandise_name}${item.size ? ` (${item.size})` : ''}`;
          const itemAmount = (item.price || 0) * (item.quantity || 1);
          await client.query(
            `INSERT INTO invoiceitemstbl (invoice_id, description, amount) VALUES ($1, $2, $3)`,
            [newInvoice.invoice_id, desc, itemAmount]
          );
        }

        await client.query(
          'INSERT INTO invoicestudentstbl (invoice_id, student_id) VALUES ($1, $2)',
          [newInvoice.invoice_id, studentIdForInvoice]
        );

        await client.query(
          `UPDATE acknowledgement_receiptstbl SET invoice_id = $1 WHERE ack_receipt_id = $2`,
          [newInvoice.invoice_id, ackReceipt.ack_receipt_id]
        );

        ackReceipt.invoice_id = newInvoice.invoice_id;

        const itemsSumResult = await client.query(
          `SELECT COALESCE(SUM(amount), 0) AS s FROM invoiceitemstbl WHERE invoice_id = $1`,
          [newInvoice.invoice_id]
        );
        const itemTotal = parseFloat(itemsSumResult.rows[0].s) || 0;

        const actionOwnerAck = newInvoice.created_by != null ? newInvoice.created_by : createdBy;
        const hasActionOwnerCol = await paymenttblHasActionOwnerUserIdColumn();

        const paymentInsert = hasActionOwnerCol
          ? await client.query(
              `INSERT INTO paymenttbl (
             invoice_id, student_id, branch_id, payment_method, payment_type,
             payable_amount, tip_amount, issue_date, status, reference_number, remarks, created_by, payment_attachment_url, action_owner_user_id
           )
           VALUES ($1, $2, $3, 'Cash', 'Full Payment', $4, $5, $6::date, 'Completed', $7, $8, $9, $10, $11)
           RETURNING *`,
              [
                newInvoice.invoice_id,
                studentIdForInvoice,
                branchId,
                itemTotal,
                tip_amount || 0,
                issue_date,
                reference_number?.trim() || null,
                'Merchandise payment (acknowledgement receipt)',
                createdBy,
                payment_attachment_url || null,
                actionOwnerAck,
              ]
            )
          : await client.query(
              `INSERT INTO paymenttbl (
             invoice_id, student_id, branch_id, payment_method, payment_type,
             payable_amount, tip_amount, issue_date, status, reference_number, remarks, created_by, payment_attachment_url
           )
           VALUES ($1, $2, $3, 'Cash', 'Full Payment', $4, $5, $6::date, 'Completed', $7, $8, $9, $10)
           RETURNING *`,
              [
                newInvoice.invoice_id,
                studentIdForInvoice,
                branchId,
                itemTotal,
                tip_amount || 0,
                issue_date,
                reference_number?.trim() || null,
                'Merchandise payment (acknowledgement receipt)',
                createdBy,
                payment_attachment_url || null,
              ]
            );
        const newPayment = paymentInsert.rows[0];

        await client.query(
          `UPDATE invoicestbl SET status = 'Paid', amount = 0 WHERE invoice_id = $1`,
          [newInvoice.invoice_id]
        );

        await client.query(
          `UPDATE acknowledgement_receiptstbl SET status = 'Paid', payment_id = $1 WHERE ack_receipt_id = $2`,
          [newPayment.payment_id, ackReceipt.ack_receipt_id]
        );

        for (const item of merchandiseItemsSnapshot) {
          const merchId = item.merchandise_id;
          const qty = parseInt(item.quantity, 10) || 1;
          await client.query(
            `UPDATE merchandisestbl SET quantity = GREATEST(0, COALESCE(quantity, 0) - $1) WHERE merchandise_id = $2`,
            [qty, merchId]
          );
        }

        ackReceipt.status = 'Paid';
        ackReceipt.payment_id = newPayment.payment_id;
      }

      await client.query('COMMIT');

      createArSubmissionNotification({
        ackReceiptId: ackReceipt.ack_receipt_id,
        branchId,
        createdByUserId: createdBy,
        studentName: prospect_student_name,
        arType: isMerchandise ? 'Merchandise' : 'Package',
        paymentMethod: normalizedPaymentMethod,
        status: ackReceipt.status,
      });

      if (pairedAckReceipt) {
        createArSubmissionNotification({
          ackReceiptId: pairedAckReceipt.ack_receipt_id,
          branchId,
          createdByUserId: createdBy,
          studentName: prospect_student_name,
          arType: 'Package',
          paymentMethod: normalizedPaymentMethod,
          status: pairedAckReceipt.status,
        });
      }

      if (ackReceipt.status === 'Paid' || ackReceipt.status === 'Applied') {
        (async () => {
          try {
            const emailClient = await getClient();
            try {
              await sendArPaymentConfirmationByAckId(emailClient, ackReceipt.ack_receipt_id);
              if (ackReceipt.invoice_id) {
                await sendInvoicePaymentConfirmationByInvoiceId(emailClient, ackReceipt.invoice_id);
              }
            } finally {
              emailClient.release();
            }
          } catch (emailError) {
            console.error(
              `❌ Error sending AR payment confirmation email for AR ${ackReceipt.ack_receipt_id}:`,
              emailError
            );
          }
        })();
      }

      res.status(201).json({
        success: true,
        // Include ack_receipt_number for the creator so the post-creation
        // modal can display and print the receipt without a separate lookup.
        data: {
          ...omitAckReceiptNumber(ackReceipt),
          ack_receipt_number: ackReceipt.ack_receipt_number,
        },
        ...(pairedAckReceipt
          ? {
              paired_acknowledgement_receipt: {
                ...omitAckReceiptNumber(pairedAckReceipt),
                ack_receipt_number: pairedAckReceipt.ack_receipt_number,
              },
              message:
                'Two sequential AR numbers were issued (downpayment, then Phase 1). Only the downpayment receipt appears on the AR list; Phase 1 is linked for printing and matches the Phase 1 invoice AR number after enrollment.',
            }
          : {}),
        ...(isMerchandise && ackReceipt.invoice_id && !pairedAckReceipt
          ? {
              message:
                'Merchandise acknowledgement receipt created. Invoice is marked Paid, payment recorded, and stock updated.',
            }
          : {}),
      });
    } catch (err) {
      await client.query('ROLLBACK');
      next(err);
    } finally {
      client.release();
    }
  }
);

/**
 * GET /api/sms/acknowledgement-receipts/:id
 * Get a single acknowledgement receipt
 * Access: Superadmin, Admin, Finance, Superfinance
 */
router.get(
  '/:id',
  [param('id').isInt().withMessage('ID must be an integer'), handleValidationErrors],
  requireRole('Superadmin', 'Admin', 'Finance', 'Superfinance'),
  async (req, res, next) => {
    try {
      const { id } = req.params;

      const sql = `
        SELECT
          ar.*,
          COALESCE(b.branch_nickname, b.branch_name) AS branch_name,
          p.package_name,
          u.full_name AS student_name
        FROM acknowledgement_receiptstbl ar
        LEFT JOIN branchestbl b ON ar.branch_id = b.branch_id
        LEFT JOIN packagestbl p ON ar.package_id = p.package_id
        LEFT JOIN userstbl u ON ar.student_id = u.user_id
        WHERE ar.ack_receipt_id = $1
      `;
      const result = await query(sql, [id]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Acknowledgement receipt not found',
        });
      }

      const ar = result.rows[0];

      // Enforce branch restriction for non-superadmin users
      if (req.user.userType !== 'Superadmin' && req.user.branchId && ar.branch_id !== req.user.branchId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied',
        });
      }

      res.json({
        success: true,
        data: omitAckReceiptNumber(ar),
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/sms/acknowledgement-receipts/:id/pdf
 * Generate a printable Acknowledgement Receipt PDF directly from AR data.
 * Works for both Package and Merchandise ARs without needing an invoice_id.
 *
 * Optional query `paired_id`: legacy — two sibling AR rows from an older split create;
 * returns one PDF with two pages. New Downpayment + Phase 1 receipts use a single row;
 * that case produces two pages automatically without `paired_id`.
 * Access: Superadmin, Admin, Finance, Superfinance
 */
router.get(
  '/:id/pdf',
  [
    param('id').isInt().withMessage('ID must be an integer'),
    queryValidator('paired_id')
      .optional()
      .isInt({ min: 1 })
      .withMessage('paired_id must be a positive integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin', 'Finance', 'Superfinance'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const idNum = Number(id);
      const pairedRaw = req.query.paired_id;
      const pairedNum =
        pairedRaw !== undefined && pairedRaw !== null && String(pairedRaw).trim() !== ''
          ? Number(pairedRaw)
          : null;

      const arResult = await query(ACK_RECEIPT_PDF_SELECT_SQL, [idNum]);

      if (arResult.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Acknowledgement receipt not found' });
      }

      const ar = arResult.rows[0];

      if (
        req.user.userType !== 'Superadmin' &&
        req.user.branchId != null &&
        ar.branch_id != null &&
        Number(ar.branch_id) !== Number(req.user.branchId)
      ) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }

      const logoPath = path.resolve(process.cwd(), '../frontend/public/LCA Icon.png');
      const hasLogo = fs.existsSync(logoPath);

      let pageRows = [ar];

      if (pairedNum != null && Number.isInteger(pairedNum) && pairedNum > 0) {
        if (pairedNum === idNum) {
          return res.status(400).json({
            success: false,
            message: 'paired_id must differ from the receipt id.',
          });
        }

        const ar2Result = await query(ACK_RECEIPT_PDF_SELECT_SQL, [pairedNum]);
        if (ar2Result.rows.length === 0) {
          return res.status(404).json({ success: false, message: 'Paired acknowledgement receipt not found' });
        }
        const ar2 = ar2Result.rows[0];

        if (
          req.user.userType !== 'Superadmin' &&
          req.user.branchId != null &&
          ar2.branch_id != null &&
          Number(ar2.branch_id) !== Number(req.user.branchId)
        ) {
          return res.status(403).json({ success: false, message: 'Access denied' });
        }

        if (!isDualPackageInstallmentPairForPdf(ar, ar2)) {
          return res.status(400).json({
            success: false,
            message:
              'These two receipts cannot be combined in one PDF. Use paired_id only for a Downpayment + Phase 1 package pair from the same submission.',
          });
        }

        pageRows = orderDualPackageArRowsForPdf(ar, ar2);
      } else if (ar.paired_ack_receipt_id) {
        const ar2Result = await query(ACK_RECEIPT_PDF_SELECT_SQL, [ar.paired_ack_receipt_id]);
        if (ar2Result.rows.length === 0) {
          return res.status(404).json({ success: false, message: 'Paired acknowledgement receipt not found' });
        }
        const ar2 = ar2Result.rows[0];
        if (
          req.user.userType !== 'Superadmin' &&
          req.user.branchId != null &&
          ar2.branch_id != null &&
          Number(ar2.branch_id) !== Number(req.user.branchId)
        ) {
          return res.status(403).json({ success: false, message: 'Access denied' });
        }
        if (!isDualPackageInstallmentPairForPdf(ar, ar2)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid Downpayment + Phase 1 acknowledgement receipt pair.',
          });
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

      const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
      res.setHeader('Content-Type', 'application/pdf');
      const pairedIdForName =
        pairedNum != null && Number.isInteger(pairedNum) && pairedNum > 0
          ? pairedNum
          : ar.paired_ack_receipt_id
            ? Number(ar.paired_ack_receipt_id)
            : null;
      const filename =
        pageRows.length > 1
          ? pairedIdForName
            ? `acknowledgement-receipt-${idNum}-and-${pairedIdForName}.pdf`
            : `acknowledgement-receipt-${idNum}-dp-phase1.pdf`
          : `acknowledgement-receipt-${idNum}.pdf`;
      res.setHeader('Content-Disposition', `inline; filename=${filename}`);
      doc.pipe(res);

      for (let i = 0; i < pageRows.length; i += 1) {
        if (i > 0) {
          doc.addPage({ margin: 40, size: 'A4', layout: 'landscape' });
        }
        drawAcknowledgementReceiptPage(doc, pageRows[i], logoPath, hasLogo);
      }

      doc.end();
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/sms/acknowledgement-receipts/:id/attach-to-invoice
 * Attach an acknowledgement receipt to an invoice and create payment
 * Access: Superadmin, Admin, Finance, Superfinance
 */
router.post(
  '/:id/attach-to-invoice',
  [
    param('id').isInt().withMessage('ID must be an integer'),
    body('invoice_id').isInt().withMessage('Invoice ID is required and must be an integer'),
    body('student_id').isInt().withMessage('Student ID is required and must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin', 'Finance', 'Superfinance'),
  async (req, res, next) => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const { id } = req.params;
      const { invoice_id, student_id } = req.body;

      // Load acknowledgement receipt
      const ackResult = await client.query(
        'SELECT * FROM acknowledgement_receiptstbl WHERE ack_receipt_id = $1',
        [id]
      );

      if (ackResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Acknowledgement receipt not found',
        });
      }

      const ack = ackResult.rows[0];

      const ackStatus = String(ack.status || '').trim();
      const ackStatusUpper = ackStatus.toUpperCase();
      const isAlreadyUsed =
        Boolean(ack.invoice_id || ack.payment_id) || ackStatusUpper === 'APPLIED';

      if (isAlreadyUsed) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message:
            'This acknowledgement receipt has already been used. Each acknowledgement receipt can only be applied once.',
        });
      }

      const ackPayment = parseFloat(ack.payment_amount ?? 0) || 0;
      if (ackPayment <= 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Acknowledgement receipt payment must be greater than zero.',
        });
      }

      const ackPaymentMethod = String(ack.payment_method || '').trim().toLowerCase();
      const isCashAck = ackPaymentMethod === 'cash';
      const isRejectedOrCancelled = ['Rejected', 'Cancelled', 'Returned'].includes(ackStatus);
      // "Applied" = already used (handled above). Here: finance-verified, or cash (no separate verify).
      const isVerifiedForAttach = ackStatusUpper === 'VERIFIED';
      const canAttachAck = !isRejectedOrCancelled && (isVerifiedForAttach || isCashAck);

      // Business rule:
      // - Non-cash AR requires Finance/Superfinance verification before use.
      // - Cash AR can be used directly (backward-compatible for legacy cash AR rows
      //   that were created before auto-verification logic was introduced).
      if (!canAttachAck) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Acknowledgement receipt must be Verified by Finance/Superfinance before it can be attached (cash acknowledgement receipt is allowed)',
        });
      }

      // Enforce branch access: non-superadmin limited to their branch
      if (req.user.userType !== 'Superadmin' && req.user.branchId && ack.branch_id !== req.user.branchId) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          success: false,
          message: 'Access denied for this acknowledgement receipt',
        });
      }

      // Verify student exists
      const studentCheck = await client.query('SELECT * FROM userstbl WHERE user_id = $1', [student_id]);
      if (studentCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Student not found',
        });
      }

      // Verify invoice exists
      const invoiceCheck = await client.query(
        'SELECT *, installmentinvoiceprofiles_id FROM invoicestbl WHERE invoice_id = $1',
        [invoice_id]
      );
      if (invoiceCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Invoice not found',
        });
      }

      const invoice = invoiceCheck.rows[0];

      // Basic sanity: ensure invoice is not already fully paid
      if (invoice.status === 'Paid') {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Invoice is already fully paid',
        });
      }

      if (invoice.balance_invoice_id || invoice.status === 'Balance Invoiced') {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'This invoice is closed for payments. Use the current balance invoice instead.',
        });
      }

      // Determine branch_id for payment from invoice or user
      const branch_id = invoice.branch_id || req.user.branchId || ack.branch_id || null;

      if (!branch_id) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Unable to determine branch for payment',
        });
      }

      // Verify branch exists
      const branchCheck = await client.query('SELECT branch_id FROM branchestbl WHERE branch_id = $1', [branch_id]);
      if (branchCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'Branch not found',
        });
      }

      const createdBy = req.user.userId || null;
      const actionOwnerAr = invoice.created_by != null ? invoice.created_by : createdBy;
      const hasActionOwnerColAr = await paymenttblHasActionOwnerUserIdColumn();
      const ackPaymentAmount = parseFloat(ack.payment_amount || 0) || 0;
      const ackTipAmount = parseFloat(ack.tip_amount || 0) || 0;
      const invoiceRemainingAmount = parseFloat(invoice.amount || 0) || 0;
      // Prevent overpaying the attached invoice when AR amount includes additional
      // components (e.g., downpayment + phase 1 combined in one AR).
      const paymentAmountForInvoice = invoiceRemainingAmount > 0
        ? Math.min(ackPaymentAmount, invoiceRemainingAmount)
        : ackPaymentAmount;

      const requestUserId = req.user.userId || req.user.user_id || null;
      const arVerifierUserId = ack.verified_by_user_id || requestUserId || null;
      const shouldAutoApproveFromVerifiedAr =
        ack.ar_type === 'Package' && String(ackStatus || '').trim().toUpperCase() === 'VERIFIED' && !!arVerifierUserId;

      // Create payment record from AR details — carry over reference_number and attachment from AR.
      // For non-cash ARs, Finance/Superfinance verification already happened at AR level,
      // so payment logs can be marked approved immediately after attachment.
      const paymentResult = hasActionOwnerColAr
        ? await client.query(
            `INSERT INTO paymenttbl (
           invoice_id,
           student_id,
           branch_id,
           payment_method,
           payment_type,
           payable_amount,
           tip_amount,
           issue_date,
           status,
           reference_number,
           remarks,
           created_by,
           payment_attachment_url,
           action_owner_user_id
         )
         VALUES ($1, $2, $3, 'Cash', 'Full Payment', $4, $5, $6, 'Completed', $7, $8, $9, $10, $11)
         RETURNING *`,
            [
              invoice_id,
              student_id,
              branch_id,
              paymentAmountForInvoice,
              ackTipAmount,
              ack.issue_date,
              ack.reference_number || null,
              ack.prospect_student_notes
                ? `Paid via acknowledgement receipt: ${ack.prospect_student_notes}`
                : 'Paid via acknowledgement receipt',
              createdBy,
              ack.payment_attachment_url || null,
              actionOwnerAr,
            ]
          )
        : await client.query(
            `INSERT INTO paymenttbl (
           invoice_id,
           student_id,
           branch_id,
           payment_method,
           payment_type,
           payable_amount,
           tip_amount,
           issue_date,
           status,
           reference_number,
           remarks,
           created_by,
           payment_attachment_url
         )
         VALUES ($1, $2, $3, 'Cash', 'Full Payment', $4, $5, $6, 'Completed', $7, $8, $9, $10)
         RETURNING *`,
            [
              invoice_id,
              student_id,
              branch_id,
              paymentAmountForInvoice,
              ackTipAmount,
              ack.issue_date,
              ack.reference_number || null,
              ack.prospect_student_notes
                ? `Paid via acknowledgement receipt: ${ack.prospect_student_notes}`
                : 'Paid via acknowledgement receipt',
              createdBy,
              ack.payment_attachment_url || null,
            ]
          );

      const newPayment = paymentResult.rows[0];

      if (shouldAutoApproveFromVerifiedAr && newPayment?.payment_id) {
        try {
          await client.query(
            `UPDATE paymenttbl
             SET approval_status = 'Approved',
                 approved_by = $1,
                 approved_at = CURRENT_TIMESTAMP
             WHERE payment_id = $2`,
            [arVerifierUserId, newPayment.payment_id]
          );
        } catch (autoApproveError) {
          // Do not fail enrollment/attachment when approval metadata update is unavailable.
          console.warn(
            'Auto-approve skipped for AR attached payment:',
            autoApproveError?.message || autoApproveError
          );
        }
      }

      // Update invoice payments and status (reuse logic from payments POST)
      const invoiceItemsResult = await client.query(
        `SELECT 
          COALESCE(SUM(amount), 0) as item_amount,
          COALESCE(SUM(discount_amount), 0) as total_discount,
          COALESCE(SUM(penalty_amount), 0) as total_penalty,
          COALESCE(SUM(amount * COALESCE(tax_percentage, 0) / 100), 0) as total_tax
         FROM invoiceitemstbl 
         WHERE invoice_id = $1`,
        [invoice_id]
      );

      const itemAmount = parseFloat(invoiceItemsResult.rows[0].item_amount) || 0;
      const totalDiscount = parseFloat(invoiceItemsResult.rows[0].total_discount) || 0;
      const totalPenalty = parseFloat(invoiceItemsResult.rows[0].total_penalty) || 0;
      const totalTax = parseFloat(invoiceItemsResult.rows[0].total_tax) || 0;

      const originalInvoiceAmount = itemAmount - totalDiscount + totalPenalty + totalTax;

      const totalPaymentsResult = await client.query(
        `SELECT COALESCE(SUM(COALESCE(payable_amount, 0) + COALESCE(discount_amount, 0)), 0) as total_paid
         FROM paymenttbl
         WHERE invoice_id = $1
           AND status = $2
           AND COALESCE(approval_status, 'Pending') <> 'Rejected'`,
        [invoice_id, 'Completed']
      );
      const totalPaid = parseFloat(totalPaymentsResult.rows[0].total_paid) || 0;

      const remainingBalance = Math.max(0, originalInvoiceAmount - totalPaid);

      await client.query('UPDATE invoicestbl SET amount = $1 WHERE invoice_id = $2', [
        remainingBalance,
        invoice_id,
      ]);

      let newInvoiceStatus = invoice.status;
      if (totalPaid >= originalInvoiceAmount) {
        newInvoiceStatus = 'Paid';
      } else if (totalPaid > 0) {
        newInvoiceStatus = 'Partially Paid';
      } else {
        const hasRejectedPayment = await invoiceHasRejectedPayment(client, invoice_id);
        if (hasRejectedPayment) {
          newInvoiceStatus = 'Rejected';
        } else if (invoice.status === 'Paid' || invoice.status === 'Partially Paid') {
          newInvoiceStatus = 'Unpaid';
        }
      }

      if (newInvoiceStatus !== invoice.status) {
        await client.query('UPDATE invoicestbl SET status = $1 WHERE invoice_id = $2', [
          newInvoiceStatus,
          invoice_id,
        ]);
      }

      // ── INSTALLMENT DOWNPAYMENT LOGIC ─────────────────────────────────────────
      // If the invoice is linked to an installment profile, mirror the same
      // post-payment logic from payments.js:
      //   • Mark downpayment as paid
      //   • Create the first installment invoice record
      //   • Generate the first installment invoice (async, after COMMIT)
      let _pendingInvoiceGeneration = null;
      if (newInvoiceStatus === 'Paid' && invoice.installmentinvoiceprofiles_id) {
        try {
          const profileResult = await client.query(
            `SELECT ip.class_id, ip.student_id, ip.total_phases, ip.generated_count,
                    ip.downpayment_paid, ip.downpayment_invoice_id, ip.amount, ip.frequency,
                    ip.first_generation_date, ip.next_invoice_due_date, ip.bill_invoice_due_date,
                    ip.branch_id, ip.package_id, ip.description, ip.phase_start
             FROM installmentinvoiceprofilestbl ip
             WHERE ip.installmentinvoiceprofiles_id = $1`,
            [invoice.installmentinvoiceprofiles_id]
          );

          if (profileResult.rows.length > 0) {
            const profile = profileResult.rows[0];

            // Treat as downpayment if: (a) profile explicitly links this invoice, OR (b) profile has no downpayment_invoice_id set
            const isDownpaymentInvoice = Number(profile.downpayment_invoice_id) === Number(invoice_id);
            const isFirstLinkedInvoice = !profile.downpayment_invoice_id && !profile.downpayment_paid && (profile.generated_count || 0) === 0;

            if ((isDownpaymentInvoice || isFirstLinkedInvoice) && !profile.downpayment_paid) {
              if (!profile.downpayment_invoice_id) {
                await client.query(
                  `UPDATE installmentinvoiceprofilestbl SET downpayment_invoice_id = $1 WHERE installmentinvoiceprofiles_id = $2`,
                  [invoice_id, invoice.installmentinvoiceprofiles_id]
                );
              }
              // Mark downpayment as paid
              await client.query(
                `UPDATE installmentinvoiceprofilestbl
                 SET downpayment_paid = true
                 WHERE installmentinvoiceprofiles_id = $1`,
                [invoice.installmentinvoiceprofiles_id]
              );

              // Get student name for the installment invoice record
              const studentNameResult = await client.query(
                'SELECT full_name FROM userstbl WHERE user_id = $1',
                [student_id]
              );
              const studentName = studentNameResult.rows[0]?.full_name || 'Student';

              // Calculate dates for the first installment invoice
              const firstGenerationDate = profile.first_generation_date
                ? new Date(profile.first_generation_date)
                : new Date();
              const nextInvoiceDueDate = profile.next_invoice_due_date
                ? new Date(profile.next_invoice_due_date)
                : new Date();

              // Create the first installment invoice record
              const firstInvoiceRecordResult = await client.query(
                `INSERT INTO installmentinvoicestbl
                 (installmentinvoiceprofiles_id, scheduled_date, status, student_name,
                  total_amount_including_tax, total_amount_excluding_tax, frequency,
                  next_generation_date, next_invoice_month)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 RETURNING *`,
                [
                  invoice.installmentinvoiceprofiles_id,
                  profile.bill_invoice_due_date || formatYmdLocal(nextInvoiceDueDate),
                  'Pending',
                  studentName,
                  profile.amount,
                  profile.amount,
                  profile.frequency || '1 month(s)',
                  formatYmdLocal(firstGenerationDate),
                  formatYmdLocal(nextInvoiceDueDate),
                ]
              );

              const firstInvoiceRecord = firstInvoiceRecordResult.rows[0];
              console.log(`✅ AR downpayment paid: Created first installment invoice record for profile ${invoice.installmentinvoiceprofiles_id}`);

              let phaseAckId = null;
              let phaseAckNum = null;
              if (ack.installment_option === 'downpayment_plus_phase1' && ack.paired_ack_receipt_id) {
                const phaseAckRes = await client.query(
                  'SELECT ack_receipt_id, ack_receipt_number FROM acknowledgement_receiptstbl WHERE ack_receipt_id = $1',
                  [ack.paired_ack_receipt_id]
                );
                if (phaseAckRes.rows.length > 0) {
                  phaseAckId = phaseAckRes.rows[0].ack_receipt_id;
                  phaseAckNum = phaseAckRes.rows[0].ack_receipt_number;
                }
              }

              // Store for async generation after COMMIT
              const enrollPhase = profile.phase_start != null ? parseInt(profile.phase_start) : 1;
              _pendingInvoiceGeneration = {
                firstInvoiceRecord,
                profile: {
                  student_id: profile.student_id,
                  branch_id: profile.branch_id || invoice.branch_id || null,
                  package_id: profile.package_id || null,
                  amount: profile.amount,
                  frequency: profile.frequency || '1 month(s)',
                  description: profile.description || 'Monthly Installment Payment',
                  generated_count: profile.generated_count || 0,
                  class_id: profile.class_id,
                  phase_start: profile.phase_start,
                },
                profileId: invoice.installmentinvoiceprofiles_id,
                // When "downpayment_plus_phase1" option: auto-pay first phase after generating it
                autoPayPhase1: ack.installment_option === 'downpayment_plus_phase1',
                autoPayPhase1Data: ack.installment_option === 'downpayment_plus_phase1' ? {
                  student_id,
                  branch_id: profile.branch_id || invoice.branch_id || null,
                  issue_date: ack.issue_date,
                  created_by: req.user.userId || null,
                  ar_verified_by_user_id: arVerifierUserId,
                  class_id: profile.class_id,
                  phase_1_amount: parseFloat(profile.amount),
                  profile_id: invoice.installmentinvoiceprofiles_id,
                  reference_number: ack.reference_number || null,
                  payment_attachment_url: ack.payment_attachment_url || null,
                  enroll_phase: enrollPhase, // Phase to enroll (phase_start for Phase packages, else 1)
                  phase_ack_receipt_id: phaseAckId,
                  phase_ack_receipt_number: phaseAckNum,
                } : null,
              };

              const skipPendingEnrollment =
                String(ack.installment_option || '').toLowerCase() === 'downpayment_plus_phase1' &&
                Boolean(ack.paired_ack_receipt_id);
              await ensurePendingEnrollmentAfterDownpaymentPaid(client, profile, student_id, {
                skip: skipPendingEnrollment,
              });
              // NOTE: If downpayment_only, student row is pending_enrollment until Phase 1 is paid.
              // If downpayment_plus_phase1, Phase 1 is auto-paid after COMMIT and student is enrolled then.
            }
          }
        } catch (installmentError) {
          console.error('Error processing AR installment downpayment:', installmentError);
        }
      }

      // If invoice is now fully paid (and not an installment or reservation fee),
      // reuse the full-payment auto-enrollment logic from payments.
      if (
        newInvoiceStatus === 'Paid' &&
        !invoice.installmentinvoiceprofiles_id &&
        invoice.invoice_description &&
        !invoice.invoice_description.includes('Reservation Fee')
      ) {
        try {
          // Get class_id from invoice remarks field (stored as CLASS_ID:class_id)
          let classId = null;
          if (invoice.remarks && invoice.remarks.includes('CLASS_ID:')) {
            const match = invoice.remarks.match(/CLASS_ID:(\d+)/);
            if (match) {
              classId = parseInt(match[1], 10);
            }
          }

          if (classId) {
            // Get class and curriculum info
            const classResult = await client.query(
              `SELECT c.class_id, c.program_id, cu.number_of_phase
               FROM classestbl c
               LEFT JOIN programstbl p ON c.program_id = p.program_id
               LEFT JOIN curriculumstbl cu ON p.curriculum_id = cu.curriculum_id
               WHERE c.class_id = $1`,
              [classId]
            );

            if (classResult.rows.length > 0) {
              const classData = classResult.rows[0];
              const totalPhases = classData.number_of_phase || 1;

              // Determine phase range for enrollment
              // Default: 1..totalPhases (full payment for entire class)
              // Phase packages: override using PHASE_START / PHASE_END from remarks
              let phaseStart = 1;
              let phaseEnd = totalPhases;
              if (invoice.remarks && invoice.remarks.includes('PHASE_START:')) {
                const startMatch = invoice.remarks.match(/PHASE_START:(\d+)/);
                if (startMatch) {
                  phaseStart = parseInt(startMatch[1], 10) || 1;
                }
              }
              if (invoice.remarks && invoice.remarks.includes('PHASE_END:')) {
                const endMatch = invoice.remarks.match(/PHASE_END:(\d+)/);
                if (endMatch) {
                  phaseEnd = parseInt(endMatch[1], 10) || phaseStart;
                }
              }
              // Clamp to valid range
              if (phaseStart < 1) phaseStart = 1;
              if (phaseEnd > totalPhases) phaseEnd = totalPhases;
              if (phaseEnd < phaseStart) phaseEnd = phaseStart;

              // Check if student is already enrolled in this class
              const existingEnrollmentCheck = await client.query(
                `SELECT classstudent_id, phase_number 
                 FROM classstudentstbl 
                 WHERE student_id = $1 AND class_id = $2
                 ORDER BY phase_number DESC`,
                [student_id, classId]
              );

              // If student is not enrolled, enroll in all phases for full payment
              if (existingEnrollmentCheck.rows.length === 0) {
                const arFullStatus = await detEnrollmentStatus({ db: client, studentId: student_id, classId, enrollmentType: 'full_payment' });
                for (let phase = phaseStart; phase <= phaseEnd; phase += 1) {
                  await client.query(
                    `INSERT INTO classstudentstbl (student_id, class_id, enrolled_by, phase_number, program_enrollment_status)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [
                      student_id,
                      classId,
                      'System (Auto-enrolled via acknowledgement receipt — full payment)',
                      phase,
                      arFullStatus,
                    ]
                  );
                }
              }
            }
          }
        } catch (fullPaymentError) {
          // Log error but don't fail AR attachment / payment
          console.error('Error auto-enrolling student for AR full payment:', fullPaymentError);
        }
      }

      // Link AR to invoice and payment
      await client.query(
        `UPDATE acknowledgement_receiptstbl
         SET status = 'Applied',
             student_id = $1,
             invoice_id = $2,
             payment_id = $3
         WHERE ack_receipt_id = $4`,
        [student_id, invoice_id, newPayment.payment_id, id]
      );

      if (ack.paired_ack_receipt_id) {
        await client.query(
          `UPDATE acknowledgement_receiptstbl SET student_id = $1 WHERE ack_receipt_id = $2`,
          [student_id, ack.paired_ack_receipt_id]
        );
      }

      // Package AR was issued with ack_receipt_number before enrollment; older enroll flows
      // allocated a new invoice_ar_number. Align invoice display with the physical receipt.
      const ackNumTrim = String(ack.ack_receipt_number || '').trim();
      if (
        String(ack.ar_type || '').trim().toLowerCase() === 'package' &&
        ackNumTrim &&
        String(invoice.invoice_ar_number || '').trim() !== ackNumTrim
      ) {
        await client.query(
          `UPDATE invoicestbl
           SET invoice_ar_number = $1,
               ack_receipt_id = COALESCE(ack_receipt_id, $3)
           WHERE invoice_id = $2`,
          [ackNumTrim, invoice_id, ack.ack_receipt_id]
        );
      }

      await client.query('COMMIT');

      if (newInvoiceStatus === 'Paid') {
        (async () => {
          try {
            const emailClient = await getClient();
            try {
              await sendArPaymentConfirmationByAckId(emailClient, id);
              await sendInvoicePaymentConfirmationByInvoiceId(emailClient, invoice_id);
            } finally {
              emailClient.release();
            }
          } catch (emailError) {
            console.error(`❌ Error sending paid confirmation email for AR ${id}/invoice ${invoice_id}:`, emailError);
          }
        })();
      }

      // Generate the first installment invoice AFTER the transaction commits
      // (mirrors the same async pattern used in payments.js)
      if (_pendingInvoiceGeneration) {
        const { firstInvoiceRecord, profile: genProfile, profileId, autoPayPhase1, autoPayPhase1Data } = _pendingInvoiceGeneration;
        (async () => {
          try {
            const { generateInvoiceFromInstallment } = await import('../utils/installmentInvoiceGenerator.js');
            const { query: dbQuery } = await import('../config/database.js');

            const enrollmentAckReuse =
              autoPayPhase1 &&
              autoPayPhase1Data?.phase_ack_receipt_id &&
              autoPayPhase1Data?.phase_ack_receipt_number
                ? {
                    reuseInvoiceArNumber: String(autoPayPhase1Data.phase_ack_receipt_number).trim(),
                    ack_receipt_id: Number(autoPayPhase1Data.phase_ack_receipt_id),
                  }
                : null;

            // Step 1: Generate Phase 1 invoice (reuse Phase 1 AR number on invoice when paired)
            const generatedInvoice = await generateInvoiceFromInstallment(
              firstInvoiceRecord,
              genProfile,
              enrollmentAckReuse
            );
            console.log(`✅ AR downpayment paid: Generated Phase 1 invoice ${generatedInvoice.invoice_id} for profile ${profileId}`);

            // Step 2: If "downpayment_plus_phase1", auto-pay Phase 1 and generate Phase 2
            if (autoPayPhase1 && autoPayPhase1Data) {
              try {
                const { student_id: sid, branch_id: bid, issue_date: ackDate,
                  created_by: createdBy, ar_verified_by_user_id, class_id, phase_1_amount, profile_id } = autoPayPhase1Data;
                const phaseApproverUserId = ar_verified_by_user_id || createdBy || null;

                // Create payment for Phase 1 invoice — carry over AR reference and attachment
                const phase1InvoiceId = generatedInvoice.invoice_id;
                const phase1InvRow = await dbQuery(
                  'SELECT created_by FROM invoicestbl WHERE invoice_id = $1',
                  [phase1InvoiceId]
                );
                const phase1ActionOwner =
                  phase1InvRow.rows[0]?.created_by != null
                    ? phase1InvRow.rows[0].created_by
                    : createdBy;

                const hasColPhase1 = await paymenttblHasActionOwnerUserIdColumn();
                if (hasColPhase1) {
                  await dbQuery(
                    `INSERT INTO paymenttbl (invoice_id, student_id, branch_id, payment_method, payment_type,
                     payable_amount, issue_date, status, approval_status, approved_by, approved_at, reference_number, remarks, created_by, payment_attachment_url, action_owner_user_id)
                   VALUES ($1, $2, $3, 'Cash', 'Installment', $4, $5, 'Completed', 'Approved', $6, CURRENT_TIMESTAMP, $7, $8, $9, $10, $11)`,
                    [
                      phase1InvoiceId,
                      sid,
                      bid,
                      phase_1_amount,
                      ackDate,
                      phaseApproverUserId,
                      autoPayPhase1Data.reference_number || null,
                      'Phase 1 auto-paid via acknowledgement receipt (Downpayment + Phase 1 option)',
                      createdBy,
                      autoPayPhase1Data.payment_attachment_url || null,
                      phase1ActionOwner,
                    ]
                  );
                } else {
                  await dbQuery(
                    `INSERT INTO paymenttbl (invoice_id, student_id, branch_id, payment_method, payment_type,
                     payable_amount, issue_date, status, approval_status, approved_by, approved_at, reference_number, remarks, created_by, payment_attachment_url)
                   VALUES ($1, $2, $3, 'Cash', 'Installment', $4, $5, 'Completed', 'Approved', $6, CURRENT_TIMESTAMP, $7, $8, $9, $10)`,
                    [
                      phase1InvoiceId,
                      sid,
                      bid,
                      phase_1_amount,
                      ackDate,
                      phaseApproverUserId,
                      autoPayPhase1Data.reference_number || null,
                      'Phase 1 auto-paid via acknowledgement receipt (Downpayment + Phase 1 option)',
                      createdBy,
                      autoPayPhase1Data.payment_attachment_url || null,
                    ]
                  );
                }

                // Mark Phase 1 invoice as Paid
                await dbQuery(
                  `UPDATE invoicestbl SET status = 'Paid', amount = 0 WHERE invoice_id = $1`,
                  [phase1InvoiceId]
                );
                console.log(`✅ AR Phase 1 auto-paid: invoice ${phase1InvoiceId}`);

                if (autoPayPhase1Data.phase_ack_receipt_id) {
                  await dbQuery(
                    `UPDATE acknowledgement_receiptstbl
                     SET status = 'Applied', student_id = $1, invoice_id = $2
                     WHERE ack_receipt_id = $3`,
                    [sid, phase1InvoiceId, autoPayPhase1Data.phase_ack_receipt_id]
                  );
                }

                // Enroll student in first phase (phase_start for Phase packages, else 1)
                if (class_id) {
                  const enrollPhase = autoPayPhase1Data.enroll_phase != null ? parseInt(autoPayPhase1Data.enroll_phase) : 1;
                  const activeEnrollment = await dbQuery(
                    `SELECT classstudent_id
                     FROM classstudentstbl
                     WHERE student_id = $1
                       AND class_id = $2
                       AND phase_number = $3
                       AND program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin')
                       AND removed_at IS NULL
                     LIMIT 1`,
                    [sid, class_id, enrollPhase]
                  );

                  if (activeEnrollment.rows.length === 0) {
                    const removedEnrollment = await dbQuery(
                      `SELECT classstudent_id
                       FROM classstudentstbl
                       WHERE student_id = $1
                         AND class_id = $2
                         AND phase_number = $3
                         AND program_enrollment_status = 'dropped'
                       ORDER BY removed_at DESC NULLS LAST, classstudent_id DESC
                       LIMIT 1`,
                      [sid, class_id, enrollPhase]
                    );

                    // Business rule: first paid installment phase after downpayment is "new",
                    // unless it is the first comeback phase after a dropped gap.
                    // Later phases are handled by payments.js and marked "re_enrolled".
                    const arEnrollStatus = await determineRejoinAwarePhaseStatus({
                      db: { query: dbQuery },
                      studentId: sid,
                      classId: class_id,
                      phaseNumber: enrollPhase,
                      defaultStatus: 'new',
                    });

                    if (removedEnrollment.rows.length > 0) {
                      await dbQuery(
                        `UPDATE classstudentstbl
                         SET program_enrollment_status = $1,
                             removed_at = NULL,
                             removed_reason = NULL,
                             removed_by = NULL,
                             enrolled_by = $2,
                             enrolled_at = CURRENT_TIMESTAMP
                         WHERE classstudent_id = $3`,
                        [arEnrollStatus, 'System (Auto-enrolled via acknowledgement receipt — Downpayment + Phase 1)', removedEnrollment.rows[0].classstudent_id]
                      );
                      console.log(`✅ AR Phase 1 re-activated enrollment: student ${sid} class ${class_id} phase ${enrollPhase} (status: ${arEnrollStatus})`);
                    } else {
                      await dbQuery(
                        `INSERT INTO classstudentstbl (student_id, class_id, enrolled_by, phase_number, program_enrollment_status)
                         VALUES ($1, $2, $3, $4, $5)`,
                        [sid, class_id, 'System (Auto-enrolled via acknowledgement receipt — Downpayment + Phase 1)', enrollPhase, arEnrollStatus]
                      );
                      console.log(`✅ AR Phase 1 auto-enrolled: student ${sid} in class ${class_id} phase ${enrollPhase} (status: ${arEnrollStatus})`);
                    }
                  } else {
                    // Keep metadata fresh when installment auto-payment confirms this phase is truly paid.
                    await dbQuery(
                      `UPDATE classstudentstbl
                       SET enrolled_by = $1
                       WHERE classstudent_id = $2`,
                      [
                        'System (Auto-enrolled via acknowledgement receipt — Downpayment + Phase 1)',
                        activeEnrollment.rows[0].classstudent_id,
                      ]
                    );
                  }
                }

                // Fetch the updated installmentinvoicestbl record for Phase 2 generation
                const nextInstallmentRecord = await dbQuery(
                  `SELECT * FROM installmentinvoicestbl WHERE installmentinvoiceprofiles_id = $1 AND (status IS NULL OR status = '' OR status = 'Pending')
                   ORDER BY installmentinvoicedtl_id DESC LIMIT 1`,
                  [profile_id]
                );

                if (nextInstallmentRecord.rows.length > 0) {
                  const nextRecord = nextInstallmentRecord.rows[0];
                  // Generate Phase 2 invoice
                  const phase2Invoice = await generateInvoiceFromInstallment(nextRecord, {
                    ...genProfile,
                    generated_count: generatedInvoice.generated_count || 1,
                  });
                  console.log(`✅ AR Phase 2 generated: invoice ${phase2Invoice.invoice_id} for profile ${profile_id}`);

                  // Pre-generated Phase 2 uses the *next* billing cycle's nominal issue (e.g. 25th of next month),
                  // so it disappears from the main Invoice list when users filter by the enrollment month.
                  // Align issue_date toward the AR / enrollment date while keeping due_date on the real schedule.
                  // Never set Phase 2 issue_date earlier than Phase 1's issue_date (billing phases must not go backwards).
                  const rawAckIssue = autoPayPhase1Data?.issue_date;
                  let arIssueYmd = null;
                  if (rawAckIssue != null && String(rawAckIssue).trim() !== '') {
                    const s = String(rawAckIssue).trim();
                    arIssueYmd = /^\d{4}-\d{2}-\d{2}$/.test(s)
                      ? s.slice(0, 10)
                      : formatYmdLocal(new Date(s));
                  }
                  let candidateIssueYmd = arIssueYmd;
                  if (phase1InvoiceId && /^\d{4}-\d{2}-\d{2}$/.test(String(candidateIssueYmd || ''))) {
                    const p1IssueRes = await dbQuery(
                      `SELECT TO_CHAR(issue_date, 'YYYY-MM-DD') AS d FROM invoicestbl WHERE invoice_id = $1`,
                      [phase1InvoiceId]
                    );
                    const phase1IssueYmd = (p1IssueRes.rows[0]?.d || '').slice(0, 10);
                    if (/^\d{4}-\d{2}-\d{2}$/.test(phase1IssueYmd)) {
                      candidateIssueYmd =
                        candidateIssueYmd >= phase1IssueYmd ? candidateIssueYmd : phase1IssueYmd;
                    }
                  }
                  if (candidateIssueYmd && phase2Invoice?.invoice_id) {
                    const dueRes = await dbQuery(
                      `SELECT TO_CHAR(due_date, 'YYYY-MM-DD') AS d FROM invoicestbl WHERE invoice_id = $1`,
                      [phase2Invoice.invoice_id]
                    );
                    const dueYmd = (dueRes.rows[0]?.d || '').slice(0, 10);
                    if (!dueYmd || candidateIssueYmd <= dueYmd) {
                      await dbQuery(
                        `UPDATE invoicestbl SET issue_date = $1::date WHERE invoice_id = $2`,
                        [candidateIssueYmd, phase2Invoice.invoice_id]
                      );
                      console.log(
                        `✅ AR Phase 2 issue_date set to ${candidateIssueYmd} (AR / Phase-1 floor) for invoice ${phase2Invoice.invoice_id}`
                      );
                    }
                  }
                } else {
                  console.log(`ℹ️ AR Phase 2 skipped: no pending installment record found (all phases generated)`);
                }
              } catch (phase1Error) {
                console.error(`⚠️ Error auto-paying Phase 1 (AR) for profile ${profileId}:`, phase1Error);
              }
            }
          } catch (invoiceGenError) {
            console.error(`⚠️ Error generating first installment invoice (AR) for profile ${profileId}:`, invoiceGenError);
          }
        })();
      }

      res.json({
        success: true,
        message: 'Acknowledgement receipt attached and payment recorded successfully',
        data: {
          acknowledgement_receipt: {
            ...omitAckReceiptNumber(ack),
            status: 'Applied',
            invoice_id,
            payment_id: newPayment.payment_id,
          },
          payment: newPayment,
        },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      next(err);
    } finally {
      client.release();
    }
  }
);

/**
 * PUT /api/sms/acknowledgement-receipts/:id
 * Update editable acknowledgement receipt details.
 * Access: Superadmin, Admin
 */
router.put(
  '/:id',
  [
    param('id').isInt().withMessage('ID must be an integer'),
    body('prospect_student_name').optional({ nullable: true }).isString().withMessage('Student name must be a string'),
    body('prospect_student_contact').optional({ nullable: true }).isString().withMessage('Guardian name must be a string'),
    body('prospect_student_email').optional({ nullable: true }).isEmail().withMessage('Email must be valid'),
    body('prospect_student_notes').optional({ nullable: true }).isString().withMessage('Notes must be a string'),
    body('level_tag').optional({ nullable: true }).isString().withMessage('Level tag must be a string'),
    body('reference_number').optional({ nullable: true }).isString().withMessage('Reference number must be a string'),
    body('payment_attachment_url')
      .optional({ nullable: true })
      .isString()
      .withMessage('Attachment URL must be a string')
      .custom((value) => value == null || String(value).trim().length > 0)
      .withMessage('Attachment image is required'),
    body('payment_method')
      .optional({ nullable: true })
      .isIn(ALLOWED_AR_PAYMENT_METHODS)
      .withMessage(`payment_method must be one of: ${ALLOWED_AR_PAYMENT_METHODS.join(', ')}`),
    body('issue_date').optional({ nullable: true }).isISO8601().withMessage('Issue date must be a valid date'),
    body('tip_amount').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('Tip amount must be >= 0'),
    body('package_id').optional({ nullable: true }).isInt().withMessage('Package ID must be an integer'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const ackResult = await query(
        `SELECT ack_receipt_id, branch_id, status, invoice_id, payment_id, ar_type, installment_option, payment_attachment_url, issue_date,
                prospect_student_notes
         FROM acknowledgement_receiptstbl
         WHERE ack_receipt_id = $1`,
        [id]
      );

      if (ackResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Acknowledgement receipt not found',
        });
      }

      const ack = ackResult.rows[0];
      if (req.user.userType !== 'Superadmin' && req.user.branchId && Number(ack.branch_id) !== Number(req.user.branchId)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied for this acknowledgement receipt',
        });
      }

      if (ack.status === 'Applied' || ack.invoice_id || ack.payment_id) {
        return res.status(400).json({
          success: false,
          message: 'Applied acknowledgement receipts cannot be edited',
        });
      }

      const raw = req.body || {};
      const notesText = String(ack.prospect_student_notes || '');
      const hadReturnedTag = notesText.includes('[Returned]');
      if (
        hadReturnedTag &&
        Object.prototype.hasOwnProperty.call(raw, 'prospect_student_notes')
      ) {
        const nextNotes = String(raw.prospect_student_notes ?? '');
        if (!nextNotes.includes('[Returned]')) {
          return res.status(400).json({
            success: false,
            message:
              'Notes must keep the Finance return marker ([Returned]). You may add text, but do not remove that history.',
          });
        }
      }

      const currentAttachment = ack.payment_attachment_url || null;
      const nextAttachment = Object.prototype.hasOwnProperty.call(raw, 'payment_attachment_url')
        ? (String(raw.payment_attachment_url || '').trim() || null)
        : currentAttachment;
      if (!nextAttachment) {
        return res.status(400).json({
          success: false,
          message: 'Attachment image is required',
        });
      }

      const updates = [];
      const params = [];
      const pushUpdate = (column, value) => {
        params.push(value);
        updates.push(`${column} = $${params.length}`);
      };

      if (Object.prototype.hasOwnProperty.call(raw, 'prospect_student_name')) {
        pushUpdate('prospect_student_name', String(raw.prospect_student_name || '').trim() || null);
      }
      if (Object.prototype.hasOwnProperty.call(raw, 'prospect_student_contact')) {
        pushUpdate('prospect_student_contact', String(raw.prospect_student_contact || '').trim() || null);
      }
      if (Object.prototype.hasOwnProperty.call(raw, 'prospect_student_email')) {
        pushUpdate('prospect_student_email', String(raw.prospect_student_email || '').trim() || null);
      }
      if (Object.prototype.hasOwnProperty.call(raw, 'prospect_student_notes')) {
        pushUpdate('prospect_student_notes', String(raw.prospect_student_notes || '').trim() || null);
      }
      if (Object.prototype.hasOwnProperty.call(raw, 'level_tag')) {
        pushUpdate('level_tag', String(raw.level_tag || '').trim() || null);
      }
      if (Object.prototype.hasOwnProperty.call(raw, 'reference_number')) {
        pushUpdate('reference_number', String(raw.reference_number || '').trim() || null);
      }
      if (Object.prototype.hasOwnProperty.call(raw, 'payment_attachment_url')) {
        pushUpdate('payment_attachment_url', String(raw.payment_attachment_url || '').trim() || null);
      }
      if (Object.prototype.hasOwnProperty.call(raw, 'payment_method')) {
        pushUpdate('payment_method', raw.payment_method || null);
      }
      // Preserve issue_date after Finance has returned this AR (sale / EOD attribution must stay fixed).
      // While status is Returned, or notes still contain the "[Returned]" tag (after resubmit to Submitted),
      // ignore client issue_date — edits + resubmit must not move the AR to another calendar day.
      const issueDateLocked = ack.status === 'Returned' || notesText.includes('[Returned]');
      if (Object.prototype.hasOwnProperty.call(raw, 'issue_date') && !issueDateLocked) {
        pushUpdate('issue_date', raw.issue_date || null);
      }
      if (Object.prototype.hasOwnProperty.call(raw, 'tip_amount')) {
        const tip = raw.tip_amount === '' || raw.tip_amount == null ? 0 : parseFloat(raw.tip_amount);
        pushUpdate('tip_amount', Number.isFinite(tip) && tip >= 0 ? tip : 0);
      }
      if (Object.prototype.hasOwnProperty.call(raw, 'package_id')) {
        const nextPackageId = raw.package_id == null || raw.package_id === '' ? null : parseInt(raw.package_id, 10);
        if (!Number.isInteger(nextPackageId) || nextPackageId <= 0) {
          return res.status(400).json({
            success: false,
            message: 'A valid package is required',
          });
        }
        if (ack.ar_type !== 'Package') {
          return res.status(400).json({
            success: false,
            message: 'Package can only be changed for Package acknowledgement receipts',
          });
        }
        const pkgResult = await query(
          `SELECT package_id, package_name, package_price, branch_id, package_type, downpayment_amount, payment_option
           FROM packagestbl
           WHERE package_id = $1`,
          [nextPackageId]
        );
        if (pkgResult.rows.length === 0) {
          return res.status(404).json({
            success: false,
            message: 'Selected package not found',
          });
        }
        const pkg = pkgResult.rows[0];
        if (pkg.branch_id != null && Number(pkg.branch_id) !== Number(ack.branch_id)) {
          return res.status(400).json({
            success: false,
            message: 'Selected package does not belong to this acknowledgement receipt branch',
          });
        }
        const packagePrice = parseFloat(pkg.package_price ?? 0) || 0;
        const downpayment = parseFloat(pkg.downpayment_amount ?? 0) || 0;
        const packageType = String(pkg.package_type || '').toLowerCase();
        const paymentOption = String(pkg.payment_option || '').toLowerCase();
        const isInstallmentLike = packageType === 'installment' || (packageType === 'phase' && paymentOption === 'installment');
        const computedPayable =
          isInstallmentLike && String(ack.installment_option || '').toLowerCase() === 'downpayment_only' && downpayment > 0
            ? downpayment
            : packagePrice;

        pushUpdate('package_id', pkg.package_id);
        pushUpdate('package_name_snapshot', pkg.package_name || null);
        pushUpdate('package_amount_snapshot', packagePrice);
        // Payable is always system-derived from package selection for consistency with create flow.
        pushUpdate('payment_amount', computedPayable);
      }

      if (updates.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No valid fields were provided to update',
        });
      }

      params.push(id);
      const updateRes = await query(
        `UPDATE acknowledgement_receiptstbl
         SET ${updates.join(', ')}
         WHERE ack_receipt_id = $${params.length}
         RETURNING *`,
        params
      );

      return res.json({
        success: true,
        message: 'Acknowledgement receipt updated successfully',
        data: omitAckReceiptNumber(updateRes.rows[0]),
      });
    } catch (err) {
      return next(err);
    }
  }
);

/**
 * DELETE /api/sms/acknowledgement-receipts/:id
 * Delete acknowledgement receipt if not yet applied.
 * Access: Superadmin, Admin
 */
router.delete(
  '/:id',
  [param('id').isInt().withMessage('ID must be an integer'), handleValidationErrors],
  requireRole('Superadmin', 'Admin'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const ackResult = await query(
        `SELECT ack_receipt_id, branch_id, status, invoice_id, payment_id
         FROM acknowledgement_receiptstbl
         WHERE ack_receipt_id = $1`,
        [id]
      );

      if (ackResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Acknowledgement receipt not found',
        });
      }

      const ack = ackResult.rows[0];
      if (req.user.userType !== 'Superadmin' && req.user.branchId && Number(ack.branch_id) !== Number(req.user.branchId)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied for this acknowledgement receipt',
        });
      }

      if (ack.status === 'Applied' || ack.invoice_id || ack.payment_id) {
        return res.status(400).json({
          success: false,
          message: 'Applied acknowledgement receipts cannot be deleted',
        });
      }

      await query('DELETE FROM acknowledgement_receiptstbl WHERE ack_receipt_id = $1', [id]);
      return res.json({
        success: true,
        message: 'Acknowledgement receipt deleted successfully',
      });
    } catch (err) {
      return next(err);
    }
  }
);

/**
 * PUT /api/sms/acknowledgement-receipts/:id/verify
 * Verify or return a package acknowledgement receipt.
 * Access: Finance, Superfinance
 */
router.put(
  '/:id/verify',
  [
    param('id').isInt().withMessage('ID must be an integer'),
    body('approve').optional({ nullable: true }).isBoolean().withMessage('approve must be boolean'),
    body('action')
      .optional({ nullable: true })
      .isIn(['verify', 'return', 'reject'])
      .withMessage("action must be 'verify', 'return' or 'reject'"),
    body('remarks').optional({ nullable: true }).isString().withMessage('remarks must be a string'),
    handleValidationErrors,
  ],
  requireRole('Finance', 'Superfinance'),
  async (req, res, next) => {
    try {
      const { id } = req.params;

      // Resolve the action: prefer explicit `action`, fall back to legacy `approve`.
      let action = (req.body?.action || '').toString().toLowerCase();
      if (!action) {
        if (req.body?.approve === true) action = 'verify';
        else if (req.body?.approve === false) action = 'return';
      }
      if (!['verify', 'return', 'reject'].includes(action)) {
        return res.status(400).json({
          success: false,
          message: "action must be 'verify', 'return' or 'reject'",
        });
      }

      const remarks = String(req.body?.remarks || '').trim() || null;

      const ackResult = await query(
        `SELECT ack_receipt_id, branch_id, ar_type, status, prospect_student_notes, created_by, prospect_student_name
         FROM acknowledgement_receiptstbl
         WHERE ack_receipt_id = $1`,
        [id]
      );

      if (ackResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Acknowledgement receipt not found',
        });
      }

      const ack = ackResult.rows[0];

      if (ack.ar_type !== 'Package') {
        return res.status(400).json({
          success: false,
          message: 'Only Package acknowledgement receipts can be verified/returned/rejected in this flow',
        });
      }

      if (req.user.userType === 'Finance' && req.user.branchId && Number(ack.branch_id) !== Number(req.user.branchId)) {
        return res.status(403).json({
          success: false,
          message: 'You can only act on acknowledgement receipts from your assigned branch',
        });
      }

      if (ack.status === 'Applied') {
        return res.status(400).json({
          success: false,
          message: 'This acknowledgement receipt is already applied to an invoice',
        });
      }

      if (ack.status === 'Cancelled') {
        return res.status(400).json({
          success: false,
          message: 'Cancelled acknowledgement receipts cannot be acted on',
        });
      }

      if (ack.status === 'Rejected') {
        return res.status(400).json({
          success: false,
          message: 'This acknowledgement receipt is already rejected. Please ask the branch admin to create a new one.',
        });
      }

      if (action === 'return' && ack.status === 'Returned') {
        return res.status(400).json({
          success: false,
          message: 'This acknowledgement receipt is already returned',
        });
      }
      if ((action === 'return' || action === 'reject') && !remarks) {
        return res.status(400).json({
          success: false,
          message: action === 'return' ? 'Return note is required' : 'Rejection reason is required',
        });
      }

      const nextStatus =
        action === 'verify' ? 'Verified' : action === 'reject' ? 'Rejected' : 'Returned';
      const updatedNotes = remarks
        ? `${ack.prospect_student_notes ? `${ack.prospect_student_notes}\n` : ''}[${nextStatus}] ${remarks}`
        : ack.prospect_student_notes;

      const verifierUserId = req.user.userId || req.user.user_id || null;
      // Track verifier_by/verified_at only on actual verification.
      const verifiedByOnUpdate = action === 'verify' ? verifierUserId : null;
      const verifiedAtOnUpdate = action === 'verify' ? new Date() : null;

      const hasVerifierCols = await ackReceiptHasVerifierColumns();
      const updateRes = hasVerifierCols
        ? await query(
            `UPDATE acknowledgement_receiptstbl
             SET status = $1,
                 prospect_student_notes = $2,
                 verified_by_user_id = $3,
                 verified_at = $4
             WHERE ack_receipt_id = $5
             RETURNING *`,
            [nextStatus, updatedNotes, verifiedByOnUpdate, verifiedAtOnUpdate, id]
          )
        : await query(
            `UPDATE acknowledgement_receiptstbl
             SET status = $1,
                 prospect_student_notes = $2
             WHERE ack_receipt_id = $3
             RETURNING *`,
            [nextStatus, updatedNotes, id]
          );

      if (action === 'return') {
        const returnedByUserId = req.user.userId || req.user.user_id || null;
        await notifyArReturnedToCreator({
          ackReceiptId: ack.ack_receipt_id,
          branchId: ack.branch_id,
          returnedByUserId,
          creatorUserId: ack.created_by,
          studentName: ack.prospect_student_name,
          reason: remarks,
        });
      } else if (action === 'reject') {
        const rejectedByUserId = req.user.userId || req.user.user_id || null;
        await notifyArRejectedToCreator({
          ackReceiptId: ack.ack_receipt_id,
          branchId: ack.branch_id,
          rejectedByUserId,
          creatorUserId: ack.created_by,
          studentName: ack.prospect_student_name,
          reason: remarks,
        });
      }

      const successMessage =
        action === 'verify'
          ? 'Acknowledgement receipt verified successfully'
          : action === 'reject'
            ? 'Acknowledgement receipt rejected. The branch admin must create a new acknowledgement receipt.'
            : 'Acknowledgement receipt returned successfully';

      return res.json({
        success: true,
        message: successMessage,
        data: omitAckReceiptNumber(updateRes.rows[0]),
      });
    } catch (err) {
      return next(err);
    }
  }
);

/**
 * PUT /api/sms/acknowledgement-receipts/:id/resubmit
 * Resubmit a returned package acknowledgement receipt.
 * Access: Superadmin, Admin, Finance, Superfinance
 */
router.put(
  '/:id/resubmit',
  [
    param('id').isInt().withMessage('ID must be an integer'),
    body('remarks').optional({ nullable: true }).isString().withMessage('remarks must be a string'),
    handleValidationErrors,
  ],
  requireRole('Superadmin', 'Admin', 'Finance', 'Superfinance'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const remarks = String(req.body?.remarks || '').trim() || null;
      const ackResult = await query(
        `SELECT ack_receipt_id, branch_id, ar_type, status, prospect_student_notes, created_by
         FROM acknowledgement_receiptstbl
         WHERE ack_receipt_id = $1`,
        [id]
      );
      if (ackResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Acknowledgement receipt not found',
        });
      }

      const ack = ackResult.rows[0];
      if (ack.ar_type !== 'Package') {
        return res.status(400).json({
          success: false,
          message: 'Only Package acknowledgement receipts can be resubmitted in this flow',
        });
      }
      if (ack.status !== 'Returned') {
        return res.status(400).json({
          success: false,
          message: 'Only returned acknowledgement receipts can be resubmitted',
        });
      }

      const actorId = req.user.userId || req.user.user_id || null;
      const isSuperadmin = req.user.userType === 'Superadmin';
      if (!isSuperadmin && Number(actorId) !== Number(ack.created_by)) {
        return res.status(403).json({
          success: false,
          message: 'Only the acknowledgement receipt creator can resubmit this acknowledgement receipt',
        });
      }
      if (req.user.userType === 'Admin' && req.user.branchId && Number(ack.branch_id) !== Number(req.user.branchId)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied for this acknowledgement receipt',
        });
      }

      const updatedNotes = remarks
        ? `${ack.prospect_student_notes ? `${ack.prospect_student_notes}\n` : ''}[Resubmitted] ${remarks}`
        : ack.prospect_student_notes;

      const hasVerifierCols = await ackReceiptHasVerifierColumns();
      const updateRes = hasVerifierCols
        ? await query(
            `UPDATE acknowledgement_receiptstbl
             SET status = 'Submitted',
                 prospect_student_notes = $1,
                 verified_by_user_id = NULL,
                 verified_at = NULL
             WHERE ack_receipt_id = $2
             RETURNING *`,
            [updatedNotes, id]
          )
        : await query(
            `UPDATE acknowledgement_receiptstbl
             SET status = 'Submitted',
                 prospect_student_notes = $1
             WHERE ack_receipt_id = $2
             RETURNING *`,
            [updatedNotes, id]
          );

      return res.json({
        success: true,
        message: 'Acknowledgement receipt resubmitted successfully',
        data: omitAckReceiptNumber(updateRes.rows[0]),
      });
    } catch (err) {
      return next(err);
    }
  }
);

export default router;

