/**
 * Regenerate classsessionstbl from class schedule + curriculum.
 *
 * @module utils/classSessionRegeneration
 */

import { generateClassSessions } from './sessionCalculation.js';
import { generateClassCode } from './classCodeGenerator.js';
import { getCustomHolidayDateSetForRange } from './holidayService.js';
import { syncClassEndDateFromSessions } from './classEndDateSync.js';

export const getHolidayRangeFromStartDate = (startDate) => {
  if (!startDate) return { startYmd: null, endYmd: null };
  const y = Number(String(startDate).slice(0, 4));
  if (!Number.isInteger(y)) return { startYmd: null, endYmd: null };
  return {
    startYmd: `${y}-01-01`,
    endYmd: `${y + 3}-12-31`,
  };
};

/**
 * @param {import('pg').PoolClient} client
 * @param {number} classId
 */
export async function loadClassSessionContext(client, classId) {
  const classResult = await client.query(
    `SELECT c.*,
            p.curriculum_id,
            p.program_code,
            p.session_duration_hours,
            cu.number_of_phase,
            cu.number_of_session_per_phase
     FROM classestbl c
     LEFT JOIN programstbl p ON c.program_id = p.program_id
     LEFT JOIN curriculumstbl cu ON p.curriculum_id = cu.curriculum_id
     WHERE c.class_id = $1`,
    [classId]
  );

  if (!classResult.rows.length) {
    return null;
  }

  const classData = classResult.rows[0];

  const schedulesResult = await client.query(
    `SELECT day_of_week, start_time, end_time
     FROM roomschedtbl
     WHERE class_id = $1
     ORDER BY day_of_week`,
    [classId]
  );

  let phaseSessions = [];
  if (classData.curriculum_id) {
    const phaseSessionsResult = await client.query(
      `SELECT phasesessiondetail_id, phase_number, phase_session_number
       FROM phasesessionstbl
       WHERE curriculum_id = $1
       ORDER BY phase_number, phase_session_number`,
      [classData.curriculum_id]
    );
    phaseSessions = phaseSessionsResult.rows;
  }

  return {
    classData,
    schedules: schedulesResult.rows,
    phaseSessions,
  };
}

/**
 * Build session rows in memory (no DB writes).
 *
 * @param {object} params
 * @param {object} params.classData
 * @param {object[]} params.schedules
 * @param {object[]} params.phaseSessions
 * @param {string|null} [params.startDateOverride]
 * @param {import('pg').PoolClient} client
 */
export async function buildSessionsForClass(
  client,
  { classData, schedules, phaseSessions },
  { startDateOverride = null, createdBy = null } = {}
) {
  const startDate = startDateOverride || classData.start_date;
  if (
    !startDate ||
    !classData.number_of_phase ||
    !classData.number_of_session_per_phase ||
    !schedules.length ||
    !phaseSessions.length
  ) {
    return [];
  }

  const formattedDaysOfWeek = schedules.map((day) => ({
    day_of_week: day.day_of_week,
    start_time: day.start_time,
    end_time: day.end_time,
    enabled: true,
  }));

  const { startYmd, endYmd } = getHolidayRangeFromStartDate(startDate);
  const skipHolidays = classData.skip_holidays === true || classData.skip_holidays === 'true';
  const holidayDateSet =
    skipHolidays && startYmd && endYmd
      ? await getCustomHolidayDateSetForRange(startYmd, endYmd, classData.branch_id || null)
      : new Set();

  return generateClassSessions(
    {
      class_id: classData.class_id,
      teacher_id: classData.teacher_id || null,
      start_date: startDate,
    },
    formattedDaysOfWeek,
    phaseSessions,
    classData.number_of_phase,
    classData.number_of_session_per_phase,
    createdBy,
    classData.session_duration_hours || null,
    holidayDateSet
  );
}

/**
 * @param {object[]} sessions
 * @returns {Record<number, string>}
 */
export function computePhaseStartDateMap(sessions) {
  const map = {};
  for (const session of sessions || []) {
    const phase = Number(session.phase_number);
    const date = String(session.scheduled_date || '').slice(0, 10);
    if (!phase || !date) continue;
    if (!map[phase] || date < map[phase]) {
      map[phase] = date;
    }
  }
  return map;
}

/**
 * @param {import('pg').PoolClient} client
 * @param {number} classId
 */
export async function getCompletedSessionStats(client, classId) {
  const res = await client.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'Completed')::int AS completed_count,
       COUNT(*) FILTER (
         WHERE status = 'Completed'
           AND EXISTS (
             SELECT 1 FROM attendancetbl a WHERE a.classsession_id = classsessionstbl.classsession_id
           )
       )::int AS completed_with_attendance
     FROM classsessionstbl
     WHERE class_id = $1`,
    [classId]
  );
  return {
    completedCount: res.rows[0]?.completed_count || 0,
    completedWithAttendance: res.rows[0]?.completed_with_attendance || 0,
  };
}

/**
 * Persist regenerated sessions and sync end_date.
 *
 * @param {import('pg').PoolClient} client
 * @param {number} classId
 * @param {object[]} sessions
 * @param {object} classData
 */
export async function persistRegeneratedSessions(client, classId, sessions, classData) {
  let sessionsUpdated = 0;
  let sessionsCreated = 0;

  for (const session of sessions) {
    const existingCheck = await client.query(
      `SELECT classsession_id FROM classsessionstbl
       WHERE class_id = $1
         AND phase_number = $2
         AND phase_session_number = $3
         AND scheduled_date = $4`,
      [session.class_id, session.phase_number, session.phase_session_number, session.scheduled_date]
    );

    let sessionClassCode = null;
    if (
      classData.program_code &&
      session.scheduled_date &&
      session.scheduled_start_time &&
      classData.class_name
    ) {
      sessionClassCode = generateClassCode(
        classData.program_code,
        session.scheduled_date,
        session.scheduled_start_time,
        classData.class_name
      );
    }

    await client.query(
      `INSERT INTO classsessionstbl (
         class_id, phasesessiondetail_id, phase_number, phase_session_number,
         scheduled_date, scheduled_start_time, scheduled_end_time,
         original_teacher_id, assigned_teacher_id, status, created_by, class_code
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (class_id, phase_number, phase_session_number, scheduled_date)
       DO UPDATE SET
         phasesessiondetail_id = EXCLUDED.phasesessiondetail_id,
         scheduled_start_time = EXCLUDED.scheduled_start_time,
         scheduled_end_time = EXCLUDED.scheduled_end_time,
         original_teacher_id = CASE
           WHEN classsessionstbl.substitute_teacher_id IS NOT NULL
             THEN classsessionstbl.original_teacher_id
           ELSE EXCLUDED.original_teacher_id
         END,
         assigned_teacher_id = CASE
           WHEN classsessionstbl.substitute_teacher_id IS NOT NULL
             THEN classsessionstbl.assigned_teacher_id
           ELSE EXCLUDED.assigned_teacher_id
         END,
         class_code = COALESCE(EXCLUDED.class_code, classsessionstbl.class_code),
         updated_at = CURRENT_TIMESTAMP`,
      [
        session.class_id,
        session.phasesessiondetail_id,
        session.phase_number,
        session.phase_session_number,
        session.scheduled_date,
        session.scheduled_start_time,
        session.scheduled_end_time,
        session.original_teacher_id,
        session.assigned_teacher_id,
        session.status,
        session.created_by,
        sessionClassCode,
      ]
    );

    if (existingCheck.rows.length > 0) {
      sessionsUpdated += 1;
    } else {
      sessionsCreated += 1;
    }
  }

  const existingSessionsResult = await client.query(
    `SELECT classsession_id, phase_number, phase_session_number,
            TO_CHAR(scheduled_date, 'YYYY-MM-DD') AS scheduled_date
     FROM classsessionstbl
     WHERE class_id = $1`,
    [classId]
  );

  const newSessionKeys = new Set(
    sessions.map((s) => `${s.phase_number}_${s.phase_session_number}_${s.scheduled_date}`)
  );

  const sessionsToDelete = existingSessionsResult.rows.filter((existing) => {
    const key = `${existing.phase_number}_${existing.phase_session_number}_${existing.scheduled_date}`;
    return !newSessionKeys.has(key);
  });

  let deletedScheduled = 0;
  if (sessionsToDelete.length > 0) {
    const sessionIdsToDelete = sessionsToDelete
      .map((s) => s.classsession_id)
      .filter((sid) => sid != null);

    if (sessionIdsToDelete.length > 0) {
      const del = await client.query(
        `DELETE FROM classsessionstbl
         WHERE classsession_id = ANY($1::int[])
           AND status = 'Scheduled'`,
        [sessionIdsToDelete]
      );
      deletedScheduled = del.rowCount || 0;
    }
  }

  const endDateSync = await syncClassEndDateFromSessions(client, classId);

  return {
    sessionsUpdated,
    sessionsCreated,
    deletedScheduled,
    endDateSync,
  };
}

/**
 * @param {import('pg').PoolClient} client
 * @param {number} classId
 * @param {{ startDateOverride?: string|null, createdBy?: number|null }} [options]
 */
export async function regenerateClassSessions(client, classId, options = {}) {
  const context = await loadClassSessionContext(client, classId);
  if (!context) {
    throw new Error('Class not found');
  }

  const sessions = await buildSessionsForClass(client, context, {
    startDateOverride: options.startDateOverride || null,
    createdBy: options.createdBy || null,
  });

  if (!sessions.length) {
    return {
      sessions: [],
      phaseStartDates: {},
      persistResult: null,
    };
  }

  const persistResult = await persistRegeneratedSessions(
    client,
    classId,
    sessions,
    context.classData
  );

  return {
    sessions,
    phaseStartDates: computePhaseStartDateMap(sessions),
    persistResult,
  };
}
