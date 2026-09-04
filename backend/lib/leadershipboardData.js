/**
 * Leadershipboard: cross-branch comparison for Superadmin / Superfinance / Admin.
 * Admin consumers use applyLeadershipboardAdminPrivacy() after load.
 *
 * Metrics align with Monthly Operational Dashboard (same payload):
 * - Invoice sales (total_sales) = branch `daily_sales_amount` (completed payments by
 *   issue date, excluding Returned/Rejected) — same as the branch table Invoice sales
 *   / Total payments sales lines on Monthly Operational.
 * - New / Re-enroll / Rejoin / Upsell = Month Re-enrollment matrix KPIs on
 *   `branch_breakdown` (via loadMonthlyOperationalDashboardPayload).
 * - Active students = new + re_enrollment + rejoin + upsell + multi-phase
 *   completed (`active_completed_count`) — same formula as Monthly Operational
 *   "Total Active Students" card (multi-phase completed with prior new/re-enrolled/rejoin).
 *
 * Overall ranking uses a weighted score (Active is display-only, not in Overall):
 *   Invoice Sales 40% + New 20% + Re-enrolled 20% + Rejoin 10% + Upsell 10%.
 * Each metric is min-max normalized across branches (0–1), then weighted and
 * scaled to 0–100. Tie-break: invoice sales, then name.
 * Optional focusBranchId keeps all ranked branches for side-by-side compare
 * and marks the focused branch (Superadmin / Superfinance global filter).
 */

import { query } from '../config/database.js';
import { loadMonthlyOperationalDashboardPayload } from './monthlyOperationalDashboardData.js';

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

const formatMonthLabel = (monthKey) => {
  const parsed = parseMonthRange(monthKey);
  if (!parsed) return String(monthKey || '');
  return parsed.anchorDate.toLocaleString('default', { month: 'long', year: 'numeric' });
};

/**
 * Min-max normalize to 0–1. All equal → 1 if value > 0, else 0.
 * @param {number[]} values
 * @returns {number[]}
 */
const normalizeValues = (values) => {
  const nums = values.map((v) => Number(v) || 0);
  if (nums.length === 0) return [];
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  if (max === min) {
    return nums.map((n) => (n > 0 ? 1 : 0));
  }
  return nums.map((n) => (n - min) / (max - min));
};

/**
 * Overall weights — Active Students is excluded (it double-counts the enrollment KPIs).
 * Weights must sum to 1.
 */
const OVERALL_WEIGHTS = [
  { field: 'total_sales', weight: 0.4, label: 'Invoice Sales' },
  { field: 'new_enrollees', weight: 0.2, label: 'New' },
  { field: 're_enrollment_count', weight: 0.2, label: 'Re-enrolled' },
  { field: 'rejoin_count', weight: 0.1, label: 'Rejoin' },
  { field: 'upsell_count', weight: 0.1, label: 'Upsell' },
];

/**
 * Weighted Overall from normalized metrics.
 * @param {object[]} branches
 * @returns {{ composite_score: number, weight_breakdown: object }[]}
 */
const computeWeightedOverall = (branches) => {
  const n = branches.length;
  if (n === 0) return [];

  const normalizedByField = {};
  for (const { field } of OVERALL_WEIGHTS) {
    normalizedByField[field] = normalizeValues(branches.map((b) => b[field]));
  }

  return branches.map((_, index) => {
    let weighted = 0;
    const weight_breakdown = {};
    for (const { field, weight, label } of OVERALL_WEIGHTS) {
      const nVal = normalizedByField[field][index] || 0;
      weighted += nVal * weight;
      weight_breakdown[field] = {
        label,
        weight,
        normalized: Math.round(nVal * 1000) / 1000,
        contribution: Math.round(nVal * weight * 1000) / 1000,
      };
    }
    return {
      composite_score: Math.round(weighted * 1000) / 10,
      weight_breakdown,
    };
  });
};

const findStrongestMetric = (branch) => {
  // Strongest badge uses Overall inputs only (not Active — display-only).
  const candidates = [
    { key: 'total_sales', label: 'Highest Invoice Sales', value: branch.total_sales },
    { key: 'new_enrollees', label: 'Most New Enrollees', value: branch.new_enrollees },
    { key: 're_enrollment_count', label: 'Most Re-enrolled', value: branch.re_enrollment_count },
    { key: 'rejoin_count', label: 'Most Rejoin', value: branch.rejoin_count },
    { key: 'upsell_count', label: 'Most Upsell', value: branch.upsell_count },
  ];
  candidates.sort((a, b) => {
    if (b.value !== a.value) return b.value - a.value;
    return a.label.localeCompare(b.label);
  });
  return candidates[0];
};

/**
 * @param {{ summaryMonth: string, focusBranchId?: number|null, runQuery?: Function }} opts
 */
export async function loadLeadershipboardPayload(opts) {
  const { summaryMonth, focusBranchId = null, runQuery = query } = opts;
  const monthRange = parseMonthRange(summaryMonth);
  if (!monthRange) {
    throw new Error('INVALID_MONTH');
  }

  const monthSeqTrend = buildMonthSequence(6, monthRange.anchorDate);
  const trendWindowStart = parseMonthRange(monthSeqTrend[0].key)?.start || monthRange.start;
  const trendWindowEndExclusive = monthRange.end;

  // Always load network-wide sales trend so focused compare still shows peers.
  const trendParams = [trendWindowStart, trendWindowEndExclusive];

  // Single source of truth: same loader as Monthly Operational Dashboard.
  const [monthlyPayload, salesTrendResult] = await Promise.all([
    loadMonthlyOperationalDashboardPayload({
      branchFilter: null,
      summaryMonth: monthRange.key,
      runQuery,
    }),
    runQuery(
      `
        SELECT
          p.branch_id,
          TO_CHAR(DATE_TRUNC('month', p.issue_date), 'YYYY-MM') AS ym,
          COALESCE(SUM(COALESCE(p.payable_amount, 0) + COALESCE(p.tip_amount, 0)), 0) AS total_amount
        FROM paymenttbl p
        WHERE p.status = 'Completed'
          AND COALESCE(p.approval_status, 'Pending') NOT IN ('Returned', 'Rejected')
          AND p.issue_date >= $1::date
          AND p.issue_date < $2::date
        GROUP BY p.branch_id, 2
        ORDER BY 2, p.branch_id
      `,
      trendParams
    ),
  ]);

  const breakdown = monthlyPayload?.branch_breakdown || [];

  const enriched = breakdown.map((row) => {
    // Match Monthly Operational branch "Invoice sales" (= Total payments sales line
    // after excluding Returned/Rejected). Do not add AR sales.
    const invoiceSales = Number(row.daily_sales_amount) || 0;
    const newEnrollees = Number(row.new_enrollees) || 0;
    const reEnrollment = Number(row.re_enrollment_count) || 0;
    const rejoin = Number(row.rejoin_count) || 0;
    const upsell = Number(row.upsell_count) || 0;
    // Multi-phase completed only (same as Monthly Operational Total Active card).
    const activeCompleted = Number(row.active_completed_count) || 0;
    // Same as Monthly Operational totalActiveStudents card.
    const activeStudents =
      newEnrollees + reEnrollment + rejoin + upsell + activeCompleted;

    return {
      branch_id: row.branch_id,
      branch_name: row.branch_name,
      daily_sales_amount: invoiceSales,
      invoice_sales_amount: invoiceSales,
      // Alias for UI compare metric — Monthly Operational invoice sales.
      total_sales: invoiceSales,
      // Verified + unverified payments on the same month (branch row); equals invoice
      // sales when using the same Returned/Rejected exclusion.
      total_payments_amount:
        (Number(row.pay_verified_amount) || 0) + (Number(row.pay_unverified_amount) || 0),
      ar_sales_amount: Number(row.ar_sales_amount) || 0,
      new_enrollees: newEnrollees,
      re_enrollment_count: reEnrollment,
      rejoin_count: rejoin,
      upsell_count: upsell,
      active_completed_count: activeCompleted,
      active_students: activeStudents,
      dropped_unenrolled_count: Number(row.dropped_unenrolled_count) || 0,
      reserved_count: Number(row.reserved_count) || 0,
      completed_count: Number(row.completed_count) || 0,
    };
  });

  const overallByIndex = computeWeightedOverall(enriched);

  const scored = enriched.map((branch, index) => ({
    ...branch,
    composite_score: overallByIndex[index]?.composite_score ?? 0,
    // Own-branch Admin “how Overall is built” story (peers never receive this).
    weight_breakdown: overallByIndex[index]?.weight_breakdown ?? null,
    strongest_metric: findStrongestMetric(branch),
  }));

  scored.sort((a, b) => {
    if (b.composite_score !== a.composite_score) return b.composite_score - a.composite_score;
    if (b.total_sales !== a.total_sales) return b.total_sales - a.total_sales;
    return String(a.branch_name || '').localeCompare(String(b.branch_name || ''));
  });

  const allRanked = scored.map((branch, index) => ({
    ...branch,
    rank: index + 1,
    strongest_metric_key: branch.strongest_metric?.key || null,
    strongest_metric_label: branch.strongest_metric?.label || null,
  }));

  for (const branch of allRanked) {
    delete branch.strongest_metric;
  }

  const networkTopBranch = allRanked.length > 0 ? allRanked[0] : null;

  const focusId =
    focusBranchId != null && Number.isFinite(Number(focusBranchId))
      ? Number(focusBranchId)
      : null;

  const branches = allRanked.map((branch) => ({
    ...branch,
    is_focus_branch: focusId != null && Number(branch.branch_id) === focusId,
  }));

  const focusedBranch =
    focusId != null ? branches.find((b) => Number(b.branch_id) === focusId) || null : null;

  const trendAmountMap = new Map();
  for (const row of salesTrendResult.rows || []) {
    const key = `${row.branch_id}|${row.ym}`;
    trendAmountMap.set(key, parseFloat(row.total_amount) || 0);
  }

  const salesTrendRows = monthSeqTrend.map((month) => {
    const row = { label: month.label, key: month.key };
    for (const branch of branches) {
      const amount = trendAmountMap.get(`${branch.branch_id}|${month.key}`) || 0;
      row[branch.branch_name] = amount;
    }
    return row;
  });

  const topBranch = focusedBranch || networkTopBranch;

  return {
    summary_month: monthRange.key,
    month_label: formatMonthLabel(monthRange.key),
    month_start: monthRange.start,
    month_end_exclusive: monthRange.end,
    metric_source: 'monthly_operational_dashboard',
    privacy_mode: false,
    focus_mode: focusId != null,
    branches,
    top_branch: topBranch,
    network_top_branch: networkTopBranch,
    total_branch_count: allRanked.length,
    sales_trend: {
      months: monthSeqTrend,
      branch_keys: branches.map((b) => ({
        branch_id: b.branch_id,
        branch_name: b.branch_name,
      })),
      rows: salesTrendRows,
    },
    selected_branch_id: focusId,
    updated_at: new Date().toISOString(),
  };
}

/** Numeric fields hidden for peer branches in Admin privacy mode. */
const MASKED_NUMERIC_FIELDS = [
  'composite_score',
  'total_sales',
  'daily_sales_amount',
  'invoice_sales_amount',
  'total_payments_amount',
  'ar_sales_amount',
  'new_enrollees',
  're_enrollment_count',
  'rejoin_count',
  'upsell_count',
  'active_students',
  'dropped_unenrolled_count',
  'reserved_count',
  'completed_count',
];

const maskBranchRow = (branch, isOwn) => {
  if (isOwn) {
    return {
      ...branch,
      is_own_branch: true,
      is_masked: false,
    };
  }
  const masked = {
    branch_id: branch.branch_id,
    branch_name: branch.branch_name,
    rank: branch.rank,
    strongest_metric_key: null,
    strongest_metric_label: null,
    weight_breakdown: null,
    is_own_branch: false,
    is_masked: true,
  };
  for (const field of MASKED_NUMERIC_FIELDS) {
    masked[field] = null;
  }
  return masked;
};

/**
 * Admin view: keep network ranks + branch names for all branches, but redact
 * peer metrics. Spotlight focuses on the Admin's own branch and its place.
 * Charts only include the Admin's branch so peer sales can't be inferred.
 *
 * @param {object} payload from loadLeadershipboardPayload (unfiltered preferred)
 * @param {number} viewerBranchId Admin's branch_id
 */
export function applyLeadershipboardAdminPrivacy(payload, viewerBranchId) {
  if (!payload || viewerBranchId == null) return payload;

  const viewerId = Number(viewerBranchId);
  // Prefer full network list when present (call with branchFilter: null).
  const sourceBranches = Array.isArray(payload.branches) ? payload.branches : [];
  const networkTop = payload.network_top_branch || sourceBranches.find((b) => b.rank === 1) || null;

  const maskedBranches = sourceBranches.map((b) =>
    maskBranchRow(b, Number(b.branch_id) === viewerId)
  );

  const ownBranch =
    maskedBranches.find((b) => Number(b.branch_id) === viewerId) || null;

  const ownName = ownBranch?.branch_name;
  const trendRows = (payload.sales_trend?.rows || []).map((row) => {
    const next = { label: row.label, key: row.key };
    if (ownName && row[ownName] != null) {
      next[ownName] = row[ownName];
    }
    return next;
  });

  return {
    ...payload,
    privacy_mode: true,
    branches: maskedBranches,
    top_branch: ownBranch,
    network_top_branch: networkTop
      ? {
          branch_id: networkTop.branch_id,
          branch_name: networkTop.branch_name,
          rank: networkTop.rank,
          is_masked: Number(networkTop.branch_id) !== viewerId,
          is_own_branch: Number(networkTop.branch_id) === viewerId,
          // Numbers redacted unless the Admin's branch is #1
          ...(Number(networkTop.branch_id) === viewerId
            ? {
                composite_score: networkTop.composite_score,
                total_sales: networkTop.total_sales,
                is_masked: false,
              }
            : { composite_score: null, total_sales: null }),
        }
      : null,
    sales_trend: {
      months: payload.sales_trend?.months || [],
      branch_keys: ownBranch
        ? [{ branch_id: ownBranch.branch_id, branch_name: ownBranch.branch_name }]
        : [],
      rows: trendRows,
    },
    selected_branch_id: viewerId,
    viewer_branch_id: viewerId,
  };
}
