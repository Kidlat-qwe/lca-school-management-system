import {
  getEnrollablePhaseNumbers,
  getInstallmentEnrollmentFloorPhase,
} from './classActivePhase';

/**
 * Rejoin target phases follow the same schedule floor as new enrollment
 * (View Class Details → current/active phase from session dates).
 */
export const buildRejoinPhaseOptions = ({
  classDetails,
  phaseSessions,
  classSessions,
  maxPhase,
}) => {
  const resolvedMax =
    Number(maxPhase) ||
    Number(classDetails?.number_of_phase) ||
    1;

  const phaseNumbers = getEnrollablePhaseNumbers(
    classDetails,
    phaseSessions,
    classSessions,
    resolvedMax
  );

  return phaseNumbers.map((absolute) => ({
    absolute,
    label: `Phase ${absolute}`,
  }));
};

export const getDefaultRejoinPhase = (context) => {
  const options = buildRejoinPhaseOptions(context);
  if (options.length > 0) {
    return options[0].absolute;
  }

  const floor = getInstallmentEnrollmentFloorPhase(
    context.classDetails,
    context.phaseSessions,
    context.classSessions
  );
  return Number.isInteger(floor) && floor >= 1 ? floor : 1;
};

/**
 * Load phase/session schedule used by Classes → View Class Details.
 */
export const fetchClassRejoinScheduleContext = async (classId, apiRequest) => {
  if (!classId) {
    return { phaseSessions: [], classSessions: [], classDetails: {} };
  }

  const [phaseResponse, sessionsResponse] = await Promise.all([
    apiRequest(`/classes/${classId}/phasesessions`),
    apiRequest(`/classes/${classId}/sessions`).catch(() => ({ success: false, data: [] })),
  ]);

  return {
    phaseSessions: phaseResponse?.data?.phasesessions || [],
    classSessions: sessionsResponse?.success ? sessionsResponse.data || [] : [],
    classDetails: phaseResponse?.data?.class || {},
  };
};
