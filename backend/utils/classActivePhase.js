import { calculateSessionDate } from './sessionCalculation.js';
import { coerceToManilaYmd, todayYmdManila } from './dateUtils.js';

const normalizeYmd = (value) => coerceToManilaYmd(value) || null;

const resolveSessionDate = (
  classSessions,
  classDetails,
  daysOfWeek,
  sessionsPerPhase,
  phaseNumber,
  phaseSessionNumber
) => {
  const fromDb = classSessions.find(
    (cs) =>
      cs.phase_number === phaseNumber &&
      cs.phase_session_number === phaseSessionNumber
  )?.scheduled_date;

  const dbYmd = normalizeYmd(fromDb);
  if (dbYmd) return dbYmd;

  const startYmd = normalizeYmd(classDetails?.start_date);
  if (!startYmd || !sessionsPerPhase) {
    return null;
  }

  return calculateSessionDate(
    startYmd,
    daysOfWeek,
    phaseNumber,
    phaseSessionNumber,
    sessionsPerPhase,
    classDetails.number_of_phase
  );
};

const groupPhaseSessions = (phaseSessions) => {
  const sessionsByPhase = (phaseSessions || []).reduce((acc, session) => {
    const phaseNum = session.phase_number;
    if (!acc[phaseNum]) {
      acc[phaseNum] = [];
    }
    acc[phaseNum].push(session);
    return acc;
  }, {});

  return Object.keys(sessionsByPhase)
    .map(Number)
    .sort((a, b) => a - b)
    .map((phaseNum) => ({
      phaseNum,
      sessions: sessionsByPhase[phaseNum].sort(
        (a, b) => a.phase_session_number - b.phase_session_number
      ),
    }));
};

export const calculateActivePhaseFromSchedule = (
  phaseSessions,
  classSessions,
  classDetails,
  daysOfWeek,
  sessionsPerPhase
) => {
  if (!phaseSessions?.length || !classDetails?.start_date) {
    return 1;
  }

  const todayStr = todayYmdManila();
  const phases = groupPhaseSessions(phaseSessions);

  for (const { phaseNum, sessions } of phases) {
    const firstSession = sessions[0];
    const lastSession = sessions[sessions.length - 1];

    const firstSessionDate = resolveSessionDate(
      classSessions,
      classDetails,
      daysOfWeek,
      sessionsPerPhase,
      firstSession.phase_number,
      firstSession.phase_session_number
    );

    const lastSessionDate = resolveSessionDate(
      classSessions,
      classDetails,
      daysOfWeek,
      sessionsPerPhase,
      lastSession.phase_number,
      lastSession.phase_session_number
    );

    if (firstSessionDate && lastSessionDate) {
      if (todayStr >= firstSessionDate && todayStr <= lastSessionDate) {
        return phaseNum;
      }
    } else if (firstSessionDate && todayStr >= firstSessionDate) {
      return phaseNum;
    }
  }

  const firstPhase = phases[0];
  if (firstPhase?.sessions?.length) {
    const firstSession = firstPhase.sessions[0];
    const firstSessionDate = resolveSessionDate(
      classSessions,
      classDetails,
      daysOfWeek,
      sessionsPerPhase,
      firstSession.phase_number,
      firstSession.phase_session_number
    );

    if (firstSessionDate && todayStr < firstSessionDate) {
      return firstPhase.phaseNum;
    }
  }

  for (let i = 0; i < phases.length; i += 1) {
    const { phaseNum, sessions } = phases[i];
    const lastSession = sessions[sessions.length - 1];
    const lastSessionDate = resolveSessionDate(
      classSessions,
      classDetails,
      daysOfWeek,
      sessionsPerPhase,
      lastSession.phase_number,
      lastSession.phase_session_number
    );

    if (lastSessionDate && todayStr > lastSessionDate) {
      if (i < phases.length - 1) {
        return phases[i + 1].phaseNum;
      }
      return phaseNum;
    }
  }

  return phases[phases.length - 1]?.phaseNum || 1;
};

export const getInstallmentEnrollmentFloorPhase = (
  classDetails,
  phaseSessions,
  classSessions
) => {
  const daysOfWeek = classDetails?.days_of_week || [];
  const sessionsPerPhase = classDetails?.number_of_session_per_phase;

  return calculateActivePhaseFromSchedule(
    phaseSessions,
    classSessions,
    classDetails,
    daysOfWeek,
    sessionsPerPhase
  );
};

/**
 * Load phase/session schedule context for a class (used during enrollment).
 */
export const loadClassPhaseScheduleContext = async (client, classData) => {
  const classId = classData.class_id;
  const curriculumId = classData.curriculum_id;

  const schedulesResult = await client.query(
    'SELECT day_of_week, start_time, end_time FROM roomschedtbl WHERE class_id = $1 ORDER BY day_of_week',
    [classId]
  );

  let daysOfWeek = schedulesResult.rows;
  if (daysOfWeek.length === 0) {
    const sessionsScheduleResult = await client.query(
      `SELECT DISTINCT ON (EXTRACT(DOW FROM cs.scheduled_date))
         CASE EXTRACT(DOW FROM cs.scheduled_date)
           WHEN 0 THEN 'Sunday' WHEN 1 THEN 'Monday' WHEN 2 THEN 'Tuesday'
           WHEN 3 THEN 'Wednesday' WHEN 4 THEN 'Thursday' WHEN 5 THEN 'Friday'
           WHEN 6 THEN 'Saturday'
         END as day_of_week,
         cs.scheduled_start_time::text as start_time,
         cs.scheduled_end_time::text as end_time
       FROM classsessionstbl cs
       WHERE cs.class_id = $1
         AND COALESCE(cs.status, 'Scheduled') != 'Cancelled'
         AND cs.scheduled_start_time IS NOT NULL
         AND cs.scheduled_end_time IS NOT NULL
       ORDER BY EXTRACT(DOW FROM cs.scheduled_date), cs.scheduled_date`,
      [classId]
    );
    daysOfWeek = sessionsScheduleResult.rows;
  }

  let phaseSessions = [];
  if (curriculumId) {
    const phaseSessionsResult = await client.query(
      `SELECT phase_number, phase_session_number
       FROM phasesessionstbl
       WHERE curriculum_id = $1
       ORDER BY phase_number, phase_session_number`,
      [curriculumId]
    );
    phaseSessions = phaseSessionsResult.rows;
  }

  const classSessionsResult = await client.query(
    `SELECT phase_number, phase_session_number,
            TO_CHAR(scheduled_date, 'YYYY-MM-DD') as scheduled_date
     FROM classsessionstbl
     WHERE class_id = $1
       AND COALESCE(status, 'Scheduled') != 'Cancelled'
     ORDER BY scheduled_date, phase_number, phase_session_number`,
    [classId]
  );

  const classDetails = {
    start_date: normalizeYmd(classData.start_date),
    number_of_phase: classData.number_of_phase,
    number_of_session_per_phase: classData.number_of_session_per_phase,
    days_of_week: daysOfWeek,
  };

  return {
    classDetails,
    phaseSessions,
    classSessions: classSessionsResult.rows,
  };
};

/**
 * Minimum phase allowed for new enrollment based on class session schedule.
 */
export const resolveInstallmentEnrollmentMinPhase = async (client, classData) => {
  if (!classData?.class_id) {
    return 1;
  }

  const { classDetails, phaseSessions, classSessions } = await loadClassPhaseScheduleContext(
    client,
    classData
  );

  return getInstallmentEnrollmentFloorPhase(classDetails, phaseSessions, classSessions);
};
