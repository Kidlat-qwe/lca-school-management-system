import { query } from '../config/database.js';

const ENROLLMENT_STATUSES = ['new', 're_enrolled', 'upsell', 'rejoin', 'completed'];

const STATUS_KEYS = ['Present', 'Absent', 'Late', 'Excused', 'Leave Early'];

const emptyStatusCounts = () =>
  STATUS_KEYS.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, { not_marked: 0 });

/**
 * Phase-level attendance matrix for class details.
 * Same enrollment eligibility as GET /attendance/session/:sessionId.
 */
export async function getPhaseAttendanceSummary(classId, phaseNumber, options = {}) {
  const classIdInt = Number(classId);
  const phaseInt = Number(phaseNumber);
  const { userBranchId = null, isSuperadmin = false } = options;

  const classResult = await query(
    `SELECT c.class_id,
            c.branch_id,
            c.class_name,
            c.level_tag,
            p.program_name
     FROM classestbl c
     LEFT JOIN programstbl p ON c.program_id = p.program_id
     WHERE c.class_id = $1`,
    [classIdInt]
  );

  if (classResult.rows.length === 0) {
    return { notFound: true };
  }

  const classRow = classResult.rows[0];

  if (!isSuperadmin && userBranchId != null && classRow.branch_id != null) {
    if (Number(classRow.branch_id) !== Number(userBranchId)) {
      return { forbidden: true };
    }
  }

  const studentsResult = await query(
    `SELECT u.user_id AS student_id,
            u.full_name
     FROM classstudentstbl cs
     INNER JOIN userstbl u ON cs.student_id = u.user_id
     WHERE cs.class_id = $1
       AND cs.phase_number = $2
       AND cs.program_enrollment_status = ANY($3::text[])
       AND cs.removed_at IS NULL
     ORDER BY u.full_name ASC`,
    [classIdInt, phaseInt, ENROLLMENT_STATUSES]
  );

  const sessionsResult = await query(
    `SELECT cs.classsession_id,
            cs.phase_session_number,
            TO_CHAR(cs.scheduled_date, 'YYYY-MM-DD') AS scheduled_date,
            cs.scheduled_start_time::text AS scheduled_start_time,
            cs.scheduled_end_time::text AS scheduled_end_time,
            cs.status AS session_status,
            ps.topic
     FROM classsessionstbl cs
     LEFT JOIN phasesessionstbl ps ON cs.phasesessiondetail_id = ps.phasesessiondetail_id
     WHERE cs.class_id = $1
       AND cs.phase_number = $2
       AND COALESCE(cs.status, 'Scheduled') != 'Cancelled'
     ORDER BY cs.scheduled_date ASC NULLS LAST,
              cs.scheduled_start_time ASC NULLS LAST,
              cs.phase_session_number ASC`,
    [classIdInt, phaseInt]
  );

  const sessionIds = sessionsResult.rows.map((row) => row.classsession_id);
  let attendanceRows = [];

  if (sessionIds.length > 0) {
    const attendanceResult = await query(
      `SELECT attendance_id,
              classsession_id,
              student_id,
              status,
              notes
       FROM attendancetbl
       WHERE classsession_id = ANY($1::int[])`,
      [sessionIds]
    );
    attendanceRows = attendanceResult.rows;
  }

  const attendanceBySessionStudent = new Map();
  attendanceRows.forEach((row) => {
    const key = `${row.classsession_id}-${row.student_id}`;
    attendanceBySessionStudent.set(key, row);
  });

  const sessions = sessionsResult.rows.map((row, index) => ({
    classsession_id: Number(row.classsession_id),
    display_session_number: index + 1,
    phase_session_number: row.phase_session_number != null ? Number(row.phase_session_number) : null,
    scheduled_date: row.scheduled_date || null,
    scheduled_start_time: row.scheduled_start_time || null,
    scheduled_end_time: row.scheduled_end_time || null,
    session_status: row.session_status || null,
    topic: row.topic || null,
  }));

  const phaseTotals = emptyStatusCounts();
  let completedSessions = 0;

  sessions.forEach((session) => {
    if (session.session_status === 'Completed') {
      completedSessions += 1;
    }
  });

  const students = studentsResult.rows.map((student) => {
    const studentId = Number(student.student_id);
    const totals = emptyStatusCounts();
    const sessionAttendance = {};

    sessions.forEach((session) => {
      const record = attendanceBySessionStudent.get(`${session.classsession_id}-${studentId}`);
      if (record?.status) {
        sessionAttendance[String(session.classsession_id)] = {
          attendance_id: Number(record.attendance_id),
          status: record.status,
          notes: record.notes || null,
        };
        if (Object.prototype.hasOwnProperty.call(totals, record.status)) {
          totals[record.status] += 1;
        }
      } else {
        sessionAttendance[String(session.classsession_id)] = null;
        totals.not_marked += 1;
      }
    });

    STATUS_KEYS.forEach((key) => {
      phaseTotals[key] += totals[key];
    });
    phaseTotals.not_marked += totals.not_marked;

    return {
      student_id: studentId,
      full_name: student.full_name,
      totals,
      sessions: sessionAttendance,
    };
  });

  const markedTotal =
    phaseTotals.Present +
    phaseTotals.Absent +
    phaseTotals.Late +
    phaseTotals.Excused +
    phaseTotals['Leave Early'];

  const attendanceRate =
    markedTotal > 0 ? Math.round((phaseTotals.Present / markedTotal) * 1000) / 10 : null;

  return {
    class_id: classIdInt,
    phase_number: phaseInt,
    class_name: classRow.class_name || null,
    level_tag: classRow.level_tag || null,
    program_name: classRow.program_name || null,
    enrolled_students: students.length,
    sessions,
    summary: {
      total_sessions: sessions.length,
      completed_sessions: completedSessions,
      present: phaseTotals.Present,
      absent: phaseTotals.Absent,
      late: phaseTotals.Late,
      excused: phaseTotals.Excused,
      leave_early: phaseTotals['Leave Early'],
      not_marked: phaseTotals.not_marked,
      marked_total: markedTotal,
      attendance_rate: attendanceRate,
    },
    students,
  };
}
