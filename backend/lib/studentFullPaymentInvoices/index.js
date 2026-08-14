/**
 * Staff Student History — full payment settlements (not installment phase invoices).
 *
 * @module lib/studentFullPaymentInvoices
 */

import { getChainFinancialSummary } from '../../utils/balanceInvoice.js';
import { parseFullPaymentChangeRemarks } from '../packageChangeConversion.js';
import {
  merchandiseReleaseLogTableExists,
  parseMerchPendingFromRemarks,
} from '../merchandiseReleaseLog.js';
import { resolveInvoicePaymentDueStatusLabel } from '../../utils/programPaymentStatusService.js';

const ENROLLMENT_STATUS_LABELS = {
  reserved: 'Reserved',
  pending_enrollment: 'Pending enrollment',
  new: 'New',
  re_enrolled: 'Re-enroll',
  upsell: 'Upsell',
  rejoin: 'Rejoin',
  dropped: 'Not enrolled',
  completed: 'Completed',
};

const formatEnrollmentStatusLabel = (status) => {
  const key = String(status || '').trim().toLowerCase();
  return ENROLLMENT_STATUS_LABELS[key] || (status ? String(status) : null);
};

const pickInt = (text, key) => {
  const match = String(text || '').match(new RegExp(`${key}:(\\d+)`, 'i'));
  return match ? parseInt(match[1], 10) : null;
};

export const parseInvoiceClassId = (remarks) => pickInt(remarks, 'CLASS_ID');
export const parseInvoicePhaseStart = (remarks) => pickInt(remarks, 'PHASE_START');
export const parseInvoicePhaseEnd = (remarks) => pickInt(remarks, 'PHASE_END');

/**
 * SQL predicate (alias `i`, optional `pkg`) for full-payment package / conversion invoices.
 */
export const STUDENT_FULL_PAYMENT_INVOICE_SQL = `
  i.installmentinvoiceprofiles_id IS NULL
  AND COALESCE(i.status, '') NOT IN ('Cancelled', 'Canceled')
  AND COALESCE(i.invoice_description, '') NOT ILIKE '%reservation%fee%'
  AND COALESCE(i.invoice_description, '') NOT ILIKE '%downpayment%'
  AND COALESCE(i.remarks, '') NOT ILIKE '%TARGET_PHASE:%'
  AND COALESCE(i.remarks, '') NOT ILIKE '%Auto-generated from installment%'
  AND COALESCE(i.remarks, '') NOT ILIKE '%Manually generated from installment%'
  AND (
    i.remarks ILIKE '%PACKAGE_CHANGE_TO_FULLPAYMENT%'
    OR i.invoice_description ILIKE '%fullpayment%'
    OR i.invoice_description ILIKE '%full payment%'
    OR LOWER(TRIM(COALESCE(pkg.package_type, ''))) = 'fullpayment'
    OR LOWER(TRIM(COALESCE(pkg.payment_option, ''))) = 'fullpayment'
    OR (
      i.remarks ILIKE '%CLASS_ID:%'
      AND i.remarks ~* 'PHASE_START:\\d+'
      AND i.remarks ~* 'PHASE_END:\\d+'
    )
  )
`;

/**
 * JS mirror of STUDENT_FULL_PAYMENT_INVOICE_SQL for unit tests.
 * @param {{
 *   remarks?: string|null,
 *   invoice_description?: string|null,
 *   package_type?: string|null,
 *   payment_option?: string|null,
 *   installmentinvoiceprofiles_id?: number|null,
 *   status?: string|null,
 * }} row
 */
export function isStudentFullPaymentInvoiceCandidate(row = {}) {
  const remarks = String(row.remarks || '');
  const description = String(row.invoice_description || '');
  const status = String(row.status || '');
  const packageType = String(row.package_type || '').trim().toLowerCase();
  const paymentOption = String(row.payment_option || '').trim().toLowerCase();

  if (row.installmentinvoiceprofiles_id != null) return false;
  if (/^cancell?ed$/i.test(status)) return false;
  if (/reservation.*fee/i.test(description)) return false;
  if (/downpayment/i.test(description)) return false;
  if (/TARGET_PHASE:/i.test(remarks)) return false;
  if (/Auto-generated from installment/i.test(remarks)) return false;
  if (/Manually generated from installment/i.test(remarks)) return false;

  if (/PACKAGE_CHANGE_TO_FULLPAYMENT/i.test(remarks)) return true;
  if (/fullpayment|full payment/i.test(description)) return true;
  if (packageType === 'fullpayment' || paymentOption === 'fullpayment') return true;
  if (/CLASS_ID:\d+/i.test(remarks) && /PHASE_START:\d+/i.test(remarks) && /PHASE_END:\d+/i.test(remarks)) {
    return true;
  }
  return false;
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const runQuery = (db, text, params) =>
  typeof db === 'function' ? db(text, params) : db.query(text, params);

const asClient = (db) => (typeof db === 'function' ? { query: db } : db);

/**
 * @param {import('pg').Pool | import('pg').PoolClient | Function} db
 * @param {number} studentId
 * @returns {Promise<object[]>}
 */
export async function loadStudentFullPaymentSettlements(db, studentId) {
  const sid = Number(studentId);
  if (!sid) return [];

  const client = asClient(db);

  const invoicesRes = await runQuery(
    db,
    `SELECT i.invoice_id, i.status, i.amount, i.invoice_ar_number,
            i.invoice_description, i.remarks, i.package_id, i.branch_id,
            TO_CHAR(i.issue_date, 'YYYY-MM-DD') AS issue_date,
            TO_CHAR(i.due_date, 'YYYY-MM-DD') AS due_date,
            pkg.package_name, pkg.package_type, pkg.payment_option,
            b.branch_name
     FROM invoicestbl i
     INNER JOIN invoicestudentstbl ist
       ON ist.invoice_id = i.invoice_id AND ist.student_id = $1
     LEFT JOIN packagestbl pkg ON pkg.package_id = i.package_id
     LEFT JOIN branchestbl b ON b.branch_id = i.branch_id
     WHERE ${STUDENT_FULL_PAYMENT_INVOICE_SQL}
     ORDER BY i.invoice_id DESC`,
    [sid]
  );

  const invoices = invoicesRes.rows || [];
  if (!invoices.length) return [];

  const invoiceIds = invoices.map((r) => Number(r.invoice_id));
  const classIds = [
    ...new Set(
      invoices
        .map((r) => parseInvoiceClassId(r.remarks) || parseFullPaymentChangeRemarks(r.remarks)?.classId)
        .filter((id) => Number.isFinite(id) && id > 0)
    ),
  ];
  const conversionPackageIds = [
    ...new Set(
      invoices
        .flatMap((r) => {
          const parsed = parseFullPaymentChangeRemarks(r.remarks);
          return parsed ? [parsed.fromPackageId, parsed.toPackageId] : [];
        })
        .filter((id) => Number.isFinite(id) && id > 0)
    ),
  ];

  const itemsRes = await runQuery(
    db,
    `SELECT invoice_item_id, invoice_id, description, amount,
            COALESCE(discount_amount, 0) AS discount_amount,
            COALESCE(penalty_amount, 0) AS penalty_amount
     FROM invoiceitemstbl
     WHERE invoice_id = ANY($1::int[])
     ORDER BY invoice_item_id`,
    [invoiceIds]
  );

  const paymentsRes = await runQuery(
    db,
    `SELECT payment_id, invoice_id, payment_type, payment_method, payable_amount,
            COALESCE(discount_amount, 0) AS discount_amount,
            status, approval_status, reference_number,
            TO_CHAR(issue_date, 'YYYY-MM-DD') AS paid_on,
            TO_CHAR(TIMEZONE('Asia/Manila', created_at), 'YYYY-MM-DD HH24:MI') AS created
     FROM paymenttbl
     WHERE invoice_id = ANY($1::int[])
       AND status = 'Completed'
       AND COALESCE(approval_status, 'Pending') <> 'Rejected'
     ORDER BY payment_id`,
    [invoiceIds]
  );

  let classById = new Map();
  if (classIds.length) {
    const classRes = await runQuery(
      db,
      `SELECT c.class_id, c.class_name, c.level_tag, c.branch_id,
              p.program_name, b.branch_name
       FROM classestbl c
       LEFT JOIN programstbl p ON p.program_id = c.program_id
       LEFT JOIN branchestbl b ON b.branch_id = c.branch_id
       WHERE c.class_id = ANY($1::int[])`,
      [classIds]
    );
    classById = new Map((classRes.rows || []).map((r) => [Number(r.class_id), r]));
  }

  let packageNameById = new Map();
  if (conversionPackageIds.length) {
    const pkgRes = await runQuery(
      db,
      `SELECT package_id, package_name FROM packagestbl WHERE package_id = ANY($1::int[])`,
      [conversionPackageIds]
    );
    packageNameById = new Map(
      (pkgRes.rows || []).map((r) => [Number(r.package_id), r.package_name || null])
    );
  }

  let enrollmentsByClass = new Map();
  if (classIds.length) {
    const enrRes = await runQuery(
      db,
      `SELECT class_id, phase_number, program_enrollment_status AS status,
              TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD') AS enrolled
       FROM classstudentstbl
       WHERE student_id = $1
         AND class_id = ANY($2::int[])
         AND removed_at IS NULL
         AND COALESCE(enrolled_by, '') NOT ILIKE '%Rejoin gap marker%'
       ORDER BY class_id, phase_number, classstudent_id`,
      [sid, classIds]
    );
    for (const row of enrRes.rows || []) {
      const cid = Number(row.class_id);
      if (!enrollmentsByClass.has(cid)) enrollmentsByClass.set(cid, []);
      enrollmentsByClass.get(cid).push({
        phase_number: row.phase_number != null ? Number(row.phase_number) : null,
        status: row.status || null,
        status_label: formatEnrollmentStatusLabel(row.status),
        enrolled: row.enrolled || null,
      });
    }
  }

  let merchByClass = new Map();
  try {
    if (classIds.length && (await merchandiseReleaseLogTableExists(db))) {
      const merchRes = await runQuery(
        db,
        `SELECT class_id, package_id, merchandise_name, size, category, quantity,
                TO_CHAR(TIMEZONE('Asia/Manila', released_at), 'YYYY-MM-DD') AS released
         FROM merchandise_release_logtbl
         WHERE student_id = $1
           AND class_id = ANY($2::int[])
         ORDER BY released_at`,
        [sid, classIds]
      );
      for (const row of merchRes.rows || []) {
        const cid = Number(row.class_id);
        if (!merchByClass.has(cid)) merchByClass.set(cid, []);
        merchByClass.get(cid).push({
          merchandise_name: row.merchandise_name || null,
          size: row.size || null,
          category: row.category || null,
          quantity: row.quantity != null ? Number(row.quantity) : 1,
          released: row.released || null,
          status: 'Released',
        });
      }
    }
  } catch {
    /* table may be missing */
  }

  const itemsByInvoice = new Map();
  for (const row of itemsRes.rows || []) {
    const id = Number(row.invoice_id);
    if (!itemsByInvoice.has(id)) itemsByInvoice.set(id, []);
    const amount = round2(row.amount);
    const discount = round2(row.discount_amount);
    itemsByInvoice.get(id).push({
      invoice_item_id: Number(row.invoice_item_id),
      description: row.description || '—',
      amount,
      discount_amount: discount,
      penalty_amount: round2(row.penalty_amount),
      net_amount: round2(amount - discount + Number(row.penalty_amount || 0)),
    });
  }

  const paymentsByInvoice = new Map();
  for (const row of paymentsRes.rows || []) {
    const id = Number(row.invoice_id);
    if (!paymentsByInvoice.has(id)) paymentsByInvoice.set(id, []);
    paymentsByInvoice.get(id).push({
      payment_id: Number(row.payment_id),
      payment_type: row.payment_type || null,
      payment_method: row.payment_method || null,
      payable_amount: round2(row.payable_amount),
      discount_amount: round2(row.discount_amount),
      paid_on: row.paid_on || null,
      reference_number: row.reference_number || null,
    });
  }

  const settlements = [];
  for (const inv of invoices) {
    const invoiceId = Number(inv.invoice_id);
    const conversion = parseFullPaymentChangeRemarks(inv.remarks);
    const classId = conversion?.classId || parseInvoiceClassId(inv.remarks);
    const phaseStart = conversion?.phaseStart || parseInvoicePhaseStart(inv.remarks);
    const phaseEnd = conversion?.phaseEnd || parseInvoicePhaseEnd(inv.remarks);
    const klass = classId ? classById.get(Number(classId)) : null;

    let chain = { total_paid_in_chain: 0, remaining_on_leaf: Number(inv.amount) || 0 };
    try {
      chain = await getChainFinancialSummary(client, invoiceId);
    } catch {
      /* keep invoice amount */
    }

    const paidAmount = round2(chain.total_paid_in_chain);
    const remaining = round2(chain.remaining_on_leaf);
    const billed = round2(
      paidAmount + remaining > 0 ? paidAmount + remaining : Number(inv.amount) || 0
    );

    let displayStatus = inv.status || 'Unpaid';
    if (remaining <= 0.009 && (paidAmount >= 0.009 || conversion)) displayStatus = 'Paid';
    else if (paidAmount > 0.009 && remaining > 0.009) displayStatus = 'Partially Paid';

    let paymentDueStatusLabel = null;
    try {
      paymentDueStatusLabel = await resolveInvoicePaymentDueStatusLabel(client, {
        ...inv,
        due_date: inv.due_date,
        issue_date: inv.issue_date,
        installmentinvoiceprofiles_id: null,
      });
    } catch {
      paymentDueStatusLabel = null;
    }

    const payments = paymentsByInvoice.get(invoiceId) || [];
    const latestPayment = payments[payments.length - 1] || null;
    const pendingMerch = parseMerchPendingFromRemarks(inv.remarks).map((line) => ({
      merchandise_name: line.merchandise_name || null,
      size: line.size || null,
      category: line.category || null,
      quantity: line.quantity != null ? Number(line.quantity) : 1,
      released: null,
      status: 'Pending',
    }));
    const releasedMerch = classId ? merchByClass.get(Number(classId)) || [] : [];
    const merchandise = releasedMerch.length ? releasedMerch : pendingMerch;

    const enrollments = classId ? enrollmentsByClass.get(Number(classId)) || [] : [];
    const enrolledDates = enrollments.map((e) => e.enrolled).filter(Boolean).sort();

    settlements.push({
      invoice_id: invoiceId,
      invoice_description: inv.invoice_description || null,
      invoice_ar_number: inv.invoice_ar_number || null,
      status: displayStatus,
      invoice_status: inv.status || null,
      payment_due_status_label: paymentDueStatusLabel,
      issue_date: inv.issue_date || null,
      due_date: inv.due_date || null,
      paid_on: latestPayment?.paid_on || null,
      amount: billed,
      paid_amount: paidAmount,
      remaining_balance: remaining,
      package_id: inv.package_id != null ? Number(inv.package_id) : null,
      package_name: inv.package_name || inv.invoice_description || null,
      package_type: inv.package_type || null,
      payment_option: inv.payment_option || null,
      is_conversion: Boolean(conversion),
      conversion: conversion
        ? {
            from_package_id: conversion.fromPackageId,
            from_package_name: conversion.fromPackageId
              ? packageNameById.get(Number(conversion.fromPackageId)) || null
              : null,
            to_package_id: conversion.toPackageId,
            to_package_name: conversion.toPackageId
              ? packageNameById.get(Number(conversion.toPackageId)) || null
              : null,
            credit_applied: conversion.creditApplied,
            target_full_price: conversion.targetFullPrice,
            profile_id: conversion.profileId,
          }
        : null,
      class_id: classId || null,
      class_name: klass?.class_name || null,
      program_name: klass?.program_name || null,
      level_tag: klass?.level_tag || null,
      branch_id:
        inv.branch_id != null
          ? Number(inv.branch_id)
          : klass?.branch_id != null
            ? Number(klass.branch_id)
            : null,
      branch_name: klass?.branch_name || inv.branch_name || null,
      phase_start: phaseStart,
      phase_end: phaseEnd,
      enrollment: {
        phases: enrollments,
        enrolled_count: enrollments.length,
        first_enrolled: enrolledDates[0] || null,
      },
      items: itemsByInvoice.get(invoiceId) || [],
      payments,
      merchandise,
      payment_type: latestPayment?.payment_type || 'Full Payment',
      payment_method: latestPayment?.payment_method || null,
    });
  }

  return settlements;
}
