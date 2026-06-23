const PHASE_OUTSTANDING_EPSILON = 0.009;

/** Enrollment was dropped for this phase — billing slot is bypassed for pay/unlock. */
export const isDroppedEnrollmentPhase = (phase) =>
  String(phase?.program_enrollment_status || '').toLowerCase() === 'dropped';

/** Student never enrolled this class phase; billing starts on a later phase. */
export const isLateStartGapPhase = (phase) =>
  String(phase?.billing_kind || '').toLowerCase() === 'late_start_gap';

/** Rows that show all em-dashes (no billing / enrollment / pay action). */
export const isInactiveInstallmentPlanSlot = (phase) =>
  isDroppedEnrollmentPhase(phase) || isLateStartGapPhase(phase);

/**
 * True when an installment phase row has no remaining balance and earlier
 * phases can advance to the next slot.
 */
export const isInstallmentPlanSlotAddressed = (phase) => {
  if (!phase) return false;
  if (phase.plan_slot_addressed === true) return true;
  if (isDroppedEnrollmentPhase(phase)) return true;
  if (isLateStartGapPhase(phase)) return true;

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

/** Plan table rows — omit late-start gaps (student enrolled on a later class phase). */
export const filterVisibleInstallmentPlanPhases = (phases) =>
  (phases || []).filter((phase) => !isLateStartGapPhase(phase));

/**
 * Progress labels for Student History / Installment Plan modal when early plan
 * slots are late_start_gap (hidden from the table).
 */
export const computeInstallmentPlanDisplayProgress = ({
  phases = [],
  profile = null,
  downpayment = null,
  totals = null,
} = {}) => {
  const total =
    profile?.total_phases != null ? Number(profile.total_phases) : phases.length || 0;
  const visiblePhases = filterVisibleInstallmentPlanPhases(phases);
  const lateStartGapCount = phases.length - visiblePhases.length;

  const paidInstallmentCount = visiblePhases.filter((p) => {
    const st = String(p.status || '').toLowerCase();
    return st === 'paid' || st === 'paid all';
  }).length;

  const downpaymentPaid =
    profile?.downpayment_paid === true ||
    ['paid', 'paid all'].includes(String(downpayment?.status || '').toLowerCase());

  const generated = visiblePhases.filter((p) => p.is_generated).length;

  const addressedVisible =
    totals?.display_plan_slots_addressed != null
      ? Number(totals.display_plan_slots_addressed)
      : visiblePhases.filter(
          (p) => isInstallmentPlanSlotAddressed(p) && !isLateStartGapPhase(p)
        ).length;

  const denomPlanVisible =
    totals?.display_plan_slots_total != null
      ? Number(totals.display_plan_slots_total)
      : Math.max(0, total - lateStartGapCount);

  const paidNumerator =
    totals?.display_paid_numerator != null
      ? Number(totals.display_paid_numerator)
      : paidInstallmentCount + (downpaymentPaid ? 1 : 0);

  const paidDenominator =
    totals?.display_paid_denominator != null ? Number(totals.display_paid_denominator) : total;

  const generatedDisplay = generated + Math.max(0, (Number(profile?.phase_start) || 1) - 1);

  return {
    visiblePhases,
    lateStartGapCount,
    addressed: addressedVisible,
    denomPlan: denomPlanVisible,
    paidDisplay: paidNumerator,
    paidDenominator,
    generated,
    generatedDisplay: totals?.display_generated_numerator != null
      ? Number(totals.display_generated_numerator)
      : generated + Math.max(0, (Number(profile?.phase_start) || 1) - 1),
    generatedDenominator: total,
    planComplete:
      totals?.plan_complete === true ||
      (denomPlanVisible > 0 && addressedVisible >= denomPlanVisible),
    planPercent:
      denomPlanVisible > 0
        ? Math.min(100, Math.round((addressedVisible / denomPlanVisible) * 100))
        : 0,
  };
};

/** Billing column label for installment plan phase rows (Student History). */
export const getInstallmentPhaseBillingLabel = (phase) => {
  if (isLateStartGapPhase(phase)) return '\u2014';
  if (phase?.billing_kind === 'skipped_gap') return 'Skipped — no invoice';
  if (phase?.billing_kind === 'advance') return 'Advance payment';
  if (!phase?.is_generated) return '\u2014';
  if (phase?.is_rejoin_invoice) return 'Rejoin';
  if (phase?.is_auto_generated) return 'Auto-generated';
  return 'Generated';
};
