/**
 * Read-only audits for operational enrollment KPI anomalies:
 * - Partial payments that would double-count before invoice-chain + phase dedupe
 * - Bronny-like same-day cross-class / upsell classification patterns
 * - Multi-track upsell candidates (lower completed + higher program)
 *
 * SQL fragments mirror dailyOperationalEnrollmentFromPayments.js — keep in sync.
 */

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

const PAYMENT_PHASE_ROW_WINDOW_SQL = `
  (
    cs.enrolled_at >= dp.payment_created_at - INTERVAL '30 seconds'
    AND cs.enrolled_at <= dp.payment_created_at + INTERVAL '2 minutes'
  )
`;

const PROGRAM_LEVEL_ORDER_SQL = `ARRAY['Playgroup','Nursery','Pre-Kindergarten','Kindergarten','Grade School']::text[]`;

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

/** Legacy cross-class prior check (no enrolled_at filter) — pre-fix Bronny pattern. */
const LEGACY_CROSS_CLASS_PRIOR_SQL = `
  EXISTS (
    SELECT 1
    FROM classstudentstbl prior
    WHERE prior.student_id = dp.student_id
      AND prior.classstudent_id != sp_pick.classstudent_id
      AND prior.class_id != dp.class_id
      AND prior.program_enrollment_status IN (
        'new', 're_enrolled', 'upsell', 'rejoin', 'completed', 'dropped'
      )
  )
`;

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

const LEGACY_SINGLE_PHASE_STATUS_CASE_SQL = `
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
        WHEN ${buildPriorEnrollmentCheckSql('sp_pick.phase_number', 'prior.classstudent_id != sp_pick.classstudent_id AND prior.class_id = dp.class_id', 'sp_pick.enrolled_at')}
          OR ${LEGACY_CROSS_CLASS_PRIOR_SQL}
          THEN 're_enrolled'
        ELSE 'new'
      END
    ELSE NULL
  END
`;

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

const RE_ENROLLMENT_KPI_STATUSES = ['re_enrolled', 'upsell', 'completed'];

const parsePositiveInt = (value) => {
  if (value == null || value === '') return null;
  const parsed = parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

/**
 * @param {{ from?: string|null, to?: string|null, branchId?: number|null, studentId?: number|null }} filters
 */
export const buildAuditFilters = (filters = {}) => {
  const params = [];
  const clauses = [
    "p.status = 'Completed'",
    "COALESCE(p.approval_status, 'Pending') NOT IN ('Returned', 'Rejected')",
    CLASS_PAYMENT_FILTER_SQL,
    `(${IS_FULL_PAYMENT_SQL} OR i.status = 'Paid')`,
  ];

  if (filters.from) {
    params.push(filters.from);
    clauses.push(`p.issue_date >= $${params.length}::date`);
  }
  if (filters.to) {
    params.push(filters.to);
    clauses.push(`p.issue_date <= $${params.length}::date`);
  }
  if (filters.branchId) {
    params.push(filters.branchId);
    clauses.push(`p.branch_id = $${params.length}`);
  }
  if (filters.studentId) {
    params.push(filters.studentId);
    clauses.push(`p.student_id = $${params.length}`);
  }

  return {
    whereSql: clauses.join('\n          AND '),
    params,
  };
};

/** Min/max completed class-payment issue_date in scope (read-only). */
export async function loadPaymentIssueDateBounds(queryFn, filters = {}) {
  const { whereSql, params } = buildAuditFilters(filters);
  const result = await queryFn(
    `
      SELECT
        MIN(p.issue_date)::text AS min_issue_date,
        MAX(p.issue_date)::text AS max_issue_date,
        COUNT(*)::bigint AS payment_row_count
      FROM paymenttbl p
      INNER JOIN invoicestbl i ON i.invoice_id = p.invoice_id
      WHERE ${whereSql}
    `,
    params
  );
  return result.rows[0] || { min_issue_date: null, max_issue_date: null, payment_row_count: '0' };
}

const buildWithStatusRawCte = () => `
  period_payments AS (
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
    WHERE {{PAYMENT_WHERE}}
  ),
  with_status_raw AS (
    SELECT
      dp.payment_id,
      dp.invoice_id,
      dp.invoice_chain_key,
      dp.invoice_status,
      dp.issue_date,
      dp.invoice_description,
      dp.is_full_payment,
      dp.branch_id,
      dp.student_id,
      dp.class_id,
      u.full_name AS student_name,
      u.email AS student_email,
      b.branch_name,
      c.class_name,
      c.level_tag AS class_level_tag,
      COALESCE(fp.phase_number, sp.phase_number) AS enrolled_phase_number,
      COALESCE(fp.raw_status, sp.raw_status) AS raw_status,
      COALESCE(fp.program_enrollment_status, sp.program_enrollment_status) AS program_enrollment_status,
      sp.legacy_program_enrollment_status
    FROM period_payments dp
    INNER JOIN userstbl u ON u.user_id = dp.student_id
    LEFT JOIN branchestbl b ON b.branch_id = dp.branch_id
    LEFT JOIN classestbl c ON c.class_id = dp.class_id
    LEFT JOIN LATERAL (
      SELECT
        fp_pick.phase_number,
        fp_pick.raw_status,
        ${FULL_PAYMENT_PHASE_STATUS_CASE_SQL} AS program_enrollment_status,
        NULL::text AS legacy_program_enrollment_status
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
        ${SINGLE_PHASE_STATUS_CASE_SQL} AS program_enrollment_status,
        ${LEGACY_SINGLE_PHASE_STATUS_CASE_SQL} AS legacy_program_enrollment_status
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
    WHERE COALESCE(fp.program_enrollment_status, sp.program_enrollment_status) IS NOT NULL
  )
`;

/**
 * Installment / partial payments where multiple completed payments map to the same
 * dedupe key (student + class + phase + invoice chain + status) — would inflate KPIs
 * without DISTINCT ON dedupe.
 */
export async function auditPartialPaymentDoubleCount(queryFn, options = {}) {
  const limit = parsePositiveInt(options.limit) || 200;
  const { whereSql, params } = buildAuditFilters(options);
  const cte = buildWithStatusRawCte().replace('{{PAYMENT_WHERE}}', whereSql);

  const summaryResult = await queryFn(
    `
      WITH ${cte},
      raw_groups AS (
        SELECT
          student_id,
          class_id,
          COALESCE(enrolled_phase_number, -1) AS enrolled_phase_number,
          invoice_chain_key,
          program_enrollment_status,
          COUNT(*)::int AS raw_event_count
        FROM with_status_raw
        WHERE NOT is_full_payment
          AND program_enrollment_status = ANY($${params.length + 1}::text[])
        GROUP BY 1, 2, 3, 4, 5
        HAVING COUNT(*) > 1
      )
      SELECT
        COUNT(*)::int AS duplicate_group_count,
        COALESCE(SUM(raw_event_count - 1), 0)::int AS extra_raw_events,
        COUNT(DISTINCT student_id)::int AS affected_student_count
      FROM raw_groups
    `,
    [...params, RE_ENROLLMENT_KPI_STATUSES]
  );

  const detailResult = await queryFn(
    `
      WITH ${cte},
      raw_groups AS (
        SELECT
          student_id,
          class_id,
          COALESCE(enrolled_phase_number, -1) AS enrolled_phase_number,
          invoice_chain_key,
          program_enrollment_status,
          COUNT(*)::int AS raw_event_count,
          MIN(issue_date)::text AS first_issue_date,
          MAX(issue_date)::text AS last_issue_date,
          array_agg(payment_id ORDER BY payment_id) AS payment_ids,
          array_agg(DISTINCT invoice_status) AS invoice_statuses
        FROM with_status_raw
        WHERE NOT is_full_payment
          AND program_enrollment_status = ANY($${params.length + 1}::text[])
        GROUP BY 1, 2, 3, 4, 5
        HAVING COUNT(*) > 1
      )
      SELECT
        rg.*,
        wsr.student_name,
        wsr.student_email,
        wsr.branch_name,
        wsr.class_name,
        wsr.class_level_tag
      FROM raw_groups rg
      INNER JOIN LATERAL (
        SELECT student_name, student_email, branch_name, class_name, class_level_tag
        FROM with_status_raw w
        WHERE w.student_id = rg.student_id
          AND w.class_id = rg.class_id
        LIMIT 1
      ) wsr ON TRUE
      ORDER BY rg.raw_event_count DESC, rg.first_issue_date, rg.student_id
      LIMIT $${params.length + 2}
    `,
    [...params, RE_ENROLLMENT_KPI_STATUSES, limit]
  );

  return {
    summary: summaryResult.rows[0] || {},
    rows: detailResult.rows || [],
  };
}

/**
 * Bronny-like patterns:
 * - legacy_cross_class_flip: installment phase-1 raw new, legacy re_enrolled, current new
 * - same_day_upsell_lower_phase1: lower + higher class same Manila day; lower phase 1 payment
 */
export async function auditBronnyLikePatterns(queryFn, options = {}) {
  const limit = parsePositiveInt(options.limit) || 200;
  const { whereSql, params } = buildAuditFilters(options);
  const cte = buildWithStatusRawCte().replace('{{PAYMENT_WHERE}}', whereSql);

  const legacySummary = await queryFn(
    `
      WITH ${cte}
      SELECT
        COUNT(*)::int AS legacy_flip_count,
        COUNT(DISTINCT student_id)::int AS affected_students
      FROM with_status_raw
      WHERE NOT is_full_payment
        AND raw_status = 'new'
        AND enrolled_phase_number = 1
        AND legacy_program_enrollment_status = 're_enrolled'
        AND program_enrollment_status = 'new'
    `,
    params
  );

  const legacyDetail = await queryFn(
    `
      WITH ${cte}
      SELECT
        student_id,
        student_name,
        student_email,
        branch_name,
        class_id,
        class_name,
        class_level_tag,
        enrolled_phase_number,
        raw_status,
        program_enrollment_status,
        legacy_program_enrollment_status,
        issue_date::text,
        payment_id,
        invoice_id,
        invoice_chain_key,
        invoice_status,
        invoice_description
      FROM with_status_raw
      WHERE NOT is_full_payment
        AND raw_status = 'new'
        AND enrolled_phase_number = 1
        AND legacy_program_enrollment_status = 're_enrolled'
        AND program_enrollment_status = 'new'
      ORDER BY issue_date, student_name, payment_id
      LIMIT $${params.length + 1}
    `,
    [...params, limit]
  );

  const stillMisclassifiedSummary = await queryFn(
    `
      WITH ${cte}
      SELECT
        COUNT(*)::int AS still_misclassified_count,
        COUNT(DISTINCT student_id)::int AS affected_students
      FROM with_status_raw
      WHERE NOT is_full_payment
        AND raw_status = 'new'
        AND enrolled_phase_number = 1
        AND program_enrollment_status = 're_enrolled'
        AND EXISTS (
          SELECT 1
          FROM classstudentstbl higher
          INNER JOIN classestbl higher_c ON higher.class_id = higher_c.class_id
          INNER JOIN classestbl lower_c ON lower_c.class_id = with_status_raw.class_id
          WHERE higher.student_id = with_status_raw.student_id
            AND higher.class_id != with_status_raw.class_id
            AND higher.enrolled_at IS NOT NULL
            AND TIMEZONE('Asia/Manila', higher.enrolled_at)::date =
                TIMEZONE('Asia/Manila', with_status_raw.issue_date::timestamp)::date
            AND array_position(${PROGRAM_LEVEL_ORDER_SQL}, TRIM(higher_c.level_tag)) IS NOT NULL
            AND array_position(${PROGRAM_LEVEL_ORDER_SQL}, TRIM(lower_c.level_tag)) IS NOT NULL
            AND array_position(${PROGRAM_LEVEL_ORDER_SQL}, TRIM(higher_c.level_tag))
                > array_position(${PROGRAM_LEVEL_ORDER_SQL}, TRIM(lower_c.level_tag))
        )
    `,
    params
  );

  const stillMisclassifiedDetail = await queryFn(
    `
      WITH ${cte}
      SELECT
        student_id,
        student_name,
        student_email,
        branch_name,
        class_id,
        class_name,
        class_level_tag,
        enrolled_phase_number,
        raw_status,
        program_enrollment_status,
        issue_date::text,
        payment_id,
        invoice_id,
        invoice_chain_key,
        invoice_description
      FROM with_status_raw
      WHERE NOT is_full_payment
        AND raw_status = 'new'
        AND enrolled_phase_number = 1
        AND program_enrollment_status = 're_enrolled'
        AND EXISTS (
          SELECT 1
          FROM classstudentstbl higher
          INNER JOIN classestbl higher_c ON higher.class_id = higher_c.class_id
          INNER JOIN classestbl lower_c ON lower_c.class_id = with_status_raw.class_id
          WHERE higher.student_id = with_status_raw.student_id
            AND higher.class_id != with_status_raw.class_id
            AND higher.enrolled_at IS NOT NULL
            AND TIMEZONE('Asia/Manila', higher.enrolled_at)::date =
                TIMEZONE('Asia/Manila', with_status_raw.issue_date::timestamp)::date
            AND array_position(${PROGRAM_LEVEL_ORDER_SQL}, TRIM(higher_c.level_tag)) IS NOT NULL
            AND array_position(${PROGRAM_LEVEL_ORDER_SQL}, TRIM(lower_c.level_tag)) IS NOT NULL
            AND array_position(${PROGRAM_LEVEL_ORDER_SQL}, TRIM(higher_c.level_tag))
                > array_position(${PROGRAM_LEVEL_ORDER_SQL}, TRIM(lower_c.level_tag))
        )
      ORDER BY issue_date, student_name, payment_id
      LIMIT $${params.length + 1}
    `,
    [...params, limit]
  );

  const upsellParams = [];
  let upsellStudentFilter = '';
  let upsellBranchFilter = '';
  let upsellEnrollmentDateFilter = '';
  if (options.studentId) {
    upsellParams.push(options.studentId);
    upsellStudentFilter = `AND cs.student_id = $${upsellParams.length}`;
  }
  if (options.branchId) {
    upsellParams.push(options.branchId);
    upsellBranchFilter = `AND lc.branch_id = $${upsellParams.length}`;
  }
  if (options.from) {
    upsellParams.push(options.from);
    upsellEnrollmentDateFilter += `\n          AND TIMEZONE('Asia/Manila', cs.enrolled_at)::date >= $${upsellParams.length}::date`;
  }
  if (options.to) {
    upsellParams.push(options.to);
    upsellEnrollmentDateFilter += `\n          AND TIMEZONE('Asia/Manila', cs.enrolled_at)::date <= $${upsellParams.length}::date`;
  }

  const upsellPairSummaryFixed = await queryFn(
    `
      WITH lower_tracks AS (
        SELECT DISTINCT
          cs.student_id,
          cs.class_id AS lower_class_id,
          lc.class_name AS lower_class_name,
          lc.level_tag AS lower_level_tag,
          TIMEZONE('Asia/Manila', cs.enrolled_at)::date AS enroll_day
        FROM classstudentstbl cs
        INNER JOIN classestbl lc ON lc.class_id = cs.class_id
        WHERE cs.phase_number = 1
          AND cs.program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'completed')
          AND cs.enrolled_at IS NOT NULL
          ${upsellStudentFilter}
          ${upsellBranchFilter}
          ${upsellEnrollmentDateFilter}
      ),
      upsell_pairs AS (
        SELECT DISTINCT
          lt.student_id,
          lt.enroll_day::text,
          lt.lower_class_id,
          lt.lower_class_name,
          lt.lower_level_tag,
          hc.class_id AS higher_class_id,
          hc.class_name AS higher_class_name,
          hc.level_tag AS higher_level_tag
        FROM lower_tracks lt
        INNER JOIN classstudentstbl higher_cs ON higher_cs.student_id = lt.student_id
        INNER JOIN classestbl hc ON hc.class_id = higher_cs.class_id
        WHERE higher_cs.class_id != lt.lower_class_id
          AND TIMEZONE('Asia/Manila', higher_cs.enrolled_at)::date = lt.enroll_day
          AND array_position(${PROGRAM_LEVEL_ORDER_SQL}, TRIM(hc.level_tag)) IS NOT NULL
          AND array_position(${PROGRAM_LEVEL_ORDER_SQL}, TRIM(lt.lower_level_tag)) IS NOT NULL
          AND array_position(${PROGRAM_LEVEL_ORDER_SQL}, TRIM(hc.level_tag))
              > array_position(${PROGRAM_LEVEL_ORDER_SQL}, TRIM(lt.lower_level_tag))
          AND higher_cs.program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'completed')
      )
      SELECT
        COUNT(*)::int AS same_day_upsell_pair_count,
        COUNT(DISTINCT student_id)::int AS affected_students
      FROM upsell_pairs
    `,
    upsellParams
  );

  const upsellPairDetail = await queryFn(
    `
      WITH lower_tracks AS (
        SELECT DISTINCT
          cs.student_id,
          cs.class_id AS lower_class_id,
          lc.class_name AS lower_class_name,
          lc.level_tag AS lower_level_tag,
          TIMEZONE('Asia/Manila', cs.enrolled_at)::date AS enroll_day
        FROM classstudentstbl cs
        INNER JOIN classestbl lc ON lc.class_id = cs.class_id
        WHERE cs.phase_number = 1
          AND cs.program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'completed')
          AND cs.enrolled_at IS NOT NULL
          ${upsellStudentFilter}
          ${upsellBranchFilter}
          ${upsellEnrollmentDateFilter}
      ),
      upsell_pairs AS (
        SELECT DISTINCT
          lt.student_id,
          u.full_name AS student_name,
          u.email AS student_email,
          lt.enroll_day::text,
          lt.lower_class_id,
          lt.lower_class_name,
          lt.lower_level_tag,
          hc.class_id AS higher_class_id,
          hc.class_name AS higher_class_name,
          hc.level_tag AS higher_level_tag
        FROM lower_tracks lt
        INNER JOIN userstbl u ON u.user_id = lt.student_id
        INNER JOIN classstudentstbl higher_cs ON higher_cs.student_id = lt.student_id
        INNER JOIN classestbl hc ON hc.class_id = higher_cs.class_id
        WHERE higher_cs.class_id != lt.lower_class_id
          AND TIMEZONE('Asia/Manila', higher_cs.enrolled_at)::date = lt.enroll_day
          AND array_position(${PROGRAM_LEVEL_ORDER_SQL}, TRIM(hc.level_tag)) IS NOT NULL
          AND array_position(${PROGRAM_LEVEL_ORDER_SQL}, TRIM(lt.lower_level_tag)) IS NOT NULL
          AND array_position(${PROGRAM_LEVEL_ORDER_SQL}, TRIM(hc.level_tag))
              > array_position(${PROGRAM_LEVEL_ORDER_SQL}, TRIM(lt.lower_level_tag))
          AND higher_cs.program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'completed')
      )
      SELECT *
      FROM upsell_pairs
      ORDER BY enroll_day DESC, student_name, lower_class_id, higher_class_id
      LIMIT $${upsellParams.length + 1}
    `,
    [...upsellParams, limit]
  );

  return {
    legacy_cross_class_flip: {
      summary: legacySummary.rows[0] || {},
      rows: legacyDetail.rows || [],
    },
    still_misclassified_same_day_upsell: {
      summary: stillMisclassifiedSummary.rows[0] || {},
      rows: stillMisclassifiedDetail.rows || [],
    },
    same_day_upsell_pairs: {
      summary: upsellPairSummaryFixed.rows[0] || {},
      rows: upsellPairDetail.rows || [],
    },
  };
}

/**
 * Students with a completed lower program and an active higher program (matrix upsell-merge candidates).
 */
export async function auditUpsellMergeCandidates(queryFn, options = {}) {
  const limit = parsePositiveInt(options.limit) || 200;
  const params = [];
  let studentFilter = '';
  let branchFilter = '';

  if (options.studentId) {
    params.push(options.studentId);
    studentFilter = `AND lower_cs.student_id = $${params.length}`;
  }
  if (options.branchId) {
    params.push(options.branchId);
    branchFilter = `AND lower_c.branch_id = $${params.length}`;
  }

  const summaryResult = await queryFn(
    `
      SELECT
        COUNT(DISTINCT lower_cs.student_id)::int AS candidate_student_count,
        COUNT(*)::int AS lower_higher_pair_count
      FROM classstudentstbl lower_cs
      INNER JOIN classestbl lower_c ON lower_c.class_id = lower_cs.class_id
      INNER JOIN classstudentstbl higher_cs ON higher_cs.student_id = lower_cs.student_id
      INNER JOIN classestbl higher_c ON higher_c.class_id = higher_cs.class_id
      WHERE lower_cs.program_enrollment_status = 'completed'
        AND lower_cs.removed_at IS NULL
        AND higher_cs.class_id != lower_cs.class_id
        AND higher_cs.removed_at IS NULL
        AND higher_cs.program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'completed')
        AND array_position(${PROGRAM_LEVEL_ORDER_SQL}, TRIM(lower_c.level_tag)) IS NOT NULL
        AND array_position(${PROGRAM_LEVEL_ORDER_SQL}, TRIM(higher_c.level_tag)) IS NOT NULL
        AND array_position(${PROGRAM_LEVEL_ORDER_SQL}, TRIM(lower_c.level_tag))
            < array_position(${PROGRAM_LEVEL_ORDER_SQL}, TRIM(higher_c.level_tag))
        ${studentFilter}
        ${branchFilter}
    `,
    params
  );

  const detailResult = await queryFn(
    `
      SELECT DISTINCT ON (lower_cs.student_id, lower_cs.class_id, higher_cs.class_id)
        lower_cs.student_id,
        u.full_name AS student_name,
        u.email AS student_email,
        lower_c.branch_id,
        b.branch_name,
        lower_cs.class_id AS lower_class_id,
        lower_c.class_name AS lower_class_name,
        lower_c.level_tag AS lower_level_tag,
        higher_cs.class_id AS higher_class_id,
        higher_c.class_name AS higher_class_name,
        higher_c.level_tag AS higher_level_tag,
        COALESCE(NULLIF(cu_lower.number_of_phase, 0), 1) AS lower_number_of_phase,
        COALESCE(NULLIF(cu_higher.number_of_phase, 0), 1) AS higher_number_of_phase,
        TIMEZONE('Asia/Manila', lower_cs.enrolled_at)::date::text AS lower_first_enrolled_day,
        TIMEZONE('Asia/Manila', higher_cs.enrolled_at)::date::text AS higher_first_enrolled_day
      FROM classstudentstbl lower_cs
      INNER JOIN userstbl u ON u.user_id = lower_cs.student_id
      INNER JOIN classestbl lower_c ON lower_c.class_id = lower_cs.class_id
      LEFT JOIN branchestbl b ON b.branch_id = lower_c.branch_id
      INNER JOIN programstbl prog_lower ON prog_lower.program_id = lower_c.program_id
      INNER JOIN curriculumstbl cu_lower ON cu_lower.curriculum_id = prog_lower.curriculum_id
      INNER JOIN classstudentstbl higher_cs ON higher_cs.student_id = lower_cs.student_id
      INNER JOIN classestbl higher_c ON higher_c.class_id = higher_cs.class_id
      INNER JOIN programstbl prog_higher ON prog_higher.program_id = higher_c.program_id
      INNER JOIN curriculumstbl cu_higher ON cu_higher.curriculum_id = prog_higher.curriculum_id
      WHERE lower_cs.program_enrollment_status = 'completed'
        AND lower_cs.removed_at IS NULL
        AND higher_cs.class_id != lower_cs.class_id
        AND higher_cs.removed_at IS NULL
        AND higher_cs.program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'completed')
        AND array_position(${PROGRAM_LEVEL_ORDER_SQL}, TRIM(lower_c.level_tag)) IS NOT NULL
        AND array_position(${PROGRAM_LEVEL_ORDER_SQL}, TRIM(higher_c.level_tag)) IS NOT NULL
        AND array_position(${PROGRAM_LEVEL_ORDER_SQL}, TRIM(lower_c.level_tag))
            < array_position(${PROGRAM_LEVEL_ORDER_SQL}, TRIM(higher_c.level_tag))
        ${studentFilter}
        ${branchFilter}
      ORDER BY lower_cs.student_id, lower_cs.class_id, higher_cs.class_id, higher_cs.enrolled_at
      LIMIT $${params.length + 1}
    `,
    [...params, limit]
  );

  return {
    summary: summaryResult.rows[0] || {},
    rows: detailResult.rows || [],
  };
}

/**
 * Compare raw vs deduped re-enrollment KPI event counts in payment window.
 */
export async function auditDedupeImpactSummary(queryFn, options = {}) {
  const { whereSql, params } = buildAuditFilters(options);
  const cte = buildWithStatusRawCte().replace('{{PAYMENT_WHERE}}', whereSql);

  const result = await queryFn(
    `
      WITH ${cte},
      ${ENROLLMENT_EVENT_DEDUPE_CTE_SQL},
      raw_kpi AS (
        SELECT COUNT(*)::int AS raw_re_enrollment_kpi_events
        FROM with_status_raw
        WHERE program_enrollment_status = ANY($${params.length + 1}::text[])
      ),
      deduped_kpi AS (
        SELECT COUNT(*)::int AS deduped_re_enrollment_kpi_events
        FROM with_status
        WHERE program_enrollment_status = ANY($${params.length + 1}::text[])
      )
      SELECT
        raw_kpi.raw_re_enrollment_kpi_events,
        deduped_kpi.deduped_re_enrollment_kpi_events,
        (raw_kpi.raw_re_enrollment_kpi_events - deduped_kpi.deduped_re_enrollment_kpi_events)::int AS events_removed_by_dedupe
      FROM raw_kpi, deduped_kpi
    `,
    [...params, RE_ENROLLMENT_KPI_STATUSES]
  );

  return result.rows[0] || {};
}
