/**
 * Temporary enrollment policy override (mirror of backend/utils/enrollmentPhasePolicy.js).
 *
 * Set ALLOW_ENROLLMENT_FROM_PREVIOUS_PHASES to false to restore schedule-based floor.
 */
export const ALLOW_ENROLLMENT_FROM_PREVIOUS_PHASES = true;

/**
 * @param {number} computedFloor
 * @returns {number}
 */
export function resolveEnrollmentFloorPhase(computedFloor) {
  if (ALLOW_ENROLLMENT_FROM_PREVIOUS_PHASES) {
    return 1;
  }
  const floor = Number(computedFloor);
  return Number.isInteger(floor) && floor >= 1 ? floor : 1;
}
