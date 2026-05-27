/**
 * Matrix rate helpers: per-row rate = numerator / cohort × 100;
 * combined rate = sum(numerators) / cohort × 100 (do not sum denominators).
 */
export function enrollmentRateFromMatrixStats(statsRows = []) {
  const enrolledCount = statsRows.reduce((sum, row) => sum + Number(row.enrolled_count || 0), 0);
  const cohortSize = Number(statsRows[0]?.student_count || 0);
  const enrollmentRate =
    cohortSize > 0 ? Number(((enrolledCount / cohortSize) * 100).toFixed(2)) : 0;
  return { enrolledCount, cohortSize, enrollmentRate };
}
