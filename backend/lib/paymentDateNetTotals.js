/**
 * Net payment totals by payment date (`paymenttbl.issue_date`).
 *
 * Used across Payment Logs, Invoice summaries, Financial Dashboard, and
 * Monthly Operational Dashboard so all screens stay aligned.
 *
 * Rules:
 * - Scope rows by payment issue date (Payment Logs "payment date").
 * - Gross = completed payment lines in scope (any approval status).
 * - Returned / rejected lines in the same scope are deducted from gross.
 * - Net = gross − returned − rejected (same as excluding Returned/Rejected up front).
 * - When a returned payment is resubmitted and approved, or a rejected invoice is
 *   paid with a new payment, approval_status updates and net totals refresh.
 */

export const PAYMENT_LINE_AMOUNT_SQL =
  'COALESCE(p.payable_amount, 0) + COALESCE(p.tip_amount, 0)';

const parseCount = (v) => parseInt(v, 10) || 0;
const parseAmount = (v) => parseFloat(v) || 0;

/**
 * @param {object} opts
 * @param {number|null} [opts.branchId]
 * @param {string|null} [opts.dateFrom] YYYY-MM-DD inclusive
 * @param {string|null} [opts.dateTo] YYYY-MM-DD inclusive, or exclusive upper bound when dateEndExclusive
 * @param {boolean} [opts.dateEndExclusive=false]
 * @param {string} [opts.extraWhereSql] Additional AND clauses (use paymenttbl alias `p`)
 * @param {Array} [opts.extraParams]
 */
export function buildPaymentDateScopeClause(opts = {}) {
  const {
    branchId = null,
    dateFrom = null,
    dateTo = null,
    dateEndExclusive = false,
    extraWhereSql = '',
    extraParams = [],
  } = opts;

  const params = [...extraParams];
  let sql = extraWhereSql;

  if (branchId != null) {
    params.push(branchId);
    sql += ` AND p.branch_id = $${params.length}`;
  }
  if (dateFrom) {
    params.push(dateFrom);
    sql += ` AND p.issue_date >= $${params.length}::date`;
  }
  if (dateTo) {
    params.push(dateTo);
    if (dateEndExclusive) {
      sql += ` AND p.issue_date < $${params.length}::date`;
    } else {
      sql += ` AND p.issue_date <= $${params.length}::date`;
    }
  }

  return { scopeSql: sql, params };
}

/** Aggregate SELECT for net / returned / rejected buckets (pair with FROM paymenttbl p …). */
export const PAYMENT_NET_TOTALS_AGGREGATE_SELECT = `
      SELECT
        COUNT(*) FILTER (
          WHERE p.status = 'Completed'
        )::int AS gross_count,
        COALESCE(SUM(${PAYMENT_LINE_AMOUNT_SQL}) FILTER (
          WHERE p.status = 'Completed'
        ), 0)::numeric AS gross_amount,
        COUNT(*) FILTER (
          WHERE p.status = 'Completed'
            AND COALESCE(p.approval_status, 'Pending') = 'Returned'
        )::int AS returned_count,
        COALESCE(SUM(${PAYMENT_LINE_AMOUNT_SQL}) FILTER (
          WHERE p.status = 'Completed'
            AND COALESCE(p.approval_status, 'Pending') = 'Returned'
        ), 0)::numeric AS returned_amount,
        COUNT(*) FILTER (
          WHERE COALESCE(p.approval_status, 'Pending') = 'Rejected'
            OR p.status = 'Rejected'
        )::int AS rejected_count,
        COALESCE(SUM(${PAYMENT_LINE_AMOUNT_SQL}) FILTER (
          WHERE COALESCE(p.approval_status, 'Pending') = 'Rejected'
            OR p.status = 'Rejected'
        ), 0)::numeric AS rejected_amount,
        COUNT(*) FILTER (
          WHERE p.status = 'Completed'
            AND COALESCE(p.approval_status, 'Pending') NOT IN ('Returned', 'Rejected')
        )::int AS net_count,
        COALESCE(SUM(${PAYMENT_LINE_AMOUNT_SQL}) FILTER (
          WHERE p.status = 'Completed'
            AND COALESCE(p.approval_status, 'Pending') NOT IN ('Returned', 'Rejected')
        ), 0)::numeric AS net_amount`;

export function netTotalsAggregateQuery(fromPaymentListSql) {
  // Must match the main list FROM, not correlated subqueries (e.g. FROM paymenttbl px).
  const marker = /FROM paymenttbl p\s+LEFT JOIN/i;
  const match = fromPaymentListSql.match(marker);
  if (!match || match.index == null) {
    throw new Error('Expected payment list SQL to include FROM paymenttbl p LEFT JOIN');
  }
  let tail = fromPaymentListSql.slice(match.index);
  tail = tail.replace(/\s+ORDER BY[\s\S]*$/i, '');
  return `${PAYMENT_NET_TOTALS_AGGREGATE_SELECT} ${tail}`;
}

export function parsePaymentNetTotalsRow(row) {
  const returnedCount = parseCount(row?.returned_count);
  const returnedAmount = parseAmount(row?.returned_amount);
  const rejectedCount = parseCount(row?.rejected_count);
  const rejectedAmount = parseAmount(row?.rejected_amount);
  return {
    grossCount: parseCount(row?.gross_count),
    grossAmount: parseAmount(row?.gross_amount),
    returnedCount,
    returnedAmount,
    rejectedCount,
    rejectedAmount,
    netCount: parseCount(row?.net_count),
    netAmount: parseAmount(row?.net_amount),
  };
}

/**
 * @returns {Promise<{
 *   grossCount: number,
 *   grossAmount: number,
 *   returnedCount: number,
 *   returnedAmount: number,
 *   rejectedCount: number,
 *   rejectedAmount: number,
 *   netCount: number,
 *   netAmount: number,
 * }>}
 */
export async function computePaymentDateNetTotals(runQuery, opts = {}) {
  const { scopeSql, params } = buildPaymentDateScopeClause(opts);

  const result = await runQuery(
    `${PAYMENT_NET_TOTALS_AGGREGATE_SELECT}
      FROM paymenttbl p
      WHERE (p.status = 'Completed' OR p.status = 'Rejected')
        ${scopeSql}`,
    params
  );

  return parsePaymentNetTotalsRow(result.rows?.[0]);
}

/** API / UI summary shape for net totals with explicit deductions. */
export function formatPaymentDateNetTotalsSummary(totals) {
  const t = totals || {};
  return {
    filterTotalLineAmount: t.netAmount ?? 0,
    filterTotalPaymentLineCount: t.netCount ?? 0,
    returnedDeductionAmount: t.returnedAmount ?? 0,
    returnedDeductionCount: t.returnedCount ?? 0,
    rejectedDeductionAmount: t.rejectedAmount ?? 0,
    rejectedDeductionCount: t.rejectedCount ?? 0,
  };
}
