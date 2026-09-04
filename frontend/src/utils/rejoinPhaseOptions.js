import {
  getEnrollablePhaseNumbers,
  getInstallmentEnrollmentFloorPhase,
} from './classActivePhase';
import { isDroppedEnrollmentPhase } from './installmentPhaseSlotStatus';

/**
 * Absolute class phase floor after a drop.
 * Dropped Phase 2 → minimum rejoin target Phase 3.
 */
export const getMinRejoinPhaseAfterDrop = (maxDroppedAbsolutePhase) => {
  const dropped = Number(maxDroppedAbsolutePhase);
  if (!Number.isFinite(dropped) || dropped < 1) return null;
  return Math.floor(dropped) + 1;
};

/**
 * Highest absolute dropped phase on an installment plan table
 * (`phase_number` is local slot; add `phaseStartOffset` for absolute).
 */
export const resolveMaxDroppedAbsolutePhaseFromPlan = (
  phases,
  phaseStartOffset = 0
) => {
  const offset = Number(phaseStartOffset) || 0;
  let max = null;
  for (const phase of Array.isArray(phases) ? phases : []) {
    if (!isDroppedEnrollmentPhase(phase)) continue;
    const absolute = Number(phase.phase_number) + offset;
    if (!Number.isFinite(absolute) || absolute < 1) continue;
    if (max == null || absolute > max) max = absolute;
  }
  return max;
};

/**
 * Highest dropped absolute phase from Classes View Students row shape.
 */
export const resolveMaxDroppedAbsolutePhaseFromStudent = (student) => {
  if (!student) return null;
  const rows = student.phaseEnrollmentRows;
  if (Array.isArray(rows) && rows.length > 0) {
    let max = null;
    for (const row of rows) {
      if (String(row.program_enrollment_status || '').trim().toLowerCase() !== 'dropped') {
        continue;
      }
      const absolute = Number(row.phase_number);
      if (!Number.isFinite(absolute) || absolute < 1) continue;
      if (max == null || absolute > max) max = absolute;
    }
    return max;
  }
  if (String(student.program_enrollment_status || '').trim().toLowerCase() === 'dropped') {
    const absolute = Number(student.phase_number);
    return Number.isFinite(absolute) && absolute >= 1 ? absolute : null;
  }
  return null;
};

/**
 * Rejoin target phases:
 * - Start at max(class schedule floor, droppedPhase + 1)
 * - Through class max phase
 *
 * @param {object} args
 * @param {number|null} [args.minPhaseAfterDrop] Floor absolute phase (already dropped+1).
 */
export const buildRejoinPhaseOptions = ({
  classDetails,
  phaseSessions,
  classSessions,
  maxPhase,
  minPhaseAfterDrop = null,
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

  const floor =
    minPhaseAfterDrop != null && Number.isFinite(Number(minPhaseAfterDrop))
      ? Math.max(1, Math.floor(Number(minPhaseAfterDrop)))
      : null;

  const filtered =
    floor == null ? phaseNumbers : phaseNumbers.filter((absolute) => absolute >= floor);

  return filtered.map((absolute) => ({
    absolute,
    label: `Phase ${absolute}`,
  }));
};

export const getDefaultRejoinPhase = (context) => {
  const options = buildRejoinPhaseOptions(context);
  if (options.length > 0) {
    return options[0].absolute;
  }

  const scheduleFloor = getInstallmentEnrollmentFloorPhase(
    context.classDetails,
    context.phaseSessions,
    context.classSessions
  );
  const dropFloor =
    context.minPhaseAfterDrop != null && Number.isFinite(Number(context.minPhaseAfterDrop))
      ? Math.floor(Number(context.minPhaseAfterDrop))
      : null;
  const floor = Math.max(
    Number.isInteger(scheduleFloor) && scheduleFloor >= 1 ? scheduleFloor : 1,
    dropFloor != null && dropFloor >= 1 ? dropFloor : 1
  );
  const maxPhase =
    Number(context.maxPhase) ||
    Number(context.classDetails?.number_of_phase) ||
    floor;
  if (floor > maxPhase) return null;
  return floor;
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
