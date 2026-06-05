const countMonthMatrixStatusLabels = (students, monthKey) => {
  let newEnrolleesCount = 0;
  let reEnrollmentCount = 0;
  let upsellCount = 0;
  let reservedCount = 0;
  let droppedCount = 0;
  let rejoinCount = 0;

  for (const student of students) {
    const cell = student.months?.[monthKey];
    if (!cell?.label) continue;

    switch (cell.label) {
      case 'new':
        newEnrolleesCount += 1;
        break;
      case 're-enrolled':
        reEnrollmentCount += 1;
        break;
      case 'upsell':
        upsellCount += 1;
        break;
      case 'reserved':
        reservedCount += 1;
        break;
      case 'dropped/unenrolled':
        droppedCount += 1;
        break;
      case 'rejoin':
        rejoinCount += 1;
        break;
      default:
        break;
    }
  }

  return { newEnrolleesCount, reEnrollmentCount, upsellCount, reservedCount, droppedCount, rejoinCount };
};

const countPhaseMatrixStatusLabels = (students, phaseKey) => {
  let newEnrolleesCount = 0;
  let reEnrollmentCount = 0;
  let upsellCount = 0;
  let reservedCount = 0;
  let droppedCount = 0;
  let rejoinCount = 0;

  for (const student of students) {
    const cell = student.phases?.[phaseKey];
    if (!cell?.label) continue;

    switch (cell.label) {
      case 'new':
        newEnrolleesCount += 1;
        break;
      case 're-enrolled':
        reEnrollmentCount += 1;
        break;
      case 'upsell':
        upsellCount += 1;
        break;
      case 'reserved':
        reservedCount += 1;
        break;
      case 'dropped/unenrolled':
        droppedCount += 1;
        break;
      case 'rejoin':
        rejoinCount += 1;
        break;
      default:
        break;
    }
  }

  return { newEnrolleesCount, reEnrollmentCount, upsellCount, reservedCount, droppedCount, rejoinCount };
};

/** Distinct student_id values in a month or phase matrix (deduped across class tracks). */
export function countUniqueMatrixStudents(matrix) {
  const students = matrix?.students ?? [];
  return new Set(students.map((row) => row.student_id).filter((id) => id != null)).size;
}

/** Row count and unique students shown in the re-enrollment matrix table. */
export function matrixCohortStats(matrix) {
  const students = matrix?.students ?? [];
  return {
    trackCount: Number(matrix?.cohort_size) || students.length,
    uniqueStudentCount: countUniqueMatrixStudents(matrix),
  };
}

const emptyMatrixKpiTotals = () => ({
  new_enrollees_count: 0,
  re_enrollment_count: 0,
  upsell_count: 0,
  reserved_count: 0,
  dropped_count: 0,
  rejoin_count: 0,
});

const matrixKpiTotalsFromApi = (apiTotals) => ({
  new_enrollees_count: Number(apiTotals?.new_enrollees_count) || 0,
  re_enrollment_count: Number(apiTotals?.re_enrollment_count) || 0,
  upsell_count: Number(apiTotals?.upsell_count) || 0,
  reserved_count: Number(apiTotals?.reserved_count) || 0,
  dropped_count: Number(apiTotals?.dropped_count) || 0,
  rejoin_count: Number(apiTotals?.rejoin_count) || 0,
});

/**
 * KPI totals from visible month matrix cells (same labels shown in the table).
 * Always derived from matrix.students — not separate SQL snapshots.
 */
export function aggregateMonthMatrixKpiTotals(matrix) {
  const students = matrix?.students ?? [];
  const months = matrix?.months ?? [];
  if (!students.length || !months.length) {
    return matrix?.kpi_totals ? matrixKpiTotalsFromApi(matrix.kpi_totals) : emptyMatrixKpiTotals();
  }

  const totals = emptyMatrixKpiTotals();

  for (const month of months) {
    const counts = countMonthMatrixStatusLabels(students, month.key);
    totals.new_enrollees_count += counts.newEnrolleesCount;
    totals.re_enrollment_count += counts.reEnrollmentCount;
    totals.upsell_count += counts.upsellCount;
    totals.reserved_count += counts.reservedCount;
    totals.dropped_count += counts.droppedCount;
    totals.rejoin_count += counts.rejoinCount;
  }

  return totals;
}

/**
 * KPI totals from visible phase matrix cells (same labels shown in the table).
 * Always derived from matrix.students — not separate SQL snapshots.
 */
export function aggregatePhaseMatrixKpiTotals(matrix) {
  const students = matrix?.students ?? [];
  const phases = matrix?.phases ?? [];
  if (!students.length || !phases.length) {
    return matrix?.kpi_totals ? matrixKpiTotalsFromApi(matrix.kpi_totals) : emptyMatrixKpiTotals();
  }

  const totals = emptyMatrixKpiTotals();

  for (const phase of phases) {
    const counts = countPhaseMatrixStatusLabels(students, phase.key);
    totals.new_enrollees_count += counts.newEnrolleesCount;
    totals.re_enrollment_count += counts.reEnrollmentCount;
    totals.upsell_count += counts.upsellCount;
    totals.reserved_count += counts.reservedCount;
    totals.dropped_count += counts.droppedCount;
    totals.rejoin_count += counts.rejoinCount;
  }

  return totals;
}

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
 * per month, all "re-enrolled" labeled cells ÷ students enrolled in prior month.
 * Combined rate = sum(re-enrolled cells) / sum(prior-month enrolled), not an average of monthly %.
 */
const priorEnrolledCountFromRow = (row) =>
  Number(row.prior_month_enrolled_count ?? row.prior_phase_enrolled_count ?? 0);

const hasPriorPeriod = (row) => Boolean(row.has_prior_month || row.has_prior_phase);

/** Rows that show a fraction in the matrix rate header (prior period enrolled > 0). */
export function matrixRateRowsWithFraction(statsRows = []) {
  return statsRows.filter(
    (row) => hasPriorPeriod(row) && priorEnrolledCountFromRow(row) > 0
  );
}

/** Sum of every monthly/phase rate numerator (all re-enrolled cells per period). */
export function sumMonthStatsReEnrolledNumerators(statsRows = []) {
  return (statsRows || []).reduce(
    (sum, row) => sum + Number(row.re_enrolled_count || 0),
    0
  );
}

/** Sum of rate-header denominators (prior-month/phase enrolled where a fraction is shown). */
export function sumMonthStatsRetentionBase(statsRows = []) {
  return matrixRateRowsWithFraction(statsRows).reduce(
    (sum, row) => sum + priorEnrolledCountFromRow(row),
    0
  );
}

/** @deprecated alias — use sumMonthStatsReEnrolledNumerators */
export function sumMatrixRateNumerators(statsRows = []) {
  return sumMonthStatsReEnrolledNumerators(statsRows);
}

/**
 * Combined re-enrollment rate from monthly or phase matrix stats rows.
 * @param {object} [matrixTotals] — optional API totals (`re_enrollment_count`, `total_re_enrolled_count`, `total_prior_*`)
 */
export function reEnrollmentRateFromMatrixStats(statsRows = [], matrixTotals = null) {
  const rowsWithPrior = matrixRateRowsWithFraction(statsRows);
  const summedNumerators = sumMonthStatsReEnrolledNumerators(statsRows);
  const summedDenominators = rowsWithPrior.reduce(
    (sum, row) => sum + priorEnrolledCountFromRow(row),
    0
  );

  const reEnrolledCount =
    summedNumerators > 0
      ? summedNumerators
      : matrixTotals?.total_re_enrolled_count != null
        ? Number(matrixTotals.total_re_enrolled_count)
        : Number(matrixTotals?.re_enrollment_count || 0);

  const priorEnrolledCount =
    matrixTotals?.total_prior_month_enrolled_count != null
      ? Number(matrixTotals.total_prior_month_enrolled_count)
      : matrixTotals?.total_prior_phase_enrolled_count != null
        ? Number(matrixTotals.total_prior_phase_enrolled_count)
        : summedDenominators;

  const reEnrollmentRate =
    priorEnrolledCount > 0
      ? Number(((reEnrolledCount / priorEnrolledCount) * 100).toFixed(2))
      : Number(matrixTotals?.total_re_enrollment_rate ?? 0);

  return {
    reEnrolledCount,
    priorMonthEnrolledCount: priorEnrolledCount,
    priorEnrolledCount,
    reEnrollmentRate,
    summedNumerators,
    summedDenominators,
  };
}
