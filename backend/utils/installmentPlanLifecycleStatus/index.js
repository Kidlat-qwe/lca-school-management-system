/**
 * Student History plan Status vs re-enrollment matrix Active/Inactive.
 *
 * `installmentinvoiceprofilestbl.is_active` stays the stored plan-open flag
 * (generation, unrejoined drop, last phase). Display Status must also match
 * the month-matrix overlay: unpaid installment past due — including
 * "Under grace period" — is Inactive.
 *
 * Historical dropped unpaid invoices are ignored so a later rejoin can stay
 * Active until the current open phase goes past due.
 *
 * @module utils/installmentPlanLifecycleStatus
 */

const OUTSTANDING_EPSILON = 0.009;

const toYmd = (value) => {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
};

const isCancelledStatus = (status) => {
  const key = String(status || '').trim().toLowerCase();
  return key === 'cancelled' || key === 'canceled';
};

const isDroppedEnrollment = (phase) =>
  String(phase?.program_enrollment_status || '').trim().toLowerCase() === 'dropped';

const isIgnoredBillingKind = (phase) => {
  const kind = String(phase?.billing_kind || '').trim().toLowerCase();
  return kind === 'late_start_gap' || kind === 'skipped_gap';
};

export const getInstallmentPhaseOutstandingForLifecycle = (phase) => {
  if (!phase?.is_generated) return 0;
  if (phase.remaining_balance != null || phase.balance != null) {
    return Math.max(0, Number(phase.remaining_balance ?? phase.balance ?? 0));
  }
  if (phase.amount == null) return 0;
  return Math.max(0, Number(phase.amount) - Number(phase.paid_amount || 0));
};

/**
 * True when a current (non-dropped) generated installment phase is unpaid
 * and its due date is before today (Manila YYYY-MM-DD).
 */
export const hasOpenUnpaidInstallmentPastDue = (phases, todayYmd) => {
  const today = toYmd(todayYmd);
  if (!today) return false;
  const list = Array.isArray(phases) ? phases : [];

  for (const phase of list) {
    if (!phase?.is_generated) continue;
    if (isDroppedEnrollment(phase)) continue;
    if (isIgnoredBillingKind(phase)) continue;
    if (isCancelledStatus(phase.status) || isCancelledStatus(phase.invoice_status)) continue;

    const dueYmd = toYmd(phase.due_date);
    if (!dueYmd) continue;
    if (dueYmd >= today) continue;
    if (getInstallmentPhaseOutstandingForLifecycle(phase) > OUTSTANDING_EPSILON) {
      return true;
    }
  }
  return false;
};

/**
 * Display Active/Inactive for Student History, aligned with the month matrix.
 *
 * @returns {boolean} true → show Active
 */
export const resolveInstallmentPlanLifecycleActive = ({
  isActive,
  upgradedToFullPayment = false,
  phases = [],
  todayYmd,
} = {}) => {
  if (upgradedToFullPayment) return false;
  if (isActive === false) return false;
  if (hasOpenUnpaidInstallmentPastDue(phases, todayYmd)) return false;
  return true;
};
