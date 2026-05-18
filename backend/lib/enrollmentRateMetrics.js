/**
 * Enrollment rate by phase and enrollment dashboard snapshot metrics.
 * Used by GET /dashboard/enrollment and daily/monthly operational dashboards.
 */

const ENROLLED_STATUSES = "('new', 're_enrolled', 'upsell', 'rejoin', 'completed')";

/**
 * @param {import('pg').QueryResult['rows']} rows
 */
export const summarizeEnrollmentRateByPhase = (rows) => {
  const byPhase = (rows || []).map((row) => ({
    phase_number: parseInt(row.phase_number, 10) || 0,
    enrolled_count: parseInt(row.enrolled_count, 10) || 0,
    student_count: parseInt(row.student_count, 10) || 0,
    enrollment_rate: Number(row.enrollment_rate) || 0,
  }));
  const enrolledCount = byPhase.reduce((sum, row) => sum + row.enrolled_count, 0);
  const studentCount = byPhase.reduce((sum, row) => sum + row.student_count, 0);
  const enrollmentRate = studentCount > 0
    ? Number(((enrolledCount / studentCount) * 100).toFixed(2))
    : 0;
  const phaseNumbers = byPhase.map((row) => row.phase_number).filter((n) => n > 0);
  const phaseFrom = phaseNumbers.length > 0 ? Math.min(...phaseNumbers) : null;
  const phaseTo = phaseNumbers.length > 0 ? Math.max(...phaseNumbers) : null;
  const phasesSummaryLabel = phaseFrom != null && phaseTo != null
    ? (phaseFrom === phaseTo ? `Phase ${phaseFrom}` : `Phases ${phaseFrom}–${phaseTo}`)
    : 'Phases 1–10';

  return {
    by_phase: byPhase,
    enrolled_count: enrolledCount,
    student_count: studentCount,
    enrollment_rate: enrollmentRate,
    phases_summary_label: phasesSummaryLabel,
    phase_from: phaseFrom,
    phase_to: phaseTo,
    phases_count: phaseNumbers.length,
  };
};

/**
 * @param {Function} queryFn - database query function
 * @param {{ branchId?: number|null, curriculumId?: number|null, enrolledOnDate?: string|null, enrolledFrom?: string|null, enrolledTo?: string|null }} options
 */
export const loadEnrollmentRateByPhase = async (queryFn, options = {}) => {
  const { branchId = null, curriculumId = null, enrolledOnDate = null, enrolledFrom = null, enrolledTo = null } = options;

  const params = [];
  let paramIdx = 1;
  let branchJoin = '';
  if (branchId) {
    branchJoin = `AND c.branch_id = $${paramIdx}`;
    params.push(branchId);
    paramIdx += 1;
  }
  let curriculumJoin = '';
  if (curriculumId) {
    curriculumJoin = `INNER JOIN programstbl p ON c.program_id = p.program_id AND p.curriculum_id = $${paramIdx}`;
    params.push(curriculumId);
    paramIdx += 1;
  }
  let dateFilter = '';
  if (enrolledOnDate) {
    dateFilter = `
      AND cs.enrolled_at IS NOT NULL
      AND TIMEZONE('Asia/Manila', cs.enrolled_at)::date = $${paramIdx}::date`;
    params.push(enrolledOnDate);
    paramIdx += 1;
  } else if (enrolledFrom && enrolledTo) {
    dateFilter = `
      AND cs.enrolled_at IS NOT NULL
      AND TIMEZONE('Asia/Manila', cs.enrolled_at)::date >= $${paramIdx}::date
      AND TIMEZONE('Asia/Manila', cs.enrolled_at)::date < $${paramIdx + 1}::date`;
    params.push(enrolledFrom, enrolledTo);
    paramIdx += 2;
  }

  const result = await queryFn(
    `
      WITH scoped_rows AS (
        SELECT
          cs.student_id,
          COALESCE(cs.phase_number, 0) AS phase_number,
          cs.program_enrollment_status,
          cs.removed_at
        FROM classstudentstbl cs
        INNER JOIN classestbl c ON cs.class_id = c.class_id ${branchJoin}
        ${curriculumJoin}
        WHERE COALESCE(cs.phase_number, 0) > 0
          AND COALESCE(cs.enrolled_by, '') NOT ILIKE '%Rejoin gap marker%'
          ${dateFilter}
      ),
      phase_student AS (
        SELECT
          student_id,
          phase_number,
          BOOL_OR(
            program_enrollment_status IN ${ENROLLED_STATUSES}
            AND removed_at IS NULL
          ) AS is_enrolled
        FROM scoped_rows
        GROUP BY student_id, phase_number
      ),
      phase_agg AS (
        SELECT
          phase_number,
          COUNT(*)::bigint AS student_count,
          COUNT(*) FILTER (WHERE is_enrolled)::bigint AS enrolled_count
        FROM phase_student
        GROUP BY phase_number
      )
      SELECT
        phase_number,
        enrolled_count,
        student_count,
        CASE
          WHEN student_count > 0
          THEN ROUND((enrolled_count::numeric / student_count::numeric) * 100, 2)
          ELSE 0
        END AS enrollment_rate
      FROM phase_agg
      ORDER BY phase_number ASC
    `,
    params
  );

  return summarizeEnrollmentRateByPhase(result.rows);
};

/**
 * Active/inactive from student_statustbl; reserved from program_enrollment_status snapshot.
 * @param {Function} queryFn
 * @param {{ branchId?: number|null }} options
 */
export const loadEnrollmentStatusSnapshot = async (queryFn, options = {}) => {
  const { branchId = null } = options;
  const branchParams = branchId ? [branchId] : [];
  const statusBranchJoin = branchId ? 'AND u.branch_id = $1' : '';
  const classBranchJoin = branchId ? 'AND c.branch_id = $1' : '';

  const [statusResult, reservedResult] = await Promise.all([
    queryFn(
      `
        SELECT
          COUNT(DISTINCT ss.student_id) AS total_students,
          COUNT(DISTINCT CASE WHEN ss.status = 'active' THEN ss.student_id END) AS active_students,
          COUNT(DISTINCT CASE WHEN ss.status = 'inactive' THEN ss.student_id END) AS inactive_students
        FROM student_statustbl ss
        INNER JOIN userstbl u ON u.user_id = ss.student_id AND u.user_type = 'Student'
        WHERE 1 = 1 ${statusBranchJoin}
      `,
      branchParams
    ),
    queryFn(
      `
        SELECT COUNT(DISTINCT cs.student_id)::bigint AS reserved_students_count
        FROM classstudentstbl cs
        INNER JOIN classestbl c ON cs.class_id = c.class_id ${classBranchJoin}
        WHERE cs.program_enrollment_status = 'reserved'
          AND cs.removed_at IS NULL
      `,
      branchParams
    ),
  ]);

  return {
    active_students: parseInt(statusResult.rows[0]?.active_students, 10) || 0,
    inactive_students: parseInt(statusResult.rows[0]?.inactive_students, 10) || 0,
    total_students: parseInt(statusResult.rows[0]?.total_students, 10) || 0,
    reserved_students_count: parseInt(reservedResult.rows[0]?.reserved_students_count, 10) || 0,
  };
};

/**
 * @param {Function} queryFn
 * @param {{ branchId?: number|null, enrolledOnDate?: string|null, enrolledFrom?: string|null, enrolledTo?: string|null }} options
 */
export const loadEnrollmentDashboardMetrics = async (queryFn, options = {}) => {
  const { branchId = null, enrolledOnDate = null, enrolledFrom = null, enrolledTo = null } = options;
  const [statusSnapshot, rateSummary] = await Promise.all([
    loadEnrollmentStatusSnapshot(queryFn, { branchId }),
    loadEnrollmentRateByPhase(queryFn, { branchId, enrolledOnDate, enrolledFrom, enrolledTo }),
  ]);

  return {
    ...statusSnapshot,
    enrollment_rate: rateSummary.enrollment_rate,
    enrollment_rate_enrolled_count: rateSummary.enrolled_count,
    enrollment_rate_student_count: rateSummary.student_count,
    enrollment_rate_phases_summary_label: rateSummary.phases_summary_label,
    enrollment_rate_by_phase: rateSummary.by_phase,
  };
};
