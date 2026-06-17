/**
 * Financial dashboard payment / AR verification counts aligned with drill-down grids:
 * - Payment Logs main tab (GET /payments/finance-unified)
 * - Acknowledgement Receipts list (GET /acknowledgement-receipts)
 */

import { paymentLogApprovalFromArVerification } from './paymentLogArApproval.js';

/** Inclusive calendar range for YYYY-MM (matches Payment Logs month mode / issueDateRangeFromManilaMonth). */
export function parseManilaMonthInclusiveRange(monthKey) {
  const key = String(monthKey || '').trim();
  if (!/^\d{4}-\d{2}$/.test(key)) return null;
  const [yearStr, monthStr] = key.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }
  const from = `${key}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${key}-${String(lastDay).padStart(2, '0')}`;
  return { from, to };
}

const buildBranchDateSql = (branchId, dateFrom, dateTo, tableAlias, params) => {
  let sql = '';
  if (branchId != null) {
    params.push(branchId);
    sql += ` AND ${tableAlias}.branch_id = $${params.length}`;
  }
  if (dateFrom) {
    params.push(dateFrom);
    sql += ` AND ${tableAlias}.issue_date >= $${params.length}::date`;
  }
  if (dateTo) {
    params.push(dateTo);
    sql += ` AND ${tableAlias}.issue_date <= $${params.length}::date`;
  }
  return sql;
};

const lineAmount = (row, paymentField = 'line_amount') =>
  parseFloat(row?.[paymentField]) || 0;

/**
 * Payment verification totals — same rows as Payment Logs finance-unified main tab:
 * completed payments (not Returned/Rejected) + unapplied package AR rows.
 */
export async function loadFinancialDashboardPaymentVerification(runQuery, options = {}) {
  const { branchId = null, dateFrom = null, dateTo = null } = options;

  const payParams = [];
  const payScopeSql = buildBranchDateSql(branchId, dateFrom, dateTo, 'p', payParams);

  const payRes = await runQuery(
    `
      SELECT
        p.approval_status,
        COALESCE(p.payable_amount, 0) + COALESCE(p.tip_amount, 0) AS line_amount
      FROM paymenttbl p
      WHERE p.status = 'Completed'
        AND COALESCE(p.approval_status, 'Pending') NOT IN ('Returned', 'Rejected')
        ${payScopeSql}
    `,
    payParams
  );

  const arParams = [];
  const arScopeSql = buildBranchDateSql(branchId, dateFrom, dateTo, 'ar', arParams);

  const arRes = await runQuery(
    `
      SELECT
        ar.payment_amount,
        ar.tip_amount,
        ar.verified_by_user_id,
        ar.verified_at,
        verifier.full_name AS verified_by_name,
        verifier.user_type AS verifier_user_type
      FROM acknowledgement_receiptstbl ar
      LEFT JOIN userstbl verifier ON ar.verified_by_user_id = verifier.user_id
      WHERE ar.ar_type = 'Package'
        AND ar.status IN ('Submitted', 'Verified')
        AND ar.payment_id IS NULL
        AND ar.invoice_id IS NULL
        ${arScopeSql}
    `,
    arParams
  );

  let verified_count = 0;
  let verified_amount = 0;
  let unverified_count = 0;
  let unverified_amount = 0;

  const addRow = (isVerified, amount) => {
    if (isVerified) {
      verified_count += 1;
      verified_amount += amount;
    } else {
      unverified_count += 1;
      unverified_amount += amount;
    }
  };

  for (const row of payRes.rows || []) {
    const isApproved = String(row.approval_status || '').trim() === 'Approved';
    addRow(isApproved, lineAmount(row));
  }

  for (const row of arRes.rows || []) {
    const approval = paymentLogApprovalFromArVerification(row);
    const amount =
      (parseFloat(row.payment_amount) || 0) + (parseFloat(row.tip_amount) || 0);
    addRow(approval.approval_status === 'Approved', amount);
  }

  return {
    verified_count,
    verified_amount,
    unverified_count,
    unverified_amount,
  };
}

/**
 * AR verification totals — same filters as Financial Dashboard → Acknowledgement Receipts drill-down.
 * Uses payment_date_* on ar.issue_date (Acknowledgement Receipts Month / Payment date modes).
 */
export async function loadFinancialDashboardArVerification(runQuery, options = {}) {
  const { branchId = null, dateFrom = null, dateTo = null } = options;

  const countForStatuses = async (statuses) => {
    const params = [statuses];
    const scopeSql = buildBranchDateSql(branchId, dateFrom, dateTo, 'ar', params);
    const res = await runQuery(
      `
        SELECT
          COUNT(*)::bigint AS count,
          COALESCE(
            SUM(COALESCE(ar.payment_amount, 0) + COALESCE(ar.tip_amount, 0)),
            0
          ) AS amount
        FROM acknowledgement_receiptstbl ar
        WHERE ar.status = ANY($1::text[])
          ${scopeSql}
      `,
      params
    );
    const row = res.rows[0] || {};
    return {
      count: parseInt(row.count, 10) || 0,
      amount: parseFloat(row.amount) || 0,
    };
  };

  const verified = await countForStatuses(['Verified', 'Applied']);
  const unverified = await countForStatuses(['Submitted', 'Pending', 'Paid']);

  return {
    verified_count: verified.count,
    verified_amount: verified.amount,
    unverified_count: unverified.count,
    unverified_amount: unverified.amount,
  };
}
