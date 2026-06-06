/**
 * Operational dashboard enrollment KPIs from completed invoice payments on
 * paymenttbl.issue_date, bucketed by program_enrollment_status on the linked
 * classstudentstbl row (class + phase from invoice remarks / profile).
 *
 * Daily: single summary_date. Monthly: all payments with issue_date in
 * [month_start, month_end_exclusive).
 *
 * Installment invoices use one phase row per payment (TARGET_PHASE). Only
 * settled invoices (status Paid) create installment phase-events; partial
 * payments on Partially Paid invoices are excluded until the chain is Paid.
 * Multiple completed payments on the same chain + phase still dedupe to one.
 * Full-payment invoices count once per phase row in the payment window
 * (matrix-aligned: first phase new, middle phases re_enrolled, terminal completed).
 * Dropped / unenrolled uses removed_at (Asia/Manila) in the same date window.
 */

const ENROLLMENT_COUNT_STATUSES = ['new', 're_enrolled', 'upsell', 'rejoin', 'reserved', 'completed'];

const EMPTY_TOTALS = () => ({
  new_enrollees: 0,
  re_enrollment_count: 0,
  upsell_count: 0,
  reserved_count: 0,
  completed_count: 0,
  rejoin_count: 0,
  dropped_unenrolled_count: 0,
});

/** SQL fragment: class-related payments. */
const CLASS_PAYMENT_FILTER_SQL = `
  (
    i.remarks ILIKE '%CLASS_ID:%'
    OR i.installmentinvoiceprofiles_id IS NOT NULL
    OR i.invoice_description ILIKE '%downpayment%'
    OR i.invoice_description ILIKE '%installment%'
    OR i.invoice_description ILIKE '%phase%'
    OR i.invoice_description ILIKE '%full%payment%'
    OR i.invoice_description ILIKE '%fullpayment%'
    OR i.remarks ~* 'REJOIN_PHASE:\\d+'
    OR i.remarks ~* 'TARGET_PHASE:\\d+'
    OR i.remarks ~* 'PHASE_START:\\d+'
    OR i.invoice_description ILIKE '%reservation%fee%'
  )
`;

/**
 * True full-payment (one payment enrolls many phases at once).
 * Installment invoices also carry PHASE_START/PHASE_END as package metadata — exclude those.
 */
const IS_FULL_PAYMENT_SQL = `
  (
    i.remarks ILIKE '%PACKAGE_CHANGE_TO_FULLPAYMENT%'
    OR i.invoice_description ILIKE '%fullpayment%'
    OR i.invoice_description ILIKE '%full payment%'
    OR (
      i.remarks ~* 'PHASE_START:\\d+'
      AND i.remarks ~* 'PHASE_END:\\d+'
      AND (regexp_match(i.remarks, 'PHASE_END:(\\d+)', 'i'))[1]::int >
          (regexp_match(i.remarks, 'PHASE_START:(\\d+)', 'i'))[1]::int
      AND i.installmentinvoiceprofiles_id IS NULL
      AND COALESCE(i.invoice_description, '') NOT ILIKE '%downpayment%'
      AND COALESCE(i.remarks, '') NOT ILIKE '%TARGET_PHASE:%'
      AND COALESCE(i.remarks, '') NOT ILIKE '%Auto-generated from installment%'
      AND COALESCE(i.remarks, '') NOT ILIKE '%Manually generated from installment%'
    )
  )
`;

/** Phase rows written by this specific payment (tight created_at window). */
const PAYMENT_PHASE_ROW_WINDOW_SQL = `
  (
    cs.enrolled_at >= dp.payment_created_at - INTERVAL '30 seconds'
    AND cs.enrolled_at <= dp.payment_created_at + INTERVAL '2 minutes'
  )
`;

/** Program level order — keep in sync with enrollmentStatus.js PROGRAM_LEVEL_ORDER. */
const PROGRAM_LEVEL_ORDER_SQL = `ARRAY['Playgroup','Nursery','Pre-Kindergarten','Kindergarten','Grade School']::text[]`;

/** Curriculum phase count for a class (defaults to 1). */
const CLASS_PHASE_COUNT_FOR_CLASS_SQL = `
  (
    SELECT COALESCE(NULLIF(cu.number_of_phase, 0), 1)
    FROM classestbl c
    INNER JOIN programstbl cprog ON c.program_id = cprog.program_id
    INNER JOIN curriculumstbl cu ON cu.curriculum_id = cprog.curriculum_id
    WHERE c.class_id = dp.class_id
    LIMIT 1
  )
`;

/** Class phase count for a with_status row (aggregate query). */
const CLASS_PHASE_COUNT_FOR_STATUS_ROW_SQL = `
  (
    SELECT COALESCE(NULLIF(cu.number_of_phase, 0), 1)
    FROM classestbl c
    INNER JOIN programstbl cprog ON c.program_id = cprog.program_id
    INNER JOIN curriculumstbl cu ON cu.curriculum_id = cprog.curriculum_id
    WHERE c.class_id = with_status.class_id
    LIMIT 1
  )
`;

/**
 * Phase-events that count toward the Re-enrollment KPI (and rate numerator):
 * re_enrolled, upsell, and completed on multi-phase classes only.
 * Single-phase completed packages stay in the Completed KPI only.
 */
const RE_ENROLLMENT_KPI_STATUS_FILTER_SQL = `
  program_enrollment_status IN ('re_enrolled', 'upsell')
  OR (
    program_enrollment_status = 'completed'
    AND ${CLASS_PHASE_COUNT_FOR_STATUS_ROW_SQL} > 1
  )
`;

/** All installment phase invoices paid for student + class (matches enrollment matrix). */
const INSTALLMENT_PACKAGE_COMPLETE_FOR_PAYMENT_SQL = `
  EXISTS (
    SELECT 1
    FROM installmentinvoiceprofilestbl ip
    WHERE ip.student_id = dp.student_id
      AND ip.class_id = dp.class_id
      AND COALESCE(ip.total_phases, 0) > 0
      AND (
        SELECT COUNT(DISTINCT CASE
          WHEN inv.status = 'Paid' THEN COALESCE(inv.invoice_chain_root_id, inv.invoice_id)
          ELSE NULL
        END)::integer
        FROM invoicestbl inv
        WHERE inv.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
          AND (
            ip.downpayment_invoice_id IS NULL
            OR COALESCE(inv.invoice_chain_root_id, inv.invoice_id) <> ip.downpayment_invoice_id::INTEGER
          )
      ) >= COALESCE(ip.total_phases, 0)
  )
`;

/**
 * Class-start billing: no installment profile and no paid downpayment (matrix is_full_payment).
 */
const MATRIX_STYLE_CLASS_START_FULL_PAY_SQL = `
  (
    NOT EXISTS (
      SELECT 1
      FROM installmentinvoiceprofilestbl ip
      WHERE ip.student_id = dp.student_id
        AND ip.class_id = dp.class_id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM invoicestbl i
      INNER JOIN invoicestudentstbl ist ON ist.invoice_id = i.invoice_id
      WHERE ist.student_id = dp.student_id
        AND i.status = 'Paid'
        AND i.invoice_description ILIKE '%downpayment%'
        AND i.remarks ILIKE ('%CLASS_ID:' || dp.class_id::text || '%')
    )
  )
`;

/**
 * Single-phase class: first/only enrollment payment finishes the package → completed (not new).
 * Aligns with enrollment matrix terminal "completed" label for 1-phase programs.
 */
const SINGLE_PHASE_COMPLETION_ON_PAYMENT_SQL = `
  (
    ${CLASS_PHASE_COUNT_FOR_CLASS_SQL} = 1
    AND (
      dp.is_full_payment
      OR ${INSTALLMENT_PACKAGE_COMPLETE_FOR_PAYMENT_SQL}
      OR ${MATRIX_STYLE_CLASS_START_FULL_PAY_SQL}
    )
  )
`;

/**
 * Student completed a lower program and is enrolling higher (upsell), even if the
 * linked phase row is still marked "new".
 */
const UPSELL_HISTORY_CHECK_SQL = `
  EXISTS (
    SELECT 1
    FROM classstudentstbl prior_cs
    INNER JOIN classestbl prior_c ON prior_cs.class_id = prior_c.class_id
    INNER JOIN classestbl cur_c ON cur_c.class_id = dp.class_id
    WHERE prior_cs.student_id = dp.student_id
      AND prior_cs.class_id != dp.class_id
      AND prior_cs.program_enrollment_status = 'completed'
      AND prior_cs.removed_at IS NULL
      AND array_position(${PROGRAM_LEVEL_ORDER_SQL}, TRIM(prior_c.level_tag)) IS NOT NULL
      AND array_position(${PROGRAM_LEVEL_ORDER_SQL}, TRIM(cur_c.level_tag)) IS NOT NULL
      AND array_position(${PROGRAM_LEVEL_ORDER_SQL}, TRIM(prior_c.level_tag))
          < array_position(${PROGRAM_LEVEL_ORDER_SQL}, TRIM(cur_c.level_tag))
  )
`;

/**
 * Student already has enrollment history (other class or earlier phase) before this phase row —
 * not a true new enrollee on this class. Cross-class rows enrolled later the same day (e.g. upsell
 * on a higher program after lower-program phase 1) are excluded so they do not flip phase 1 to
 * re_enrolled when the month matrix shows "new" before upsell.
 * @param {string} phaseNumberSql - SQL expression for the paid phase number
 * @param {string} excludeClassStudentSql - e.g. "prior.classstudent_id != sp_pick.classstudent_id"
 * @param {string} currentEnrolledAtSql - enrolled_at of the phase row linked to this payment
 */
const buildPriorEnrollmentCheckSql = (
  phaseNumberSql,
  excludeClassStudentSql = 'TRUE',
  currentEnrolledAtSql = 'dp.payment_created_at'
) => `
  EXISTS (
    SELECT 1
    FROM classstudentstbl prior
    WHERE prior.student_id = dp.student_id
      AND (${excludeClassStudentSql})
      AND (
        (prior.class_id = dp.class_id AND prior.phase_number < COALESCE(${phaseNumberSql}, 1))
        OR prior.class_id != dp.class_id
      )
      AND prior.program_enrollment_status IN (
        'new', 're_enrolled', 'upsell', 'rejoin', 'completed', 'dropped'
      )
      AND prior.enrolled_at IS NOT NULL
      AND prior.enrolled_at < ${currentEnrolledAtSql}
  )
`;

/**
 * Per-phase bucket for full-payment invoices (aligns with enrollmentRateMetrics matrix).
 * Example full pay phases 1–5: phase 1 → new, phases 2–4 → re_enrolled, phase 5 → completed.
 */
const FULL_PAYMENT_PHASE_STATUS_CASE_SQL = `
  CASE
    WHEN fp_pick.raw_status = 'rejoin' THEN 'rejoin'
    WHEN fp_pick.raw_status = 'upsell' THEN 'upsell'
    WHEN fp_pick.raw_status = 'reserved' THEN 'reserved'
    WHEN fp_pick.raw_status = 'completed' THEN 'completed'
    WHEN fp_pick.raw_status = 're_enrolled' THEN 're_enrolled'
    WHEN fp_pick.raw_status = 'new' THEN
      CASE
        WHEN COALESCE(dp.phase_end, fp_pick.max_phase_in_payment) > fp_pick.first_enrolled_phase
          AND fp_pick.phase_number = COALESCE(dp.phase_end, fp_pick.max_phase_in_payment)
        THEN 'completed'
        WHEN fp_pick.phase_number = fp_pick.first_enrolled_phase
          AND ${SINGLE_PHASE_COMPLETION_ON_PAYMENT_SQL}
        THEN 'completed'
        WHEN fp_pick.phase_number = fp_pick.first_enrolled_phase
          AND ${UPSELL_HISTORY_CHECK_SQL}
        THEN 'upsell'
        WHEN fp_pick.phase_number = fp_pick.first_enrolled_phase
          AND ${buildPriorEnrollmentCheckSql('fp_pick.phase_number', 'prior.classstudent_id != fp_pick.classstudent_id', 'fp_pick.enrolled_at')}
        THEN 're_enrolled'
        WHEN fp_pick.phase_number = fp_pick.first_enrolled_phase
        THEN 'new'
        WHEN fp_pick.phase_number > fp_pick.first_enrolled_phase
        THEN 're_enrolled'
        ELSE NULL
      END
    ELSE NULL
  END
`;

/** Map a raw classstudent row status to an operational payment bucket (installment / single-phase pay). */
const SINGLE_PHASE_STATUS_CASE_SQL = `
  CASE
    WHEN sp_pick.raw_status = 'rejoin' THEN 'rejoin'
    WHEN sp_pick.raw_status = 'upsell' THEN 'upsell'
    WHEN sp_pick.raw_status = 're_enrolled' THEN 're_enrolled'
    WHEN sp_pick.raw_status = 'reserved' THEN 'reserved'
    WHEN sp_pick.raw_status = 'completed' THEN 'completed'
    WHEN sp_pick.raw_status = 'new' THEN
      CASE
        WHEN ${SINGLE_PHASE_COMPLETION_ON_PAYMENT_SQL} THEN 'completed'
        WHEN ${UPSELL_HISTORY_CHECK_SQL} THEN 'upsell'
        WHEN ${buildPriorEnrollmentCheckSql('sp_pick.phase_number', 'prior.classstudent_id != sp_pick.classstudent_id', 'sp_pick.enrolled_at')}
          THEN 're_enrolled'
        ELSE 'new'
      END
    ELSE NULL
  END
`;

/**
 * One enrollment event per student + class + phase + invoice chain + status bucket.
 * Multiple completed payments settling the same phase (partial then balance) → 1 count.
 */
const ENROLLMENT_EVENT_DEDUPE_CTE_SQL = `
  with_status AS (
    SELECT DISTINCT ON (
      wsr.student_id,
      wsr.class_id,
      COALESCE(wsr.enrolled_phase_number, -1),
      wsr.invoice_chain_key,
      wsr.program_enrollment_status
    )
      wsr.*
    FROM with_status_raw wsr
    ORDER BY
      wsr.student_id,
      wsr.class_id,
      COALESCE(wsr.enrolled_phase_number, -1),
      wsr.invoice_chain_key,
      wsr.program_enrollment_status,
      CASE wsr.invoice_status
        WHEN 'Paid' THEN 0
        WHEN 'Partially Paid' THEN 1
        ELSE 2
      END,
      wsr.issue_date,
      wsr.payment_id
  )
`;

/** Shared drop-row filter (matches legacy operational dropped CTE). */
const DROPPED_ROW_FILTER_SQL = `
  cs.program_enrollment_status = 'dropped'
  AND cs.removed_at IS NOT NULL
  AND COALESCE(cs.enrolled_by, '') NOT ILIKE '%Rejoin gap marker%'
  AND (
    (cs.enrolled_at IS NOT NULL AND cs.enrolled_at < cs.removed_at)
    OR (
      cs.enrolled_at IS NULL
      AND COALESCE(cs.enrolled_by, '') ILIKE '%Drop marker%'
    )
  )
`;

const buildBranchFilter = (branchId, params, paymentAlias = 'p') => {
  if (!branchId) return { sql: '', params };
  params.push(branchId);
  return { sql: `AND ${paymentAlias}.branch_id = $${params.length}`, params };
};

const buildDropBranchFilter = (branchId, params, tableAlias = 'c') => {
  if (!branchId) return { sql: '', params };
  params.push(branchId);
  return { sql: `AND ${tableAlias}.branch_id = $${params.length}`, params };
};

const resolveDateWindow = (options) => {
  const { summaryDate, monthStart, monthEndExclusive } = options;

  if (summaryDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(summaryDate))) {
      throw new Error('summaryDate must be YYYY-MM-DD');
    }
    return {
      paymentDateFilterSql: 'p.issue_date = $1::date',
      dropDateFilterSql: "TIMEZONE('Asia/Manila', cs.removed_at)::date = $1::date",
      params: [summaryDate],
      label: summaryDate,
    };
  }

  if (monthStart && monthEndExclusive) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(monthStart)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(monthEndExclusive))) {
      throw new Error('monthStart and monthEndExclusive must be YYYY-MM-DD');
    }
    return {
      paymentDateFilterSql: 'p.issue_date >= $1::date AND p.issue_date < $2::date',
      dropDateFilterSql:
        "TIMEZONE('Asia/Manila', cs.removed_at)::date >= $1::date AND TIMEZONE('Asia/Manila', cs.removed_at)::date < $2::date",
      params: [monthStart, monthEndExclusive],
      label: `${monthStart}:${monthEndExclusive}`,
    };
  }

  throw new Error('Provide summaryDate or monthStart + monthEndExclusive');
};

/** Prior calendar day or prior calendar month for retention-base (matrix-aligned cohort). */
const resolvePriorDateWindow = (options) => {
  const { summaryDate, monthStart, monthEndExclusive } = options;

  if (summaryDate) {
    const [year, month, day] = String(summaryDate).split('-').map(Number);
    const prior = new Date(Date.UTC(year, month - 1, day));
    prior.setUTCDate(prior.getUTCDate() - 1);
    const priorDate = prior.toISOString().slice(0, 10);
    return {
      ...resolveDateWindow({ summaryDate: priorDate }),
      label: priorDate,
      period_type: 'day',
    };
  }

  if (monthStart && monthEndExclusive) {
    const [year, month] = String(monthStart).split('-').map(Number);
    const priorStart = month === 1
      ? `${year - 1}-12-01`
      : `${year}-${String(month - 1).padStart(2, '0')}-01`;
    return {
      ...resolveDateWindow({ monthStart: priorStart, monthEndExclusive: monthStart }),
      label: `${priorStart}:${monthStart}`,
      period_type: 'month',
    };
  }

  throw new Error('Provide summaryDate or monthStart + monthEndExclusive');
};

const PRIOR_RETENTION_BASE_STATUSES = new Set([
  'new',
  're_enrolled',
  'upsell',
  'rejoin',
  'completed',
]);

const buildEnrollmentTrackKey = (row) => `${row.student_id}:${row.class_id}`;

/** Mirrors {@link RE_ENROLLMENT_KPI_STATUS_FILTER_SQL} for detail-row rate math. */
export const countsTowardOperationalReEnrollmentKpi = (row) => {
  const status = row?.program_enrollment_status;
  if (status === 're_enrolled' || status === 'upsell') return true;
  if (status === 'completed') {
    const phaseCount = parseInt(row.class_number_of_phase, 10) || 1;
    return phaseCount > 1;
  }
  return false;
};

/**
 * Retention base from deduped prior-period payment phase-events.
 * Base = student+class tracks with enrolled activity in the prior day/month.
 */
export const computeOperationalRetentionBaseFromDetailRows = (priorRows = []) => {
  const priorTracks = new Set();
  const priorTracksByBranch = new Map();

  for (const row of priorRows) {
    if (!PRIOR_RETENTION_BASE_STATUSES.has(row.program_enrollment_status)) continue;
    if (row.student_id == null || row.class_id == null) continue;

    const trackKey = buildEnrollmentTrackKey(row);
    priorTracks.add(trackKey);

    const branchId = parseInt(row.branch_id, 10);
    if (!Number.isFinite(branchId)) continue;
    if (!priorTracksByBranch.has(branchId)) priorTracksByBranch.set(branchId, new Set());
    priorTracksByBranch.get(branchId).add(trackKey);
  }

  const retentionBaseByBranch = [...priorTracksByBranch.entries()].map(([branch_id, tracks]) => ({
    branch_id,
    retention_base_count: tracks.size,
  }));

  return {
    retention_base_count: priorTracks.size,
    retention_base_by_branch: retentionBaseByBranch,
    prior_period_label: null,
  };
};

export async function loadOperationalRetentionFromPayments(queryFn, options = {}) {
  const priorWindow = resolvePriorDateWindow(options);
  const priorOptions = options.summaryDate
    ? { branchId: options.branchId ?? null, summaryDate: priorWindow.params[0] }
    : {
        branchId: options.branchId ?? null,
        monthStart: priorWindow.params[0],
        monthEndExclusive: priorWindow.params[1],
      };

  const priorDetail = await loadOperationalEnrollmentDetailFromPayments(queryFn, priorOptions);
  const retention = computeOperationalRetentionBaseFromDetailRows(priorDetail.rows || []);

  return {
    ...retention,
    prior_period_label: priorWindow.label,
    prior_period_type: priorWindow.period_type,
  };
};

/**
 * Re-enrollment rate: Re-enrollment KPI card ÷ prior-period retention base × 100.
 * Same rule for daily and monthly (e.g. 11 ÷ 4 today, 126 ÷ 211 for June).
 */
export function computeOperationalRetentionRate({
  retention_base_count = 0,
  re_enrollment_count = 0,
  retention_rate_mode = 'kpi_card',
} = {}) {
  const retained = Number(re_enrollment_count) || 0;
  const priorCount = Number(retention_base_count) || 0;
  const rate = priorCount > 0 ? Number(((retained / priorCount) * 100).toFixed(2)) : 0;

  return {
    re_enrollment_rate: rate,
    re_enrollment_rate_retained_count: retained,
    re_enrollment_rate_prior_count: priorCount,
    retention_base_count: priorCount,
    retention_re_enrollment_count: retained,
    retention_rate_mode,
  };
}

/**
 * @deprecated Daily/monthly operational dashboards use {@link computeOperationalRetentionRate}
 * with the Re-enrollment KPI card count. Kept for audits / scripts.
 * Distinct continuing tracks ÷ prior-day retention base (can differ from KPI card).
 */
export function computeDailyOperationalRetentionRateFromDetailRows(
  currentRows = [],
  priorRows = []
) {
  const priorRetention = computeOperationalRetentionBaseFromDetailRows(priorRows);
  const priorTrackKeys = new Set();

  for (const row of priorRows) {
    if (!PRIOR_RETENTION_BASE_STATUSES.has(row.program_enrollment_status)) continue;
    if (row.student_id == null || row.class_id == null) continue;
    priorTrackKeys.add(buildEnrollmentTrackKey(row));
  }

  const continuingTracks = new Set();
  for (const row of currentRows) {
    if (!countsTowardOperationalReEnrollmentKpi(row)) continue;
    if (row.student_id == null || row.class_id == null) continue;
    const trackKey = buildEnrollmentTrackKey(row);
    if (!priorTrackKeys.has(trackKey)) continue;
    continuingTracks.add(trackKey);
  }

  return computeOperationalRetentionRate({
    retention_base_count: priorRetention.retention_base_count,
    re_enrollment_count: continuingTracks.size,
    retention_rate_mode: 'daily_track_deduped',
  });
}

/**
 * Core loader — daily or monthly date window.
 * @param {Function} queryFn
 * @param {{ branchId?: number|null, summaryDate?: string, monthStart?: string, monthEndExclusive?: string }} options
 */
export async function loadOperationalEnrollmentFromPayments(queryFn, options = {}) {
  const { branchId = null } = options;
  const window = resolveDateWindow(options);

  const paymentParams = [...window.params];
  const paymentBranch = buildBranchFilter(branchId, paymentParams);

  const statusParamIdx = paymentParams.length + 1;

  const paymentResult = await queryFn(
    `
      WITH period_payments AS (
        SELECT
          p.payment_id,
          p.invoice_id,
          p.branch_id,
          p.student_id,
          p.issue_date,
          p.created_at AS payment_created_at,
          i.status AS invoice_status,
          COALESCE(i.invoice_chain_root_id, i.invoice_id) AS invoice_chain_key,
          COALESCE(
            (regexp_match(i.remarks, 'CLASS_ID:(\\d+)', 'i'))[1]::int,
            ip.class_id
          ) AS class_id,
          (regexp_match(i.remarks, 'PHASE_START:(\\d+)', 'i'))[1]::int AS phase_start,
          (regexp_match(i.remarks, 'PHASE_END:(\\d+)', 'i'))[1]::int AS phase_end,
          ${IS_FULL_PAYMENT_SQL} AS is_full_payment,
          COALESCE(
            (regexp_match(i.remarks, 'REJOIN_PHASE:(\\d+)', 'i'))[1]::int,
            (regexp_match(i.remarks, 'TARGET_PHASE:(\\d+)', 'i'))[1]::int,
            (regexp_match(i.remarks, 'PHASE_START:(\\d+)', 'i'))[1]::int,
            (regexp_match(i.invoice_description, 'phase\\s*(\\d+)', 'i'))[1]::int,
            CASE
              WHEN i.invoice_description ILIKE '%downpayment%'
                OR COALESCE(i.invoice_chain_root_id, i.invoice_id) = ip.downpayment_invoice_id
              THEN COALESCE(NULLIF(ip.phase_start, 0), 1)
              ELSE NULL
            END
          ) AS phase_number
        FROM paymenttbl p
        INNER JOIN invoicestbl i ON i.invoice_id = p.invoice_id
        LEFT JOIN installmentinvoiceprofilestbl ip
          ON ip.installmentinvoiceprofiles_id = i.installmentinvoiceprofiles_id
        WHERE p.status = 'Completed'
          AND ${window.paymentDateFilterSql}
          AND COALESCE(p.approval_status, 'Pending') NOT IN ('Returned', 'Rejected')
          AND ${CLASS_PAYMENT_FILTER_SQL}
          AND (
            ${IS_FULL_PAYMENT_SQL}
            OR i.status = 'Paid'
          )
          ${paymentBranch.sql}
      ),
      with_status_raw AS (
        SELECT
          dp.payment_id,
          dp.invoice_id,
          dp.invoice_chain_key,
          dp.invoice_status,
          dp.branch_id,
          dp.student_id,
          dp.class_id,
          dp.issue_date,
          COALESCE(fp.phase_number, sp.phase_number) AS enrolled_phase_number,
          COALESCE(fp.program_enrollment_status, sp.program_enrollment_status) AS program_enrollment_status
        FROM period_payments dp
        LEFT JOIN LATERAL (
          SELECT
            fp_pick.phase_number,
            ${FULL_PAYMENT_PHASE_STATUS_CASE_SQL} AS program_enrollment_status
          FROM (
            SELECT
              cs.classstudent_id,
              cs.phase_number,
              cs.program_enrollment_status AS raw_status,
              cs.enrolled_at,
              MIN(cs.phase_number) OVER () AS first_enrolled_phase,
              MAX(cs.phase_number) OVER () AS max_phase_in_payment
            FROM classstudentstbl cs
            WHERE cs.student_id = dp.student_id
              AND cs.class_id = dp.class_id
              AND (
                (dp.phase_start IS NOT NULL AND dp.phase_end IS NOT NULL
                  AND cs.phase_number BETWEEN dp.phase_start AND dp.phase_end)
                OR (dp.phase_start IS NULL OR dp.phase_end IS NULL)
              )
              AND ${PAYMENT_PHASE_ROW_WINDOW_SQL}
          ) fp_pick
        ) fp ON dp.is_full_payment AND dp.class_id IS NOT NULL
        LEFT JOIN LATERAL (
          SELECT
            sp_pick.phase_number,
            ${SINGLE_PHASE_STATUS_CASE_SQL} AS program_enrollment_status
          FROM (
            SELECT
              cs.classstudent_id,
              cs.phase_number,
              cs.program_enrollment_status AS raw_status,
              cs.enrolled_at
            FROM classstudentstbl cs
            WHERE cs.student_id = dp.student_id
              AND cs.class_id = dp.class_id
              AND (dp.phase_number IS NULL OR cs.phase_number = dp.phase_number)
            ORDER BY
              CASE
                WHEN dp.phase_number IS NOT NULL AND cs.phase_number = dp.phase_number THEN 0
                ELSE 1
              END,
              ABS(EXTRACT(EPOCH FROM (cs.enrolled_at - dp.payment_created_at))),
              CASE WHEN cs.removed_at IS NULL THEN 0 ELSE 1 END,
              cs.classstudent_id DESC
            LIMIT 1
          ) sp_pick
        ) sp ON NOT dp.is_full_payment AND dp.class_id IS NOT NULL
        WHERE COALESCE(fp.program_enrollment_status, sp.program_enrollment_status) = ANY($${statusParamIdx}::text[])
      ),
      ${ENROLLMENT_EVENT_DEDUPE_CTE_SQL}
      SELECT
        branch_id,
        COUNT(*) FILTER (WHERE program_enrollment_status = 'new')::bigint AS new_enrollees,
        COUNT(*) FILTER (WHERE ${RE_ENROLLMENT_KPI_STATUS_FILTER_SQL})::bigint AS re_enrollment_count,
        COUNT(*) FILTER (WHERE program_enrollment_status = 'upsell')::bigint AS upsell_count,
        COUNT(*) FILTER (WHERE program_enrollment_status = 'reserved')::bigint AS reserved_count,
        COUNT(*) FILTER (WHERE program_enrollment_status = 'completed')::bigint AS completed_count,
        COUNT(*) FILTER (WHERE program_enrollment_status = 'rejoin')::bigint AS rejoin_count
      FROM with_status
      GROUP BY branch_id
    `,
    [...paymentParams, ENROLLMENT_COUNT_STATUSES]
  );

  const dropParams = [...window.params];
  const dropBranch = buildDropBranchFilter(branchId, dropParams);

  const dropResult = await queryFn(
    `
      SELECT
        c.branch_id,
        COUNT(DISTINCT cs.student_id)::bigint AS dropped_unenrolled_count
      FROM classstudentstbl cs
      INNER JOIN classestbl c ON cs.class_id = c.class_id
      WHERE ${DROPPED_ROW_FILTER_SQL}
        AND ${window.dropDateFilterSql}
        ${dropBranch.sql}
      GROUP BY c.branch_id
    `,
    dropParams
  );

  const byBranchMap = new Map();

  for (const row of paymentResult.rows || []) {
    const branch_id = parseInt(row.branch_id, 10);
    byBranchMap.set(branch_id, {
      branch_id,
      new_enrollees: parseInt(row.new_enrollees, 10) || 0,
      re_enrollment_count: parseInt(row.re_enrollment_count, 10) || 0,
      upsell_count: parseInt(row.upsell_count, 10) || 0,
      reserved_count: parseInt(row.reserved_count, 10) || 0,
      completed_count: parseInt(row.completed_count, 10) || 0,
      rejoin_count: parseInt(row.rejoin_count, 10) || 0,
      dropped_unenrolled_count: 0,
    });
  }

  for (const row of dropResult.rows || []) {
    const branch_id = parseInt(row.branch_id, 10);
    const dropped = parseInt(row.dropped_unenrolled_count, 10) || 0;
    const existing = byBranchMap.get(branch_id);
    if (existing) {
      existing.dropped_unenrolled_count = dropped;
    } else {
      byBranchMap.set(branch_id, {
        branch_id,
        new_enrollees: 0,
        re_enrollment_count: 0,
        upsell_count: 0,
        reserved_count: 0,
        completed_count: 0,
        rejoin_count: 0,
        dropped_unenrolled_count: dropped,
      });
    }
  }

  const byBranch = [...byBranchMap.values()];

  const totals = byBranch.reduce(
    (acc, row) => ({
      new_enrollees: acc.new_enrollees + row.new_enrollees,
      re_enrollment_count: acc.re_enrollment_count + row.re_enrollment_count,
      upsell_count: acc.upsell_count + row.upsell_count,
      reserved_count: acc.reserved_count + row.reserved_count,
      completed_count: acc.completed_count + row.completed_count,
      rejoin_count: acc.rejoin_count + row.rejoin_count,
      dropped_unenrolled_count: acc.dropped_unenrolled_count + row.dropped_unenrolled_count,
    }),
    EMPTY_TOTALS()
  );

  const retention = await loadOperationalRetentionFromPayments(queryFn, options);
  const rateMetrics = computeOperationalRetentionRate({
    retention_base_count: retention.retention_base_count,
    re_enrollment_count: totals.re_enrollment_count,
  });

  const retentionBranchMap = new Map(
    (retention.retention_base_by_branch || []).map((row) => [row.branch_id, row])
  );
  for (const row of byBranch) {
    const retentionRow = retentionBranchMap.get(row.branch_id);
    row.retention_base_count = retentionRow?.retention_base_count ?? 0;
  }

  return {
    by_branch: byBranch,
    totals: {
      ...totals,
      retention_base_count: retention.retention_base_count,
      retention_re_enrollment_count: rateMetrics.retention_re_enrollment_count,
    },
    source: 'payment_issue_date_program_enrollment_status',
    window_label: window.label,
    prior_period_label: retention.prior_period_label,
    prior_period_type: retention.prior_period_type,
    retention_rate_mode: rateMetrics.retention_rate_mode,
    ...rateMetrics,
  };
}

/**
 * Row-level enrollment events (one row per classified phase-event) for audit / breakdown.
 * @param {Function} queryFn
 * @param {{ branchId?: number|null, summaryDate?: string, monthStart?: string, monthEndExclusive?: string, statusFilter?: string|null }} options
 */
export async function loadOperationalEnrollmentDetailFromPayments(queryFn, options = {}) {
  const { branchId = null, statusFilter = null } = options;
  const window = resolveDateWindow(options);

  const paymentParams = [...window.params];
  const paymentBranch = buildBranchFilter(branchId, paymentParams);
  const statusParamIdx = paymentParams.length + 1;
  paymentParams.push(ENROLLMENT_COUNT_STATUSES);

  let statusFilterSql = '';
  if (statusFilter) {
    paymentParams.push(statusFilter);
    statusFilterSql = `AND program_enrollment_status = $${paymentParams.length}`;
  }

  const detailResult = await queryFn(
    `
      WITH period_payments AS (
        SELECT
          p.payment_id,
          p.invoice_id,
          p.branch_id,
          p.student_id,
          p.issue_date,
          p.created_at AS payment_created_at,
          i.invoice_description,
          i.remarks,
          i.status AS invoice_status,
          COALESCE(i.invoice_chain_root_id, i.invoice_id) AS invoice_chain_key,
          COALESCE(
            (regexp_match(i.remarks, 'CLASS_ID:(\\d+)', 'i'))[1]::int,
            ip.class_id
          ) AS class_id,
          (regexp_match(i.remarks, 'PHASE_START:(\\d+)', 'i'))[1]::int AS phase_start,
          (regexp_match(i.remarks, 'PHASE_END:(\\d+)', 'i'))[1]::int AS phase_end,
          ${IS_FULL_PAYMENT_SQL} AS is_full_payment,
          COALESCE(
            (regexp_match(i.remarks, 'REJOIN_PHASE:(\\d+)', 'i'))[1]::int,
            (regexp_match(i.remarks, 'TARGET_PHASE:(\\d+)', 'i'))[1]::int,
            (regexp_match(i.remarks, 'PHASE_START:(\\d+)', 'i'))[1]::int,
            (regexp_match(i.invoice_description, 'phase\\s*(\\d+)', 'i'))[1]::int,
            CASE
              WHEN i.invoice_description ILIKE '%downpayment%'
                OR COALESCE(i.invoice_chain_root_id, i.invoice_id) = ip.downpayment_invoice_id
              THEN COALESCE(NULLIF(ip.phase_start, 0), 1)
              ELSE NULL
            END
          ) AS phase_number
        FROM paymenttbl p
        INNER JOIN invoicestbl i ON i.invoice_id = p.invoice_id
        LEFT JOIN installmentinvoiceprofilestbl ip
          ON ip.installmentinvoiceprofiles_id = i.installmentinvoiceprofiles_id
        WHERE p.status = 'Completed'
          AND ${window.paymentDateFilterSql}
          AND COALESCE(p.approval_status, 'Pending') NOT IN ('Returned', 'Rejected')
          AND ${CLASS_PAYMENT_FILTER_SQL}
          AND (
            ${IS_FULL_PAYMENT_SQL}
            OR i.status = 'Paid'
          )
          ${paymentBranch.sql}
      ),
      with_status_raw AS (
        SELECT
          dp.payment_id,
          dp.invoice_id,
          dp.invoice_chain_key,
          dp.invoice_status,
          dp.issue_date,
          dp.invoice_description,
          dp.remarks,
          dp.is_full_payment,
          dp.phase_start,
          dp.phase_end,
          dp.phase_number AS invoice_phase_number,
          dp.branch_id,
          dp.student_id,
          dp.class_id,
          u.full_name AS student_name,
          u.email AS student_email,
          b.branch_name,
          c.class_name,
          COALESCE(fp.phase_number, sp.phase_number) AS enrolled_phase_number,
          COALESCE(fp.raw_status, sp.raw_status) AS raw_status,
          COALESCE(fp.program_enrollment_status, sp.program_enrollment_status) AS program_enrollment_status
        FROM period_payments dp
        INNER JOIN userstbl u ON u.user_id = dp.student_id
        LEFT JOIN branchestbl b ON b.branch_id = dp.branch_id
        LEFT JOIN classestbl c ON c.class_id = dp.class_id
        LEFT JOIN LATERAL (
          SELECT
            fp_pick.phase_number,
            fp_pick.raw_status,
            ${FULL_PAYMENT_PHASE_STATUS_CASE_SQL} AS program_enrollment_status
          FROM (
            SELECT
              cs.classstudent_id,
              cs.phase_number,
              cs.program_enrollment_status AS raw_status,
              cs.enrolled_at,
              MIN(cs.phase_number) OVER () AS first_enrolled_phase,
              MAX(cs.phase_number) OVER () AS max_phase_in_payment
            FROM classstudentstbl cs
            WHERE cs.student_id = dp.student_id
              AND cs.class_id = dp.class_id
              AND (
                (dp.phase_start IS NOT NULL AND dp.phase_end IS NOT NULL
                  AND cs.phase_number BETWEEN dp.phase_start AND dp.phase_end)
                OR (dp.phase_start IS NULL OR dp.phase_end IS NULL)
              )
              AND ${PAYMENT_PHASE_ROW_WINDOW_SQL}
          ) fp_pick
        ) fp ON dp.is_full_payment AND dp.class_id IS NOT NULL
        LEFT JOIN LATERAL (
          SELECT
            sp_pick.phase_number,
            sp_pick.raw_status,
            ${SINGLE_PHASE_STATUS_CASE_SQL} AS program_enrollment_status
          FROM (
            SELECT
              cs.classstudent_id,
              cs.phase_number,
              cs.program_enrollment_status AS raw_status,
              cs.enrolled_at
            FROM classstudentstbl cs
            WHERE cs.student_id = dp.student_id
              AND cs.class_id = dp.class_id
              AND (dp.phase_number IS NULL OR cs.phase_number = dp.phase_number)
            ORDER BY
              CASE
                WHEN dp.phase_number IS NOT NULL AND cs.phase_number = dp.phase_number THEN 0
                ELSE 1
              END,
              ABS(EXTRACT(EPOCH FROM (cs.enrolled_at - dp.payment_created_at))),
              CASE WHEN cs.removed_at IS NULL THEN 0 ELSE 1 END,
              cs.classstudent_id DESC
            LIMIT 1
          ) sp_pick
        ) sp ON NOT dp.is_full_payment AND dp.class_id IS NOT NULL
        WHERE COALESCE(fp.program_enrollment_status, sp.program_enrollment_status) = ANY($${statusParamIdx}::text[])
      ),
      ${ENROLLMENT_EVENT_DEDUPE_CTE_SQL}
      SELECT
        with_status.*,
        (
          SELECT COALESCE(NULLIF(cu.number_of_phase, 0), 1)
          FROM classestbl c2
          INNER JOIN programstbl cprog ON cprog.program_id = c2.program_id
          INNER JOIN curriculumstbl cu ON cu.curriculum_id = cprog.curriculum_id
          WHERE c2.class_id = with_status.class_id
          LIMIT 1
        ) AS class_number_of_phase
      FROM with_status
      WHERE TRUE
      ${statusFilterSql}
      ORDER BY issue_date, student_name, enrolled_phase_number, payment_id
    `,
    paymentParams
  );

  return {
    rows: detailResult.rows || [],
    window_label: window.label,
  };
}

/** @param {Function} queryFn @param {{ branchId?: number|null, summaryDate: string }} options */
export async function loadDailyOperationalEnrollmentFromPayments(queryFn, options = {}) {
  const { branchId = null, summaryDate } = options;
  const result = await loadOperationalEnrollmentFromPayments(queryFn, { branchId, summaryDate });
  return { ...result, summary_date: summaryDate };
}

/** @param {Function} queryFn @param {{ branchId?: number|null, monthStart: string, monthEndExclusive: string, summaryMonth?: string }} options */
export async function loadMonthlyOperationalEnrollmentFromPayments(queryFn, options = {}) {
  const { branchId = null, monthStart, monthEndExclusive, summaryMonth } = options;
  const result = await loadOperationalEnrollmentFromPayments(queryFn, {
    branchId,
    monthStart,
    monthEndExclusive,
  });
  return { ...result, summary_month: summaryMonth || null, month_start: monthStart, month_end_exclusive: monthEndExclusive };
}

/**
 * @deprecated Same-window rate (new + re_enrollment + rejoin). Operational dashboards use
 * {@link computeOperationalRetentionRate} with prior-period retention base instead.
 */
export function computePaymentReEnrollmentRate(totals = {}) {
  const retained = Number(totals.re_enrollment_count) || 0;
  const newCount = Number(totals.new_enrollees) || 0;
  const rejoinCount = Number(totals.rejoin_count) || 0;
  const priorCount = newCount + retained + rejoinCount;
  const rate = priorCount > 0 ? Number(((retained / priorCount) * 100).toFixed(2)) : 0;

  return {
    re_enrollment_rate: rate,
    re_enrollment_rate_retained_count: retained,
    re_enrollment_rate_prior_count: priorCount,
  };
}

/** @deprecated Use computePaymentReEnrollmentRate */
export const computeDailyPaymentReEnrollmentRate = computePaymentReEnrollmentRate;

/**
 * Merge payment-date + program_enrollment_status counts into branch breakdown rows.
 */
export function applyPaymentEnrollmentToBranchBreakdown(branchBreakdown, paymentEnrollment) {
  const byBranchId = new Map(
    (paymentEnrollment?.by_branch || []).map((row) => [row.branch_id, row])
  );

  return (branchBreakdown || []).map((row) => {
    const paymentRow = byBranchId.get(row.branch_id);
    return {
      ...row,
      new_enrollees: paymentRow?.new_enrollees ?? 0,
      re_enrollment_count: paymentRow?.re_enrollment_count ?? 0,
      upsell_count: paymentRow?.upsell_count ?? 0,
      reserved_count: paymentRow?.reserved_count ?? 0,
      completed_count: paymentRow?.completed_count ?? 0,
      rejoin_count: paymentRow?.rejoin_count ?? 0,
      dropped_unenrolled_count: paymentRow?.dropped_unenrolled_count ?? 0,
      retention_base_count: paymentRow?.retention_base_count ?? 0,
    };
  });
}
