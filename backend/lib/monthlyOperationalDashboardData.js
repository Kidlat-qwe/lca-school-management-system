/**
 * Monthly operational dashboard: same KPI definitions as daily-operational,
 * aggregated over a Manila calendar month (half-open [month_start, month_end_exclusive)).
 *
 * Invoice sales (daily_sales_amount) and the 6-month payment trend use paymenttbl.issue_date
 * only — same business date as Payment Logs (payment_date_from/to).
 * Approval filter matches Payment Logs main tab: exclude Returned and Rejected (see exclude_approval_status).
 *
 * Acknowledgement Receipt Sales (ar_sales) matches GET /acknowledgement-receipts list totals for the
 * same issue-date month and main-tab semantics (exclude Returned only; paired-row combine when enabled).
 *
 * New enrollees / re-enrollment / dropped counts come from classstudentstbl.program_enrollment_status
 * and enrolled_at / removed_at (Asia/Manila calendar day), not paymenttbl.
 */

import { query } from '../config/database.js';
import { loadEnrollmentDashboardMetrics } from './enrollmentRateMetrics.js';
import {
  ackReceiptHasPairedAckReceiptIdColumn,
  AR_LIST_EXCLUDE_PAIRED_LEADER_SQL,
  AR_LIST_LINE_AMOUNT_SUM_SQL,
} from './ackReceiptPairedColumn.js';

const buildMonthSequence = (monthsBack = 6, anchorDateInput = new Date()) => {
  const today = anchorDateInput instanceof Date ? anchorDateInput : new Date(anchorDateInput);
  const anchorDate = Number.isNaN(today.getTime()) ? new Date() : today;
  const sequence = [];
  for (let i = monthsBack - 1; i >= 0; i -= 1) {
    const date = new Date(anchorDate.getFullYear(), anchorDate.getMonth() - i, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    sequence.push({
      key,
      label: date.toLocaleString('default', { month: 'short', year: 'numeric' }),
    });
  }
  return sequence;
};

const parseMonthRange = (monthKey) => {
  if (!monthKey || !/^\d{4}-\d{2}$/.test(String(monthKey))) return null;
  const [yearStr, monthStr] = String(monthKey).split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0));
  return {
    key: `${yearStr}-${monthStr}`,
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    anchorDate: new Date(year, month - 1, 1),
  };
};

const getMonthEndInclusiveYmd = (monthRange) => {
  if (!monthRange?.end) return null;
  const end = new Date(`${monthRange.end}T00:00:00.000Z`);
  if (Number.isNaN(end.getTime())) return null;
  end.setUTCDate(end.getUTCDate() - 1);
  return end.toISOString().slice(0, 10);
};

const buildBranchMetricsSql = (branchWhereClause, startIdx, endIdx, arSalesSql) => `
            WITH branch_scope AS (
              SELECT
                b.branch_id,
                COALESCE(b.branch_nickname, b.branch_name) AS branch_name
              FROM branchestbl b
              ${branchWhereClause}
            ),
            new_enrollees AS (
              SELECT
                c.branch_id,
                COUNT(DISTINCT cs.student_id)::bigint AS new_enrollees
              FROM classstudentstbl cs
              INNER JOIN classestbl c ON cs.class_id = c.class_id
              WHERE cs.program_enrollment_status = 'new'
                AND TIMEZONE('Asia/Manila', cs.enrolled_at)::date >= $${startIdx}::date
                AND TIMEZONE('Asia/Manila', cs.enrolled_at)::date < $${endIdx}::date
              GROUP BY c.branch_id
            ),
            daily_sales AS (
              SELECT
                p.branch_id,
                COALESCE(SUM(COALESCE(p.payable_amount, 0) + COALESCE(p.tip_amount, 0)), 0) AS daily_sales_amount
              FROM paymenttbl p
              WHERE p.status = 'Completed'
                AND p.issue_date >= $${startIdx}::date
                AND p.issue_date < $${endIdx}::date
                AND COALESCE(p.approval_status, 'Pending') NOT IN ('Returned', 'Rejected')
              GROUP BY p.branch_id
            ),
            ar_sales AS (
              SELECT
                ar.branch_id,
                COUNT(*)::bigint AS ar_sales_count,
                COALESCE(SUM(${arSalesSql.lineSumExpr}), 0) AS ar_sales_amount
              FROM acknowledgement_receiptstbl ar
              WHERE ar.issue_date >= $${startIdx}::date
                AND ar.issue_date < $${endIdx}::date
                AND (ar.status IS NULL OR ar.status <> 'Returned')
                ${arSalesSql.extraWhere}
              GROUP BY ar.branch_id
            ),
            merchandise_release AS (
              SELECT
                p.branch_id,
                COUNT(DISTINCT p.payment_id) AS merchandise_released_count,
                COALESCE(SUM(COALESCE(NULLIF(item.quantity, '')::numeric, 0)), 0) AS merchandise_released_quantity
              FROM paymenttbl p
              INNER JOIN invoicestbl i ON p.invoice_id = i.invoice_id
              INNER JOIN acknowledgement_receiptstbl ar ON i.ack_receipt_id = ar.ack_receipt_id
              LEFT JOIN LATERAL jsonb_to_recordset(
                CASE
                  WHEN ar.merchandise_items_snapshot IS NULL THEN '[]'::jsonb
                  ELSE ar.merchandise_items_snapshot::jsonb
                END
              ) AS item(merchandise_id INTEGER, quantity TEXT) ON TRUE
              WHERE p.status = 'Completed'
                AND p.issue_date >= $${startIdx}::date
                AND p.issue_date < $${endIdx}::date
                AND COALESCE(p.approval_status, 'Pending') NOT IN ('Returned', 'Rejected')
                AND ar.ar_type = 'Merchandise'
              GROUP BY p.branch_id
            ),
            re_enrollment AS (
              SELECT
                c.branch_id,
                COUNT(DISTINCT cs.student_id)::bigint AS re_enrollment_count
              FROM classstudentstbl cs
              INNER JOIN classestbl c ON cs.class_id = c.class_id
              WHERE cs.program_enrollment_status IN ('re_enrolled', 'upsell')
                AND TIMEZONE('Asia/Manila', cs.enrolled_at)::date >= $${startIdx}::date
                AND TIMEZONE('Asia/Manila', cs.enrolled_at)::date < $${endIdx}::date
              GROUP BY c.branch_id
            ),
            rejoin_enrollment AS (
              SELECT
                c.branch_id,
                COUNT(DISTINCT cs.student_id)::bigint AS rejoin_count
              FROM classstudentstbl cs
              INNER JOIN classestbl c ON cs.class_id = c.class_id
              WHERE cs.program_enrollment_status = 'rejoin'
                AND TIMEZONE('Asia/Manila', cs.enrolled_at)::date >= $${startIdx}::date
                AND TIMEZONE('Asia/Manila', cs.enrolled_at)::date < $${endIdx}::date
              GROUP BY c.branch_id
            ),
            dropped_unenrolled AS (
              SELECT
                c.branch_id,
                COUNT(DISTINCT cs.student_id) AS dropped_unenrolled_count
              FROM classstudentstbl cs
              INNER JOIN classestbl c ON cs.class_id = c.class_id
              WHERE cs.program_enrollment_status = 'dropped'
                AND cs.removed_at IS NOT NULL
                AND COALESCE(cs.enrolled_by, '') NOT ILIKE '%Rejoin gap marker%'
                AND (
                  (cs.enrolled_at IS NOT NULL AND cs.enrolled_at < cs.removed_at)
                  OR (
                    cs.enrolled_at IS NULL
                    AND COALESCE(cs.enrolled_by, '') ILIKE '%Drop marker%'
                  )
                )
                AND TIMEZONE('Asia/Manila', cs.removed_at)::date >= $${startIdx}::date
                AND TIMEZONE('Asia/Manila', cs.removed_at)::date < $${endIdx}::date
              GROUP BY c.branch_id
            ),
            pay_verified AS (
              SELECT
                p.branch_id,
                COUNT(*)::bigint AS pay_verified_count,
                COALESCE(SUM(COALESCE(p.payable_amount, 0) + COALESCE(p.tip_amount, 0)), 0) AS pay_verified_amount
              FROM paymenttbl p
              WHERE p.status = 'Completed'
                AND p.issue_date >= $${startIdx}::date
                AND p.issue_date < $${endIdx}::date
                AND p.approval_status = 'Approved'
              GROUP BY p.branch_id
            ),
            pay_unverified AS (
              SELECT
                p.branch_id,
                COUNT(*)::bigint AS pay_unverified_count,
                COALESCE(SUM(COALESCE(p.payable_amount, 0) + COALESCE(p.tip_amount, 0)), 0) AS pay_unverified_amount
              FROM paymenttbl p
              WHERE p.status = 'Completed'
                AND p.issue_date >= $${startIdx}::date
                AND p.issue_date < $${endIdx}::date
                AND COALESCE(p.approval_status, 'Pending') NOT IN ('Approved', 'Rejected', 'Returned')
              GROUP BY p.branch_id
            ),
            ar_verified AS (
              SELECT
                ar.branch_id,
                COUNT(*)::bigint AS ar_verified_count,
                COALESCE(SUM(COALESCE(ar.payment_amount, 0) + COALESCE(ar.tip_amount, 0)), 0) AS ar_verified_amount
              FROM acknowledgement_receiptstbl ar
              WHERE ar.ar_type = 'Package'
                AND ar.issue_date >= $${startIdx}::date
                AND ar.issue_date < $${endIdx}::date
                AND ar.status IN ('Verified', 'Applied')
              GROUP BY ar.branch_id
            ),
            ar_unverified AS (
              SELECT
                ar.branch_id,
                COUNT(*)::bigint AS ar_unverified_count,
                COALESCE(SUM(COALESCE(ar.payment_amount, 0) + COALESCE(ar.tip_amount, 0)), 0) AS ar_unverified_amount
              FROM acknowledgement_receiptstbl ar
              WHERE ar.ar_type = 'Package'
                AND ar.issue_date >= $${startIdx}::date
                AND ar.issue_date < $${endIdx}::date
                AND COALESCE(ar.status, 'Submitted') NOT IN ('Verified', 'Applied', 'Rejected', 'Cancelled')
              GROUP BY ar.branch_id
            )
            SELECT
              bs.branch_id,
              bs.branch_name,
              COALESCE(ne.new_enrollees, 0)::bigint AS new_enrollees,
              COALESCE(ds.daily_sales_amount, 0) AS daily_sales_amount,
              COALESCE(ars.ar_sales_count, 0)::bigint AS ar_sales_count,
              COALESCE(ars.ar_sales_amount, 0) AS ar_sales_amount,
              COALESCE(mr.merchandise_released_count, 0)::bigint AS merchandise_released_count,
              COALESCE(mr.merchandise_released_quantity, 0) AS merchandise_released_quantity,
              COALESCE(re.re_enrollment_count, 0)::bigint AS re_enrollment_count,
              COALESCE(rj.rejoin_count, 0)::bigint AS rejoin_count,
              COALESCE(du.dropped_unenrolled_count, 0)::bigint AS dropped_unenrolled_count,
              COALESCE(pv.pay_verified_count, 0)::bigint AS pay_verified_count,
              COALESCE(pv.pay_verified_amount, 0) AS pay_verified_amount,
              COALESCE(puv.pay_unverified_count, 0)::bigint AS pay_unverified_count,
              COALESCE(puv.pay_unverified_amount, 0) AS pay_unverified_amount,
              COALESCE(arv.ar_verified_count, 0)::bigint AS ar_verified_count,
              COALESCE(arv.ar_verified_amount, 0) AS ar_verified_amount,
              COALESCE(aruv.ar_unverified_count, 0)::bigint AS ar_unverified_count,
              COALESCE(aruv.ar_unverified_amount, 0) AS ar_unverified_amount
            FROM branch_scope bs
            LEFT JOIN new_enrollees ne ON ne.branch_id = bs.branch_id
            LEFT JOIN daily_sales ds ON ds.branch_id = bs.branch_id
            LEFT JOIN ar_sales ars ON ars.branch_id = bs.branch_id
            LEFT JOIN merchandise_release mr ON mr.branch_id = bs.branch_id
            LEFT JOIN re_enrollment re ON re.branch_id = bs.branch_id
            LEFT JOIN rejoin_enrollment rj ON rj.branch_id = bs.branch_id
            LEFT JOIN dropped_unenrolled du ON du.branch_id = bs.branch_id
            LEFT JOIN pay_verified pv ON pv.branch_id = bs.branch_id
            LEFT JOIN pay_unverified puv ON puv.branch_id = bs.branch_id
            LEFT JOIN ar_verified arv ON arv.branch_id = bs.branch_id
            LEFT JOIN ar_unverified aruv ON aruv.branch_id = bs.branch_id
            ORDER BY
              COALESCE(ds.daily_sales_amount, 0) DESC,
              COALESCE(ne.new_enrollees, 0) DESC,
              bs.branch_name ASC
          `;

export async function loadMonthlyOperationalDashboardPayload(opts) {
  const { branchFilter, summaryMonth, runQuery = query } = opts;
  const branchParams = branchFilter ? [branchFilter] : [];
  const branchWhereClause = branchFilter ? 'WHERE b.branch_id = $1' : '';

  const monthRange = parseMonthRange(summaryMonth);
  if (!monthRange) {
    throw new Error('INVALID_MONTH');
  }

  const monthStart = monthRange.start;
  const monthEndExclusive = monthRange.end;
  const startIdx = branchParams.length + 1;
  const endIdx = branchParams.length + 2;
  const metricsParams = [...branchParams, monthStart, monthEndExclusive];

  const monthSeqTrend = buildMonthSequence(6, monthRange.anchorDate);
  const trendWindowStart = parseMonthRange(monthSeqTrend[0].key)?.start || monthStart;
  const trendWindowEndExclusive = monthRange.end;
  const trendParams = [...branchParams, trendWindowStart, trendWindowEndExclusive];
  const tStart = branchParams.length + 1;
  const tEnd = branchParams.length + 2;

  const hidePairedLeaders = await ackReceiptHasPairedAckReceiptIdColumn(runQuery);
  const arSalesSql = {
    lineSumExpr: hidePairedLeaders
      ? AR_LIST_LINE_AMOUNT_SUM_SQL
      : 'COALESCE(ar.payment_amount, 0) + COALESCE(ar.tip_amount, 0)',
    extraWhere: hidePairedLeaders ? AR_LIST_EXCLUDE_PAIRED_LEADER_SQL : '',
  };
  const branchMetricsSql = buildBranchMetricsSql(branchWhereClause, startIdx, endIdx, arSalesSql);

  const salesTrendSql = `
            SELECT
              TO_CHAR(DATE_TRUNC('month', p.issue_date), 'YYYY-MM') AS ym,
              COALESCE(SUM(COALESCE(p.payable_amount, 0) + COALESCE(p.tip_amount, 0)), 0) AS total_amount
            FROM paymenttbl p
            WHERE p.status = 'Completed'
              AND COALESCE(p.approval_status, 'Pending') NOT IN ('Returned', 'Rejected')
              AND p.issue_date >= $${tStart}::date
              AND p.issue_date < $${tEnd}::date
              ${branchFilter ? 'AND p.branch_id = $1' : ''}
            GROUP BY 1
            ORDER BY 1
          `;

  const [branchesResult, branchMetricsResult, salesTrendResult] = await Promise.all([
    runQuery(
      `
            SELECT
              b.branch_id,
              COALESCE(b.branch_nickname, b.branch_name) AS branch_name
            FROM branchestbl b
            ORDER BY COALESCE(b.branch_nickname, b.branch_name)
          `
    ),
    runQuery(branchMetricsSql, metricsParams),
    runQuery(salesTrendSql, trendParams),
  ]);

  const branches = branchesResult.rows.map((row) => ({
    branch_id: row.branch_id,
    branch_name: row.branch_name,
  }));

  const branchBreakdown = branchMetricsResult.rows.map((row) => ({
    branch_id: row.branch_id,
    branch_name: row.branch_name,
    new_enrollees: parseInt(row.new_enrollees, 10) || 0,
    daily_sales_amount: parseFloat(row.daily_sales_amount) || 0,
    ar_sales_count: parseInt(row.ar_sales_count, 10) || 0,
    ar_sales_amount: parseFloat(row.ar_sales_amount) || 0,
    merchandise_released_count: parseInt(row.merchandise_released_count, 10) || 0,
    merchandise_released_quantity: parseFloat(row.merchandise_released_quantity) || 0,
    re_enrollment_count: parseInt(row.re_enrollment_count, 10) || 0,
    rejoin_count: parseInt(row.rejoin_count, 10) || 0,
    dropped_unenrolled_count: parseInt(row.dropped_unenrolled_count, 10) || 0,
    pay_verified_count: parseInt(row.pay_verified_count, 10) || 0,
    pay_verified_amount: parseFloat(row.pay_verified_amount) || 0,
    pay_unverified_count: parseInt(row.pay_unverified_count, 10) || 0,
    pay_unverified_amount: parseFloat(row.pay_unverified_amount) || 0,
    ar_verified_count: parseInt(row.ar_verified_count, 10) || 0,
    ar_verified_amount: parseFloat(row.ar_verified_amount) || 0,
    ar_unverified_count: parseInt(row.ar_unverified_count, 10) || 0,
    ar_unverified_amount: parseFloat(row.ar_unverified_amount) || 0,
  }));

  const totals = branchBreakdown.reduce(
    (acc, row) => ({
      new_enrollees: acc.new_enrollees + row.new_enrollees,
      daily_sales_amount: acc.daily_sales_amount + row.daily_sales_amount,
      ar_sales_count: acc.ar_sales_count + row.ar_sales_count,
      ar_sales_amount: acc.ar_sales_amount + row.ar_sales_amount,
      merchandise_released_count: acc.merchandise_released_count + row.merchandise_released_count,
      merchandise_released_quantity: acc.merchandise_released_quantity + row.merchandise_released_quantity,
      re_enrollment_count: acc.re_enrollment_count + row.re_enrollment_count,
      rejoin_count: acc.rejoin_count + row.rejoin_count,
      dropped_unenrolled_count: acc.dropped_unenrolled_count + row.dropped_unenrolled_count,
      pay_verified_count: acc.pay_verified_count + row.pay_verified_count,
      pay_verified_amount: acc.pay_verified_amount + row.pay_verified_amount,
      pay_unverified_count: acc.pay_unverified_count + row.pay_unverified_count,
      pay_unverified_amount: acc.pay_unverified_amount + row.pay_unverified_amount,
      ar_verified_count: acc.ar_verified_count + row.ar_verified_count,
      ar_verified_amount: acc.ar_verified_amount + row.ar_verified_amount,
      ar_unverified_count: acc.ar_unverified_count + row.ar_unverified_count,
      ar_unverified_amount: acc.ar_unverified_amount + row.ar_unverified_amount,
      active_branches:
        acc.active_branches +
        (row.new_enrollees > 0 ||
        row.daily_sales_amount > 0 ||
        row.ar_sales_amount > 0 ||
        row.merchandise_released_count > 0 ||
        row.re_enrollment_count > 0 ||
        row.rejoin_count > 0 ||
        row.dropped_unenrolled_count > 0
          ? 1
          : 0),
    }),
    {
      new_enrollees: 0,
      daily_sales_amount: 0,
      ar_sales_count: 0,
      ar_sales_amount: 0,
      merchandise_released_count: 0,
      merchandise_released_quantity: 0,
      re_enrollment_count: 0,
      rejoin_count: 0,
      dropped_unenrolled_count: 0,
      pay_verified_count: 0,
      pay_verified_amount: 0,
      pay_unverified_count: 0,
      pay_unverified_amount: 0,
      ar_verified_count: 0,
      ar_verified_amount: 0,
      ar_unverified_count: 0,
      ar_unverified_amount: 0,
      active_branches: 0,
    }
  );

  const salesTrendMap = salesTrendResult.rows.reduce((acc, row) => {
    acc[String(row.ym)] = parseFloat(row.total_amount) || 0;
    return acc;
  }, {});

  const salesLast6Months = monthSeqTrend.map((m) => ({
    date: m.key,
    label: m.label,
    total_amount: salesTrendMap[m.key] || 0,
  }));

  const monthEndInclusive = getMonthEndInclusiveYmd(monthRange);

  const enrollmentDashboard = await loadEnrollmentDashboardMetrics(runQuery, {
    branchId: branchFilter,
    enrolledFrom: monthStart,
    enrolledTo: monthEndExclusive,
  });

  return {
    summary_month: monthRange.key,
    month_start: monthStart,
    month_end_exclusive: monthEndExclusive,
    month_end_inclusive: monthEndInclusive,
    verification_as_of: `${monthStart}–${monthEndInclusive}`,
    totals,
    enrollment_dashboard: enrollmentDashboard,
    branch_breakdown: branchBreakdown,
    charts: {
      branch_metrics: branchBreakdown.map((row) => ({
        branch_id: row.branch_id,
        branch_name: row.branch_name,
        new_enrollees: row.new_enrollees,
        daily_sales_amount: row.daily_sales_amount,
        ar_sales_count: row.ar_sales_count,
        ar_sales_amount: row.ar_sales_amount,
        merchandise_released_count: row.merchandise_released_count,
        merchandise_released_quantity: row.merchandise_released_quantity,
        re_enrollment_count: row.re_enrollment_count,
        rejoin_count: row.rejoin_count,
        dropped_unenrolled_count: row.dropped_unenrolled_count,
        pay_verified_count: row.pay_verified_count,
        pay_verified_amount: row.pay_verified_amount,
        pay_unverified_count: row.pay_unverified_count,
        pay_unverified_amount: row.pay_unverified_amount,
        ar_verified_count: row.ar_verified_count,
        ar_verified_amount: row.ar_verified_amount,
        ar_unverified_count: row.ar_unverified_count,
        ar_unverified_amount: row.ar_unverified_amount,
      })),
      activity_mix: [
        { name: 'New Enrollees', value: totals.new_enrollees },
        { name: 'Acknowledgement Receipt Sales', value: totals.ar_sales_count },
        { name: 'Merchandise Released', value: totals.merchandise_released_quantity },
        { name: 'Re-enrollment', value: totals.re_enrollment_count },
        { name: 'Rejoin', value: totals.rejoin_count },
        { name: 'Dropped / Unenrolled', value: totals.dropped_unenrolled_count },
      ],
      sales_last_6_months: salesLast6Months,
    },
    branches,
    selected_branch_id: branchFilter,
    updated_at: new Date().toISOString(),
  };
}
