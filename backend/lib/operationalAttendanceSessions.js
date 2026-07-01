import { todayYmdManila } from '../utils/dateUtils.js';

const MAX_LIST_ROWS = 5000;

/**
 * Operational attendance uses the same session row class details opens:
 * one canonical classsession per (class, phase, phase_session_number),
 * chosen as the earliest scheduled_date — matching classSessions.find(...)
 * on the /classes/:id/sessions list sorted by date ascending.
 *
 * Attendance is "taken" only when that canonical session status is Completed,
 * same as the class attendance modal and phase attendance summary.
 */
function buildOperationalAttendanceScope(options = {}) {
  const {
    mode = 'daily',
    summaryDate,
    summaryMonth,
    branchId = null,
    teacherId = null,
    userType = null,
  } = options;

  const todayManila = todayYmdManila();
  let dateStart;
  let dateEnd;

  if (mode === 'monthly') {
    if (!summaryMonth || !/^\d{4}-\d{2}$/.test(summaryMonth)) {
      throw new Error('summary_month must be YYYY-MM for monthly mode');
    }
    const [year, month] = summaryMonth.split('-').map(Number);
    dateStart = `${summaryMonth}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const monthEnd = `${summaryMonth}-${String(lastDay).padStart(2, '0')}`;
    dateEnd = summaryMonth === todayManila.slice(0, 7) ? todayManila : monthEnd;
  } else {
    dateStart = summaryDate || todayManila;
    dateEnd = summaryDate || todayManila;
  }

  const params = [dateStart, dateEnd];
  let paramCount = 2;

  let branchClause = '';
  if (branchId) {
    paramCount += 1;
    branchClause = ` AND c.branch_id = $${paramCount}`;
    params.push(branchId);
  }

  let teacherClause = '';
  if (userType === 'Teacher' && teacherId) {
    paramCount += 1;
    teacherClause = ` AND (
      c.teacher_id = $${paramCount}
      OR cs.original_teacher_id = $${paramCount}
      OR cs.assigned_teacher_id = $${paramCount}
      OR cs.substitute_teacher_id = $${paramCount}
      OR EXISTS (
        SELECT 1 FROM classteacherstbl ct
        WHERE ct.class_id = c.class_id AND ct.teacher_id = $${paramCount}
      )
    )`;
    params.push(teacherId);
  }

  paramCount += 1;
  const todayParam = `$${paramCount}`;
  params.push(todayManila);

  const scopedSessionsCte = `
    enrolled_by_class_phase AS (
      SELECT
        cs_enroll.class_id,
        cs_enroll.phase_number,
        COUNT(DISTINCT cs_enroll.student_id)::int AS enrolled_count
      FROM classstudentstbl cs_enroll
      WHERE cs_enroll.phase_number IS NOT NULL
        AND cs_enroll.program_enrollment_status IN (
          'new', 're_enrolled', 'upsell', 'rejoin', 'completed'
        )
        AND cs_enroll.removed_at IS NULL
      GROUP BY cs_enroll.class_id, cs_enroll.phase_number
    ),
    all_class_sessions AS (
      SELECT
        cs.classsession_id,
        cs.class_id,
        cs.phase_number,
        cs.phase_session_number,
        cs.scheduled_date,
        cs.scheduled_start_time,
        cs.scheduled_end_time,
        cs.status,
        c.class_name,
        c.level_tag,
        p.program_name,
        COALESCE(b.branch_nickname, b.branch_name) AS branch_name,
        COALESCE(
          u_sub.full_name,
          u_assign.full_name,
          u_orig.full_name,
          u_primary.full_name
        ) AS teacher_name,
        ROW_NUMBER() OVER (
          PARTITION BY cs.class_id, cs.phase_number, cs.phase_session_number
          ORDER BY cs.scheduled_date ASC NULLS LAST, cs.classsession_id ASC
        ) AS slot_rank
      FROM classsessionstbl cs
      INNER JOIN classestbl c ON c.class_id = cs.class_id
      LEFT JOIN programstbl p ON p.program_id = c.program_id
      LEFT JOIN branchestbl b ON b.branch_id = c.branch_id
      LEFT JOIN userstbl u_primary ON c.teacher_id = u_primary.user_id
      LEFT JOIN userstbl u_orig ON cs.original_teacher_id = u_orig.user_id
      LEFT JOIN userstbl u_assign ON cs.assigned_teacher_id = u_assign.user_id
      LEFT JOIN userstbl u_sub ON cs.substitute_teacher_id = u_sub.user_id
      WHERE COALESCE(c.status, 'Active') = 'Active'
        ${branchClause}
        ${teacherClause}
    ),
    canonical_sessions AS (
      SELECT
        acs.classsession_id,
        acs.class_id,
        acs.phase_number,
        acs.phase_session_number,
        TO_CHAR(acs.scheduled_date, 'YYYY-MM-DD') AS scheduled_date,
        acs.scheduled_date AS scheduled_date_raw,
        acs.scheduled_start_time,
        acs.scheduled_end_time,
        acs.status,
        acs.class_name,
        acs.level_tag,
        acs.program_name,
        acs.branch_name,
        acs.teacher_name,
        COALESCE(e.enrolled_count, 0) AS enrolled_count,
        (
          SELECT COUNT(*)::int
          FROM attendancetbl a
          WHERE a.classsession_id = acs.classsession_id
        ) AS marked_count
      FROM all_class_sessions acs
      LEFT JOIN enrolled_by_class_phase e
        ON e.class_id = acs.class_id
       AND e.phase_number = acs.phase_number
      WHERE acs.slot_rank = 1
        AND acs.scheduled_date >= $1::date
        AND acs.scheduled_date <= $2::date
        AND COALESCE(acs.status, 'Scheduled') != 'Cancelled'
    ),
    derived_sessions AS (
      SELECT
        s.*,
        CASE
          WHEN COALESCE(s.status, 'Scheduled') = 'Completed' THEN 'completed'
          WHEN s.scheduled_date_raw > ${todayParam}::date THEN 'upcoming'
          WHEN s.scheduled_date_raw <= ${todayParam}::date
            AND COALESCE(s.status, 'Scheduled') NOT IN ('Cancelled', 'Completed')
            THEN 'pending'
          ELSE 'other'
        END AS attendance_status,
        (COALESCE(s.status, 'Scheduled') = 'Completed') AS is_taken
      FROM canonical_sessions s
    )
  `;

  return {
    mode,
    summaryDate,
    summaryMonth,
    dateStart,
    dateEnd,
    todayManila,
    params,
    scopedSessionsCte,
  };
}

function buildAttendanceFilterClause(attendanceFilter) {
  switch (attendanceFilter) {
    case 'pending':
      return ` AND d.attendance_status = 'pending' AND d.is_taken = false`;
    case 'taken':
      return ` AND d.is_taken = true`;
    case 'upcoming':
      return ` AND d.attendance_status = 'upcoming'`;
    default:
      return '';
  }
}

function buildOrderClause(attendanceFilter) {
  if (attendanceFilter === 'taken') {
    return `
      ORDER BY d.scheduled_date_raw DESC,
        d.scheduled_start_time ASC NULLS LAST,
        d.phase_number ASC,
        d.phase_session_number ASC
    `;
  }

  if (attendanceFilter === 'upcoming') {
    return `
      ORDER BY d.scheduled_date_raw ASC,
        d.scheduled_start_time ASC NULLS LAST,
        d.phase_number ASC,
        d.phase_session_number ASC
    `;
  }

  return `
    ORDER BY
      CASE
        WHEN d.is_taken THEN 2
        WHEN d.attendance_status = 'upcoming' THEN 1
        ELSE 0
      END,
      d.scheduled_date_raw DESC,
      d.scheduled_start_time ASC NULLS LAST,
      d.phase_number ASC,
      d.phase_session_number ASC
  `;
}

async function loadOperationalAttendanceSummary(queryFn, scope) {
  const summarySql = `
    WITH ${scope.scopedSessionsCte}
    SELECT
      COUNT(*)::int AS total_count,
      COUNT(*) FILTER (
        WHERE d.attendance_status = 'pending' AND d.is_taken = false
      )::int AS pending_count,
      COUNT(*) FILTER (WHERE d.is_taken)::int AS taken_count,
      COUNT(*) FILTER (WHERE d.attendance_status = 'completed')::int AS completed_count,
      COUNT(*) FILTER (WHERE d.attendance_status = 'upcoming')::int AS upcoming_count
    FROM derived_sessions d
  `;

  const result = await queryFn(summarySql, scope.params);
  return result.rows[0] || {
    total_count: 0,
    pending_count: 0,
    taken_count: 0,
    completed_count: 0,
    upcoming_count: 0,
  };
}

/**
 * List class sessions for operational dashboard attendance shortcuts.
 * Summary counts cover the full period; list rows are optionally filtered and capped.
 */
export async function loadOperationalAttendanceSessions(queryFn, options = {}) {
  const {
    attendanceFilter = 'all',
    listLimit = null,
  } = options;

  const scope = buildOperationalAttendanceScope(options);
  const filterClause = buildAttendanceFilterClause(attendanceFilter);
  const orderClause = buildOrderClause(attendanceFilter);

  const safeLimit =
    listLimit != null && Number.isFinite(Number(listLimit)) && Number(listLimit) > 0
      ? Math.min(Number(listLimit), MAX_LIST_ROWS)
      : null;

  const limitClause = safeLimit ? ` LIMIT ${safeLimit}` : ` LIMIT ${MAX_LIST_ROWS}`;

  const listSql = `
    WITH ${scope.scopedSessionsCte}
    SELECT
      d.classsession_id,
      d.class_id,
      d.phase_number,
      d.phase_session_number,
      d.scheduled_date,
      d.scheduled_start_time,
      d.scheduled_end_time,
      d.status,
      d.class_name,
      d.level_tag,
      d.program_name,
      d.branch_name,
      d.teacher_name,
      d.enrolled_count,
      d.marked_count,
      d.attendance_status,
      d.is_taken
    FROM derived_sessions d
    WHERE 1=1
      ${filterClause}
    ${orderClause}
    ${limitClause}
  `;

  const [summary, listResult] = await Promise.all([
    loadOperationalAttendanceSummary(queryFn, scope),
    queryFn(listSql, scope.params),
  ]);

  const sessions = (listResult.rows || []).map(({ is_taken, scheduled_date_raw, ...row }) => ({
    ...row,
    is_taken,
  }));
  const listCount = sessions.length;
  const totalCount = Number(summary.total_count) || 0;
  const filterTotal =
    attendanceFilter === 'pending'
      ? Number(summary.pending_count) || 0
      : attendanceFilter === 'taken'
        ? Number(summary.taken_count) || 0
        : attendanceFilter === 'upcoming'
          ? Number(summary.upcoming_count) || 0
          : totalCount;
  const rowCap = safeLimit || MAX_LIST_ROWS;
  const isTruncated = listCount >= rowCap && listCount < filterTotal;

  return {
    mode: scope.mode,
    summary_date: scope.mode === 'daily' ? scope.dateStart : null,
    summary_month: scope.mode === 'monthly' ? scope.summaryMonth : null,
    date_start: scope.dateStart,
    date_end: scope.dateEnd,
    today_manila: scope.todayManila,
    attendance_filter: attendanceFilter,
    pending_count: Number(summary.pending_count) || 0,
    taken_count: Number(summary.taken_count) || 0,
    completed_count: Number(summary.completed_count) || 0,
    upcoming_count: Number(summary.upcoming_count) || 0,
    total_count: totalCount,
    list_count: listCount,
    is_truncated: isTruncated,
    sessions,
  };
}
