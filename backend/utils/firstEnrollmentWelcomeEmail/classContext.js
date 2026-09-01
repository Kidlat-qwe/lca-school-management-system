/**
 * Load enrolled class start date + weekly schedule for onboarding emails.
 *
 * Mid-phase enrollments use the first session of the student's enrolled phase
 * (MIN classsessionstbl.scheduled_date per class+phase), not the class CMS start_date.
 */
import { getClient, query as poolQuery } from '../../config/database.js';
import { formatDateDisplay } from '../templateRenderService.js';

const DAY_ORDER = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

function formatTime12h(raw) {
  if (!raw) return '';
  const text = String(raw).trim();
  const match = text.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return text;
  let hour = Number(match[1]);
  const minute = match[2];
  const suffix = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12;
  if (hour === 0) hour = 12;
  return `${hour}:${minute} ${suffix}`;
}

function sortSchedules(rows) {
  return [...rows].sort(
    (a, b) => (DAY_ORDER[a.day_of_week] ?? 99) - (DAY_ORDER[b.day_of_week] ?? 99)
  );
}

function resolvePhaseNumber(raw) {
  const phase = Number(raw);
  return Number.isInteger(phase) && phase >= 1 ? phase : 1;
}

export function formatClassScheduleText(schedules = []) {
  const sorted = sortSchedules(schedules.filter((r) => r?.day_of_week));
  if (!sorted.length) {
    return 'Please contact your branch for your class schedule.';
  }

  const timeRanges = sorted.map(
    (r) => `${formatTime12h(r.start_time)} – ${formatTime12h(r.end_time)}`
  );
  const uniqueTimes = [...new Set(timeRanges.filter(Boolean))];
  const days = sorted.map((r) => r.day_of_week).join(', ');

  if (uniqueTimes.length === 1 && uniqueTimes[0]) {
    return `${days} · ${uniqueTimes[0]}`;
  }

  return sorted
    .map((r) => `${r.day_of_week}: ${formatTime12h(r.start_time)} – ${formatTime12h(r.end_time)}`)
    .join('\n');
}

async function loadPhaseFirstSessionYmd(client, classId, phaseNumber) {
  const result = await client.query(
    `SELECT TO_CHAR(MIN(cs.scheduled_date), 'YYYY-MM-DD') AS phase_start_ymd
     FROM classsessionstbl cs
     WHERE cs.class_id = $1
       AND cs.phase_number = $2
       AND COALESCE(cs.status, 'Scheduled') != 'Cancelled'
       AND cs.scheduled_date IS NOT NULL`,
    [classId, phaseNumber]
  );
  return result.rows[0]?.phase_start_ymd || null;
}

async function loadSchedulesForClass(client, classId, phaseNumber = 1) {
  const byClass = await client.query(
    `SELECT day_of_week, start_time::text AS start_time, end_time::text AS end_time
     FROM roomschedtbl
     WHERE class_id = $1
     ORDER BY day_of_week`,
    [classId]
  );
  if (byClass.rows.length > 0) {
    return sortSchedules(byClass.rows);
  }

  const sessions = await client.query(
    `SELECT DISTINCT ON (EXTRACT(DOW FROM cs.scheduled_date))
       CASE EXTRACT(DOW FROM cs.scheduled_date)
         WHEN 0 THEN 'Sunday' WHEN 1 THEN 'Monday' WHEN 2 THEN 'Tuesday'
         WHEN 3 THEN 'Wednesday' WHEN 4 THEN 'Thursday' WHEN 5 THEN 'Friday'
         WHEN 6 THEN 'Saturday'
       END AS day_of_week,
       cs.scheduled_start_time::text AS start_time,
       cs.scheduled_end_time::text AS end_time
     FROM classsessionstbl cs
     WHERE cs.class_id = $1
       AND cs.phase_number = $2
       AND COALESCE(cs.status, 'Scheduled') != 'Cancelled'
       AND cs.scheduled_start_time IS NOT NULL
       AND cs.scheduled_end_time IS NOT NULL
     ORDER BY EXTRACT(DOW FROM cs.scheduled_date), cs.scheduled_date`,
    [classId, phaseNumber]
  );
  return sortSchedules(sessions.rows);
}

/**
 * @param {number|null|undefined} classstudentId
 * @returns {Promise<{
 *   classId: number|null,
 *   className: string,
 *   branchId: number|null,
 *   branchName: string,
 *   branchNickname: string,
 *   enrolledPhaseNumber: number,
 *   classStartDateDisplay: string,
 *   classScheduleText: string,
 * }|null>}
 */
export async function loadEnrollmentClassContext(classstudentId) {
  const csId = Number(classstudentId);
  if (!Number.isFinite(csId) || csId <= 0) return null;

  const client = await getClient();
  try {
    const row = (
      await client.query(
        `SELECT cs.class_id,
                cs.phase_number,
                c.class_name,
                c.branch_id,
                b.branch_name,
                b.branch_nickname,
                TO_CHAR(c.start_date, 'YYYY-MM-DD') AS class_start_ymd
         FROM classstudentstbl cs
         INNER JOIN classestbl c ON c.class_id = cs.class_id
         LEFT JOIN branchestbl b ON b.branch_id = c.branch_id
         WHERE cs.classstudent_id = $1
         LIMIT 1`,
        [csId]
      )
    ).rows[0];

    if (!row) return null;

    const classId = Number(row.class_id);
    const enrolledPhaseNumber = resolvePhaseNumber(row.phase_number);
    const phaseStartYmd =
      (await loadPhaseFirstSessionYmd(client, classId, enrolledPhaseNumber)) ||
      row.class_start_ymd ||
      null;
    const schedules = await loadSchedulesForClass(client, classId, enrolledPhaseNumber);

    return {
      classId,
      className: row.class_name || '',
      branchId: row.branch_id != null ? Number(row.branch_id) : null,
      branchName: row.branch_name || '',
      branchNickname: row.branch_nickname || '',
      enrolledPhaseNumber,
      classStartDateDisplay: formatDateDisplay(phaseStartYmd),
      classScheduleText: formatClassScheduleText(schedules),
    };
  } finally {
    client.release();
  }
}

/** Resolve class from earliest `new` enrollment when classstudentId is missing. */
export async function loadEnrollmentClassContextForStudent(studentId) {
  const res = await poolQuery(
    `SELECT cs.classstudent_id
     FROM classstudentstbl cs
     WHERE cs.student_id = $1
       AND cs.program_enrollment_status = 'new'
       AND cs.removed_at IS NULL
     ORDER BY cs.enrolled_at ASC NULLS LAST, cs.classstudent_id ASC
     LIMIT 1`,
    [studentId]
  );
  const csId = res.rows[0]?.classstudent_id;
  if (!csId) return null;
  return loadEnrollmentClassContext(csId);
}
