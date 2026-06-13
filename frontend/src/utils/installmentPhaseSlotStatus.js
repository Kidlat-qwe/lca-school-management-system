const PHASE_OUTSTANDING_EPSILON = 0.009;

/** Enrollment was dropped for this phase — billing slot is bypassed for pay/unlock. */
export const isDroppedEnrollmentPhase = (phase) =>
  String(phase?.program_enrollment_status || '').toLowerCase() === 'dropped';

/**
 * True when an installment phase row has no remaining balance and earlier
 * phases can advance to the next slot.
 */
export const isInstallmentPlanSlotAddressed = (phase) => {
  if (!phase) return false;
  if (phase.plan_slot_addressed === true) return true;
  if (isDroppedEnrollmentPhase(phase)) return true;

  const status = String(phase.status || '').toLowerCase();
  if (status.includes('skipped') || phase.billing_kind === 'skipped_gap') {
    return true;
  }
  if (status === 'paid' || status === 'paid all') {
    return true;
  }

  if (!phase.is_generated) {
    return false;
  }

  const amount = phase.amount != null ? Number(phase.amount) : null;
  const paid = Number(phase.paid_amount || 0);
  if (amount != null) {
    return Math.max(0, amount - paid) <= PHASE_OUTSTANDING_EPSILON;
  }

  return paid > PHASE_OUTSTANDING_EPSILON && status === 'paid';
};

export const getInstallmentPhaseOutstanding = (phase) => {
  if (!phase?.is_generated || phase.amount == null) return 0;
  return Math.max(0, Number(phase.amount) - Number(phase.paid_amount || 0));
};
