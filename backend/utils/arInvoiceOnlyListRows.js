/**
 * Invoices may carry invoice_ar_number (YY####) without a matching
 * acknowledgement_receiptstbl row — e.g. installment phase paid on Invoice page.
 * These helpers surface them in the AR list when searching or cross-linking by invoice_id.
 */

import { query } from '../config/database.js';

const INVOICE_ONLY_NOT_LINKED_SQL = `
  NOT EXISTS (
    SELECT 1 FROM acknowledgement_receiptstbl ar
    WHERE ar.invoice_id = i.invoice_id
       OR (i.ack_receipt_id IS NOT NULL AND ar.ack_receipt_id = i.ack_receipt_id)
       OR EXISTS (
         SELECT 1 FROM paymenttbl pay
         WHERE pay.invoice_id = i.invoice_id AND pay.payment_id = ar.payment_id
       )
       OR (
         TRIM(COALESCE(ar.ack_receipt_number, '')) <> ''
         AND TRIM(ar.ack_receipt_number) = TRIM(i.invoice_ar_number)
       )
       OR (
         i.ack_receipt_id IS NOT NULL
         AND ar.paired_ack_receipt_id IS NOT NULL
         AND ar.paired_ack_receipt_id = i.ack_receipt_id
       )
  )
`;

function buildInvoiceOnlyWhere({
  search,
  invoiceId,
  branchId,
  paymentFrom,
  paymentTo,
  issueFrom,
  issueTo,
  createdFrom,
  createdTo,
  paymentMethod,
  statusFilter,
}) {
  const params = [];
  let n = 0;
  let sql = `
    WHERE i.invoice_ar_number IS NOT NULL
      AND TRIM(i.invoice_ar_number) <> ''
      AND ${INVOICE_ONLY_NOT_LINKED_SQL}
  `;

  if (invoiceId) {
    n += 1;
    sql += ` AND i.invoice_id = $${n}`;
    params.push(Number(invoiceId));
  }

  const trimmedSearch = String(search || '').trim();
  if (trimmedSearch) {
    n += 1;
    const like = `%${trimmedSearch}%`;
    sql += ` AND (
      i.invoice_ar_number ILIKE $${n}
      OR i.invoice_id::text ILIKE $${n}
      OR EXISTS (
        SELECT 1 FROM invoicestudentstbl inv_s
        INNER JOIN userstbl u ON u.user_id = inv_s.student_id
        WHERE inv_s.invoice_id = i.invoice_id AND u.full_name ILIKE $${n}
      )
    )`;
    params.push(like);
  }

  if (branchId) {
    n += 1;
    sql += ` AND i.branch_id = $${n}`;
    params.push(branchId);
  }

  if (paymentMethod) {
    n += 1;
    sql += ` AND EXISTS (
      SELECT 1 FROM paymenttbl p_m
      WHERE p_m.invoice_id = i.invoice_id AND p_m.payment_method = $${n}
    )`;
    params.push(paymentMethod);
  }

  if (paymentFrom) {
    n += 1;
    sql += ` AND i.issue_date >= $${n}::date`;
    params.push(paymentFrom);
  }
  if (paymentTo) {
    n += 1;
    sql += ` AND i.issue_date <= $${n}::date`;
    params.push(paymentTo);
  }
  if (issueFrom) {
    n += 1;
    sql += ` AND i.issue_date >= $${n}::date`;
    params.push(issueFrom);
  }
  if (issueTo) {
    n += 1;
    sql += ` AND i.issue_date <= $${n}::date`;
    params.push(issueTo);
  }
  if (createdFrom) {
    n += 1;
    sql += ` AND i.created_at::date >= $${n}::date`;
    params.push(createdFrom);
  }
  if (createdTo) {
    n += 1;
    sql += ` AND i.created_at::date <= $${n}::date`;
    params.push(createdTo);
  }

  if (statusFilter && statusFilter.length > 0) {
    const normalized = statusFilter.map((s) => String(s).trim()).filter(Boolean);
    if (normalized.length > 0 && !normalized.includes('Paid')) {
      sql += ` AND 1=0`;
    } else if (normalized.length > 0) {
      n += 1;
      sql += ` AND i.status = ANY($${n}::text[])`;
      params.push(normalized);
    }
  }

  return { sql, params };
}

const INVOICE_ONLY_SELECT_SQL = `
  SELECT
    NULL::integer AS ack_receipt_id,
    TRUE AS invoice_only_payment,
    i.invoice_id AS linked_invoice_id,
    i.invoice_ar_number,
    i.branch_id,
    i.status,
    i.issue_date,
    i.amount,
    COALESCE(b.branch_nickname, b.branch_name) AS branch_name,
    u.full_name AS student_name,
    u.full_name AS prospect_student_name,
    u.phone_number AS prospect_student_phone,
    p.payment_method,
    p.reference_number,
    COALESCE(p.payable_amount, i.amount, 0) AS payment_amount,
    0::numeric AS tip_amount,
    p.issue_date AS payment_date,
    'Package' AS ar_type,
    'Invoice payment (no AR record)' AS package_name_snapshot,
    COALESCE(p.payable_amount, i.amount, 0) AS list_line_total_amount
  FROM invoicestbl i
  LEFT JOIN branchestbl b ON i.branch_id = b.branch_id
  LEFT JOIN LATERAL (
    SELECT inv_s.student_id
    FROM invoicestudentstbl inv_s
    WHERE inv_s.invoice_id = i.invoice_id
    ORDER BY inv_s.student_id
    LIMIT 1
  ) inv_one ON TRUE
  LEFT JOIN userstbl u ON u.user_id = inv_one.student_id
  LEFT JOIN LATERAL (
    SELECT payment_method, reference_number, payable_amount, issue_date
    FROM paymenttbl
    WHERE invoice_id = i.invoice_id
      AND UPPER(TRIM(COALESCE(status, ''))) = 'COMPLETED'
    ORDER BY payment_id DESC
    LIMIT 1
  ) p ON TRUE
`;

/**
 * @param {object} filters - same branch/search/date/status as AR list GET
 * @returns {Promise<object[]>}
 */
export async function fetchInvoiceOnlyArListRows(filters = {}) {
  const trimmedSearch = String(filters.search || '').trim();
  const invoiceId = filters.invoiceId;
  if (!trimmedSearch && !invoiceId) return [];

  const { sql: whereSql, params } = buildInvoiceOnlyWhere({
    search: trimmedSearch,
    invoiceId,
    branchId: filters.branchId,
    paymentFrom: filters.paymentFrom,
    paymentTo: filters.paymentTo,
    issueFrom: filters.issueFrom,
    issueTo: filters.issueTo,
    createdFrom: filters.createdFrom,
    createdTo: filters.createdTo,
    paymentMethod: filters.paymentMethod,
    statusFilter: filters.statusFilter,
  });

  const result = await query(`${INVOICE_ONLY_SELECT_SQL} ${whereSql} ORDER BY i.invoice_id DESC`, params);
  return result.rows;
}

export async function countInvoiceOnlyArListRows(filters = {}) {
  const rows = await fetchInvoiceOnlyArListRows(filters);
  const totalLine = rows.reduce(
    (sum, row) => sum + (parseFloat(row.list_line_total_amount ?? row.payment_amount ?? 0) || 0),
    0
  );
  return { count: rows.length, totalLineAmount: totalLine };
}
