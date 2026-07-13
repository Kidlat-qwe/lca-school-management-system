/**
 * Class start date adjustment — preview and apply.
 *
 * @module utils/classStartDateAdjustment/classStartDateAdjustmentService
 */

import { checkScheduleConflict, checkTeacherScheduleConflict } from '../scheduleConflict.js';
import {
  buildSessionsForClass,
  computePhaseStartDateMap,
  getCompletedSessionStats,
  loadClassSessionContext,
  persistRegeneratedSessions,
  regenerateClassSessions,
} from '../classSessionRegeneration.js';
import {
  applyBillingRealignment,
  dateParam,
  planBillingRealignmentForClass,
} from './billingRealignment.js';

const ACTIVE_CLASS_ENROLLMENT_SQL = `program_enrollment_status <> 'dropped' AND removed_at IS NULL`;

const ymd = (value) => (value == null ? '' : String(value).slice(0, 10));

/**
 * @param {import('pg').PoolClient} client
 * @param {number} classId
 */
export async function classRequiresStartDateWizard(client, classId) {
  const enrollmentRes = await client.query(
    `SELECT 1
     FROM classstudentstbl
     WHERE class_id = $1
       AND ${ACTIVE_CLASS_ENROLLMENT_SQL}
     LIMIT 1`,
    [classId]
  );
  if (enrollmentRes.rows.length) return true;

  const billingRes = await client.query(
    `SELECT 1
     FROM installmentinvoiceprofilestbl ip
     WHERE ip.class_id = $1
       AND (
         COALESCE(ip.generated_count, 0) > 0
         OR EXISTS (
           SELECT 1 FROM invoicestbl i
           WHERE i.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
             AND i.status = 'Unpaid'
         )
       )
     LIMIT 1`,
    [classId]
  );
  return billingRes.rows.length > 0;
}

/**
 * @param {import('pg').PoolClient} client
 * @param {number} classId
 * @param {string} proposedStartDate
 * @param {string} proposedEndDate
 */
export async function checkClassScheduleConflicts(client, classId, proposedStartDate, proposedEndDate) {
  const classRes = await client.query(
    `SELECT room_id FROM classestbl WHERE class_id = $1`,
    [classId]
  );
  const roomId = classRes.rows[0]?.room_id;
  if (!roomId) return [];

  const schedulesRes = await client.query(
    `SELECT day_of_week, start_time, end_time
     FROM roomschedtbl WHERE class_id = $1`,
    [classId]
  );

  const conflicts = [];
  for (const row of schedulesRes.rows) {
    const result = await checkScheduleConflict(
      roomId,
      row.day_of_week,
      row.start_time,
      row.end_time,
      classId,
      { classStartDate: proposedStartDate, classEndDate: proposedEndDate }
    );
    if (result.hasConflict) {
      conflicts.push({
        type: 'room',
        day_of_week: row.day_of_week,
        start_time: row.start_time,
        end_time: row.end_time,
        message: result.message,
        conflicting_class: result.conflictingClass,
      });
    }
  }
  return conflicts;
}

/**
 * @param {import('pg').PoolClient} client
 * @param {number} classId
 * @param {string} proposedStartDate
 * @param {string} proposedEndDate
 */
export async function checkClassTeacherConflicts(client, classId, proposedStartDate, proposedEndDate) {
  const classRes = await client.query(
    `SELECT teacher_id FROM classestbl WHERE class_id = $1`,
    [classId]
  );

  const teacherIds = new Set();
  if (classRes.rows[0]?.teacher_id) {
    teacherIds.add(Number(classRes.rows[0].teacher_id));
  }

  const junctionRes = await client.query(
    `SELECT teacher_id FROM classteacherstbl WHERE class_id = $1`,
    [classId]
  );
  junctionRes.rows.forEach((row) => {
    if (row.teacher_id) teacherIds.add(Number(row.teacher_id));
  });

  const schedulesRes = await client.query(
    `SELECT day_of_week, start_time, end_time
     FROM roomschedtbl WHERE class_id = $1`,
    [classId]
  );

  const daysOfWeek = schedulesRes.rows.map((row) => ({
    day: row.day_of_week,
    start_time: row.start_time,
    end_time: row.end_time,
    enabled: true,
  }));

  const conflicts = [];
  for (const teacherId of teacherIds) {
    const result = await checkTeacherScheduleConflict(teacherId, daysOfWeek, classId, {
      classStartDate: proposedStartDate,
      classEndDate: proposedEndDate,
    });
    for (const c of result.conflicts || []) {
      conflicts.push({
        type: 'teacher',
        teacher_id: teacherId,
        ...c,
      });
    }
  }
  return conflicts;
}

function buildSessionSummary(sessions, phaseStartDates) {
  const phases = Object.keys(phaseStartDates)
    .map(Number)
    .sort((a, b) => a - b)
    .map((phaseNumber) => {
      const phaseSessions = sessions.filter((s) => Number(s.phase_number) === phaseNumber);
      const dates = phaseSessions.map((s) => ymd(s.scheduled_date)).filter(Boolean).sort();
      return {
        phase_number: phaseNumber,
        first_session_date: dates[0] || phaseStartDates[phaseNumber] || null,
        last_session_date: dates[dates.length - 1] || null,
        session_count: phaseSessions.length,
      };
    });

  const allDates = sessions.map((s) => ymd(s.scheduled_date)).filter(Boolean).sort();
  return {
    phases,
    first_session_date: allDates[0] || null,
    last_session_date: allDates[allDates.length - 1] || null,
    total_sessions: sessions.length,
  };
}

/**
 * @param {import('pg').PoolClient} client
 * @param {number} classId
 * @param {string} newStartDate
 * @param {{ acknowledgeWarnings?: boolean }} [options]
 */
export async function previewStartDateAdjustment(client, classId, newStartDate, options = {}) {
  const classRes = await client.query(
    `SELECT class_id, class_name, level_tag, status,
            TO_CHAR(start_date, 'YYYY-MM-DD') AS start_ymd,
            TO_CHAR(end_date, 'YYYY-MM-DD') AS end_ymd,
            room_id, branch_id
     FROM classestbl WHERE class_id = $1`,
    [classId]
  );
  if (!classRes.rows.length) {
    const err = new Error('Class not found');
    err.statusCode = 404;
    throw err;
  }

  const classRow = classRes.rows[0];
  const currentStartDate = ymd(classRow.start_ymd);
  const newStartYmd = ymd(newStartDate);

  if (!newStartYmd) {
    const err = new Error('new_start_date is required (YYYY-MM-DD)');
    err.statusCode = 400;
    throw err;
  }

  if (newStartYmd === currentStartDate) {
    const err = new Error('New start date is the same as the current start date');
    err.statusCode = 400;
    throw err;
  }

  const context = await loadClassSessionContext(client, classId);
  if (!context) {
    const err = new Error('Class session context not found');
    err.statusCode = 404;
    throw err;
  }

  const sessions = await buildSessionsForClass(client, context, {
    startDateOverride: newStartYmd,
  });

  if (!sessions.length) {
    const err = new Error(
      'Cannot generate sessions for the proposed start date. Check class schedule and curriculum.'
    );
    err.statusCode = 400;
    throw err;
  }

  const phaseStartDates = computePhaseStartDateMap(sessions);
  const sessionSummary = buildSessionSummary(sessions, phaseStartDates);
  const newEndDate = sessionSummary.last_session_date;

  const completedStats = await getCompletedSessionStats(client, classId);
  const warnings = [];

  if (classRow.status === 'Inactive') {
    warnings.push({
      code: 'class_inactive',
      message: 'Class is inactive. Reactivate after adjustment if needed.',
    });
  }

  const blockers = [];
  if (completedStats.completedWithAttendance > 0 && !options.acknowledgeWarnings) {
    blockers.push({
      code: 'completed_sessions_with_attendance',
      message: `${completedStats.completedWithAttendance} completed session(s) with attendance exist. Start date adjustment is blocked in v1.`,
      count: completedStats.completedWithAttendance,
    });
  } else if (completedStats.completedWithAttendance > 0) {
    warnings.push({
      code: 'completed_sessions_with_attendance',
      message: `${completedStats.completedWithAttendance} completed session(s) with attendance will remain at previous dates.`,
      count: completedStats.completedWithAttendance,
    });
  }

  const roomConflicts = await checkClassScheduleConflicts(client, classId, newStartYmd, newEndDate);
  const teacherConflicts = await checkClassTeacherConflicts(client, classId, newStartYmd, newEndDate);

  if (roomConflicts.length) {
    blockers.push({
      code: 'room_conflicts',
      message: 'Room schedule conflicts detected for the proposed class date range.',
      conflicts: roomConflicts,
    });
  }

  if (teacherConflicts.length) {
    blockers.push({
      code: 'teacher_conflicts',
      message: 'Teacher schedule conflicts detected for the proposed class date range.',
      conflicts: teacherConflicts,
    });
  }

  const billingImpacts = await planBillingRealignmentForClass(
    client,
    classId,
    phaseStartDates,
    { previewMode: true }
  );

  const canApply = blockers.length === 0;

  return {
    class_id: classId,
    class_name: classRow.class_name,
    level_tag: classRow.level_tag,
    current_start_date: currentStartDate,
    current_end_date: ymd(classRow.end_ymd),
    new_start_date: newStartYmd,
    new_end_date: newEndDate,
    session_summary: sessionSummary,
    room_conflicts: roomConflicts,
    teacher_conflicts: teacherConflicts,
    billing_impacts: billingImpacts,
    warnings,
    blockers,
    can_apply: canApply,
    completed_session_stats: completedStats,
  };
}

async function ensureAdjustmentTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS class_schedule_adjustmenttbl (
      adjustment_id SERIAL PRIMARY KEY,
      class_id INTEGER NOT NULL REFERENCES classestbl(class_id) ON DELETE CASCADE,
      adjusted_by INTEGER REFERENCES userstbl(user_id) ON DELETE SET NULL,
      reason TEXT NOT NULL,
      old_start_date DATE NOT NULL,
      new_start_date DATE NOT NULL,
      old_end_date DATE,
      new_end_date DATE,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      preview_snapshot JSONB,
      result_summary JSONB
    )
  `);
}

/**
 * @param {import('pg').PoolClient} client
 * @param {number} classId
 * @param {string} newStartDate
 * @param {string} reason
 * @param {number|null} adjustedBy
 * @param {{ acknowledgeWarnings?: boolean }} [options]
 */
export async function applyStartDateAdjustment(
  client,
  classId,
  newStartDate,
  reason,
  adjustedBy,
  options = {}
) {
  const preview = await previewStartDateAdjustment(client, classId, newStartDate, options);

  if (!preview.can_apply) {
    const err = new Error(
      preview.blockers.map((b) => b.message).join(' ') ||
        'Cannot apply start date adjustment due to blocking issues.'
    );
    err.statusCode = 409;
    err.details = preview.blockers;
    throw err;
  }

  if (!String(reason || '').trim()) {
    const err = new Error('reason is required');
    err.statusCode = 400;
    throw err;
  }

  await ensureAdjustmentTable(client);

  await client.query(`UPDATE classestbl SET start_date = $1::date WHERE class_id = $2`, [
    preview.new_start_date,
    classId,
  ]);

  const regen = await regenerateClassSessions(client, classId, {
    startDateOverride: preview.new_start_date,
    createdBy: adjustedBy,
  });

  const billingImpacts = await planBillingRealignmentForClass(
    client,
    classId,
    regen.phaseStartDates,
    {}
  );

  const adjustmentInsert = await client.query(
    `INSERT INTO class_schedule_adjustmenttbl (
       class_id, adjusted_by, reason,
       old_start_date, new_start_date, old_end_date, new_end_date,
       preview_snapshot
     ) VALUES ($1, $2, $3, $4::date, $5::date, $6::date, $7::date, $8::jsonb)
     RETURNING adjustment_id`,
    [
      classId,
      adjustedBy,
      String(reason).trim(),
      preview.current_start_date,
      preview.new_start_date,
      dateParam(preview.current_end_date),
      dateParam(preview.new_end_date),
      JSON.stringify(preview),
    ]
  );

  const adjustmentId = adjustmentInsert.rows[0].adjustment_id;
  const billingSummary = await applyBillingRealignment(client, billingImpacts, adjustmentId);

  const resultSummary = {
    sessions: regen.persistResult,
    phase_start_dates: regen.phaseStartDates,
    billing: billingSummary,
    new_end_date: preview.new_end_date,
  };

  await client.query(
    `UPDATE class_schedule_adjustmenttbl
     SET result_summary = $1::jsonb
     WHERE adjustment_id = $2`,
    [JSON.stringify(resultSummary), adjustmentId]
  );

  return {
    adjustment_id: adjustmentId,
    class_id: classId,
    current_start_date: preview.current_start_date,
    new_start_date: preview.new_start_date,
    current_end_date: preview.current_end_date,
    new_end_date: preview.new_end_date,
    session_summary: preview.session_summary,
    billing_impacts: billingImpacts,
    billing_summary: billingSummary,
    result_summary: resultSummary,
  };
}
