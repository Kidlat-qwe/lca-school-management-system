/**
 * Installment → full payment package conversion (upgrade plan).
 * Credits all completed class-related payments; enrollment finalization runs from payments.js on settlement.
 */

import { enrollStudentForFullPaymentPhases } from '../utils/fullPaymentPhaseEnrollment.js';

export const PACKAGE_CHANGE_TO_FULLPAYMENT = 'PACKAGE_CHANGE_TO_FULLPAYMENT';

export const roundCurrency = (value) =>
  Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

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
 * Reservation fee invoice for this class (reservedstudentstbl.invoice_id — often no CLASS_ID in remarks).
 */
export async function getReservationFeeCreditTotal(client, { studentId, classId }) {
  const result = await client.query(
    `${sumCompletedPaymentsForInvoicesSql}
     AND i.invoice_id IN (
       SELECT r.invoice_id
       FROM reservedstudentstbl r
       WHERE r.student_id = $1
         AND r.class_id = $2
         AND r.invoice_id IS NOT NULL
     )`,
    [studentId, classId]
  );
  return roundCurrency(result.rows[0]?.total_paid || 0);
}

/**
 * Installment plan payments (profile-linked + downpayment invoice), excluding reservation fee invoice.
 */
export async function getInstallmentPlanPaymentCreditTotal(
  client,
  { studentId, classId, profileId, downpaymentInvoiceId }
) {
  const result = await client.query(
    `${sumCompletedPaymentsForInvoicesSql}
     AND (
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
    [studentId, classId, profileId, downpaymentInvoiceId || null]
  );
  return roundCurrency(result.rows[0]?.total_paid || 0);
}

/**
 * Sum completed payments: reservation fee + downpayment + phase/installment invoices for this class plan.
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
  const [reservationFeePaid, installmentPaymentsPaid] = await Promise.all([
    getReservationFeeCreditTotal(client, { studentId, classId }),
    getInstallmentPlanPaymentCreditTotal(client, {
      studentId,
      classId,
      profileId,
      downpaymentInvoiceId,
    }),
  ]);

  return {
    reservation_fee_paid: reservationFeePaid,
    installment_payments_paid: installmentPaymentsPaid,
    credit_total: roundCurrency(reservationFeePaid + installmentPaymentsPaid),
  };
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

  return lineItems;
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
