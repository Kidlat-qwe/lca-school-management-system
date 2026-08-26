/**
 * Installment → full payment package conversion (upgrade plan).
 * Credits completed class-related tuition payments (downpayment, reservation, phases);
 * late-penalty amounts are not credited. Enrollment finalization runs from payments.js on settlement.
 */

import { enrollStudentForFullPaymentPhases } from '../utils/fullPaymentPhaseEnrollment.js';

export const PACKAGE_CHANGE_TO_FULLPAYMENT = 'PACKAGE_CHANGE_TO_FULLPAYMENT';

export const roundCurrency = (value) =>
  Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

/**
 * Count recurring invoices that still have an open partial / in-progress payment.
 *
 * A Completed payment on a non-Paid invoice normally blocks package change.
 * Settled balance-chain parents are excluded: when `balance_invoice_id` walks to a
 * leaf whose status is Paid (e.g. Partially Paid INV-2048 → Paid INV-2049), the
 * phase is fully settled and must not block Update Plan.
 *
 * @param {object} client - pg client or pool query wrapper with `.query`
 * @param {{ profileId: number, downpaymentInvoiceId?: number|null }} args
 * @returns {Promise<number>}
 */
export async function countOpenPartialRecurringInvoices(
  client,
  { profileId, downpaymentInvoiceId = null }
) {
  const result = await client.query(
    `SELECT COUNT(DISTINCT i.invoice_id) AS partial_count
     FROM invoicestbl i
     INNER JOIN paymenttbl p ON p.invoice_id = i.invoice_id
     WHERE i.installmentinvoiceprofiles_id = $1
       AND ($2::INTEGER IS NULL OR i.invoice_id != $2::INTEGER)
       AND p.status = 'Completed'
       AND COALESCE(p.approval_status, 'Pending') <> 'Rejected'
       AND COALESCE(i.status, '') <> 'Paid'
       AND NOT (
         i.balance_invoice_id IS NOT NULL
         AND EXISTS (
           WITH RECURSIVE chain AS (
             SELECT
               inv.invoice_id,
               inv.balance_invoice_id,
               inv.status,
               0 AS depth
             FROM invoicestbl inv
             WHERE inv.invoice_id = i.balance_invoice_id
             UNION ALL
             SELECT
               nxt.invoice_id,
               nxt.balance_invoice_id,
               nxt.status,
               chain.depth + 1
             FROM invoicestbl nxt
             INNER JOIN chain ON nxt.invoice_id = chain.balance_invoice_id
             WHERE chain.depth < 20
               AND chain.balance_invoice_id IS NOT NULL
           )
           SELECT 1
           FROM chain
           WHERE chain.balance_invoice_id IS NULL
             AND COALESCE(chain.status, '') = 'Paid'
         )
       )`,
    [profileId, downpaymentInvoiceId]
  );
  return parseInt(result.rows[0]?.partial_count || 0, 10);
}

export const isInstallmentLikePackage = (pkg) =>
  Boolean(
    pkg &&
      (pkg.package_type === 'Installment' ||
        (pkg.package_type === 'Phase' &&
          String(pkg.payment_option || '')
            .trim()
            .toLowerCase() === 'installment'))
  );

export const isFullpaymentLikePackage = (pkg) => {
  if (!pkg) return false;
  if (pkg.package_type === 'Fullpayment') return true;
  if (
    pkg.package_type === 'Phase' &&
    String(pkg.payment_option || '')
      .trim()
      .toLowerCase() === 'fullpayment'
  ) {
    return true;
  }
  return false;
};

const sumCompletedPaymentsForInvoicesSql = `
  SELECT COALESCE(SUM(COALESCE(p.payable_amount, 0) + COALESCE(p.discount_amount, 0)), 0) AS total_paid
  FROM paymenttbl p
  INNER JOIN invoicestbl i ON i.invoice_id = p.invoice_id
  INNER JOIN invoicestudentstbl ins ON ins.invoice_id = i.invoice_id AND ins.student_id = $1
  WHERE p.status = 'Completed'
    AND COALESCE(p.approval_status, 'Pending') <> 'Rejected'
    AND COALESCE(i.status, '') <> 'Cancelled'
`;

/**
 * Completed payment credit for a set of invoices, excluding late-penalty portions.
 * Per invoice: credit = paid − min(paid, invoice penalty_amount total).
 *
 * @returns {Promise<{ total_paid: number, penalty_excluded: number, credit: number }>}
 */
async function sumCompletedPaymentCreditExcludingPenalties(client, { studentId, invoiceFilterSql, params }) {
  const result = await client.query(
    `
    WITH scoped_paid AS (
      SELECT
        i.invoice_id,
        COALESCE(SUM(COALESCE(p.payable_amount, 0) + COALESCE(p.discount_amount, 0)), 0) AS paid
      FROM paymenttbl p
      INNER JOIN invoicestbl i ON i.invoice_id = p.invoice_id
      INNER JOIN invoicestudentstbl ins ON ins.invoice_id = i.invoice_id AND ins.student_id = $1
      WHERE p.status = 'Completed'
        AND COALESCE(p.approval_status, 'Pending') <> 'Rejected'
        AND COALESCE(i.status, '') <> 'Cancelled'
        AND (${invoiceFilterSql})
      GROUP BY i.invoice_id
    ),
    scoped_penalties AS (
      SELECT
        ii.invoice_id,
        COALESCE(SUM(COALESCE(ii.penalty_amount, 0)), 0) AS penalty
      FROM invoiceitemstbl ii
      INNER JOIN scoped_paid sp ON sp.invoice_id = ii.invoice_id
      GROUP BY ii.invoice_id
    )
    SELECT
      COALESCE(SUM(sp.paid), 0) AS total_paid,
      COALESCE(SUM(LEAST(sp.paid, COALESCE(pen.penalty, 0))), 0) AS penalty_excluded
    FROM scoped_paid sp
    LEFT JOIN scoped_penalties pen ON pen.invoice_id = sp.invoice_id
    `,
    params
  );

  const totalPaid = roundCurrency(result.rows[0]?.total_paid || 0);
  const penaltyExcluded = roundCurrency(result.rows[0]?.penalty_excluded || 0);
  return {
    total_paid: totalPaid,
    penalty_excluded: penaltyExcluded,
    credit: roundCurrency(Math.max(0, totalPaid - penaltyExcluded)),
  };
}

/**
 * Reservation fee invoice for this class (reservedstudentstbl.invoice_id — often no CLASS_ID in remarks).
 * Late penalties on reservation invoices are not credited toward Update Plan.
 */
export async function getReservationFeeCreditTotal(client, { studentId, classId }) {
  const breakdown = await sumCompletedPaymentCreditExcludingPenalties(client, {
    studentId,
    invoiceFilterSql: `i.invoice_id IN (
      SELECT r.invoice_id
      FROM reservedstudentstbl r
      WHERE r.student_id = $1
        AND r.class_id = $2
        AND r.invoice_id IS NOT NULL
    )`,
    params: [studentId, classId],
  });
  return breakdown.credit;
}

/**
 * Installment plan payments (profile-linked + downpayment invoice), excluding reservation fee invoice.
 * Late-penalty amounts on those invoices are not credited toward Update Plan.
 */
export async function getInstallmentPlanPaymentCreditTotal(
  client,
  { studentId, classId, profileId, downpaymentInvoiceId }
) {
  const breakdown = await sumCompletedPaymentCreditExcludingPenalties(client, {
    studentId,
    invoiceFilterSql: `(
      i.installmentinvoiceprofiles_id = $3
      OR ($4::INTEGER IS NOT NULL AND i.invoice_id = $4::INTEGER)
    )
    AND i.invoice_id NOT IN (
      SELECT r.invoice_id
      FROM reservedstudentstbl r
      WHERE r.student_id = $1
        AND r.class_id = $2
        AND r.invoice_id IS NOT NULL
    )`,
    params: [studentId, classId, profileId, downpaymentInvoiceId || null],
  });
  return breakdown.credit;
}

/**
 * Sum completed payments: reservation fee + downpayment + phase/installment invoices for this class plan.
 * Late penalties are excluded from credit_total (they do not reduce the Update Plan balance due).
 */
export async function getStudentClassPaymentCreditTotal(
  client,
  { studentId, classId, profileId, downpaymentInvoiceId }
) {
  const breakdown = await getStudentClassPaymentCreditBreakdown(client, {
    studentId,
    classId,
    profileId,
    downpaymentInvoiceId,
  });
  return breakdown.credit_total;
}

export async function getStudentClassPaymentCreditBreakdown(
  client,
  { studentId, classId, profileId, downpaymentInvoiceId }
) {
  const [reservation, installment] = await Promise.all([
    sumCompletedPaymentCreditExcludingPenalties(client, {
      studentId,
      invoiceFilterSql: `i.invoice_id IN (
        SELECT r.invoice_id
        FROM reservedstudentstbl r
        WHERE r.student_id = $1
          AND r.class_id = $2
          AND r.invoice_id IS NOT NULL
      )`,
      params: [studentId, classId],
    }),
    sumCompletedPaymentCreditExcludingPenalties(client, {
      studentId,
      invoiceFilterSql: `(
        i.installmentinvoiceprofiles_id = $3
        OR ($4::INTEGER IS NOT NULL AND i.invoice_id = $4::INTEGER)
      )
      AND i.invoice_id NOT IN (
        SELECT r.invoice_id
        FROM reservedstudentstbl r
        WHERE r.student_id = $1
          AND r.class_id = $2
          AND r.invoice_id IS NOT NULL
      )`,
      params: [studentId, classId, profileId, downpaymentInvoiceId || null],
    }),
  ]);

  const penaltyExcluded = roundCurrency(
    (reservation.penalty_excluded || 0) + (installment.penalty_excluded || 0)
  );

  return {
    reservation_fee_paid: reservation.credit,
    installment_payments_paid: installment.credit,
    reservation_fee_gross_paid: reservation.total_paid,
    installment_payments_gross_paid: installment.total_paid,
    penalty_paid_not_credited: penaltyExcluded,
    credit_total: roundCurrency(reservation.credit + installment.credit),
  };
}

/**
 * Profile-scoped completed payment credit (installment↔installment), excluding late penalties.
 */
export async function getInstallmentProfilePaymentCreditExcludingPenalties(
  client,
  { studentId, profileId }
) {
  return sumCompletedPaymentCreditExcludingPenalties(client, {
    studentId,
    invoiceFilterSql: 'i.installmentinvoiceprofiles_id = $2',
    params: [studentId, profileId],
  });
}

export function resolveTargetFullPaymentPhaseRange(targetPackage, classMaxPhase) {
  let phaseStart = 1;
  let phaseEnd = classMaxPhase != null && classMaxPhase > 0 ? classMaxPhase : 1;

  if (targetPackage?.package_type === 'Phase') {
    phaseStart = parseInt(targetPackage.phase_start, 10) || 1;
    phaseEnd = parseInt(targetPackage.phase_end, 10) || phaseStart;
  }

  if (classMaxPhase != null && classMaxPhase > 0) {
    phaseStart = Math.min(phaseStart, classMaxPhase);
    phaseEnd = Math.min(phaseEnd, classMaxPhase);
  }

  if (phaseEnd < phaseStart) phaseEnd = phaseStart;
  return { phaseStart, phaseEnd };
}

export function resolveCurrentInstallmentPhaseRange(profile) {
  const phaseStart =
    profile?.phase_start != null ? parseInt(profile.phase_start, 10) : 1;
  const totalPhases = Math.max(1, parseInt(profile?.total_phases, 10) || 1);
  const phaseEnd = phaseStart + totalPhases - 1;
  return { phaseStart, phaseEnd };
}

export function buildFullPaymentRemarks({
  classId,
  studentId,
  profileId,
  fromPackageId,
  toPackageId,
  phaseStart,
  phaseEnd,
  creditApplied,
  targetFullPrice,
}) {
  return [
    PACKAGE_CHANGE_TO_FULLPAYMENT,
    `CLASS_ID:${classId}`,
    `STUDENT_ID:${studentId}`,
    `PROFILE_ID:${profileId}`,
    `FROM_PACKAGE_ID:${fromPackageId}`,
    `TO_PACKAGE_ID:${toPackageId}`,
    `PHASE_START:${phaseStart}`,
    `PHASE_END:${phaseEnd}`,
    `CREDIT_APPLIED:${roundCurrency(creditApplied).toFixed(2)}`,
    `TARGET_FULL_PRICE:${roundCurrency(targetFullPrice).toFixed(2)}`,
  ].join(';');
}

export async function deactivateInstallmentPlanForConversion(
  client,
  profileId,
  conversionInvoiceId = null
) {
  await client.query(
    `UPDATE installmentinvoiceprofilestbl
     SET is_active = false
     WHERE installmentinvoiceprofiles_id = $1`,
    [profileId]
  );

  await client.query(
    `UPDATE installmentinvoicestbl
     SET status = 'Cancelled'
     WHERE installmentinvoiceprofiles_id = $1
       AND COALESCE(status, '') IN ('Pending', 'Scheduled')`,
    [profileId]
  );

  await client.query(
    `UPDATE invoicestbl
     SET status = 'Cancelled'
     WHERE installmentinvoiceprofiles_id = $1
       AND COALESCE(status, '') IN ('Unpaid', 'Pending', 'Overdue')
       AND ($2::INTEGER IS NULL OR invoice_id <> $2::INTEGER)`,
    [profileId, conversionInvoiceId]
  );
}

export async function applyInstallmentToFullPaymentConversion(
  client,
  {
    classId,
    studentId,
    profileId,
    phaseStart,
    phaseEnd,
    conversionInvoiceId = null,
    sourceLabel,
  }
) {
  await deactivateInstallmentPlanForConversion(client, profileId, conversionInvoiceId);
  const changedRows = await enrollStudentForFullPaymentPhases({
    client,
    studentId,
    classId,
    phaseStart,
    phaseEnd,
    sourceLabel:
      sourceLabel ||
      'System (Installment converted to full payment — all target phases enrolled)',
  });
  return { changedRows };
}

/**
 * Itemized invoice lines for installment → full payment conversion.
 */
export function buildFullPaymentConversionInvoiceLineItems(details) {
  const target = details?.target_package || {};
  const phaseStart = details?.target_phase_start ?? 1;
  const phaseEnd = details?.target_phase_end ?? phaseStart;
  const lineItems = [
    {
      description: `Full payment: ${target.package_name || 'Package'} (Phases ${phaseStart}–${phaseEnd})`,
      amount: roundCurrency(details?.target_full_price || 0),
    },
  ];

  const reservationCredit = roundCurrency(details?.reservation_fee_credited || 0);
  const installmentCredit = roundCurrency(details?.installment_payments_credited || 0);

  if (reservationCredit > 0) {
    lineItems.push({
      description: 'Credit: Reservation fee paid',
      amount: -reservationCredit,
    });
  }
  if (installmentCredit > 0) {
    lineItems.push({
      description: 'Credit: Downpayment and installment payments',
      amount: -installmentCredit,
    });
  }

  if (reservationCredit <= 0 && installmentCredit <= 0) {
    const lumpCredit = roundCurrency(details?.credit_total || 0);
    if (lumpCredit > 0) {
      lineItems.push({
        description: 'Credit: Previous downpayment, reservation fee, and installment payments',
        amount: -lumpCredit,
      });
    }
  }

  const promoDiscount = roundCurrency(details?.promo_discount || 0);
  if (promoDiscount > 0) {
    const promoName = details?.promo?.promo_name || 'Promo';
    lineItems.push({
      description: `Promo discount: ${promoName}`,
      amount: -promoDiscount,
    });
  }

  return lineItems;
}

export const FULL_PAYMENT_UPGRADE_NOTE = 'Upgraded to Full Payment';

/**
 * Detect whether an installment profile was settled via installment → full payment conversion.
 * Matches paid conversion invoices; falls back to inactive profile + cancelled slots + enrollment.
 */
export async function resolveInstallmentProfileFullPaymentConversion(
  db,
  { profileId, studentId, classId, isActive }
) {
  if (!profileId || !studentId) return null;

  const paidConversion = await db.query(
    `SELECT i.invoice_id,
            i.remarks,
            (
              SELECT TO_CHAR(MAX(p.issue_date), 'YYYY-MM-DD')
              FROM paymenttbl p
              WHERE p.invoice_id = i.invoice_id
                AND p.status = 'Completed'
                AND COALESCE(p.approval_status, 'Pending') <> 'Rejected'
            ) AS conversion_payment_date
     FROM invoicestbl i
     INNER JOIN invoicestudentstbl ins
       ON ins.invoice_id = i.invoice_id
      AND ins.student_id = $1
     WHERE i.status = 'Paid'
       AND i.remarks ILIKE '%PACKAGE_CHANGE_TO_FULLPAYMENT%'
       AND i.remarks ILIKE $2
     ORDER BY i.invoice_id DESC
     LIMIT 1`,
    [studentId, `%PROFILE_ID:${profileId}%`]
  );

  if (paidConversion.rows.length > 0) {
    const row = paidConversion.rows[0];
    const parsed = parseFullPaymentChangeRemarks(row.remarks);
    return {
      upgraded: true,
      note: FULL_PAYMENT_UPGRADE_NOTE,
      conversion_invoice_id:
        row.invoice_id != null ? Number(row.invoice_id) : null,
      conversion_payment_date: row.conversion_payment_date || null,
      phase_start: parsed?.phaseStart ?? null,
      phase_end: parsed?.phaseEnd ?? null,
    };
  }

  if (isActive !== false) return null;

  const cancelledOnProfile = await db.query(
    `SELECT 1
     FROM invoicestbl
     WHERE installmentinvoiceprofiles_id = $1
       AND status = 'Cancelled'
     LIMIT 1`,
    [profileId]
  );
  if (cancelledOnProfile.rows.length === 0) return null;

  if (classId) {
    const enrolled = await db.query(
      `SELECT 1
       FROM classstudentstbl
       WHERE student_id = $1
         AND class_id = $2
         AND removed_at IS NULL
         AND program_enrollment_status IN (
           'new', 're_enrolled', 'upsell', 'rejoin', 'completed'
         )
       LIMIT 1`,
      [studentId, classId]
    );
    if (enrolled.rows.length === 0) return null;
  }

  return {
    upgraded: true,
    note: FULL_PAYMENT_UPGRADE_NOTE,
    conversion_invoice_id: null,
    conversion_payment_date: null,
    phase_start: null,
    phase_end: null,
  };
}

/**
 * Display overlay for phases API: unpaid/cancelled/not-generated slots show as Paid with upgrade note.
 */
export function applyFullPaymentUpgradePhaseDisplay(phases, profile, conversion) {
  if (!conversion?.upgraded || !Array.isArray(phases)) return phases;

  const profilePhaseAmount =
    profile?.amount != null ? Number(profile.amount) : null;
  const phaseStartRaw =
    profile?.phase_start != null ? parseInt(profile.phase_start, 10) : 1;
  const phaseStartOffset = Math.max(0, (Number.isFinite(phaseStartRaw) ? phaseStartRaw : 1) - 1);

  return phases.map((phase) => {
    const isTrulyPaid = String(phase.status || '').toLowerCase() === 'paid';
    if (isTrulyPaid) {
      return { ...phase, plan_slot_addressed: true };
    }

    const absolutePhase = Number(phase.phase_number) + phaseStartOffset;
    if (
      conversion.phase_start != null &&
      conversion.phase_end != null &&
      (absolutePhase < conversion.phase_start || absolutePhase > conversion.phase_end)
    ) {
      return phase;
    }

    const amount =
      phase.amount != null
        ? Number(phase.amount)
        : profilePhaseAmount;

    return {
      ...phase,
      status: 'Paid All',
      paid_amount: amount != null ? amount : Number(phase.paid_amount || 0),
      phase_note: conversion.note,
      upgraded_to_full_payment: true,
      plan_slot_addressed: true,
      payment_date: phase.payment_date || conversion.conversion_payment_date || null,
    };
  });
}

export function parseFullPaymentChangeRemarks(remarks) {
  const text = String(remarks || '');
  if (!text.includes(PACKAGE_CHANGE_TO_FULLPAYMENT)) return null;

  const pick = (key) => {
    const match = text.match(new RegExp(`${key}:(\\d+)`, 'i'));
    return match ? parseInt(match[1], 10) : null;
  };
  const pickMoney = (key) => {
    const match = text.match(new RegExp(`${key}:([0-9.]+)`, 'i'));
    return match ? parseFloat(match[1]) : null;
  };

  return {
    classId: pick('CLASS_ID'),
    studentId: pick('STUDENT_ID'),
    profileId: pick('PROFILE_ID'),
    fromPackageId: pick('FROM_PACKAGE_ID'),
    toPackageId: pick('TO_PACKAGE_ID'),
    phaseStart: pick('PHASE_START'),
    phaseEnd: pick('PHASE_END'),
    creditApplied: pickMoney('CREDIT_APPLIED'),
    targetFullPrice: pickMoney('TARGET_FULL_PRICE'),
  };
}

function computePromoDiscountAmount(promo, baseAmount) {
  const base = Number(baseAmount || 0);
  if (base <= 0 || !promo) return 0;

  let discount = 0;
  if (promo.promo_type === 'percentage_discount' && promo.discount_percentage) {
    discount = (base * Number(promo.discount_percentage)) / 100;
  } else if (promo.promo_type === 'fixed_discount' && promo.discount_amount) {
    discount = Math.min(Number(promo.discount_amount), base);
  } else if (promo.promo_type === 'combined') {
    if (promo.discount_percentage && Number(promo.discount_percentage) > 0) {
      discount = (base * Number(promo.discount_percentage)) / 100;
    } else if (promo.discount_amount && Number(promo.discount_amount) > 0) {
      discount = Math.min(Number(promo.discount_amount), base);
    }
  }

  return roundCurrency(Math.max(0, Math.min(discount, base)));
}

/**
 * Optionally apply a promo discount to an allowed package-change preview.
 * Discount reduces the additional amount due (difference). No schema change.
 *
 * @returns {Promise<{ ok: true, data: object } | { ok: false, status: number, body: object }>}
 */
export async function applyOptionalPromoToPackageChangePreview(client, previewPayload, {
  promoId = null,
  promoCode = null,
  studentId = null,
  targetPackageId = null,
} = {}) {
  if (!previewPayload?.success || !previewPayload?.data) {
    return { ok: true, data: previewPayload };
  }

  const details = { ...previewPayload.data };
  const hasPromo = (promoId != null && Number(promoId) > 0) || (promoCode && String(promoCode).trim());
  if (!hasPromo || !details.allowed) {
    return { ok: true, data: { ...previewPayload, data: details } };
  }

  let promo = null;
  if (promoId != null && Number(promoId) > 0) {
    const promoResult = await client.query(
      `SELECT promo_id, promo_name, promo_type, promo_code, discount_percentage, discount_amount,
              min_payment_amount, status, max_uses, current_uses,
              TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date,
              TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date
       FROM promostbl
       WHERE promo_id = $1`,
      [Number(promoId)]
    );
    promo = promoResult.rows[0] || null;
  } else if (promoCode) {
    const normalized = String(promoCode).trim().toUpperCase();
    const promoResult = await client.query(
      `SELECT promo_id, promo_name, promo_type, promo_code, discount_percentage, discount_amount,
              min_payment_amount, status, max_uses, current_uses,
              TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date,
              TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date
       FROM promostbl
       WHERE UPPER(promo_code) = $1`,
      [normalized]
    );
    promo = promoResult.rows[0] || null;
  }

  if (!promo || promo.status !== 'Active') {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        message: 'Promo is invalid or inactive.',
        data: { ...details, allowed: false, code: 'invalid_promo' },
      },
    };
  }

  const pkgLinks = await client.query(
    `SELECT package_id FROM promopackagestbl WHERE promo_id = $1`,
    [promo.promo_id]
  );
  const linkedIds = pkgLinks.rows.map((r) => Number(r.package_id));
  if (linkedIds.length > 0 && targetPackageId != null && !linkedIds.includes(Number(targetPackageId))) {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        message: 'This promo does not apply to the selected package.',
        data: { ...details, allowed: false, code: 'promo_package_mismatch' },
      },
    };
  }

  if (studentId) {
    const used = await client.query(
      `SELECT promousage_id FROM promousagetbl WHERE promo_id = $1 AND student_id = $2 LIMIT 1`,
      [promo.promo_id, studentId]
    );
    if (used.rows.length > 0) {
      return {
        ok: false,
        status: 400,
        body: {
          success: false,
          message: 'This student has already used this promo.',
          data: { ...details, allowed: false, code: 'promo_already_used' },
        },
      };
    }
  }

  const baseForDiscount =
    details.change_type === 'installment_to_fullpayment'
      ? roundCurrency(details.target_full_price || 0)
      : roundCurrency(details.difference || 0);

  const promoDiscount = computePromoDiscountAmount(promo, baseForDiscount);
  const differenceBeforePromo = roundCurrency(details.difference || 0);
  const difference = roundCurrency(Math.max(0, differenceBeforePromo - promoDiscount));

  let { allowed, code, message } = details;
  if (details.change_type === 'installment_to_fullpayment') {
    if (difference === 0) {
      allowed = true;
      code = 'fullpayment_conversion_no_balance';
      message =
        'No additional payment is required after promo. Confirm to convert to full payment and enroll all target phases.';
    } else {
      allowed = true;
      code = 'fullpayment_conversion';
      message =
        'A conversion invoice can be created. After payment, the student will be enrolled for all target phases.';
    }
  } else if (difference === 0) {
    allowed = false;
    code = 'no_difference';
    message = 'There is no additional amount to invoice for this package change after promo.';
  }

  return {
    ok: true,
    data: {
      ...previewPayload,
      data: {
        ...details,
        allowed,
        code,
        message,
        difference_before_promo: differenceBeforePromo,
        promo_discount: promoDiscount,
        difference,
        promo: {
          promo_id: promo.promo_id,
          promo_name: promo.promo_name,
          promo_code: promo.promo_code,
          promo_type: promo.promo_type,
          discount_percentage: promo.discount_percentage,
          discount_amount: promo.discount_amount,
        },
      },
    },
  };
}
