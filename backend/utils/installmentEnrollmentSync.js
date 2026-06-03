import { getCanonicalInstallmentPhaseCounts, parseTargetPhase } from './balanceInvoice.js';
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
 * After an installment phase invoice is paid, promote pending_enrollment or insert
 * the active phase row (mirrors payments.js post-payment enrollment sync).
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

  const { paidPhaseCount: paidInstallmentCount } = await getCanonicalInstallmentPhaseCounts(
    client,
    profileId,
    profile.downpayment_invoice_id || null
  );
  if (paidInstallmentCount <= 0) {
    return;
  }

  const phaseStart = profile.phase_start != null ? parseInt(profile.phase_start, 10) : 1;
  const totalPhases = profile.total_phases != null ? parseInt(profile.total_phases, 10) : null;
  const maxPhase = totalPhases ? phaseStart + totalPhases - 1 : null;

  const storedGeneratedCount =
    profile.generated_count != null ? parseInt(profile.generated_count, 10) : 0;
  const effectiveProgressCount = Math.max(paidInstallmentCount, storedGeneratedCount);

  let targetPhase = phaseStart + effectiveProgressCount - 1;
  if (maxPhase !== null) {
    targetPhase = Math.min(targetPhase, maxPhase);
  }

  const remarkTargetPhase = invoice?.remarks ? parseTargetPhase(invoice.remarks) : null;
  if (remarkTargetPhase != null && remarkTargetPhase >= phaseStart) {
    targetPhase = maxPhase !== null ? Math.min(remarkTargetPhase, maxPhase) : remarkTargetPhase;
  }

  const markCompletedIfFullyPaid = async () => {
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

  const installmentDefaultStatus =
    paidInstallmentCount <= 1
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
       AND program_enrollment_status = 'pending_enrollment'
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
