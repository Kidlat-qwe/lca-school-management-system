import { coerceToManilaYmd, formatYmdLocal, parseYmdToLocalNoon, todayYmdManila } from './dateUtils.js';

const PHASE_INSTALLMENT_DUE_DAYS_BEFORE = 1;
const RECURRING_DUE_DAY = 5;
const RECURRING_GENERATION_DAY = 25;
const FIRST_WEEK_LAST_DAY = 7;
const FIRST_OF_MONTH_SKIP_GAP_DAYS = 7;

export const BILLING_CADENCE_25_5 = '25_5';
export const BILLING_CADENCE_1_5 = '1_5';

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

const addDays = (dateValue, days) => {
  const date = normalizeDateInput(dateValue);
  if (!date) return null;
  const result = new Date(date.getTime());
  result.setDate(result.getDate() + days);
  return result;
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

const addMonths = (dateValue, months) => {
  const date = startOfMonth(dateValue);
  if (!date) return null;
  const result = new Date(date.getTime());
  result.setMonth(result.getMonth() + months);
  return result;
};

const ymdCompare = (a, b) => String(a || '').slice(0, 10).localeCompare(String(b || '').slice(0, 10));

const dayOfYmd = (value) => {
  const ymd = coerceToManilaYmd(value, { fallbackToToday: false });
  if (!ymd) return null;
  const day = Number(ymd.slice(8, 10));
  return Number.isInteger(day) ? day : null;
};

const diffUtcDays = (fromDate, toDate) => {
  if (!fromDate || !toDate) return null;
  const fromUtc = Date.UTC(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
  const toUtc = Date.UTC(toDate.getFullYear(), toDate.getMonth(), toDate.getDate());
  return Math.round((toUtc - fromUtc) / 86400000);
};

/**
 * Class start day 1–7 keeps current 25th / next-month 5th.
 * Later start days use 1st / same-month 5th.
 */
export const resolveClassBillingCadence = (classStartYmd) => {
  const start = normalizeDateInput(classStartYmd);
  if (!start) return BILLING_CADENCE_25_5;
  const day = start.getDate();
  if (day >= 1 && day <= FIRST_WEEK_LAST_DAY) return BILLING_CADENCE_25_5;
  return BILLING_CADENCE_1_5;
};

/**
 * Next month's 1st after class start. If that 1st is within 7 days, skip to the following 1st.
 * Example: July 20 → Aug 1; June 24 → Aug 1 (skip July 1).
 */
export const resolveFirstOfMonthRecurringIssueYmd = (classStartYmd) => {
  const start = normalizeDateInput(classStartYmd);
  if (!start) return null;
  let nextFirst = startOfMonth(addMonths(start, 1));
  const gap = diffUtcDays(start, nextFirst);
  if (gap != null && gap <= FIRST_OF_MONTH_SKIP_GAP_DAYS) {
    nextFirst = startOfMonth(addMonths(nextFirst, 1));
  }
  return formatYmdLocal(nextFirst);
};

export const inferBillingCadenceFromAnchorYmd = (anchorYmd) => {
  const day = dayOfYmd(anchorYmd);
  if (day === 1) return BILLING_CADENCE_1_5;
  if (day === RECURRING_GENERATION_DAY) return BILLING_CADENCE_25_5;
  return null;
};

/**
 * Existing 25th queues stay on 25/5. New plans use class.start_date.
 * ignoreStoredQueueAnchor (start-date rebuild) recomputes from class start.
 */
export const resolveProfileBillingCadence = ({
  classStartYmd,
  profile = {},
  generatedCount = 0,
  ignoreStoredQueueAnchor = false,
} = {}) => {
  if (!ignoreStoredQueueAnchor) {
    const inferred = inferBillingCadenceFromAnchorYmd(profile.next_generation_date);
    if (inferred) return inferred;
    if (Number(generatedCount) >= 1) return BILLING_CADENCE_25_5;
  }
  return resolveClassBillingCadence(classStartYmd);
};

/**
 * Fixed recurring installment cycle: issue on 25th of anchor month, due on 5th of next month.
 */
export const buildFixedRecurringCycleDates = (generationAnchorYmd, frequencyMonths = 1) => {
  const anchor = parseYmdToLocalNoon(generationAnchorYmd) || new Date();
  const issueDate = setDayOfMonth(startOfMonth(anchor), RECURRING_GENERATION_DAY);

  const dueMonth = new Date(issueDate);
  dueMonth.setDate(1);
  dueMonth.setMonth(dueMonth.getMonth() + 1);
  const dueDate = setDayOfMonth(dueMonth, RECURRING_DUE_DAY);

  const nextGenerationDate = new Date(issueDate);
  nextGenerationDate.setMonth(nextGenerationDate.getMonth() + frequencyMonths);
  nextGenerationDate.setDate(RECURRING_GENERATION_DAY);

  const nextInvoiceMonth = new Date(dueMonth);
  nextInvoiceMonth.setDate(1);
  nextInvoiceMonth.setMonth(nextInvoiceMonth.getMonth() + frequencyMonths);

  return {
    issueDate,
    dueDate,
    invoiceMonth: dueMonth,
    nextGenerationDate,
    nextInvoiceMonth,
    generationAnchorYmd: formatYmdLocal(issueDate),
  };
};

/**
 * Recurring cycle: issue on the 1st, due on the 5th of the same month.
 */
export const buildFirstOfMonthCycleDates = (generationAnchorYmd, frequencyMonths = 1) => {
  const anchor = parseYmdToLocalNoon(generationAnchorYmd) || new Date();
  const issueDate = startOfMonth(anchor);
  const dueDate = setDayOfMonth(issueDate, RECURRING_DUE_DAY);
  const nextGenerationDate = addMonths(issueDate, frequencyMonths);
  const invoiceMonth = startOfMonth(dueDate);
  const nextInvoiceMonth = addMonths(invoiceMonth, frequencyMonths);

  return {
    issueDate,
    dueDate,
    invoiceMonth,
    nextGenerationDate,
    nextInvoiceMonth,
    generationAnchorYmd: formatYmdLocal(issueDate),
  };
};

export const buildRecurringCycleDates = (
  generationAnchorYmd,
  frequencyMonths = 1,
  cadence = BILLING_CADENCE_25_5
) => {
  if (cadence === BILLING_CADENCE_1_5) {
    return buildFirstOfMonthCycleDates(generationAnchorYmd, frequencyMonths);
  }
  return buildFixedRecurringCycleDates(generationAnchorYmd, frequencyMonths);
};

/**
 * Advance the installment auto-generation queue by one billing cycle.
 * Manual advance pay consumes the pending generation slot (same as if auto-generated),
 * so next_generation_date / next_invoice_month move forward one month (e.g. Aug 25 → Sep 25).
 *
 * @param {string|Date|null} nextGenerationDateYmd
 * @param {number} [frequencyMonths=1]
 * @returns {{ next_generation_date: string|null, next_invoice_month: string|null }}
 */
export const advanceInstallmentQueueByOneCycle = (nextGenerationDateYmd, frequencyMonths = 1) => {
  const anchor = coerceToManilaYmd(nextGenerationDateYmd, { fallbackToToday: false });
  if (!anchor) {
    return { next_generation_date: null, next_invoice_month: null };
  }
  const cadence =
    inferBillingCadenceFromAnchorYmd(anchor) || BILLING_CADENCE_25_5;
  const cycle = buildRecurringCycleDates(anchor, frequencyMonths, cadence);
  return {
    next_generation_date: formatYmdLocal(cycle.nextGenerationDate),
    next_invoice_month: formatYmdLocal(cycle.nextInvoiceMonth),
  };
};

/**
 * First recurring cycle after the initial (phase-tied) invoice.
 *
 * 25/5: issue 25th → due 5th of next month (legacy / first-week class starts).
 * 1/5: issue 1st → due 5th same month, from class.start_date (+ optional 7-day skip).
 */
export const resolveFirstRecurringCycleAfterIssue = (issueYmd, options = {}) => {
  const {
    firstPhaseStartYmd = null,
    minDaysAfterIssue = 7,
    classStartYmd = null,
    cadence = null,
  } = options;

  const resolvedCadence =
    cadence ||
    (classStartYmd ? resolveClassBillingCadence(classStartYmd) : BILLING_CADENCE_25_5);

  if (resolvedCadence === BILLING_CADENCE_1_5) {
    const seedStart = classStartYmd || firstPhaseStartYmd || issueYmd;
    let firstIssueYmd = resolveFirstOfMonthRecurringIssueYmd(seedStart);
    if (!firstIssueYmd) return null;

    const issue = parseYmdToLocalNoon(issueYmd);
    const firstPhaseStart = firstPhaseStartYmd ? parseYmdToLocalNoon(firstPhaseStartYmd) : null;
    const isPreStartEnrollment =
      Boolean(firstPhaseStart && issue && firstPhaseStart.getTime() >= issue.getTime());

    for (let step = 0; step < 24; step += 1) {
      const cycle = buildFirstOfMonthCycleDates(firstIssueYmd);
      if (!cycle?.issueDate) return null;
      const anchorYmd = formatYmdLocal(cycle.issueDate);

      if (issue && ymdCompare(anchorYmd, formatYmdLocal(issue)) <= 0) {
        firstIssueYmd = formatYmdLocal(cycle.nextGenerationDate);
        continue;
      }
      if (isPreStartEnrollment && cycle.issueDate.getTime() <= firstPhaseStart.getTime()) {
        firstIssueYmd = formatYmdLocal(cycle.nextGenerationDate);
        continue;
      }

      return {
        ...cycle,
        catchUp: false,
      };
    }
    return null;
  }

  const issue = parseYmdToLocalNoon(issueYmd);
  if (!issue) return null;

  const issueYmdStr = formatYmdLocal(issue);
  const minDue = addDays(issue, minDaysAfterIssue);
  const firstPhaseStart = firstPhaseStartYmd ? parseYmdToLocalNoon(firstPhaseStartYmd) : null;
  const isPreStartEnrollment =
    Boolean(firstPhaseStart && issue && firstPhaseStart.getTime() >= issue.getTime());

  for (let monthOffset = 0; monthOffset <= 6; monthOffset += 1) {
    const anchorMonth = addMonths(startOfMonth(issue), monthOffset);
    const anchor = setDayOfMonth(anchorMonth, RECURRING_GENERATION_DAY);
    const cycle = buildFixedRecurringCycleDates(formatYmdLocal(anchor));
    if (!cycle.dueDate || !minDue) continue;
    if (cycle.dueDate.getTime() < minDue.getTime()) continue;

    if (firstPhaseStart) {
      if (isPreStartEnrollment) {
        if (anchor.getTime() <= firstPhaseStart.getTime()) continue;
      } else if (anchor.getTime() < firstPhaseStart.getTime()) {
        continue;
      }
    }

    const anchorYmd = formatYmdLocal(anchor);
    const catchUp =
      ymdCompare(anchorYmd, issueYmdStr) < 0 &&
      anchorYmd.slice(0, 7) === issueYmdStr.slice(0, 7);

    if (ymdCompare(anchorYmd, issueYmdStr) >= 0 || catchUp) {
      return {
        ...cycle,
        catchUp,
      };
    }
  }

  return null;
};

export const isMidEnrollmentFirstPhaseInvoice = (issueYmd, dueYmd) => {
  if (!issueYmd || !dueYmd) return false;
  return ymdCompare(dueYmd, issueYmd) < 0;
};

/**
 * True when student joined a phase that had already started before the first invoice issue
 * (due before issue). Excludes pre-start enrollment (issue on/before phase start).
 */
export const isOngoingPhaseMidEnrollment = ({
  firstPhaseStartYmd,
  firstPhaseIssueYmd,
  firstPhaseDueYmd,
}) => {
  if (!isMidEnrollmentFirstPhaseInvoice(firstPhaseIssueYmd, firstPhaseDueYmd)) return false;
  if (!firstPhaseStartYmd || !firstPhaseIssueYmd) return false;
  return ymdCompare(firstPhaseStartYmd, firstPhaseIssueYmd) < 0;
};

/**
 * Immediate catch-up for the next recurring phase only when:
 * - first phase due is before issue (mid-enrollment into an ongoing phase), AND
 * - enrolled phase had already started before that issue, AND
 * - payment is on/after the missed 25th in the same month.
 *
 * Pre-start enrollment (e.g. enroll Mar 24, phase starts Mar 25) never catch-up on payment.
 */
export const shouldCatchUpRecurringOnFirstPhasePayment = ({
  firstPhaseIssueYmd,
  firstPhaseDueYmd,
  firstPhaseStartYmd,
  paymentYmd,
  scheduledGenerationYmd,
}) => {
  if (!firstPhaseIssueYmd || !paymentYmd || !scheduledGenerationYmd) return false;
  if (
    !isOngoingPhaseMidEnrollment({
      firstPhaseStartYmd,
      firstPhaseIssueYmd,
      firstPhaseDueYmd,
    })
  ) {
    return false;
  }
  if (ymdCompare(paymentYmd, scheduledGenerationYmd) < 0) return false;
  return paymentYmd.slice(0, 7) === scheduledGenerationYmd.slice(0, 7);
};

const resolveGeneratedCount = (profile, generatedCountOverride) =>
  generatedCountOverride !== null && generatedCountOverride !== undefined
    ? parseInt(generatedCountOverride, 10)
    : parseInt(profile.generated_count || 0, 10);

const coerceScheduleYmd = (value) => coerceToManilaYmd(value, { fallbackToToday: false });

/** Earliest auto-generated installment phase invoice issue date for anchor seeding. */
async function getFirstGeneratedInstallmentIssueYmd(db, profile) {
  const profileId = profile.installmentinvoiceprofiles_id;
  if (!profileId) return null;

  const phaseNum = resolveProfilePhaseStart(profile);
  const result = await db.query(
    `SELECT TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue_date
     FROM invoicestbl
     WHERE installmentinvoiceprofiles_id = $1
       AND (
         remarks ILIKE $2
         OR (
           remarks ILIKE '%Auto-generated from installment%'
           AND remarks NOT ILIKE '%Downpayment%'
         )
       )
     ORDER BY issue_date ASC, invoice_id ASC
     LIMIT 1`,
    [profileId, `%TARGET_PHASE:${phaseNum}%`]
  );
  const issue = result.rows[0]?.issue_date;
  return issue ? String(issue).slice(0, 10) : null;
}

/**
 * Advance a recurring anchor by N monthly billing cycles.
 */
function advanceRecurringAnchorYmd(anchorYmd, steps, frequencyMonths = 1, cadence = BILLING_CADENCE_25_5) {
  if (!anchorYmd || steps <= 0) return anchorYmd;
  let cursor = anchorYmd;
  for (let step = 0; step < steps; step += 1) {
    const cycle = buildRecurringCycleDates(cursor, frequencyMonths, cadence);
    cursor = formatYmdLocal(cycle.nextGenerationDate);
  }
  return cursor;
}

export async function loadClassStartYmd(db, classId) {
  if (!classId || !db?.query) return null;
  const result = await db.query(
    `SELECT TO_CHAR(start_date, 'YYYY-MM-DD') AS start_ymd
     FROM classestbl
     WHERE class_id = $1`,
    [classId]
  );
  return result.rows[0]?.start_ymd || null;
}

/**
 * Resolve the recurring billing anchor at a given generated_count.
 * Uses stored queue dates when present; otherwise derives from class start / first phase issue.
 */
async function resolveRecurringBillingAnchorYmd(
  db,
  profile,
  generatedCount,
  {
    generationAnchorYmd,
    issueDateOverride,
    frequencyMonths = 1,
    ignoreStoredQueueAnchor = false,
    resolvePhaseStartDate = null,
    classStartYmd = null,
    cadence = BILLING_CADENCE_25_5,
  } = {}
) {
  const profileCount = parseInt(profile.generated_count ?? generatedCount, 10);
  const explicitAnchor = coerceScheduleYmd(generationAnchorYmd);
  const queueAnchor =
    !ignoreStoredQueueAnchor && generatedCount === profileCount
      ? coerceScheduleYmd(profile.next_generation_date)
      : null;
  const storedAnchor = explicitAnchor || queueAnchor;
  if (storedAnchor) return storedAnchor;

  const phaseStartNum = resolveProfilePhaseStart(profile);
  const firstPhaseStart = resolvePhaseStartDate
    ? await resolvePhaseStartDate(phaseStartNum)
    : await getPhaseStartDate(db, profile.class_id, phaseStartNum);
  const firstPhaseIssueYmd = await getFirstGeneratedInstallmentIssueYmd(db, profile);

  const seedIssueYmd =
    coerceScheduleYmd(issueDateOverride) ||
    firstPhaseIssueYmd ||
    (firstPhaseStart ? formatYmdLocal(firstPhaseStart) : todayYmdManila());

  const firstRecurring = resolveFirstRecurringCycleAfterIssue(seedIssueYmd, {
    firstPhaseStartYmd: firstPhaseStart ? formatYmdLocal(firstPhaseStart) : null,
    classStartYmd,
    cadence,
  });
  if (!firstRecurring?.generationAnchorYmd) return null;

  return advanceRecurringAnchorYmd(
    firstRecurring.generationAnchorYmd,
    Math.max(0, generatedCount - 1),
    frequencyMonths,
    cadence
  );
}

/**
 * Class-linked installment plans bill from classsessionstbl phase dates.
 */
export const isPhaseInstallmentProfile = (profile = {}) =>
  profile.class_id !== null && profile.class_id !== undefined;

export const resolveProfilePhaseStart = (profile) => {
  const safeProfile = profile ?? {};
  if (safeProfile.phase_start !== null && safeProfile.phase_start !== undefined) {
    const n = parseInt(safeProfile.phase_start, 10);
    return Number.isInteger(n) && n >= 1 ? n : 1;
  }
  return 1;
};

export const getCurrentInstallmentPhaseNumber = (profile = {}, generatedCountOverride = null) => {
  const safeProfile = profile ?? {};
  const startPhase = safeProfile.phase_start !== null && safeProfile.phase_start !== undefined
    ? parseInt(safeProfile.phase_start, 10)
    : 1;
  const generatedCount = generatedCountOverride !== null && generatedCountOverride !== undefined
    ? parseInt(generatedCountOverride, 10)
    : parseInt(profile.generated_count || 0, 10);

  return startPhase + Math.max(0, generatedCount);
};

export const getLastInstallmentPhaseNumber = (profile = {}) => {
  if (!isPhaseInstallmentProfile(profile)) return null;

  const startPhase = resolveProfilePhaseStart(profile);
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
 * Hybrid installment schedule:
 * - First phase (generated_count 0): due = day before phase start; issue = payment/enrollment day.
 * - Recurring: first-week class start → 25th / next-month 5th.
 *   Otherwise → 1st / same-month 5th (skip next 1st when gap ≤ 7 days).
 */
export const buildPhaseInstallmentSchedule = async ({
  db,
  profile,
  generatedCountOverride = null,
  issueDateOverride = null,
  generationAnchorYmd = null,
  frequencyMonths = 1,
  phaseStartDateMapOverride = null,
  ignoreStoredQueueAnchor = false,
  classStartYmdOverride = null,
}) => {
  if (!isPhaseInstallmentProfile(profile)) {
    return null;
  }

  const resolvePhaseStartDate = async (phaseNumber) => {
    const overrideYmd = phaseStartDateMapOverride?.[phaseNumber];
    if (overrideYmd) {
      return normalizeDateInput(overrideYmd);
    }
    return getPhaseStartDate(db, profile.class_id, phaseNumber);
  };

  const profileWithPhaseStart = {
    ...profile,
    phase_start: resolveProfilePhaseStart(profile),
  };
  const generatedCount = resolveGeneratedCount(profile, generatedCountOverride);
  const isFirstPhaseBilling = generatedCount === 0;
  const isRecurringPhaseBilling = generatedCount >= 1;
  const classStartYmd =
    coerceScheduleYmd(classStartYmdOverride) || (await loadClassStartYmd(db, profile.class_id));
  const billingCadence = resolveProfileBillingCadence({
    classStartYmd,
    profile: {
      ...profileWithPhaseStart,
      next_generation_date: profile.next_generation_date || generationAnchorYmd,
    },
    generatedCount,
    ignoreStoredQueueAnchor,
  });

  const currentPhaseNumber = getCurrentInstallmentPhaseNumber(profileWithPhaseStart, generatedCountOverride);
  const lastPhaseNumber = getLastInstallmentPhaseNumber(profileWithPhaseStart);
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
      billing_mode: null,
      billing_cadence: billingCadence,
    };
  }

  const currentPhaseStart = await resolvePhaseStartDate(currentPhaseNumber);
  if (!currentPhaseStart) {
    throw new Error(`Cannot determine start date for Phase ${currentPhaseNumber}. Please generate class sessions first.`);
  }

  const explicitIssueOverride = normalizeDateInput(issueDateOverride);
  let currentIssueDate = null;
  let currentDueDate = null;
  let currentGenerationDate = null;
  let currentInvoiceMonthDate = null;
  let billingMode = 'first_phase';
  let recurringCatchUp = false;

  if (isRecurringPhaseBilling) {
    billingMode = 'recurring';
    const anchorYmd = await resolveRecurringBillingAnchorYmd(db, profileWithPhaseStart, generatedCount, {
      generationAnchorYmd,
      issueDateOverride: explicitIssueOverride ? formatYmdLocal(explicitIssueOverride) : null,
      frequencyMonths,
      ignoreStoredQueueAnchor,
      resolvePhaseStartDate: phaseStartDateMapOverride ? resolvePhaseStartDate : null,
      classStartYmd,
      cadence: billingCadence,
    });

    const cycle = buildRecurringCycleDates(anchorYmd, frequencyMonths, billingCadence);
    currentDueDate = cycle.dueDate;
    currentGenerationDate = cycle.issueDate;
    currentInvoiceMonthDate = cycle.invoiceMonth;
    currentIssueDate = explicitIssueOverride || cycle.issueDate;

    if (
      explicitIssueOverride &&
      cycle.issueDate &&
      explicitIssueOverride.getTime() > cycle.issueDate.getTime()
    ) {
      recurringCatchUp = true;
    }
  } else {
    currentDueDate = subtractDays(currentPhaseStart, PHASE_INSTALLMENT_DUE_DAYS_BEFORE);
    currentIssueDate = explicitIssueOverride || (currentDueDate ? new Date(currentDueDate.getTime()) : null);
    currentInvoiceMonthDate = startOfMonth(currentPhaseStart);
    currentGenerationDate = null;
  }

  const currentIssueYmd = currentIssueDate ? formatYmdLocal(currentIssueDate) : null;
  const currentDueYmd = currentDueDate ? formatYmdLocal(currentDueDate) : null;
  const isMidEnrollmentFirstPhase =
    isFirstPhaseBilling && isMidEnrollmentFirstPhaseInvoice(currentIssueYmd, currentDueYmd);

  const nextPhaseNumber = currentPhaseNumber + 1;
  const hasNextPhase = lastPhaseNumber === null || nextPhaseNumber <= lastPhaseNumber;
  const nextPhaseStart = hasNextPhase
    ? await resolvePhaseStartDate(nextPhaseNumber)
    : null;

  let nextIssueDate = null;
  let nextDueDate = null;
  let nextInvoiceMonthDate = null;
  let nextGenerationDate = null;
  let nextCatchUp = false;

  if (nextPhaseStart) {
    if (isFirstPhaseBilling) {
      const firstPhaseStartYmd = formatYmdLocal(currentPhaseStart);
      const firstRecurring = resolveFirstRecurringCycleAfterIssue(
        currentIssueYmd || firstPhaseStartYmd,
        {
          firstPhaseStartYmd,
          classStartYmd,
          cadence: billingCadence,
        }
      );
      if (firstRecurring) {
        nextIssueDate = firstRecurring.issueDate;
        nextDueDate = firstRecurring.dueDate;
        nextInvoiceMonthDate = firstRecurring.invoiceMonth;
        nextGenerationDate = firstRecurring.generationAnchorYmd;
        nextCatchUp = firstRecurring.catchUp;
      }
    } else {
      const anchorYmd =
        coerceScheduleYmd(generationAnchorYmd) ||
        (currentGenerationDate ? formatYmdLocal(currentGenerationDate) : null) ||
        (!ignoreStoredQueueAnchor &&
        generatedCount === parseInt(profile.generated_count ?? generatedCount, 10)
          ? coerceScheduleYmd(profile.next_generation_date)
          : null);
      const nextCycle = buildRecurringCycleDates(
        formatYmdLocal(
          buildRecurringCycleDates(anchorYmd, frequencyMonths, billingCadence).nextGenerationDate
        ),
        frequencyMonths,
        billingCadence
      );
      nextIssueDate = nextCycle.issueDate;
      nextDueDate = nextCycle.dueDate;
      nextInvoiceMonthDate = nextCycle.invoiceMonth;
      nextGenerationDate = formatYmdLocal(nextCycle.generationAnchorYmd);
    }
  }

  return {
    current_phase_number: currentPhaseNumber,
    current_phase_start_date: formatYmdLocal(currentPhaseStart),
    current_issue_date: currentIssueYmd,
    current_due_date: currentDueYmd,
    current_invoice_month: currentInvoiceMonthDate ? formatYmdLocal(currentInvoiceMonthDate) : null,
    current_generation_date: currentGenerationDate ? formatYmdLocal(currentGenerationDate) : null,
    next_phase_number: nextPhaseStart ? nextPhaseNumber : null,
    next_phase_start_date: nextPhaseStart ? formatYmdLocal(nextPhaseStart) : null,
    next_issue_date: nextIssueDate ? formatYmdLocal(nextIssueDate) : null,
    next_due_date: nextDueDate ? formatYmdLocal(nextDueDate) : null,
    next_invoice_month: nextInvoiceMonthDate ? formatYmdLocal(nextInvoiceMonthDate) : null,
    next_generation_date: nextGenerationDate,
    next_recurring_catch_up: nextCatchUp,
    is_last_phase: !nextPhaseStart,
    billing_mode: billingMode,
    billing_cadence: billingCadence,
    is_mid_enrollment_first_phase: isMidEnrollmentFirstPhase,
    recurring_catch_up: recurringCatchUp,
  };
};
