/**
 * Utility functions for calculating and generating class sessions
 * 
 * This module handles the logic for generating individual session records
 * based on class schedule, start date, and curriculum structure.
 */

/**
 * Calculate the actual date for a specific session
 * @param {string|Date} startDate - Class start date in YYYY-MM-DD format or Date object
 * @param {Array} daysOfWeek - Array of day objects with {day_of_week, start_time, end_time}
 * @param {number} phaseNumber - Phase number (1-indexed)
 * @param {number} sessionNumber - Session number within phase (1-indexed)
 * @param {number} sessionsPerPhase - Number of sessions per phase
 * @returns {string|null} - Date in YYYY-MM-DD format, or null if calculation fails
 */
const calculateSessionDate = (startDate, daysOfWeek, phaseNumber, sessionNumber, sessionsPerPhase) => {
  if (!startDate || !daysOfWeek || daysOfWeek.length === 0 || !phaseNumber || !sessionNumber) {
    return null;
  }

  const dayMap = {
    'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3,
    'Thursday': 4, 'Friday': 5, 'Saturday': 6
  };

  // Filter enabled days and sort them
  const sortedDays = [...daysOfWeek]
    .filter(day => day && (day.enabled !== false) && day.day_of_week)
    .sort((a, b) => {
      const dayA = typeof a === 'string' ? dayMap[a] : dayMap[a.day_of_week];
      const dayB = typeof b === 'string' ? dayMap[b] : dayMap[b.day_of_week];
      return dayA - dayB;
    });

  if (sortedDays.length === 0) {
    return null;
  }

  const dayNames = sortedDays.map(day => typeof day === 'string' ? day : day.day_of_week);
  const dayNumbers = dayNames.map(day => dayMap[day]);

  // Convert startDate to string if it's a Date object
  let dateString;
  if (startDate instanceof Date) {
    // Convert Date object to YYYY-MM-DD string
    const year = startDate.getFullYear();
    const month = String(startDate.getMonth() + 1).padStart(2, '0');
    const day = String(startDate.getDate()).padStart(2, '0');
    dateString = `${year}-${month}-${day}`;
  } else if (typeof startDate === 'string') {
    dateString = startDate;
  } else {
    // Try to convert to string if it's some other format
    dateString = String(startDate);
  }

  // Parse start date as local date (YYYY-MM-DD format)
  const [year, month, day] = dateString.split('-').map(Number);
  const start = new Date(year, month - 1, day, 12, 0, 0);
  const startDayOfWeek = start.getDay();

  // Calculate which session number this is (1-indexed across all phases)
  const overallSessionNumber = sessionsPerPhase 
    ? (phaseNumber - 1) * sessionsPerPhase + sessionNumber
    : sessionNumber;

  // Session index (0-indexed)
  const sessionIndex = overallSessionNumber - 1;
  
  // Which day in the cycle (0 = first enabled day, 1 = second enabled day, etc.)
  const dayIndexInCycle = sessionIndex % dayNames.length;
  
  // Which week (0 = first week, 1 = second week, etc.)
  const weekOffset = Math.floor(sessionIndex / dayNames.length);

  // Get the target day name for this session
  const targetDayName = dayNames[dayIndexInCycle];

  // Find the first enabled day in the cycle
  const firstDayNumber = dayNumbers[0];
  
  // Check if start date is already on an enabled day
  let baseDate;
  let baseDayOfWeek;
  
  if (dayNumbers.includes(startDayOfWeek)) {
    // Start date is on an enabled day, use it as the base
    baseDate = new Date(year, month - 1, day, 12, 0, 0);
    baseDayOfWeek = startDayOfWeek;
  } else {
    // Start date is not on an enabled day, find the next enabled day
    let daysUntilFirstDay = firstDayNumber - startDayOfWeek;
    if (daysUntilFirstDay < 0) {
      daysUntilFirstDay += 7; // Next week
    }
    baseDate = new Date(year, month - 1, day + daysUntilFirstDay, 12, 0, 0);
    baseDayOfWeek = firstDayNumber;
  }
  
  // Find which position the base day is in the enabled days cycle
  const baseDayIndex = dayNumbers.indexOf(baseDayOfWeek);
  
  // Calculate which day in the cycle this session should be on
  const targetDayIndex = dayIndexInCycle;
  const targetDayNumber = dayNumbers[targetDayIndex];
  
  // Calculate how many days to add from base date
  let daysToAdd = 0;
  
  if (targetDayIndex >= baseDayIndex) {
    // Target day is same week or later in the cycle
    // Calculate actual calendar day difference
    const dayDifference = targetDayNumber - baseDayOfWeek;
    daysToAdd = dayDifference + (weekOffset * 7);
  } else {
    // Target day is earlier in the cycle, need to go to next week
    // Calculate days to end of week + days from start of week
    const daysToEndOfWeek = 7 - baseDayOfWeek;
    const daysFromStartOfWeek = targetDayNumber;
    daysToAdd = daysToEndOfWeek + daysFromStartOfWeek + (weekOffset * 7);
  }
  
  // Calculate the final session date
  const sessionDate = new Date(baseDate);
  sessionDate.setDate(baseDate.getDate() + daysToAdd);

  // Format as YYYY-MM-DD (using local date components to avoid timezone conversion)
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

  // Add duration in hours
  const endDate = new Date(startDate.getTime() + (durationHours * 60 * 60 * 1000));

  // Format as HH:MM:SS
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
 * @param {Object} classData - Class data with class_id, teacher_id, start_date, etc.
 * @param {Array} daysOfWeek - Array of day objects from roomschedtbl
 * @param {Array} phaseSessions - Array of phase sessions from phasesessionstbl
 * @param {number} number_of_phase - Number of phases
 * @param {number} number_of_session_per_phase - Number of sessions per phase
 * @param {number} createdBy - User ID who is creating the sessions
 * @param {number|Object} sessionDurationPerDay - Optional fixed duration in hours for all sessions, or legacy object format for backward compatibility
 * @param {Set<string>} holidayDateSet - Optional set of YYYY-MM-DD holiday dates to skip
 * @returns {Array} - Array of session objects ready for database insertion
 */
const generateClassSessions = (classData, daysOfWeek, phaseSessions, number_of_phase, number_of_session_per_phase, createdBy, sessionDurationPerDay = null, holidayDateSet = null) => {
  if (!classData.start_date || !daysOfWeek || daysOfWeek.length === 0) {
    return [];
  }

  const sessions = [];
  const dayMap = {}; // Map day_of_week to {start_time, end_time}

  // Parse sessionDurationHours (single fixed duration for all sessions)
  let durationHours = null;
  if (sessionDurationPerDay !== undefined && sessionDurationPerDay !== null) {
    // Handle both old format (object) and new format (number)
    if (typeof sessionDurationPerDay === 'number') {
      durationHours = sessionDurationPerDay;
    } else if (typeof sessionDurationPerDay === 'string') {
      // Try to parse as number first (new format)
      const parsed = parseFloat(sessionDurationPerDay);
      if (!isNaN(parsed)) {
        durationHours = parsed;
      } else {
        // Fallback: try to parse as JSON (old format for backward compatibility)
        try {
          const parsedObj = JSON.parse(sessionDurationPerDay);
          // If it's an object, extract first value (migration scenario)
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
      // Old format: extract first value for backward compatibility
      const firstValue = Object.values(sessionDurationPerDay)[0];
      if (firstValue !== undefined) {
        durationHours = typeof firstValue === 'number' ? firstValue : parseFloat(firstValue);
      }
    }
  }

  // Build day map from daysOfWeek
  daysOfWeek.forEach(day => {
    if (day && day.day_of_week && day.start_time) {
      let endTime = day.end_time; // Default to existing end_time
      
      // If fixed duration is configured, calculate end_time from start_time for all days
      if (durationHours !== null && !isNaN(durationHours)) {
        const calculatedEndTime = calculateEndTime(day.start_time, durationHours);
        if (calculatedEndTime) {
          endTime = calculatedEndTime;
        }
      }

      dayMap[day.day_of_week] = {
        start_time: day.start_time,
        end_time: endTime
      };
    }
  });

  // Create a map of phase/session to phasesessiondetail_id
  const phaseSessionMap = {};
  if (phaseSessions && Array.isArray(phaseSessions)) {
    phaseSessions.forEach(ps => {
      const key = `${ps.phase_number}_${ps.phase_session_number}`;
      phaseSessionMap[key] = ps.phasesessiondetail_id;
    });
  }

  const enabledDayNames = Object.keys(dayMap);
  if (enabledDayNames.length === 0) {
    return [];
  }

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
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
    // Use noon to avoid DST issues
    return new Date(y, m - 1, d, 12, 0, 0, 0);
  };

  const formatLocalDateToYmd = (dateObj) => {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const startDate = parseYmdToLocalDate(
    classData.start_date instanceof Date
      ? `${classData.start_date.getFullYear()}-${String(classData.start_date.getMonth() + 1).padStart(2, '0')}-${String(classData.start_date.getDate()).padStart(2, '0')}`
      : String(classData.start_date)
  );

  if (!startDate) {
    return [];
  }

  const totalSessions = Number(number_of_phase) * Number(number_of_session_per_phase);
  if (!Number.isFinite(totalSessions) || totalSessions <= 0) {
    return [];
  }

  let currentDate = new Date(startDate);
  let sessionsCompleted = 0;

  // Iterate day-by-day and assign sessions in order, skipping holidays.
  while (sessionsCompleted < totalSessions) {
    const dow = currentDate.getDay();
    const ymd = formatLocalDateToYmd(currentDate);

    if (enabledDayNumbers.has(dow) && !isHoliday(ymd)) {
      const overallSessionNumber = sessionsCompleted + 1; // 1-indexed across whole curriculum
      const phase = Math.floor((overallSessionNumber - 1) / Number(number_of_session_per_phase)) + 1;
      const sessionInPhase = ((overallSessionNumber - 1) % Number(number_of_session_per_phase)) + 1;

      const dayOfWeekName = dayNames[dow];
      const daySchedule = dayMap[dayOfWeekName];
      if (daySchedule) {
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
          created_by: createdBy || null
        });

        sessionsCompleted++;
      }
    }

    // Move to next day
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return sessions;
};

export { calculateSessionDate, generateClassSessions };

