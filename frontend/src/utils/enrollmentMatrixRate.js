import {
  MATRIX_CELL_LABEL,
  normalizeMatrixCellLabel,
} from './enrollmentMatrixLabels';

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

    switch (normalizeMatrixCellLabel(cell.label)) {
      case MATRIX_CELL_LABEL.NEW:
        newEnrolleesCount += 1;
        break;
      case MATRIX_CELL_LABEL.RE_ENROLLED:
        reEnrollmentCount += 1;
        break;
      case 'upsell':
        upsellCount += 1;
        break;
      case 'reserved':
        reservedCount += 1;
        break;
      case MATRIX_CELL_LABEL.DROPPED:
        droppedCount += 1;
        break;
      case MATRIX_CELL_LABEL.REJOIN:
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

    switch (normalizeMatrixCellLabel(cell.label)) {
      case MATRIX_CELL_LABEL.NEW:
        newEnrolleesCount += 1;
        break;
      case MATRIX_CELL_LABEL.RE_ENROLLED:
        reEnrollmentCount += 1;
        break;
      case 'upsell':
        upsellCount += 1;
        break;
      case 'reserved':
        reservedCount += 1;
        break;
      case MATRIX_CELL_LABEL.DROPPED:
        droppedCount += 1;
        break;
      case MATRIX_CELL_LABEL.REJOIN:
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
 * Month keys from January through the current Manila month for the selected year.
 * Past calendar years include all months in the matrix; future years include none past today.
 */
export function getYearToDateMonthKeys(matrix, displayYear, currentMonthKey) {
  const months = matrix?.months ?? [];
  const year = String(displayYear);
  const currentYear = String(currentMonthKey).slice(0, 4);
  const currentMonthNum = parseInt(String(currentMonthKey).slice(5, 7), 10);

  return months
    .filter((m) => {
      if (!m.key?.startsWith(`${year}-`)) return false;
      const monthNum = parseInt(m.key.slice(5, 7), 10);
      if (year === currentYear) {
        return monthNum <= currentMonthNum;
      }
      if (parseInt(year, 10) < parseInt(currentYear, 10)) {
        return true;
      }
      return monthNum <= currentMonthNum;
    })
    .map((m) => m.key);
}

export function filterMonthStatsByKeys(statsRows = [], monthKeys = []) {
  const keySet = new Set(monthKeys);
  return (statsRows || []).filter((row) => keySet.has(row.month_key));
}

/** KPI totals summed across multiple billing-month columns. */
export function aggregateMonthMatrixKpiTotalsForMonthKeys(matrix, monthKeys) {
  if (!matrix || !monthKeys?.length) {
    return emptyMatrixKpiTotals();
  }
  const totals = emptyMatrixKpiTotals();
  for (const monthKey of monthKeys) {
    const monthTotals = aggregateMonthMatrixKpiTotalsForMonth(matrix, monthKey);
    totals.new_enrollees_count += monthTotals.new_enrollees_count;
    totals.re_enrollment_count += monthTotals.re_enrollment_count;
    totals.upsell_count += monthTotals.upsell_count;
    totals.reserved_count += monthTotals.reserved_count;
    totals.dropped_count += monthTotals.dropped_count;
    totals.rejoin_count += monthTotals.rejoin_count;
  }
  return totals;
}

/** Distinct students with a labeled cell in any of the given billing months. */
export function countUniqueMatrixStudentsForMonthKeys(matrix, monthKeys) {
  if (!matrix || !monthKeys?.length) return 0;
  const ids = new Set();
  for (const monthKey of monthKeys) {
    for (const student of matrix.students ?? []) {
      if (student.months?.[monthKey]?.label) {
        ids.add(student.student_id);
      }
    }
  }
  return ids.size;
}

/** Combined re-enrollment rate for a subset of billing months (rate-header sums). */
export function reEnrollmentRateForMonthKeys(matrix, monthKeys) {
  const statsRows = filterMonthStatsByKeys(matrix?.month_stats ?? [], monthKeys);
  return reEnrollmentRateFromMatrixStats(statsRows, null);
}

/**
 * KPI totals for a single billing month column (same labels as the matrix table).
 */
export function aggregateMonthMatrixKpiTotalsForMonth(matrix, monthKey) {
  if (!matrix || !monthKey) {
    return emptyMatrixKpiTotals();
  }
  const students = matrix?.students ?? [];
  if (!students.length) {
    return emptyMatrixKpiTotals();
  }
  const counts = countMonthMatrixStatusLabels(students, monthKey);
  return {
    new_enrollees_count: counts.newEnrolleesCount,
    re_enrollment_count: counts.reEnrollmentCount,
    upsell_count: counts.upsellCount,
    reserved_count: counts.reservedCount,
    dropped_count: counts.droppedCount,
    rejoin_count: counts.rejoinCount,
  };
}

/** Distinct students with any labeled cell in one billing month column. */
export function countUniqueMatrixStudentsForMonth(matrix, monthKey) {
  if (!matrix || !monthKey) return 0;
  const ids = new Set();
  for (const student of matrix.students ?? []) {
    if (student.months?.[monthKey]?.label) {
      ids.add(student.student_id);
    }
  }
  return ids.size;
}

/**
 * Re-enrollment rate for one billing month (matches matrix rate header row for that column).
 */
export function reEnrollmentRateForMonth(matrix, monthKey) {
  if (!matrix || !monthKey) {
    return {
      reEnrolledCount: 0,
      priorEnrolledCount: 0,
      priorMonthEnrolledCount: 0,
      reEnrollmentRate: 0,
    };
  }
  const row = (matrix.month_stats ?? []).find((r) => r.month_key === monthKey);
  if (!row) {
    return {
      reEnrolledCount: 0,
      priorEnrolledCount: 0,
      priorMonthEnrolledCount: 0,
      reEnrollmentRate: 0,
    };
  }
  const reEnrolledCount = Number(row.re_enrolled_count) || 0;
  const priorEnrolledCount = Number(row.prior_month_enrolled_count) || 0;
  const reEnrollmentRate =
    priorEnrolledCount > 0
      ? Number(((reEnrolledCount / priorEnrolledCount) * 100).toFixed(2))
      : row.re_enrollment_rate != null
        ? Number(row.re_enrollment_rate)
        : 0;
  return {
    reEnrolledCount,
    priorEnrolledCount,
    priorMonthEnrolledCount: priorEnrolledCount,
    reEnrollmentRate,
  };
}

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
 * per month, Re-enrollment KPI cells for the prior-month cohort only ÷ students enrolled in prior month.
 * Combined rate = sum(cohort-aligned numerators) / sum(prior-month enrolled), not an average of monthly %.
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
