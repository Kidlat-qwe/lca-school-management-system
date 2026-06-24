import {
  getCanonicalInstallmentPhaseCounts,
  getChainFinancialSummary,
  parseTargetPhase,
} from './balanceInvoice.js';

const EPSILON = 0.01;

async function phaseChainHasPayment(client, invoice) {
  if (!invoice?.invoice_id) return false;
  const chainRoot = Number(invoice.invoice_chain_root_id || invoice.invoice_id);
  const summary = await getChainFinancialSummary(client, chainRoot);
  return summary.total_paid_in_chain >= EPSILON;
}

async function isPhaseChainFullySettled(client, invoice) {
  if (!invoice?.invoice_id) return false;
  const chainRoot = Number(invoice.invoice_chain_root_id || invoice.invoice_id);
  const summary = await getChainFinancialSummary(client, chainRoot);
  return summary.total_paid_in_chain >= EPSILON && summary.remaining_on_leaf < EPSILON;
}
import { loadInstallmentProfilePhaseChains } from '../lib/installmentPaymentEligibility.js';
import {
  mapPhaseChainsToLocalSlots,
  parseAbsolutePhaseFromInvoice,
} from './installmentPhaseRowMapping.js';
import {
  PROGRAM_ENROLLMENT_STATUS,
  determineRejoinAwarePhaseStatus,
} from './enrollmentStatus.js';

const ACTIVE_PHASE_STATUSES = [
  'new',
  're_enrolled',
  'upsell',
  'rejoin',
  'completed',
  'pending_enrollment',
];

/**
 * Absolute class phase for the invoice being paid (chain slot), not generated_count.
 */
async function resolveTargetPhaseForPaidInvoice({ client, profileId, profile, invoice }) {
  if (!invoice) return null;

  const phaseStart = profile.phase_start != null ? parseInt(profile.phase_start, 10) : 1;
  const fromInvoiceRow = parseAbsolutePhaseFromInvoice(invoice);
  if (fromInvoiceRow != null && fromInvoiceRow >= phaseStart) {
    return fromInvoiceRow;
  }

  if (!invoice.invoice_id) return null;

  const chainRootId = Number(invoice.invoice_chain_root_id || invoice.invoice_id);
  const { phaseChains } = await loadInstallmentProfilePhaseChains(client, profileId);
  const chainByLocal = mapPhaseChainsToLocalSlots(phaseChains, profile);

  for (const [localPhase, chain] of chainByLocal.entries()) {
    if (Number(chain.chain_root_id) === chainRootId) {
      return phaseStart + Number(localPhase) - 1;
    }
  }
  return null;
}

/**
 * When a later phase is paid (including out-of-order), insert any missing
 * intermediate phase rows so the enrollment matrix does not show a gap.
 */
async function ensureIntermediatePhaseEnrollments({
  client,
  studentId,
  classId,
  targetPhase,
  sourceLabel,
}) {
  const maxActiveResult = await client.query(
    `SELECT COALESCE(MAX(phase_number), 0)::int AS max_phase
     FROM classstudentstbl
     WHERE student_id = $1
       AND class_id = $2
       AND removed_at IS NULL
       AND program_enrollment_status = ANY($3::text[])`,
    [studentId, classId, ACTIVE_PHASE_STATUSES]
  );
  const maxActivePhase = parseInt(maxActiveResult.rows[0]?.max_phase || 0, 10);
  if (maxActivePhase <= 0 || targetPhase <= maxActivePhase + 1) {
    return;
  }

  const droppedBetweenResult = await client.query(
    `SELECT 1
     FROM classstudentstbl
     WHERE student_id = $1
       AND class_id = $2
       AND program_enrollment_status = 'dropped'
       AND COALESCE(phase_number, 0) > $3
       AND COALESCE(phase_number, 0) < $4
     LIMIT 1`,
    [studentId, classId, maxActivePhase, targetPhase]
  );
  if (droppedBetweenResult.rows.length > 0) {
    return;
  }

  for (let phaseNumber = maxActivePhase + 1; phaseNumber < targetPhase; phaseNumber += 1) {
    const existing = await client.query(
      `SELECT classstudent_id
       FROM classstudentstbl
       WHERE student_id = $1
         AND class_id = $2
         AND phase_number = $3
         AND removed_at IS NULL
         AND program_enrollment_status = ANY($4::text[])`,
      [studentId, classId, phaseNumber, ACTIVE_PHASE_STATUSES]
    );
    if (existing.rows.length > 0) continue;

    await client.query(
      `INSERT INTO classstudentstbl (student_id, class_id, enrolled_by, phase_number, program_enrollment_status)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        studentId,
        classId,
        sourceLabel,
        phaseNumber,
        PROGRAM_ENROLLMENT_STATUS.RE_ENROLLED,
      ]
    );
    console.log(
      `✅ Backfilled missing Phase ${phaseNumber} as re_enrolled for student ${studentId} class ${classId}`
    );
  }
}

/**
 * After an installment phase invoice is paid or partially paid, promote pending_enrollment
 * or insert the active phase row (mirrors payments.js post-payment enrollment sync).
 * Partial payment enrolls the student for that phase; completion status updates only
 * when the phase chain is fully settled.
 */
export async function syncInstallmentEnrollmentForPaidInvoice({
  client,
  profileId,
  profile,
  studentId,
  sourceLabel,
  invoice = null,
}) {
  if (!profileId || !profile?.class_id || Number(profile.student_id) !== Number(studentId)) {
    return;
  }

  const hasInvoiceContext = Boolean(invoice?.invoice_id);
  const chainHasPayment = hasInvoiceContext
    ? await phaseChainHasPayment(client, invoice)
    : false;

  const { paidPhaseCount: paidInstallmentCount } = await getCanonicalInstallmentPhaseCounts(
    client,
    profileId,
    profile.downpayment_invoice_id || null
  );
  if (!chainHasPayment && paidInstallmentCount <= 0) {
    return;
  }

  const phaseStart = profile.phase_start != null ? parseInt(profile.phase_start, 10) : 1;
  const totalPhases = profile.total_phases != null ? parseInt(profile.total_phases, 10) : null;
  const maxPhase = totalPhases ? phaseStart + totalPhases - 1 : null;

  const remarkTargetPhase = invoice?.remarks ? parseTargetPhase(invoice.remarks) : null;
  const invoiceTargetPhase = await resolveTargetPhaseForPaidInvoice({
    client,
    profileId,
    profile,
    invoice,
  });

  let targetPhase;
  if (remarkTargetPhase != null && remarkTargetPhase >= phaseStart) {
    targetPhase = maxPhase !== null ? Math.min(remarkTargetPhase, maxPhase) : remarkTargetPhase;
  } else if (invoiceTargetPhase != null) {
    targetPhase = maxPhase !== null ? Math.min(invoiceTargetPhase, maxPhase) : invoiceTargetPhase;
  } else {
    targetPhase = phaseStart + paidInstallmentCount - 1;
    if (maxPhase !== null) {
      targetPhase = Math.min(targetPhase, maxPhase);
    }
  }

  const markCompletedIfFullyPaid = async () => {
    if (!(maxPhase !== null && targetPhase >= maxPhase)) return;
    if (hasInvoiceContext) {
      const fullySettled = await isPhaseChainFullySettled(client, invoice);
      if (!fullySettled) return;
    }
    const keepFirstPhaseNewResult = await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = CASE
             WHEN program_enrollment_status IN ('rejoin', 'upsell') THEN program_enrollment_status
             ELSE 'new'
           END
       WHERE student_id = $1
         AND class_id = $2
         AND phase_number = $3
         AND program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin', 'completed')
         AND removed_at IS NULL`,
      [studentId, profile.class_id, phaseStart]
    );
    const reEnrolledResult = await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = 're_enrolled'
       WHERE student_id = $1
         AND class_id = $2
         AND phase_number > $3
         AND phase_number < $4
         AND program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'completed')
         AND removed_at IS NULL`,
      [studentId, profile.class_id, phaseStart, targetPhase]
    );
    const completedResult = await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = 'completed'
       WHERE student_id = $1
         AND class_id = $2
         AND phase_number = $3
         AND program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin', 'completed')
         AND removed_at IS NULL`,
      [studentId, profile.class_id, targetPhase]
    );
    if (
      completedResult.rowCount > 0 ||
      reEnrolledResult.rowCount > 0 ||
      keepFirstPhaseNewResult.rowCount > 0
    ) {
      console.log(
        `✅ Installment fully paid: phase ${phaseStart} kept as new (${keepFirstPhaseNewResult.rowCount} row[s]), ` +
          `phase ${targetPhase} marked completed (${completedResult.rowCount} row[s]), ` +
          `${reEnrolledResult.rowCount} intermediate phase row(s) set to re_enrolled for student ${studentId} class ${profile.class_id}`
      );
    }
  };

  const installmentDefaultStatus =
    Number(targetPhase) === phaseStart
      ? PROGRAM_ENROLLMENT_STATUS.NEW
      : PROGRAM_ENROLLMENT_STATUS.RE_ENROLLED;
  const installmentEnrollStatus = await determineRejoinAwarePhaseStatus({
    db: client,
    studentId,
    classId: profile.class_id,
    phaseNumber: targetPhase,
    defaultStatus: installmentDefaultStatus,
  });

  const promoted = await client.query(
    `UPDATE classstudentstbl
     SET program_enrollment_status = $1,
         enrolled_by = $2,
         enrolled_at = CURRENT_TIMESTAMP
     WHERE student_id = $3 AND class_id = $4 AND phase_number = $5
       AND program_enrollment_status IN ('pending_enrollment', 'reserved')
       AND removed_at IS NULL
     RETURNING classstudent_id`,
    [installmentEnrollStatus, sourceLabel, studentId, profile.class_id, targetPhase]
  );
  if (promoted.rows.length > 0) {
    console.log(
      `✅ Promoted pending_enrollment → ${installmentEnrollStatus} for student ${studentId} class ${profile.class_id} phase ${targetPhase}`
    );
    await ensureIntermediatePhaseEnrollments({
      client,
      studentId,
      classId: profile.class_id,
      targetPhase,
      sourceLabel,
    });
    await markCompletedIfFullyPaid();
    return;
  }

  const existingPhaseEnrollment = await client.query(
    `SELECT classstudent_id
     FROM classstudentstbl
     WHERE student_id = $1
       AND class_id = $2
       AND phase_number = $3
       AND program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin')
       AND removed_at IS NULL`,
    [studentId, profile.class_id, targetPhase]
  );

  if (existingPhaseEnrollment.rows.length > 0) {
    await ensureIntermediatePhaseEnrollments({
      client,
      studentId,
      classId: profile.class_id,
      targetPhase,
      sourceLabel,
    });
    await markCompletedIfFullyPaid();
    return;
  }

  await ensureIntermediatePhaseEnrollments({
    client,
    studentId,
    classId: profile.class_id,
    targetPhase,
    sourceLabel,
  });

  await client.query(
    `INSERT INTO classstudentstbl (student_id, class_id, enrolled_by, phase_number, program_enrollment_status)
     VALUES ($1, $2, $3, $4, $5)`,
    [studentId, profile.class_id, sourceLabel, targetPhase, installmentEnrollStatus]
  );

  console.log(
    `✅ Auto-enrolled student ${studentId} in Phase ${targetPhase} after installment payment (status: ${installmentEnrollStatus})`
  );

  await markCompletedIfFullyPaid();
}
