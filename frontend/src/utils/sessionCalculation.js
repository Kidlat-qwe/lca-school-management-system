/**
 * Session date schedule (mirrors backend/utils/sessionCalculation.js).
 * Between phases: after the last session of a phase, advance one day; the next phase starts on
 * the next eligible schedule weekday (phases may share the same month).
 */

const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * @param {string} startDateYmd - YYYY-MM-DD
 * @param {Array} daysOfWeek - room schedule rows
 * @param {number} number_of_phase
 * @param {number} number_of_session_per_phase
 * @param {Set<string>|null} holidayDateSet
 * @returns {string[]} YYYY-MM-DD for each session in order
 */
export function computeSessionScheduleDates(
  startDateYmd,
  daysOfWeek,
  number_of_phase,
  number_of_session_per_phase,
  holidayDateSet = null
) {
  if (!startDateYmd || !daysOfWeek || daysOfWeek.length === 0) {
    return [];
  }

  const dayMap = {};
  daysOfWeek.forEach((day) => {
    if (day && day.day_of_week && day.start_time) {
      dayMap[day.day_of_week] = {
        start_time: day.start_time,
        end_time: day.end_time,
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
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const startDate = parseYmdToLocalDate(String(startDateYmd));
  if (!startDate) {
    return [];
  }

  const totalSessions = Number(number_of_phase) * Number(number_of_session_per_phase);
  if (!Number.isFinite(totalSessions) || totalSessions <= 0) {
    return [];
  }

  const dates = [];
  let currentDate = new Date(startDate);
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
}

/**
 * @param {string} startDate
 * @param {Array} daysOfWeek
 * @param {number} phaseNumber
 * @param {number} sessionNumber
 * @param {number} sessionsPerPhase
 * @param {number} numberOfPhase - total phases (required for full schedule)
 * @param {Set<string>|null} holidayDateSet
 */
export function calculateSessionDate(
  startDate,
  daysOfWeek,
  phaseNumber,
  sessionNumber,
  sessionsPerPhase,
  numberOfPhase,
  holidayDateSet = null
) {
  if (!numberOfPhase || !sessionsPerPhase) {
    return null;
  }
  const schedule = computeSessionScheduleDates(
    startDate,
    daysOfWeek,
    numberOfPhase,
    sessionsPerPhase,
    holidayDateSet
  );
  const idx = (phaseNumber - 1) * sessionsPerPhase + sessionNumber - 1;
  return schedule[idx] || null;
}
