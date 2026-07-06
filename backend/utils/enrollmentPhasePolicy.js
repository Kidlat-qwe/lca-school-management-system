/**
 * Temporary enrollment policy override.
 *
 * When true, students may enroll in Phase 1 (and any earlier package phase)
 * even if the class schedule floor has moved forward.
 *
 * Set to false (or remove the override) to restore the default rule:
 * enrollment cannot start before the schedule-based minimum phase.
 */
export const ALLOW_ENROLLMENT_FROM_PREVIOUS_PHASES = false;

/**
 * @param {number} computedFloor Phase from schedule (previous phase last session rule).
 * @returns {number} Effective minimum enrollable phase.
 */
export function resolveEnrollmentFloorPhase(computedFloor) {
  if (ALLOW_ENROLLMENT_FROM_PREVIOUS_PHASES) {
    return 1;
  }
  const floor = Number(computedFloor);
  return Number.isInteger(floor) && floor >= 1 ? floor : 1;
}
