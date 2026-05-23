/**
 * Enrollment rate by phase and enrollment dashboard snapshot metrics.
 * Used by GET /dashboard/enrollment and daily/monthly operational dashboards.
 */

const ENROLLED_STATUSES = "('new', 're_enrolled', 'upsell', 'rejoin', 'completed')";
const ACTIVE_PROGRAM_STATUSES = "('new', 're_enrolled', 'upsell', 'rejoin')";

const buildMonthEnrolledAtFilter = (paramFromIdx, paramToIdx) => `
  AND cs.enrolled_at IS NOT NULL
  AND TIMEZONE('Asia/Manila', cs.enrolled_at)::date >= $${paramFromIdx}::date
  AND TIMEZONE('Asia/Manila', cs.enrolled_at)::date < $${paramToIdx}::date`;

/** Matches student_statustbl drop-blocking rule (migration 115). */
const DROP_BLOCKED_STUDENT_SQL = `
  SELECT DISTINCT cs.student_id
  FROM classstudentstbl cs
  WHERE cs.program_enrollment_status = 'dropped'
    AND NOT EXISTS (
      SELECT 1
      FROM classstudentstbl active_after_drop
      WHERE active_after_drop.student_id = cs.student_id
        AND active_after_drop.program_enrollment_status IN ${ACTIVE_PROGRAM_STATUSES}
        AND active_after_drop.removed_at IS NULL
        AND active_after_drop.enrolled_at > COALESCE(cs.removed_at, cs.enrolled_at)
    )`;

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
 * Active/inactive for Enrollment Dashboard month picker: distinct students with enrolled_at in range.
 * Active = has a month enrollment row in ACTIVE_PROGRAM_STATUSES with removed_at IS NULL, and not drop-blocked.
 * @param {Function} queryFn
 * @param {{ branchId?: number|null, enrolledFrom: string, enrolledTo: string }} options
 */
export const loadEnrollmentStatusSnapshotForMonth = async (queryFn, options = {}) => {
  const { branchId = null, enrolledFrom, enrolledTo } = options;
  const params = [];
  let paramIdx = 1;
  let branchJoin = '';
  if (branchId) {
    branchJoin = `AND c.branch_id = $${paramIdx}`;
    params.push(branchId);
    paramIdx += 1;
  }
  const fromIdx = paramIdx;
  const toIdx = paramIdx + 1;
  params.push(enrolledFrom, enrolledTo);

  const result = await queryFn(
    `
      WITH month_enrollments AS (
        SELECT
          cs.student_id,
          cs.program_enrollment_status,
          cs.removed_at
        FROM classstudentstbl cs
        INNER JOIN classestbl c ON cs.class_id = c.class_id
        INNER JOIN userstbl u ON u.user_id = cs.student_id AND u.user_type = 'Student'
        WHERE 1 = 1
          ${branchJoin}
          ${buildMonthEnrolledAtFilter(fromIdx, toIdx)}
      ),
      student_month_status AS (
        SELECT
          me.student_id,
          BOOL_OR(
            me.program_enrollment_status IN ${ACTIVE_PROGRAM_STATUSES}
            AND me.removed_at IS NULL
          ) AS has_active_enrollment_in_month
        FROM month_enrollments me
        GROUP BY me.student_id
      ),
      drop_blocked AS (
        ${DROP_BLOCKED_STUDENT_SQL}
      )
      SELECT
        COUNT(DISTINCT sms.student_id)::bigint AS total_students,
        COUNT(DISTINCT CASE
          WHEN sms.has_active_enrollment_in_month AND db.student_id IS NULL
          THEN sms.student_id
        END)::bigint AS active_students,
        COUNT(DISTINCT CASE
          WHEN NOT sms.has_active_enrollment_in_month OR db.student_id IS NOT NULL
          THEN sms.student_id
        END)::bigint AS inactive_students
      FROM student_month_status sms
      LEFT JOIN drop_blocked db ON db.student_id = sms.student_id
    `,
    params
  );

  const row = result.rows[0] || {};
  return {
    active_students: parseInt(row.active_students, 10) || 0,
    inactive_students: parseInt(row.inactive_students, 10) || 0,
    total_students: parseInt(row.total_students, 10) || 0,
  };
};

/**
 * Active/inactive by branch for selected month (enrolled_at, Manila).
 * @param {Function} queryFn
 * @param {{ enrolledFrom: string, enrolledTo: string }} options
 */
export const loadActiveInactiveByBranchForMonth = async (queryFn, options = {}) => {
  const { enrolledFrom, enrolledTo } = options;
  const result = await queryFn(
    `
      WITH month_enrollments AS (
        SELECT
          cs.student_id,
          c.branch_id,
          cs.program_enrollment_status,
          cs.removed_at
        FROM classstudentstbl cs
        INNER JOIN classestbl c ON cs.class_id = c.class_id
        INNER JOIN userstbl u ON u.user_id = cs.student_id AND u.user_type = 'Student'
        WHERE cs.enrolled_at IS NOT NULL
          ${buildMonthEnrolledAtFilter(1, 2)}
      ),
      student_branch_month AS (
        SELECT
          me.student_id,
          me.branch_id,
          BOOL_OR(
            me.program_enrollment_status IN ${ACTIVE_PROGRAM_STATUSES}
            AND me.removed_at IS NULL
          ) AS has_active_enrollment_in_month
        FROM month_enrollments me
        GROUP BY me.student_id, me.branch_id
      ),
      drop_blocked AS (
        ${DROP_BLOCKED_STUDENT_SQL}
      )
      SELECT
        b.branch_id,
        COALESCE(b.branch_nickname, b.branch_name) AS branch_name,
        COUNT(DISTINCT sbm.student_id)::bigint AS total,
        COUNT(DISTINCT CASE
          WHEN sbm.has_active_enrollment_in_month AND db.student_id IS NULL
          THEN sbm.student_id
        END)::bigint AS active_count,
        COUNT(DISTINCT CASE
          WHEN NOT sbm.has_active_enrollment_in_month OR db.student_id IS NOT NULL
          THEN sbm.student_id
        END)::bigint AS inactive_count
      FROM branchestbl b
      LEFT JOIN student_branch_month sbm ON sbm.branch_id = b.branch_id
      LEFT JOIN drop_blocked db ON db.student_id = sbm.student_id
      GROUP BY b.branch_id, b.branch_nickname, b.branch_name
      ORDER BY COALESCE(b.branch_nickname, b.branch_name)
    `,
    [enrolledFrom, enrolledTo]
  );

  return (result.rows || []).map((row) => ({
    branch_id: row.branch_id,
    branch_name: row.branch_name || 'Unassigned',
    total: parseInt(row.total, 10) || 0,
    active: parseInt(row.active_count, 10) || 0,
    inactive: parseInt(row.inactive_count, 10) || 0,
  }));
};

/**
 * Shared scope filters for enrollment-rate queries (matches dashboard phase table).
 * @returns {{ branchJoin: string, curriculumJoin: string, dateFilter: string, params: unknown[], nextIdx: number }}
 */
const buildEnrollmentRateScopeParts = (options = {}) => {
  const { branchId = null, curriculumId = null, enrolledOnDate = null, enrolledFrom = null, enrolledTo = null } =
    options;
  const params = [];
  let idx = 1;
  let branchJoin = '';
  let curriculumJoin = '';
  let dateFilter = '';

  if (branchId) {
    branchJoin = `AND c.branch_id = $${idx}`;
    params.push(branchId);
    idx += 1;
  }
  if (curriculumId) {
    curriculumJoin = `INNER JOIN programstbl p ON c.program_id = p.program_id AND p.curriculum_id = $${idx}`;
    params.push(curriculumId);
    idx += 1;
  }
  if (enrolledOnDate) {
    dateFilter = `
      AND cs.enrolled_at IS NOT NULL
      AND TIMEZONE('Asia/Manila', cs.enrolled_at)::date = $${idx}::date`;
    params.push(enrolledOnDate);
    idx += 1;
  } else if (enrolledFrom && enrolledTo) {
    dateFilter = `
      AND cs.enrolled_at IS NOT NULL
      AND TIMEZONE('Asia/Manila', cs.enrolled_at)::date >= $${idx}::date
      AND TIMEZONE('Asia/Manila', cs.enrolled_at)::date < $${idx + 1}::date`;
    params.push(enrolledFrom, enrolledTo);
    idx += 2;
  }

  return { branchJoin, curriculumJoin, dateFilter, params, nextIdx: idx };
};

const enrollmentRatePhaseStudentsSql = (scope, phaseFilterSql = '') => `
  WITH scoped_rows AS (
    SELECT
      cs.student_id,
      COALESCE(cs.phase_number, 0) AS phase_number,
      cs.program_enrollment_status,
      cs.removed_at,
      cs.enrolled_at,
      COALESCE(c.class_name, '') AS class_name,
      c.branch_id AS class_branch_id
    FROM classstudentstbl cs
    INNER JOIN classestbl c ON cs.class_id = c.class_id ${scope.branchJoin}
    ${scope.curriculumJoin}
    WHERE COALESCE(cs.phase_number, 0) > 0
      AND COALESCE(cs.enrolled_by, '') NOT ILIKE '%Rejoin gap marker%'
      ${scope.dateFilter}
  ),
  phase_student AS (
    SELECT
      student_id,
      phase_number,
      BOOL_OR(
        program_enrollment_status IN ${ENROLLED_STATUSES}
        AND removed_at IS NULL
      ) AS is_enrolled,
      STRING_AGG(DISTINCT program_enrollment_status, ', ' ORDER BY program_enrollment_status) AS statuses_seen,
      STRING_AGG(DISTINCT NULLIF(class_name, ''), ', ' ORDER BY NULLIF(class_name, '')) AS class_names,
      MAX(enrolled_at) AS enrolled_at,
      MAX(removed_at) AS removed_at
    FROM scoped_rows
    GROUP BY student_id, phase_number
  )
  SELECT
    ps.student_id,
    ps.phase_number,
    ps.is_enrolled,
    ps.statuses_seen,
    ps.class_names,
    TO_CHAR(TIMEZONE('Asia/Manila', ps.enrolled_at), 'YYYY-MM-DD HH24:MI:SS') AS enrolled_at_manila,
    TO_CHAR(TIMEZONE('Asia/Manila', ps.removed_at), 'YYYY-MM-DD HH24:MI:SS') AS removed_at_manila,
    u.full_name,
    u.email,
    u.level_tag,
    COALESCE(b.branch_nickname, b.branch_name) AS branch_name
  FROM phase_student ps
  INNER JOIN userstbl u ON u.user_id = ps.student_id
  LEFT JOIN branchestbl b ON b.branch_id = u.branch_id
  WHERE 1=1
    ${phaseFilterSql}
  ORDER BY ps.is_enrolled DESC, u.full_name ASC NULLS LAST, ps.student_id ASC
`;

/**
 * Student list behind enrollment-rate-by-phase (for human verification).
 * @param {Function} queryFn
 * @param {{ branchId?: number|null, curriculumId?: number|null, enrolledOnDate?: string|null, enrolledFrom?: string|null, enrolledTo?: string|null, phaseNumber: number }} options
 */
export const loadEnrollmentRatePhaseStudents = async (queryFn, options = {}) => {
  const {
    branchId = null,
    curriculumId = null,
    enrolledOnDate = null,
    enrolledFrom = null,
    enrolledTo = null,
    phaseNumber,
  } = options;

  const scope = buildEnrollmentRateScopeParts({
    branchId,
    curriculumId,
    enrolledOnDate,
    enrolledFrom,
    enrolledTo,
  });
  const params = [...scope.params];
  const phaseNum = parseInt(phaseNumber, 10);
  if (!Number.isFinite(phaseNum) || phaseNum <= 0) {
    return { students: [], summary: { phase_number: phaseNum, enrolled_count: 0, student_count: 0 } };
  }
  params.push(phaseNum);
  const phaseFilterSql = `AND ps.phase_number = $${scope.nextIdx}`;

  const result = await queryFn(enrollmentRatePhaseStudentsSql(scope, phaseFilterSql), params);
  const students = (result.rows || []).map((row) => ({
    student_id: parseInt(row.student_id, 10) || 0,
    phase_number: parseInt(row.phase_number, 10) || 0,
    is_enrolled: Boolean(row.is_enrolled),
    statuses_seen: row.statuses_seen || '',
    class_names: row.class_names || '',
    enrolled_at_manila: row.enrolled_at_manila || null,
    removed_at_manila: row.removed_at_manila || null,
    full_name: row.full_name || '',
    email: row.email || '',
    level_tag: row.level_tag || '',
    branch_name: row.branch_name || '',
  }));

  const enrolledCount = students.filter((s) => s.is_enrolled).length;
  return {
    students,
    summary: {
      phase_number: phaseNum,
      enrolled_count: enrolledCount,
      student_count: students.length,
    },
  };
};

/**
 * All phases — export rows for spreadsheet verification.
 */
export const loadEnrollmentRatePhaseStudentsExport = async (queryFn, options = {}) => {
  const { branchId = null, curriculumId = null, enrolledOnDate = null, enrolledFrom = null, enrolledTo = null } =
    options;
  const scope = buildEnrollmentRateScopeParts({
    branchId,
    curriculumId,
    enrolledOnDate,
    enrolledFrom,
    enrolledTo,
  });
  const result = await queryFn(enrollmentRatePhaseStudentsSql(scope, ''), scope.params);
  return (result.rows || []).map((row) => ({
    phase_number: parseInt(row.phase_number, 10) || 0,
    student_id: parseInt(row.student_id, 10) || 0,
    full_name: row.full_name || '',
    email: row.email || '',
    level_tag: row.level_tag || '',
    branch_name: row.branch_name || '',
    class_names: row.class_names || '',
    statuses_seen: row.statuses_seen || '',
    counts_toward_enrolled: Boolean(row.is_enrolled) ? 'Y' : 'N',
    enrolled_at_manila: row.enrolled_at_manila || '',
    removed_at_manila: row.removed_at_manila || '',
  }));
};

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
