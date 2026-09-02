/**
 * Continue per phase: student already enrolled in class, extending to a higher phase range.
 * Package merchandise must not be issued on this path.
 */

export const CONTINUE_PER_PHASE_REMARK = 'CONTINUE_PER_PHASE:1';

/**
 * @param {{
 *   hasActiveEnrollment?: boolean,
 *   highestActivePhase?: number|null,
 *   requestedStartPhase?: number|null,
 * }} params
 */
export function resolveIsContinuePerPhaseEnrollment({
  hasActiveEnrollment = false,
  highestActivePhase = 0,
  requestedStartPhase = null,
} = {}) {
  const start = requestedStartPhase != null ? parseInt(requestedStartPhase, 10) : NaN;
  const highest = parseInt(highestActivePhase, 10) || 0;
  return (
    Boolean(hasActiveEnrollment) &&
    Number.isInteger(start) &&
    start > 0 &&
    start > highest
  );
}

/** @param {string|null|undefined} remarks */
export function isContinuePerPhaseInvoiceRemarks(remarks) {
  return /CONTINUE_PER_PHASE:1/i.test(String(remarks || ''));
}

/** @param {string|null|undefined} remarks */
export function stampContinuePerPhaseOnRemarks(remarks) {
  const base = String(remarks || '').trim();
  if (isContinuePerPhaseInvoiceRemarks(base)) return base;
  return base ? `${base};${CONTINUE_PER_PHASE_REMARK}` : CONTINUE_PER_PHASE_REMARK;
}
