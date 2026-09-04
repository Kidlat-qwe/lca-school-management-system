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
import { queueFirstEnrollmentWelcomeEmail } from './firstEnrollmentWelcomeEmail/index.js';

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
 * After an installment phase invoice has **any completed payment**, sync the
 * class phase enrollment row:
 *
 * - **Partial** (remaining > 0): enroll as `new` / `re_enrolled` so attendance works.
 * - **Fully settled**: same enroll; if the phase was **dropped** after a partial
 *   delinquency drop, restore `dropped` → `re_enrolled` and reactivate the plan.
 *
 * Fully unpaid chains still do not enroll.
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
  let fullySettled = false;
  let chainHasPayment = false;

  if (hasInvoiceContext) {
    chainHasPayment = await phaseChainHasPayment(client, invoice);
    if (!chainHasPayment) {
      return;
    }
    fullySettled = await isPhaseChainFullySettled(client, invoice);
  }

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
    if (!fullySettled) return;
    if (!(maxPhase !== null && targetPhase >= maxPhase)) return;
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

  const reactivateProfile = async () => {
    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET is_active = true
       WHERE installmentinvoiceprofiles_id = $1
         AND is_active = false`,
      [profileId]
    );
  };

  // Partial-drop settle: restore dropped → re_enrolled when remaining is cleared.
  if (fullySettled) {
    const restored = await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = 're_enrolled',
           removed_at = NULL,
           removed_reason = NULL,
           removed_by = NULL,
           enrolled_by = $1,
           enrolled_at = CURRENT_TIMESTAMP
       WHERE student_id = $2
         AND class_id = $3
         AND COALESCE(phase_number, 1) = $4
         AND program_enrollment_status = 'dropped'
       RETURNING classstudent_id`,
      [sourceLabel, studentId, profile.class_id, targetPhase]
    );
    if (restored.rows.length > 0) {
      console.log(
        `✅ Restored Phase ${targetPhase} dropped → re_enrolled after settling remaining ` +
          `(student ${studentId} class ${profile.class_id})`
      );
      await reactivateProfile();
      await markCompletedIfFullyPaid();
      return;
    }
  }

  const installmentDefaultStatus =
    Number(targetPhase) === phaseStart
      ? PROGRAM_ENROLLMENT_STATUS.NEW
      : PROGRAM_ENROLLMENT_STATUS.RE_ENROLLED;
  // Partial-drop continue path uses re_enrolled for later phases; rejoin label is for
  // fully unpaid drop comebacks. Prefer default when restoring/enrolling after payment.
  const installmentEnrollStatus = fullySettled
    ? await determineRejoinAwarePhaseStatus({
        db: client,
        studentId,
        classId: profile.class_id,
        phaseNumber: targetPhase,
        defaultStatus: installmentDefaultStatus,
      })
    : installmentDefaultStatus;

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
    queueFirstEnrollmentWelcomeEmail({
      studentId,
      enrollmentStatus: installmentEnrollStatus,
      classstudentId: promoted.rows[0]?.classstudent_id,
      invoiceId: invoice?.invoice_id ?? null,
    });
    if (fullySettled) {
      await ensureIntermediatePhaseEnrollments({
        client,
        studentId,
        classId: profile.class_id,
        targetPhase,
        sourceLabel,
      });
      await markCompletedIfFullyPaid();
    }
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
    if (fullySettled) {
      await ensureIntermediatePhaseEnrollments({
        client,
        studentId,
        classId: profile.class_id,
        targetPhase,
        sourceLabel,
      });
      await markCompletedIfFullyPaid();
    }
    return;
  }

  // Do not backfill intermediate gaps on partial — only enroll the paid phase.
  if (fullySettled) {
    await ensureIntermediatePhaseEnrollments({
      client,
      studentId,
      classId: profile.class_id,
      targetPhase,
      sourceLabel,
    });
  }

  const inserted = await client.query(
    `INSERT INTO classstudentstbl (student_id, class_id, enrolled_by, phase_number, program_enrollment_status)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING classstudent_id`,
    [studentId, profile.class_id, sourceLabel, targetPhase, installmentEnrollStatus]
  );

  console.log(
    `✅ Auto-enrolled student ${studentId} in Phase ${targetPhase} after installment payment ` +
      `(status: ${installmentEnrollStatus}${fullySettled ? '' : ', partial'})`
  );

  queueFirstEnrollmentWelcomeEmail({
    studentId,
    enrollmentStatus: installmentEnrollStatus,
    classstudentId: inserted.rows[0]?.classstudent_id,
    invoiceId: invoice?.invoice_id ?? null,
  });

  await markCompletedIfFullyPaid();
}

/**
 * After finance rejects an installment phase payment, remove the phase enrollment
 * that was created by that payment so the student must pay again to re-enroll.
 * Leaves the Rejected invoice in place for Pay Now / resubmit.
 *
 * @returns {Promise<{ removed: boolean, targetPhase: number|null, classstudent_id: number|null }>}
 */
export async function voidInstallmentEnrollmentForRejectedInvoice({
  client,
  invoice,
  studentId = null,
  reason = 'Payment rejected — enrollment voided pending repayment',
}) {
  if (!invoice?.invoice_id || !invoice?.installmentinvoiceprofiles_id) {
    return { removed: false, targetPhase: null, classstudent_id: null };
  }

  const profileRes = await client.query(
    `SELECT *
     FROM installmentinvoiceprofilestbl
     WHERE installmentinvoiceprofiles_id = $1`,
    [invoice.installmentinvoiceprofiles_id]
  );
  const profile = profileRes.rows[0];
  if (!profile?.class_id) {
    return { removed: false, targetPhase: null, classstudent_id: null };
  }

  const sid =
    studentId != null
      ? Number(studentId)
      : profile.student_id != null
        ? Number(profile.student_id)
        : null;
  if (!sid || Number.isNaN(sid)) {
    return { removed: false, targetPhase: null, classstudent_id: null };
  }

  const targetPhase = await resolveTargetPhaseForPaidInvoice({
    client,
    profileId: profile.installmentinvoiceprofiles_id,
    profile,
    invoice,
  });
  if (targetPhase == null) {
    return { removed: false, targetPhase: null, classstudent_id: null };
  }

  // Only void if this invoice (or its chain) has no remaining completed payment.
  const stillPaid = await client.query(
    `SELECT 1
     FROM paymenttbl p
     INNER JOIN invoicestbl i ON i.invoice_id = p.invoice_id
     WHERE (
         i.invoice_id = $1
         OR COALESCE(i.invoice_chain_root_id, i.invoice_id) = COALESCE(
           (SELECT COALESCE(invoice_chain_root_id, invoice_id) FROM invoicestbl WHERE invoice_id = $1),
           $1
         )
       )
       AND COALESCE(p.status, '') = 'Completed'
       AND COALESCE(p.approval_status, 'Pending') NOT IN ('Returned', 'Rejected')
     LIMIT 1`,
    [invoice.invoice_id]
  );
  if (stillPaid.rows.length > 0) {
    return { removed: false, targetPhase, classstudent_id: null };
  }

  const existing = await client.query(
    `SELECT classstudent_id, program_enrollment_status, enrolled_by
     FROM classstudentstbl
     WHERE student_id = $1
       AND class_id = $2
       AND COALESCE(phase_number, 1) = $3
       AND removed_at IS NULL
       AND program_enrollment_status = ANY($4::text[])
     ORDER BY classstudent_id DESC
     LIMIT 1`,
    [sid, profile.class_id, targetPhase, ACTIVE_PHASE_STATUSES]
  );
  const row = existing.rows[0];
  if (!row) {
    return { removed: false, targetPhase, classstudent_id: null };
  }

  const enrolledBy = String(row.enrolled_by || '');
  const isAutoInstallment =
    enrolledBy.toLowerCase().includes('installment') ||
    enrolledBy.toLowerCase().includes('auto-enrolled');
  if (!isAutoInstallment) {
    // Still clear enrollment for rejected phase payment — repayment recreates it.
  }

  await client.query(`DELETE FROM classstudentstbl WHERE classstudent_id = $1`, [
    row.classstudent_id,
  ]);

  console.log(
    `✅ Voided Phase ${targetPhase} enrollment (classstudent ${row.classstudent_id}) after rejected payment on invoice ${invoice.invoice_id}: ${reason}`
  );

  return {
    removed: true,
    targetPhase,
    classstudent_id: row.classstudent_id,
  };
}
