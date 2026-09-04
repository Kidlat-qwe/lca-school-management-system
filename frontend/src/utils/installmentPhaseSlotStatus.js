const PHASE_OUTSTANDING_EPSILON = 0.009;

/** Enrollment was dropped for this phase — billing slot is bypassed for pay/unlock. */
export const isDroppedEnrollmentPhase = (phase) =>
  String(phase?.program_enrollment_status || '').toLowerCase() === 'dropped';

/** Student never enrolled this class phase; billing starts on a later phase. */
export const isLateStartGapPhase = (phase) =>
  String(phase?.billing_kind || '').toLowerCase() === 'late_start_gap';

/** Late-start gap rows only — dropped phases still show enrollment and billing history. */
export const isInactiveInstallmentPlanSlot = (phase) => isLateStartGapPhase(phase);

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

  if (phase.remaining_balance != null || phase.balance != null) {
    const remaining = Number(phase.remaining_balance ?? phase.balance ?? 0);
    return remaining <= PHASE_OUTSTANDING_EPSILON;
  }

  const amount = phase.amount != null ? Number(phase.amount) : null;
  const paid = Number(phase.paid_amount || 0);
  if (amount != null) {
    return Math.max(0, amount - paid) <= PHASE_OUTSTANDING_EPSILON;
  }

  return paid > PHASE_OUTSTANDING_EPSILON && status === 'paid';
};

export const getInstallmentPhaseOutstanding = (phase) => {
  if (!phase?.is_generated) return 0;
  if (phase.remaining_balance != null || phase.balance != null) {
    return Math.max(0, Number(phase.remaining_balance ?? phase.balance ?? 0));
  }
  if (phase.amount == null) return 0;
  return Math.max(0, Number(phase.amount) - Number(phase.paid_amount || 0));
};

/**
 * Dropped enrollment with remaining invoice balance.
 * Fully unpaid drops use Rejoin; partial drops can Pay Now to settle remaining.
 */
export const isUnpaidDroppedEnrollmentPhase = (phase) => {
  if (!isDroppedEnrollmentPhase(phase)) return false;
  if (!phase?.is_generated) return true;
  return getInstallmentPhaseOutstanding(phase) > PHASE_OUTSTANDING_EPSILON;
};

/** Dropped phase that already has payment and still has remaining (settle via Pay Now). */
export const isPartialDroppedSettlePhase = (phase) => {
  if (!isDroppedEnrollmentPhase(phase)) return false;
  if (!phase?.is_generated) return false;
  const paid = Number(phase.paid_amount || 0);
  return (
    paid > PHASE_OUTSTANDING_EPSILON &&
    getInstallmentPhaseOutstanding(phase) > PHASE_OUTSTANDING_EPSILON
  );
};

/** Index of the latest unpaid-dropped phase in a visible phases list, or -1. */
export const findLatestUnpaidDroppedPhaseIndex = (phases) => {
  if (!Array.isArray(phases) || !phases.length) return -1;
  let latest = -1;
  for (let i = 0; i < phases.length; i += 1) {
    if (isUnpaidDroppedEnrollmentPhase(phases[i])) latest = i;
  }
  return latest;
};

const ACTIVE_ENROLLMENT_KEYS = new Set([
  'new',
  're_enrolled',
  'upsell',
  'rejoin',
  'completed',
]);

/**
 * True when billing/enrollment continued after an unpaid drop
 * (active enrollment, paid later invoice, or a dedicated rejoin invoice).
 * A later auto-generated unpaid invoice alone is NOT a continue — that is
 * still blocked and the student must Rejoin.
 */
export const hasContinuedAfterUnpaidDrop = (phases, dropIdx) => {
  if (!Array.isArray(phases) || dropIdx < 0) return false;
  for (let i = dropIdx + 1; i < phases.length; i += 1) {
    const p = phases[i];
    if (isLateStartGapPhase(p) || isDroppedEnrollmentPhase(p)) continue;
    const enr = String(p?.program_enrollment_status || '').toLowerCase();
    if (ACTIVE_ENROLLMENT_KEYS.has(enr)) return true;
    if (!p?.is_generated) continue;
    const st = String(p.status || '').toLowerCase();
    if (st === 'paid' || st === 'paid all') return true;
    if (p?.is_rejoin_invoice) return true;
  }
  return false;
};

/** Empty Not Generated slot with no enrollment — skipped when continuing after a drop. */
export const isEmptyNotGeneratedPlanGap = (phase) => {
  if (!phase || isLateStartGapPhase(phase) || isDroppedEnrollmentPhase(phase)) return false;
  if (phase.is_generated) return false;
  const st = String(phase.status || '').toLowerCase();
  if (st && st !== 'not generated') return false;
  const enr = String(phase.program_enrollment_status || '').trim().toLowerCase();
  return !enr || enr === '-' || enr === '—' || enr === '\u2014';
};

/** Latest index with real billing/enrollment activity (generated invoice or known enrollment status). */
export const findLastTouchedPhaseIndex = (phases) => {
  if (!Array.isArray(phases)) return -1;
  let latest = -1;
  phases.forEach((p, i) => {
    if (isLateStartGapPhase(p)) return;
    const enr = String(p?.program_enrollment_status || '').trim().toLowerCase();
    const hasEnrollment = enr && enr !== '-' && enr !== '\u2014';
    if (p?.is_generated || hasEnrollment) {
      latest = i;
    }
  });
  return latest;
};

/**
 * A past, non-generated gap phase with no enrollment record — occurs before the
 * latest phase with real activity, so the student is confirmed to have never
 * enrolled that phase (as opposed to a future phase that simply hasn't arrived yet).
 */
export const isPastUnenrolledGapPhase = (phases, phaseIndex) => {
  if (!Array.isArray(phases) || phaseIndex < 0 || phaseIndex >= phases.length) return false;
  if (!isEmptyNotGeneratedPlanGap(phases[phaseIndex])) return false;
  const lastTouched = findLastTouchedPhaseIndex(phases);
  return phaseIndex < lastTouched;
};

/**
 * Latest index after an unpaid drop where the student continued
 * (active enrollment, paid invoice, or rejoin invoice). -1 if none.
 */
export const findLatestContinuedPhaseIndexAfterDrop = (phases, dropIdx) => {
  if (!Array.isArray(phases) || dropIdx < 0) return -1;
  let latest = -1;
  for (let i = dropIdx + 1; i < phases.length; i += 1) {
    const p = phases[i];
    if (isLateStartGapPhase(p) || isDroppedEnrollmentPhase(p)) continue;
    const enr = String(p?.program_enrollment_status || '').toLowerCase();
    if (ACTIVE_ENROLLMENT_KEYS.has(enr)) {
      latest = i;
      continue;
    }
    if (!p?.is_generated) continue;
    const st = String(p.status || '').toLowerCase();
    if (st === 'paid' || st === 'paid all' || p?.is_rejoin_invoice) {
      latest = i;
    }
  }
  return latest;
};

/**
 * Show plan Rejoin only when an unpaid drop blocks further billing and the
 * student has not continued (no later rejoin / paid invoice after the drop).
 * If they already continued, use Pay Now on the next phase instead.
 */
export const shouldOfferInstallmentPlanRejoin = (phases, profile = null) => {
  const list = Array.isArray(phases) ? phases : [];
  const blockIdx = findLatestUnpaidDroppedPhaseIndex(list);
  if (blockIdx < 0) return false;
  if (hasContinuedAfterUnpaidDrop(list, blockIdx)) return false;
  const hasLaterOpenSlot = list.slice(blockIdx + 1).some((p) => {
    if (isLateStartGapPhase(p)) return false;
    if (isDroppedEnrollmentPhase(p)) return false;
    const st = String(p?.status || '').toLowerCase();
    if (!p?.is_generated || st === 'not generated') return true;
    // Later unpaid auto-generated invoice after a drop still needs Rejoin.
    if (p?.is_rejoin_invoice) return false;
    return getInstallmentPhaseOutstanding(p) > PHASE_OUTSTANDING_EPSILON;
  });
  if (hasLaterOpenSlot) return true;
  return profile?.is_active === false;
};

/** Phase has payment recorded but an unsettled remainder (blocks later phases). */
export const hasOpenPartialPhaseBalance = (phase) => {
  if (!phase?.is_generated || isInactiveInstallmentPlanSlot(phase)) return false;
  const balance = getInstallmentPhaseOutstanding(phase);
  const paid = Number(phase.paid_amount || 0);
  return paid > PHASE_OUTSTANDING_EPSILON && balance > PHASE_OUTSTANDING_EPSILON;
};

/** True when an earlier phase still has an open partial-payment balance. */
export const isPhaseLockedByPriorPartialBalance = (phases, phaseIndex) => {
  if (!Array.isArray(phases) || phaseIndex <= 0) return false;
  for (let i = 0; i < phaseIndex; i += 1) {
    if (hasOpenPartialPhaseBalance(phases[i])) return true;
  }
  return false;
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

const toPhaseDueYmd = (value) => {
  if (value == null || value === '') return null;
  const match = String(value).trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
};

/**
 * Student History Status aligned with the month-matrix overlay:
 * unpaid current installment past due (including under grace) → Inactive.
 * Prefers API `profile.lifecycle_is_active` when present.
 */
export const resolveInstallmentPlanLifecycleActive = ({
  profile = null,
  phases = [],
  todayYmd,
} = {}) => {
  if (profile && typeof profile.lifecycle_is_active === 'boolean') {
    return profile.lifecycle_is_active;
  }
  if (profile?.upgraded_to_full_payment) return false;
  if (profile?.is_active === false) return false;

  const today = toPhaseDueYmd(todayYmd);
  if (!today) return profile?.is_active !== false;

  for (const phase of Array.isArray(phases) ? phases : []) {
    if (!phase?.is_generated) continue;
    if (isDroppedEnrollmentPhase(phase)) continue;
    if (isLateStartGapPhase(phase) || phase?.billing_kind === 'skipped_gap') continue;
    const status = String(phase.status || phase.invoice_status || '').trim().toLowerCase();
    if (status === 'cancelled' || status === 'canceled') continue;
    const dueYmd = toPhaseDueYmd(phase.due_date);
    if (!dueYmd || dueYmd >= today) continue;
    if (getInstallmentPhaseOutstanding(phase) > PHASE_OUTSTANDING_EPSILON) {
      return false;
    }
  }
  return true;
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
