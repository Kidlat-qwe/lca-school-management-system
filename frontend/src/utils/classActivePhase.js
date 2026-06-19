import { calculateSessionDate } from './sessionCalculation';
import { todayManilaYMD } from './dateUtils';

const normalizeYmd = (value) => {
  if (value == null || value === '') return null;
  const str = String(value).trim();
  const match = str.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
};

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

  if (!classDetails?.start_date || !sessionsPerPhase) {
    return null;
  }

  return calculateSessionDate(
    normalizeYmd(classDetails.start_date) || classDetails.start_date,
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

/**
 * Resolve the last session date (YYYY-MM-DD) for a given phase.
 */
export const getPhaseLastSessionDate = (
  phaseNumber,
  phaseSessions,
  classSessions,
  classDetails,
  daysOfWeek,
  sessionsPerPhase
) => {
  const phaseGroup = groupPhaseSessions(phaseSessions).find((p) => p.phaseNum === phaseNumber);
  if (!phaseGroup?.sessions?.length) return null;

  const lastSession = phaseGroup.sessions[phaseGroup.sessions.length - 1];
  return resolveSessionDate(
    classSessions,
    classDetails,
    daysOfWeek,
    sessionsPerPhase,
    lastSession.phase_number,
    lastSession.phase_session_number
  );
};

/**
 * Which phase is "current" for display and enrollment floor.
 * Once today is after a phase's last session date, the next phase becomes the floor
 * (enrollment into earlier phases is closed).
 */
export const calculateActivePhase = (
  phaseSessions,
  classSessions,
  classDetails,
  daysOfWeek,
  sessionsPerPhase
) => {
  if (!phaseSessions?.length || !classDetails?.start_date) {
    return 1;
  }

  const todayStr = todayManilaYMD();
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

/**
 * Minimum phase number allowed for new enrollment.
 * Based on the previous phase's last session date: once that date has passed,
 * enrollment into earlier phases is no longer available.
 */
export const getInstallmentEnrollmentFloorPhase = (
  classDetails,
  phaseSessions,
  classSessions
) => {
  const daysOfWeek = classDetails?.days_of_week || [];
  const sessionsPerPhase = classDetails?.number_of_session_per_phase;

  return calculateActivePhase(
    phaseSessions,
    classSessions,
    classDetails,
    daysOfWeek,
    sessionsPerPhase
  );
};

/** True when the requested phase is before the enrollment floor (past / closed phase). */
export const isPhaseClosedForEnrollment = (
  phaseNumber,
  classDetails,
  phaseSessions,
  classSessions
) => {
  const requested = Number(phaseNumber);
  if (!Number.isInteger(requested) || requested < 1) {
    return true;
  }

  const floor = getInstallmentEnrollmentFloorPhase(classDetails, phaseSessions, classSessions);
  return requested < floor;
};

/** Phase numbers that may be selected for enrollment (from floor through maxPhase). */
export const getEnrollablePhaseNumbers = (
  classDetails,
  phaseSessions,
  classSessions,
  maxPhase
) => {
  const floor = getInstallmentEnrollmentFloorPhase(classDetails, phaseSessions, classSessions);
  const resolvedMax =
    Number(maxPhase) ||
    Number(classDetails?.number_of_phase) ||
    floor;

  if (resolvedMax < floor) {
    return [];
  }

  return Array.from({ length: resolvedMax - floor + 1 }, (_, idx) => floor + idx);
};
