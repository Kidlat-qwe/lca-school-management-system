import { formatYmdLocal, parseYmdToLocalNoon } from './dateUtils.js';

const PHASE_INSTALLMENT_DUE_DAYS_BEFORE = 1;

const normalizeDateInput = (value) => {
  if (!value) return null;
  if (value instanceof Date) return new Date(value.getTime());

  const str = String(value).trim();
  if (!str) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return parseYmdToLocalNoon(str);
  }

  const parsed = new Date(str);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const startOfMonth = (dateValue) => {
  const date = normalizeDateInput(dateValue);
  if (!date) return null;
  return new Date(date.getFullYear(), date.getMonth(), 1, 12, 0, 0, 0);
};

const subtractDays = (dateValue, days) => {
  const date = normalizeDateInput(dateValue);
  if (!date) return null;
  const result = new Date(date.getTime());
  result.setDate(result.getDate() - days);
  return result;
};

const setDayOfMonth = (dateValue, day) => {
  const date = normalizeDateInput(dateValue);
  if (!date) return null;
  return new Date(date.getFullYear(), date.getMonth(), day, 12, 0, 0, 0);
};

export const isPhaseInstallmentProfile = (profile = {}) =>
  profile.phase_start !== null &&
  profile.phase_start !== undefined &&
  profile.class_id !== null &&
  profile.class_id !== undefined;

export const getCurrentInstallmentPhaseNumber = (profile = {}, generatedCountOverride = null) => {
  const startPhase = profile.phase_start !== null && profile.phase_start !== undefined
    ? parseInt(profile.phase_start, 10)
    : 1;
  const generatedCount = generatedCountOverride !== null && generatedCountOverride !== undefined
    ? parseInt(generatedCountOverride, 10)
    : parseInt(profile.generated_count || 0, 10);

  return startPhase + Math.max(0, generatedCount);
};

export const getLastInstallmentPhaseNumber = (profile = {}) => {
  if (!isPhaseInstallmentProfile(profile)) return null;

  const startPhase = parseInt(profile.phase_start, 10);
  const totalPhases = parseInt(profile.total_phases || 0, 10);
  if (!Number.isInteger(startPhase) || !Number.isInteger(totalPhases) || totalPhases <= 0) {
    return null;
  }

  return startPhase + totalPhases - 1;
};

export const getPhaseStartDate = async (db, classId, phaseNumber) => {
  if (!classId || !phaseNumber) return null;

  const result = await db.query(
    `SELECT MIN(scheduled_date) AS phase_start_date
     FROM classsessionstbl
     WHERE class_id = $1 AND phase_number = $2`,
    [classId, phaseNumber]
  );

  const value = result.rows[0]?.phase_start_date || null;
  return normalizeDateInput(value);
};

export const getPhaseDueDateYmd = async (db, classId, phaseNumber, dueDaysBefore = PHASE_INSTALLMENT_DUE_DAYS_BEFORE) => {
  const phaseStart = await getPhaseStartDate(db, classId, phaseNumber);
  if (!phaseStart) return null;
  const dueDate = subtractDays(phaseStart, dueDaysBefore);
  return dueDate ? formatYmdLocal(dueDate) : null;
};

/**
 * Builds invoice/generation dates from the earliest class session per phase (MIN scheduled_date).
 *
 * Due date is always (phase start − PHASE_INSTALLMENT_DUE_DAYS_BEFORE) — never raised to match a
 * billing "generation day" (e.g. 25th). Issue date uses issueDateOverride when it is on or before
 * due; otherwise it is capped to due so payment is never due before the stated issue date.
 */
export const buildPhaseInstallmentSchedule = async ({
  db,
  profile,
  generatedCountOverride = null,
  issueDateOverride = null,
}) => {
  if (!isPhaseInstallmentProfile(profile)) {
    return null;
  }

  const currentPhaseNumber = getCurrentInstallmentPhaseNumber(profile, generatedCountOverride);
  const lastPhaseNumber = getLastInstallmentPhaseNumber(profile);
  if (lastPhaseNumber !== null && currentPhaseNumber > lastPhaseNumber) {
    return {
      current_phase_number: null,
      current_phase_start_date: null,
      current_issue_date: null,
      current_due_date: null,
      current_invoice_month: null,
      current_generation_date: null,
      next_phase_number: null,
      next_phase_start_date: null,
      next_issue_date: null,
      next_due_date: null,
      next_invoice_month: null,
      next_generation_date: null,
      is_last_phase: true,
    };
  }

  const currentPhaseStart = await getPhaseStartDate(db, profile.class_id, currentPhaseNumber);
  if (!currentPhaseStart) {
    throw new Error(`Cannot determine start date for Phase ${currentPhaseNumber}. Please generate class sessions first.`);
  }

  // Authoritative due: always one day before first session of this phase (auto-detected per class).
  const currentDueDate = subtractDays(currentPhaseStart, PHASE_INSTALLMENT_DUE_DAYS_BEFORE);

  let currentIssueDate =
    normalizeDateInput(issueDateOverride) || subtractDays(currentPhaseStart, PHASE_INSTALLMENT_DUE_DAYS_BEFORE);
  if (currentDueDate && currentIssueDate && currentIssueDate.getTime() > currentDueDate.getTime()) {
    currentIssueDate = new Date(currentDueDate.getTime());
  }

  const currentInvoiceMonthDate = startOfMonth(currentPhaseStart);
  const currentGenerationDate = setDayOfMonth(currentInvoiceMonthDate, 25);

  const nextPhaseNumber = currentPhaseNumber + 1;
  const hasNextPhase = lastPhaseNumber === null || nextPhaseNumber <= lastPhaseNumber;
  const nextPhaseStart = hasNextPhase
    ? await getPhaseStartDate(db, profile.class_id, nextPhaseNumber)
    : null;

  const nextIssueDate = nextPhaseStart
    ? subtractDays(nextPhaseStart, PHASE_INSTALLMENT_DUE_DAYS_BEFORE)
    : null;
  const nextDueDate = nextPhaseStart
    ? subtractDays(nextPhaseStart, PHASE_INSTALLMENT_DUE_DAYS_BEFORE)
    : null;
  const nextInvoiceMonthDate = nextPhaseStart ? startOfMonth(nextPhaseStart) : null;
  const nextGenerationDate = nextInvoiceMonthDate ? setDayOfMonth(nextInvoiceMonthDate, 25) : null;

  return {
    current_phase_number: currentPhaseNumber,
    current_phase_start_date: formatYmdLocal(currentPhaseStart),
    current_issue_date: formatYmdLocal(currentIssueDate),
    current_due_date: formatYmdLocal(currentDueDate),
    current_invoice_month: formatYmdLocal(currentInvoiceMonthDate),
    current_generation_date: formatYmdLocal(currentGenerationDate),
    next_phase_number: nextPhaseStart ? nextPhaseNumber : null,
    next_phase_start_date: nextPhaseStart ? formatYmdLocal(nextPhaseStart) : null,
    next_issue_date: nextIssueDate ? formatYmdLocal(nextIssueDate) : null,
    next_due_date: nextDueDate ? formatYmdLocal(nextDueDate) : null,
    next_invoice_month: nextInvoiceMonthDate ? formatYmdLocal(nextInvoiceMonthDate) : null,
    next_generation_date: nextGenerationDate ? formatYmdLocal(nextGenerationDate) : null,
    is_last_phase: !nextPhaseStart,
  };
};

