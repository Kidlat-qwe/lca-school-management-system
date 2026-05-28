/**
 * Phase matrix: per-row rate = enrolled in phase / cohort × 100;
 * combined rate = sum(numerators) / cohort × 100 (do not sum denominators).
 */
export function enrollmentRateFromMatrixStats(statsRows = []) {
  const enrolledCount = statsRows.reduce((sum, row) => sum + Number(row.enrolled_count || 0), 0);
  const cohortSize = Number(statsRows[0]?.student_count || 0);
  const enrollmentRate =
    cohortSize > 0 ? Number(((enrolledCount / cohortSize) * 100).toFixed(2)) : 0;
  return { enrolledCount, cohortSize, enrollmentRate };
}

/**
 * Monthly matrix re-enrollment (matches backend computeReEnrollmentMonthStats):
 * per month, retained from prior month ÷ enrolled in prior month.
 * First-time ("new") and gap-return months are excluded by the API.
 * Combined rate = sum(retained) / sum(prior-month enrolled), not an average of monthly %.
 */
const priorEnrolledCountFromRow = (row) =>
  Number(row.prior_month_enrolled_count ?? row.prior_phase_enrolled_count ?? 0);

const hasPriorPeriod = (row) => Boolean(row.has_prior_month || row.has_prior_phase);

/**
 * Combined re-enrollment rate from monthly or phase matrix stats rows.
 */
export function reEnrollmentRateFromMatrixStats(statsRows = []) {
  const rowsWithPrior = statsRows.filter(
    (row) => hasPriorPeriod(row) && priorEnrolledCountFromRow(row) > 0
  );
  const reEnrolledCount = rowsWithPrior.reduce(
    (sum, row) => sum + Number(row.re_enrolled_count || 0),
    0
  );
  const priorEnrolledCount = rowsWithPrior.reduce(
    (sum, row) => sum + priorEnrolledCountFromRow(row),
    0
  );
  const reEnrollmentRate =
    priorEnrolledCount > 0
      ? Number(((reEnrolledCount / priorEnrolledCount) * 100).toFixed(2))
      : 0;
  return {
    reEnrolledCount,
    priorMonthEnrolledCount: priorEnrolledCount,
    priorEnrolledCount,
    reEnrollmentRate,
  };
}
