/**
 * Re-enrollment rate breakdown for the operational dashboard table (monthly only).
 * Uses the same enrollment-month matrix as Month Re-enrollment dashboard — not payment issue_date.
 */

const roundRate = (reEnrolled, retentionBase) => {
  const num = Number(reEnrolled) || 0;
  const den = Number(retentionBase) || 0;
  if (den <= 0) return 0;
  return Number(((num / den) * 100).toFixed(2));
};

const resolvePriorPeriodLabel = (matrix, summaryMonth, year) => {
  const months = matrix?.months || [];
  const idx = months.findIndex((m) => m.key === summaryMonth);
  if (idx > 0) return months[idx - 1]?.label ?? null;
  if (idx === 0) return `Dec ${parseInt(year, 10) - 1}`;
  return null;
};

/**
 * @param {Function} apiRequest
 * @param {{ summaryMonth: string, branchRows?: object[], branchFilterId?: string|number }} options
 */
export async function fetchMonthMatrixReEnrollmentBreakdown(apiRequest, {
  summaryMonth,
  branchRows = [],
  branchFilterId = '',
}) {
  if (!summaryMonth || !/^\d{4}-\d{2}$/.test(String(summaryMonth))) {
    return null;
  }

  const year = String(summaryMonth).slice(0, 4);
  let targets = (branchRows || []).filter((b) => b?.branch_id != null);
  if (branchFilterId !== '' && branchFilterId != null) {
    targets = targets.filter((b) => String(b.branch_id) === String(branchFilterId));
  }
  if (!targets.length) return null;

  let priorPeriodLabel = null;

  const overallParams = new URLSearchParams({
    year,
    enrollment_rate_scope: 'month',
    phase_matrix_scope: 'overall',
  });
  if (branchFilterId !== '' && branchFilterId != null) {
    overallParams.set('branch_id', String(branchFilterId));
  }

  const [rows, overallRes] = await Promise.all([
    Promise.all(
      targets.map(async (branch) => {
        const params = new URLSearchParams({
          year,
          enrollment_rate_scope: 'month',
          phase_matrix_scope: 'overall',
          branch_id: String(branch.branch_id),
        });
        const res = await apiRequest(`/dashboard/enrollment?${params.toString()}`);
        const matrix = res.data?.student_month_enrollment_matrix;
        const monthStat =
          (matrix?.month_stats || []).find((r) => r.month_key === summaryMonth) || {};

        const reEnrolled = Number(monthStat.re_enrolled_count) || 0;
        const retentionBase = Number(monthStat.prior_month_enrolled_count) || 0;

        return {
          branch_id: branch.branch_id,
          branch_name: branch.branch_name || '—',
          re_enrolled_student_count: reEnrolled,
          re_enrollment_kpi_count: reEnrolled,
          retention_base_count: retentionBase,
          re_enrollment_rate: roundRate(reEnrolled, retentionBase),
        };
      })
    ),
    apiRequest(`/dashboard/enrollment?${overallParams.toString()}`),
  ]);

  const overallMatrix = overallRes.data?.student_month_enrollment_matrix;
  const overallMonthStat =
    (overallMatrix?.month_stats || []).find((r) => r.month_key === summaryMonth) || {};
  priorPeriodLabel = resolvePriorPeriodLabel(overallMatrix, summaryMonth, year);

  const sortedRows = [...rows].sort((a, b) =>
    String(a.branch_name || '').localeCompare(String(b.branch_name || ''))
  );

  // Total row must match the all-branches matrix rate row (e.g. 136/254), not sum of branches.
  const totalReEnrolled = Number(overallMonthStat.re_enrolled_count) || 0;
  const totalBase = Number(overallMonthStat.prior_month_enrolled_count) || 0;

  return {
    prior_period_label: priorPeriodLabel,
    rows: sortedRows,
    totals: {
      branch_id: null,
      branch_name: 'All branches (total)',
      re_enrolled_student_count: totalReEnrolled,
      re_enrollment_kpi_count: totalReEnrolled,
      retention_base_count: totalBase,
      re_enrollment_rate: roundRate(totalReEnrolled, totalBase),
    },
  };
}
