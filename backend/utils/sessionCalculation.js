/**
 * Utility functions for calculating and generating class sessions
 *
 * Scheduling rules:
 * - Sessions are placed on enabled weekdays from class start_date, skipping optional holidays.
 * - Between phases: after the last session of phase N, advance one calendar day and continue;
 *   the next phase starts on the next eligible schedule weekday (phases may share the same month).
 */

const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Computes ordered YYYY-MM-DD list for all class sessions (same rules as generateClassSessions).
 * @param {Object} opts
 * @param {string|Date} opts.startDate - class start_date
 * @param {Array} opts.daysOfWeek - schedule rows with day_of_week, start_time, end_time
 * @param {number} opts.number_of_phase
 * @param {number} opts.number_of_session_per_phase
 * @param {Set<string>|null} opts.holidayDateSet
 * @returns {string[]}
 */
const computeSessionScheduleDates = ({
  startDate,
  daysOfWeek,
  number_of_phase,
  number_of_session_per_phase,
  holidayDateSet = null,
}) => {
  if (!startDate || !daysOfWeek || daysOfWeek.length === 0) {
    return [];
  }

  const dayMap = {};
  daysOfWeek.forEach((day) => {
    if (day && day.day_of_week && day.start_time) {
      let endTime = day.end_time;
      dayMap[day.day_of_week] = {
        start_time: day.start_time,
        end_time: endTime,
      };
    }
  });

  const enabledDayNames = Object.keys(dayMap);
  if (enabledDayNames.length === 0) {
    return [];
  }

  const enabledDayNumbers = new Set(
    enabledDayNames.map((dayName) => dayNames.indexOf(dayName)).filter((n) => n >= 0)
  );

  const isHoliday = (ymd) => {
    if (!holidayDateSet || !(holidayDateSet instanceof Set)) return false;
    return holidayDateSet.has(ymd);
  };

  const parseYmdToLocalDate = (ymd) => {
    if (!ymd || typeof ymd !== 'string') return null;
    const [y, m, d] = ymd.split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d, 12, 0, 0, 0);
  };

  const formatLocalDateToYmd = (dateObj) => {
    const y = dateObj.getFullYear();
    const mo = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${mo}-${d}`;
  };

  const startStr =
    startDate instanceof Date
      ? `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`
      : String(startDate);

  const startD = parseYmdToLocalDate(startStr);
  if (!startD) {
    return [];
  }

  const totalSessions = Number(number_of_phase) * Number(number_of_session_per_phase);
  if (!Number.isFinite(totalSessions) || totalSessions <= 0) {
    return [];
  }

  const dates = [];
  let currentDate = new Date(startD);
  let sessionsCompleted = 0;
  const perPhase = Number(number_of_session_per_phase);

  while (sessionsCompleted < totalSessions) {
    const dow = currentDate.getDay();
    const ymd = formatLocalDateToYmd(currentDate);

    if (enabledDayNumbers.has(dow) && !isHoliday(ymd)) {
      const dayOfWeekName = dayNames[dow];
      if (dayMap[dayOfWeekName]) {
        dates.push(ymd);
        sessionsCompleted++;

        if (sessionsCompleted % perPhase === 0 && sessionsCompleted < totalSessions) {
          currentDate.setDate(currentDate.getDate() + 1);
          continue;
        }
      }
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }

  return dates;
};

/**
 * Calculate the actual date for a specific session (aligned with generateClassSessions / computeSessionScheduleDates).
 * @param {string|Date} startDate - Class start date in YYYY-MM-DD format or Date object
 * @param {Array} daysOfWeek - Array of day objects with {day_of_week, start_time, end_time}
 * @param {number} phaseNumber - Phase number (1-indexed)
 * @param {number} sessionNumber - Session number within phase (1-indexed)
 * @param {number} sessionsPerPhase - Number of sessions per phase
 * @param {number} [numberOfPhases] - Total phases (required for full schedule; if omitted, falls back to legacy continuous schedule)
 * @param {Set<string>|null} [holidayDateSet] - Optional holidays to skip
 * @returns {string|null} - Date in YYYY-MM-DD format, or null if calculation fails
 */
const calculateSessionDate = (
  startDate,
  daysOfWeek,
  phaseNumber,
  sessionNumber,
  sessionsPerPhase,
  numberOfPhases = null,
  holidayDateSet = null
) => {
  if (!startDate || !daysOfWeek || daysOfWeek.length === 0 || !phaseNumber || !sessionNumber) {
    return null;
  }

  if (
    numberOfPhases != null &&
    Number(numberOfPhases) > 0 &&
    Number(sessionsPerPhase) > 0
  ) {
    const schedule = computeSessionScheduleDates({
      startDate,
      daysOfWeek,
      number_of_phase: numberOfPhases,
      number_of_session_per_phase: sessionsPerPhase,
      holidayDateSet,
    });
    const idx = (phaseNumber - 1) * Number(sessionsPerPhase) + sessionNumber - 1;
    return schedule[idx] || null;
  }

  // Legacy fallback (no phase count): original continuous calendar math
  const dayMap = {
    Sunday: 0,
    Monday: 1,
    Tuesday: 2,
    Wednesday: 3,
    Thursday: 4,
    Friday: 5,
    Saturday: 6,
  };

  const sortedDays = [...daysOfWeek]
    .filter((day) => day && (day.enabled !== false) && day.day_of_week)
    .sort((a, b) => {
      const dayA = typeof a === 'string' ? dayMap[a] : dayMap[a.day_of_week];
      const dayB = typeof b === 'string' ? dayMap[b] : dayMap[b.day_of_week];
      return dayA - dayB;
    });

  if (sortedDays.length === 0) {
    return null;
  }

  const dayNamesSorted = sortedDays.map((day) => (typeof day === 'string' ? day : day.day_of_week));
  const dayNumbers = dayNamesSorted.map((day) => dayMap[day]);

  let dateString;
  if (startDate instanceof Date) {
    const year = startDate.getFullYear();
    const month = String(startDate.getMonth() + 1).padStart(2, '0');
    const day = String(startDate.getDate()).padStart(2, '0');
    dateString = `${year}-${month}-${day}`;
  } else if (typeof startDate === 'string') {
    dateString = startDate;
  } else {
    dateString = String(startDate);
  }

  const [year, month, day] = dateString.split('-').map(Number);
  const start = new Date(year, month - 1, day, 12, 0, 0);
  const startDayOfWeek = start.getDay();

  const overallSessionNumber = sessionsPerPhase
    ? (phaseNumber - 1) * sessionsPerPhase + sessionNumber
    : sessionNumber;

  const sessionIndex = overallSessionNumber - 1;

  const dayIndexInCycle = sessionIndex % dayNamesSorted.length;

  const weekOffset = Math.floor(sessionIndex / dayNamesSorted.length);

  const firstDayNumber = dayNumbers[0];

  let baseDate;
  let baseDayOfWeek;

  if (dayNumbers.includes(startDayOfWeek)) {
    baseDate = new Date(year, month - 1, day, 12, 0, 0);
    baseDayOfWeek = startDayOfWeek;
  } else {
    let daysUntilFirstDay = firstDayNumber - startDayOfWeek;
    if (daysUntilFirstDay < 0) {
      daysUntilFirstDay += 7;
    }
    baseDate = new Date(year, month - 1, day + daysUntilFirstDay, 12, 0, 0);
    baseDayOfWeek = firstDayNumber;
  }

  const baseDayIndex = dayNumbers.indexOf(baseDayOfWeek);

  const targetDayIndex = dayIndexInCycle;
  const targetDayNumber = dayNumbers[targetDayIndex];

  let daysToAdd = 0;

  if (targetDayIndex >= baseDayIndex) {
    const dayDifference = targetDayNumber - baseDayOfWeek;
    daysToAdd = dayDifference + weekOffset * 7;
  } else {
    const daysToEndOfWeek = 7 - baseDayOfWeek;
    const daysFromStartOfWeek = targetDayNumber;
    daysToAdd = daysToEndOfWeek + daysFromStartOfWeek + weekOffset * 7;
  }

  const sessionDate = new Date(baseDate);
  sessionDate.setDate(baseDate.getDate() + daysToAdd);

  const resultYear = sessionDate.getFullYear();
  const resultMonth = String(sessionDate.getMonth() + 1).padStart(2, '0');
  const resultDay = String(sessionDate.getDate()).padStart(2, '0');
  return `${resultYear}-${resultMonth}-${resultDay}`;
};

/**
 * Calculate end time from start time and duration
 * @param {string} startTime - Start time in HH:MM:SS format
 * @param {number} durationHours - Duration in hours
 * @returns {string} - End time in HH:MM:SS format
 */
const calculateEndTime = (startTime, durationHours) => {
  if (!startTime || !durationHours) {
    return null;
  }

  const [hours, minutes, seconds = 0] = startTime.split(':').map(Number);
  const startDate = new Date();
  startDate.setHours(hours, minutes, seconds || 0, 0);

  const endDate = new Date(startDate.getTime() + durationHours * 60 * 60 * 1000);

  const endHours = String(endDate.getHours()).padStart(2, '0');
  const endMinutes = String(endDate.getMinutes()).padStart(2, '0');
  const endSeconds = String(endDate.getSeconds()).padStart(2, '0');
  return `${endHours}:${endMinutes}:${endSeconds}`;
};

/**
 * Generate all session records for a class.
 *
 * Holiday support:
 * - Pass `holidayDateSet` as a Set of YYYY-MM-DD strings. If a computed session date is in the set,
 *   that day is skipped and the schedule extends automatically.
 *
 * Between phases: next phase starts on the next eligible schedule day after the last session of
 * the previous phase (same month allowed).
 */
const generateClassSessions = (
  classData,
  daysOfWeek,
  phaseSessions,
  number_of_phase,
  number_of_session_per_phase,
  createdBy,
  sessionDurationPerDay = null,
  holidayDateSet = null
) => {
  if (!classData.start_date || !daysOfWeek || daysOfWeek.length === 0) {
    return [];
  }

  let durationHours = null;
  if (sessionDurationPerDay !== undefined && sessionDurationPerDay !== null) {
    if (typeof sessionDurationPerDay === 'number') {
      durationHours = sessionDurationPerDay;
    } else if (typeof sessionDurationPerDay === 'string') {
      const parsed = parseFloat(sessionDurationPerDay);
      if (!isNaN(parsed)) {
        durationHours = parsed;
      } else {
        try {
          const parsedObj = JSON.parse(sessionDurationPerDay);
          if (typeof parsedObj === 'object' && parsedObj !== null) {
            const firstValue = Object.values(parsedObj)[0];
            if (firstValue !== undefined) {
              durationHours = typeof firstValue === 'number' ? firstValue : parseFloat(firstValue);
            }
          }
        } catch (e) {
          console.error('Error parsing session duration:', e);
        }
      }
    } else if (typeof sessionDurationPerDay === 'object' && sessionDurationPerDay !== null) {
      const firstValue = Object.values(sessionDurationPerDay)[0];
      if (firstValue !== undefined) {
        durationHours = typeof firstValue === 'number' ? firstValue : parseFloat(firstValue);
      }
    }
  }

  const dayMap = {};
  daysOfWeek.forEach((day) => {
    if (day && day.day_of_week && day.start_time) {
      let endTime = day.end_time;
      if (durationHours !== null && !isNaN(durationHours)) {
        const calculatedEndTime = calculateEndTime(day.start_time, durationHours);
        if (calculatedEndTime) {
          endTime = calculatedEndTime;
        }
      }

      dayMap[day.day_of_week] = {
        start_time: day.start_time,
        end_time: endTime,
      };
    }
  });

  const phaseSessionMap = {};
  if (phaseSessions && Array.isArray(phaseSessions)) {
    phaseSessions.forEach((ps) => {
      const key = `${ps.phase_number}_${ps.phase_session_number}`;
      phaseSessionMap[key] = ps.phasesessiondetail_id;
    });
  }

  const enabledDayNames = Object.keys(dayMap);
  if (enabledDayNames.length === 0) {
    return [];
  }

  const scheduleDates = computeSessionScheduleDates({
    startDate: classData.start_date,
    daysOfWeek,
    number_of_phase,
    number_of_session_per_phase,
    holidayDateSet,
  });

  const sessions = [];
  const perPhase = Number(number_of_session_per_phase);

  scheduleDates.forEach((ymd, idx) => {
    const overallSessionNumber = idx + 1;
    const phase = Math.floor((overallSessionNumber - 1) / perPhase) + 1;
    const sessionInPhase = ((overallSessionNumber - 1) % perPhase) + 1;

    const [y, mo, d] = ymd.split('-').map(Number);
    const dt = new Date(y, mo - 1, d, 12, 0, 0, 0);
    const dow = dt.getDay();
    const dayOfWeekName = dayNames[dow];
    const daySchedule = dayMap[dayOfWeekName];
    if (!daySchedule) {
      return;
    }

    const key = `${phase}_${sessionInPhase}`;
    const phasesessiondetail_id = phaseSessionMap[key] || null;

    sessions.push({
      class_id: classData.class_id,
      phasesessiondetail_id,
      phase_number: phase,
      phase_session_number: sessionInPhase,
      scheduled_date: ymd,
      scheduled_start_time: daySchedule.start_time,
      scheduled_end_time: daySchedule.end_time,
      original_teacher_id: classData.teacher_id || null,
      assigned_teacher_id: classData.teacher_id || null,
      substitute_teacher_id: null,
      substitute_reason: null,
      status: 'Scheduled',
      actual_date: null,
      actual_start_time: null,
      actual_end_time: null,
      notes: null,
      created_by: createdBy || null,
    });
  });

  return sessions;
};

export { calculateSessionDate, generateClassSessions, computeSessionScheduleDates };
