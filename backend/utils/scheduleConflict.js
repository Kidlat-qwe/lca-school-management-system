import { query } from '../config/database.js';

/** @param {Date|string|null|undefined} value */
export const normalizeClassDate = (value) => {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const iso = String(value).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
};

/**
 * True when two class run periods overlap (inclusive). Open-ended bounds are treated as unbounded.
 */
export const classDateRangesOverlap = (newStart, newEnd, existingStart, existingEnd) => {
  const ns = normalizeClassDate(newStart);
  const ne = normalizeClassDate(newEnd);
  const es = normalizeClassDate(existingStart);
  const ee = normalizeClassDate(existingEnd);

  if (!ns || !ne) return true;
  if (!es && !ee) return true;

  const existingStartBound = es || '1900-01-01';
  const existingEndBound = ee || '9999-12-31';

  return ns <= existingEndBound && existingStartBound <= ne;
};

const timeToMinutes = (timeStr) => {
  if (!timeStr) return 0;
  const parts = String(timeStr).split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1] || 0, 10);
};

const formatClassDateRange = (startDate, endDate) => {
  const start = normalizeClassDate(startDate);
  const end = normalizeClassDate(endDate);
  if (start && end) return `${start} – ${end}`;
  if (start) return `from ${start}`;
  if (end) return `until ${end}`;
  return 'ongoing';
};

/**
 * Room schedule conflict: same room, day, overlapping time, AND overlapping class date range.
 */
export const checkScheduleConflict = async (
  roomId,
  dayOfWeek,
  startTime,
  endTime,
  excludeClassId = null,
  { classStartDate = null, classEndDate = null } = {}
) => {
  if (!roomId || !dayOfWeek || !startTime || !endTime) {
    return { hasConflict: false, conflictingClass: null, message: null };
  }

  try {
    let conflictQuery = `
      SELECT
        rs.class_id,
        rs.day_of_week,
        rs.start_time,
        rs.end_time,
        c.class_name,
        c.level_tag,
        p.program_name,
        c.status,
        TO_CHAR(c.start_date, 'YYYY-MM-DD') AS start_date,
        TO_CHAR(c.end_date, 'YYYY-MM-DD') AS end_date
      FROM roomschedtbl rs
      INNER JOIN classestbl c ON rs.class_id = c.class_id
      LEFT JOIN programstbl p ON c.program_id = p.program_id
      WHERE rs.room_id = $1
        AND rs.day_of_week = $2
        AND c.status = 'Active'
        AND rs.start_time IS NOT NULL
        AND rs.end_time IS NOT NULL
    `;

    const params = [roomId, dayOfWeek];

    if (excludeClassId) {
      conflictQuery += ' AND rs.class_id != $3';
      params.push(excludeClassId);
    }

    const conflictResult = await query(conflictQuery, params);
    const newStartMin = timeToMinutes(startTime);
    const newEndMin = timeToMinutes(endTime);

    for (const existingSchedule of conflictResult.rows) {
      const existingStartMin = timeToMinutes(existingSchedule.start_time);
      const existingEndMin = timeToMinutes(existingSchedule.end_time);

      if (!(newStartMin < existingEndMin && existingStartMin < newEndMin)) {
        continue;
      }

      if (
        !classDateRangesOverlap(
          classStartDate,
          classEndDate,
          existingSchedule.start_date,
          existingSchedule.end_date
        )
      ) {
        continue;
      }

      const className = existingSchedule.class_name
        ? `${existingSchedule.program_name || ''} - ${existingSchedule.class_name}`.trim()
        : existingSchedule.level_tag
          ? `${existingSchedule.program_name || ''} - ${existingSchedule.level_tag}`.trim()
          : existingSchedule.program_name || `Class ${existingSchedule.class_id}`;

      const dateRangeLabel = formatClassDateRange(
        existingSchedule.start_date,
        existingSchedule.end_date
      );

      return {
        hasConflict: true,
        conflictingClass: {
          class_id: existingSchedule.class_id,
          class_name: existingSchedule.class_name,
          level_tag: existingSchedule.level_tag,
          program_name: existingSchedule.program_name,
          start_date: existingSchedule.start_date,
          end_date: existingSchedule.end_date,
        },
        message: `Schedule conflicts with active class "${className}" (${existingSchedule.start_time} - ${existingSchedule.end_time}, ${dateRangeLabel})`,
      };
    }

    return { hasConflict: false, conflictingClass: null, message: null };
  } catch (error) {
    console.error('Error checking schedule conflict:', error);
    return { hasConflict: false, conflictingClass: null, message: null };
  }
};

const timesOverlap = (startA, endA, startB, endB) => {
  const a0 = timeToMinutes(startA);
  const a1 = timeToMinutes(endA);
  const b0 = timeToMinutes(startB);
  const b1 = timeToMinutes(endB);
  return a0 < b1 && b0 < a1;
};

const buildClassDisplayName = (row) => {
  if (row.class_name) {
    return `${row.program_name || ''} - ${row.class_name}`.trim();
  }
  if (row.level_tag) {
    return `${row.program_name || ''} - ${row.level_tag}`.trim();
  }
  return row.program_name || `Class ${row.class_id}`;
};

/**
 * Teacher conflict: same day/time AND overlapping class run period with the new class.
 * Checks class sessions and active class room schedules (for classes without sessions yet).
 */
export const checkTeacherScheduleConflict = async (
  teacherId,
  daysOfWeek,
  excludeClassId = null,
  { classStartDate = null, classEndDate = null } = {}
) => {
  if (!teacherId || !daysOfWeek || !Array.isArray(daysOfWeek) || daysOfWeek.length === 0) {
    return { hasConflict: false, conflicts: [] };
  }

  const enabledDays = daysOfWeek.filter((d) => d.enabled && d.start_time && d.end_time);
  if (enabledDays.length === 0) {
    return { hasConflict: false, conflicts: [] };
  }

  const dayNameToDOW = {
    Sunday: 0,
    Monday: 1,
    Tuesday: 2,
    Wednesday: 3,
    Thursday: 4,
    Friday: 5,
    Saturday: 6,
  };

  const conflicts = [];
  const seenKeys = new Set();

  const addConflict = (dayName, row, message) => {
    const key = `${row.class_id}-${dayName}`;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    conflicts.push({
      day: dayName,
      conflictingSession: {
        class_id: row.class_id,
        class_name: row.class_name,
        level_tag: row.level_tag,
        program_name: row.program_name,
        scheduled_date: row.scheduled_date || null,
        scheduled_start_time: row.scheduled_start_time || row.start_time,
        scheduled_end_time: row.scheduled_end_time || row.end_time,
        start_date: row.class_start_date || row.start_date,
        end_date: row.class_end_date || row.end_date,
      },
      message,
    });
  };

  try {
    for (const daySchedule of enabledDays) {
      const dayName = daySchedule.day;
      const dayOfWeek = dayNameToDOW[dayName];
      if (dayOfWeek === undefined) continue;

      let sessionQuery = `
        SELECT
          cs.classsession_id,
          cs.class_id,
          cs.scheduled_date,
          cs.scheduled_start_time,
          cs.scheduled_end_time,
          c.class_name,
          c.level_tag,
          p.program_name,
          TO_CHAR(c.start_date, 'YYYY-MM-DD') AS class_start_date,
          TO_CHAR(c.end_date, 'YYYY-MM-DD') AS class_end_date
        FROM classsessionstbl cs
        INNER JOIN classestbl c ON cs.class_id = c.class_id
        LEFT JOIN programstbl p ON c.program_id = p.program_id
        WHERE cs.original_teacher_id = $1
          AND EXTRACT(DOW FROM cs.scheduled_date) = $2
          AND cs.status IN ('Scheduled', 'Completed')
          AND cs.scheduled_start_time IS NOT NULL
          AND cs.scheduled_end_time IS NOT NULL
          AND c.status = 'Active'
      `;

      const sessionParams = [teacherId, dayOfWeek];
      if (excludeClassId) {
        sessionQuery += ' AND cs.class_id != $3';
        sessionParams.push(excludeClassId);
      }

      const sessionResult = await query(sessionQuery, sessionParams);

      for (const row of sessionResult.rows) {
        if (!timesOverlap(daySchedule.start_time, daySchedule.end_time, row.scheduled_start_time, row.scheduled_end_time)) {
          continue;
        }
        if (
          !classDateRangesOverlap(
            classStartDate,
            classEndDate,
            row.class_start_date,
            row.class_end_date
          )
        ) {
          continue;
        }

        const className = buildClassDisplayName(row);
        const dateRangeLabel = formatClassDateRange(row.class_start_date, row.class_end_date);
        addConflict(
          dayName,
          row,
          `Teacher has a conflicting session on ${dayName} (${row.scheduled_start_time} - ${row.scheduled_end_time}) for class "${className}" (${dateRangeLabel})`
        );
      }

      let scheduleQuery = `
        SELECT DISTINCT
          c.class_id,
          rs.start_time,
          rs.end_time,
          c.class_name,
          c.level_tag,
          p.program_name,
          TO_CHAR(c.start_date, 'YYYY-MM-DD') AS class_start_date,
          TO_CHAR(c.end_date, 'YYYY-MM-DD') AS class_end_date
        FROM classestbl c
        INNER JOIN roomschedtbl rs ON rs.class_id = c.class_id
        LEFT JOIN programstbl p ON c.program_id = p.program_id
        LEFT JOIN classteacherstbl ct ON ct.class_id = c.class_id
        WHERE c.status = 'Active'
          AND rs.day_of_week = $2
          AND rs.start_time IS NOT NULL
          AND rs.end_time IS NOT NULL
          AND (c.teacher_id = $1 OR ct.teacher_id = $1)
      `;

      const scheduleParams = [teacherId, dayName];
      if (excludeClassId) {
        scheduleQuery += ' AND c.class_id != $3';
        scheduleParams.push(excludeClassId);
      }

      const scheduleResult = await query(scheduleQuery, scheduleParams);

      for (const row of scheduleResult.rows) {
        if (!timesOverlap(daySchedule.start_time, daySchedule.end_time, row.start_time, row.end_time)) {
          continue;
        }
        if (
          !classDateRangesOverlap(
            classStartDate,
            classEndDate,
            row.class_start_date,
            row.class_end_date
          )
        ) {
          continue;
        }

        const className = buildClassDisplayName(row);
        const dateRangeLabel = formatClassDateRange(row.class_start_date, row.class_end_date);
        addConflict(
          dayName,
          row,
          `Teacher is assigned to "${className}" on ${dayName} (${row.start_time} - ${row.end_time}, ${dateRangeLabel})`
        );
      }
    }

    return { hasConflict: conflicts.length > 0, conflicts };
  } catch (error) {
    console.error('Error checking teacher schedule conflict:', error);
    return { hasConflict: false, conflicts: [] };
  }
};
