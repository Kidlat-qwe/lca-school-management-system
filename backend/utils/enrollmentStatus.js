/**
 * enrollmentStatus.js
 *
 * Canonical values for program_enrollment_status and helper utilities that
 * determine the correct status to assign when a student is enrolled.
 *
 * Program-level hierarchy (for upsell detection):
 *   Playgroup → Nursery → Pre-Kindergarten → Kindergarten → Grade School
 *
 * Status rules:
 *   reserved           – student paid a class reservation fee; not fully enrolled yet.
 *   pending_enrollment – downpayment paid; Phase 1 / first monthly invoice not settled.
 *   new                – no prior class enrollment history for this student.
 *   re_enrolled        – student already has at least one enrollment record in any class.
 *   upsell             – student was enrolled in a lower program level and is now enrolling
 *                        in a higher one (e.g. Pre-K → Kindergarten).
 *   rejoin             – first active phase after a prior dropped phase in the same class.
 *   dropped            – student was unenrolled / removed.
 *   completed          – student finished their enrolled phases / class (set by cron).
 */

export const PROGRAM_ENROLLMENT_STATUS = Object.freeze({
  RESERVED:           'reserved',
  PENDING_ENROLLMENT: 'pending_enrollment',
  NEW:                'new',
  RE_ENROLLED:        're_enrolled',
  UPSELL:             'upsell',
  REJOIN:             'rejoin',
  DROPPED:            'dropped',
  COMPLETED:          'completed',
});

/** Values that count as "actively enrolled" (used by student_statustbl trigger). */
export const ACTIVE_ENROLLMENT_STATUSES = [
  PROGRAM_ENROLLMENT_STATUS.NEW,
  PROGRAM_ENROLLMENT_STATUS.RE_ENROLLED,
  PROGRAM_ENROLLMENT_STATUS.UPSELL,
  PROGRAM_ENROLLMENT_STATUS.REJOIN,
];

/** Ordered program level tags from lowest to highest. */
export const PROGRAM_LEVEL_ORDER = [
  'Playgroup',
  'Nursery',
  'Pre-Kindergarten',
  'Kindergarten',
  'Grade School',
];

/** @deprecated internal alias */
const LEVEL_ORDER = PROGRAM_LEVEL_ORDER;

export function levelTagIndex(levelTag) {
  const idx = PROGRAM_LEVEL_ORDER.indexOf(String(levelTag || '').trim());
  return idx >= 0 ? idx : -1;
}

/**
 * Determines the correct program_enrollment_status to assign to a new
 * classstudentstbl row.
 *
 * @param {object} params
 * @param {object} params.db           - pg client or the query pool (must have `.query()`)
 * @param {number} params.studentId    - The student being enrolled
 * @param {number} params.classId      - The class being enrolled into
 * @param {'reservation'|'downpayment'|'full_payment'|'installment'|'phase'|'direct'} params.enrollmentType
 *        Caller signals the payment context so we can set reserved / pending_enrollment
 *        before doing a full history check.
 * @param {number|null} [params.phaseNumber] Optional phase number for rejoin detection.
 * @returns {Promise<string>} One of the PROGRAM_ENROLLMENT_STATUS values.
 */
export async function determineEnrollmentStatus({ db, studentId, classId, enrollmentType, phaseNumber = null }) {
  // Fast-path: payment context determines status directly
  if (enrollmentType === 'reservation') return PROGRAM_ENROLLMENT_STATUS.RESERVED;
  if (enrollmentType === 'downpayment') return PROGRAM_ENROLLMENT_STATUS.PENDING_ENROLLMENT;

  const rejoinStatus = await determineRejoinEnrollmentStatus({
    db,
    studentId,
    classId,
    phaseNumber,
  });
  if (rejoinStatus) return rejoinStatus;

  // Check whether this student has ANY prior class enrollment (any status, any class)
  const priorResult = await db.query(
    `SELECT 1
     FROM classstudentstbl cs
     WHERE cs.student_id = $1
       AND cs.class_id != $2
     LIMIT 1`,
    [studentId, classId]
  );

  if (priorResult.rows.length === 0) {
    return PROGRAM_ENROLLMENT_STATUS.NEW;
  }

  // Resolve current class level
  const currentClassResult = await db.query(
    `SELECT level_tag FROM classestbl WHERE class_id = $1`,
    [classId]
  );
  const currentLevel = currentClassResult.rows[0]?.level_tag || null;
  const currentLevelIdx = levelTagIndex(currentLevel);

  // Upsell: completed a lower program level, now enrolling in a higher one.
  if (currentLevelIdx > 0) {
    const priorLowerCompleted = await db.query(
      `SELECT DISTINCT c.level_tag
       FROM classstudentstbl cs
       INNER JOIN classestbl c ON cs.class_id = c.class_id
       WHERE cs.student_id = $1
         AND cs.class_id != $2
         AND cs.program_enrollment_status = 'completed'
         AND cs.removed_at IS NULL`,
      [studentId, classId]
    );
    const isUpsell = priorLowerCompleted.rows.some((row) => {
      const prevIdx = levelTagIndex(row.level_tag);
      return prevIdx >= 0 && prevIdx < currentLevelIdx;
    });
    if (isUpsell) return PROGRAM_ENROLLMENT_STATUS.UPSELL;
  }

  return PROGRAM_ENROLLMENT_STATUS.RE_ENROLLED;
}

/**
 * Returns "rejoin" when this phase is the first active enrollment after the
 * latest dropped phase in the same class. Later phases after that comeback
 * return null so callers can apply their normal status (usually re_enrolled).
 *
 * @param {object} params
 * @param {object} params.db
 * @param {number} params.studentId
 * @param {number} params.classId
 * @param {number|null} params.phaseNumber
 * @returns {Promise<string|null>}
 */
export async function determineRejoinEnrollmentStatus({ db, studentId, classId, phaseNumber }) {
  const sid = Number(studentId);
  const cid = Number(classId);
  const phase = Number(phaseNumber);
  if (!sid || !cid || !Number.isFinite(phase) || phase <= 0) return null;

  const latestDroppedResult = await db.query(
    `SELECT phase_number, removed_at, classstudent_id
     FROM classstudentstbl
     WHERE student_id = $1
       AND class_id = $2
       AND program_enrollment_status = 'dropped'
       AND COALESCE(phase_number, 0) <= $3
     ORDER BY COALESCE(removed_at, enrolled_at) DESC NULLS LAST, classstudent_id DESC
     LIMIT 1`,
    [sid, cid, phase]
  );

  if (latestDroppedResult.rows.length === 0) return null;

  const latestDropped = latestDroppedResult.rows[0];
  const droppedPhase = Number(latestDropped.phase_number) || 0;
  const droppedAt = latestDropped.removed_at || null;

  const activeAfterDropResult = await db.query(
    `SELECT 1
     FROM classstudentstbl
     WHERE student_id = $1
       AND class_id = $2
       AND program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin')
       AND removed_at IS NULL
       AND COALESCE(phase_number, 0) > $3
       AND COALESCE(phase_number, 0) < $4
       AND (
         $5::timestamptz IS NULL
         OR enrolled_at > $5::timestamptz
       )
     LIMIT 1`,
    [sid, cid, droppedPhase, phase, droppedAt]
  );

  return activeAfterDropResult.rows.length === 0 ? PROGRAM_ENROLLMENT_STATUS.REJOIN : null;
}

export async function determineRejoinAwarePhaseStatus({
  db,
  studentId,
  classId,
  phaseNumber,
  defaultStatus = PROGRAM_ENROLLMENT_STATUS.RE_ENROLLED,
}) {
  const rejoinStatus = await determineRejoinEnrollmentStatus({
    db,
    studentId,
    classId,
    phaseNumber,
  });
  if (rejoinStatus) return rejoinStatus;

  const phase = parseInt(String(phaseNumber), 10);
  if (!Number.isFinite(phase) || phase <= 1) {
    return determineEnrollmentStatus({
      db,
      studentId,
      classId,
      enrollmentType: 'phase',
      phaseNumber: Number.isFinite(phase) && phase > 0 ? phase : 1,
    });
  }

  return defaultStatus;
}

/**
 * After downpayment is marked paid: insert a classstudent row for the first
 * installment phase with program_enrollment_status = pending_enrollment
 * (downpayment paid, Phase 1 invoice not yet paid).
 *
 * Skip when `options.skip` is true (e.g. downpayment_plus_phase1 with paired AR,
 * where Phase 1 is auto-paid and the student is enrolled in the same transaction chain).
 *
 * @param {import('pg').PoolClient} client
 * @param {{ class_id?: number|null, student_id?: number|null, phase_start?: number|null }} profile
 * @param {number} studentId
 * @param {{ skip?: boolean }} [options]
 */
export async function ensurePendingEnrollmentAfterDownpaymentPaid(client, profile, studentId, options = {}) {
  if (options.skip) return;
  const sid = Number(studentId);
  const classId = profile?.class_id != null ? Number(profile.class_id) : null;
  if (!classId || Number.isNaN(classId) || !sid || Number.isNaN(sid)) return;

  const phaseStart = profile.phase_start != null ? parseInt(String(profile.phase_start), 10) : 1;
  const phaseNum = Number.isFinite(phaseStart) && phaseStart > 0 ? phaseStart : 1;

  const activeRow = await client.query(
    `SELECT classstudent_id FROM classstudentstbl
     WHERE student_id = $1 AND class_id = $2 AND phase_number = $3
       AND program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin')
       AND removed_at IS NULL`,
    [sid, classId, phaseNum]
  );
  if (activeRow.rows.length > 0) return;

  const pendingRow = await client.query(
    `SELECT classstudent_id FROM classstudentstbl
     WHERE student_id = $1 AND class_id = $2 AND phase_number = $3
       AND program_enrollment_status = 'pending_enrollment'
       AND removed_at IS NULL`,
    [sid, classId, phaseNum]
  );
  if (pendingRow.rows.length > 0) return;

  const reservedRow = await client.query(
    `SELECT classstudent_id FROM classstudentstbl
     WHERE student_id = $1 AND class_id = $2 AND phase_number = $3
       AND program_enrollment_status = 'reserved'
       AND removed_at IS NULL`,
    [sid, classId, phaseNum]
  );
  if (reservedRow.rows.length > 0) {
    await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = $1,
           enrolled_by = $2,
           enrolled_at = COALESCE(enrolled_at, CURRENT_TIMESTAMP)
       WHERE classstudent_id = $3`,
      [
        PROGRAM_ENROLLMENT_STATUS.PENDING_ENROLLMENT,
        'System (Downpayment paid — awaiting Phase 1 payment)',
        reservedRow.rows[0].classstudent_id,
      ]
    );
    return;
  }

  await client.query(
    `INSERT INTO classstudentstbl (student_id, class_id, enrolled_by, phase_number, program_enrollment_status)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      sid,
      classId,
      'System (Downpayment paid — awaiting Phase 1 payment)',
      phaseNum,
      PROGRAM_ENROLLMENT_STATUS.PENDING_ENROLLMENT,
    ]
  );
}

/**
 * After a reservation is upgraded to a real package (invoice created, not yet paid),
 * keep the student visible on enrollment dashboards as "reserved" until downpayment /
 * Phase 1 payment promotes the row.
 *
 * @param {import('pg').PoolClient} client
 * @param {{ student_id: number, class_id: number, phase_number?: number|null }} reservation
 * @param {string} [upgradedBy]
 */
export async function ensureReservedEnrollmentOnReservationUpgrade(
  client,
  reservation,
  upgradedBy = 'System (Reservation upgraded — awaiting package payment)'
) {
  const sid = Number(reservation?.student_id);
  const classId = Number(reservation?.class_id);
  if (!sid || Number.isNaN(sid) || !classId || Number.isNaN(classId)) return;

  const phaseNum =
    reservation.phase_number != null && reservation.phase_number !== ''
      ? parseInt(String(reservation.phase_number), 10)
      : 1;
  const phaseNumber = Number.isFinite(phaseNum) && phaseNum > 0 ? phaseNum : 1;

  const activeRow = await client.query(
    `SELECT classstudent_id FROM classstudentstbl
     WHERE student_id = $1 AND class_id = $2 AND phase_number = $3
       AND program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin', 'pending_enrollment')
       AND removed_at IS NULL`,
    [sid, classId, phaseNumber]
  );
  if (activeRow.rows.length > 0) return;

  const reservedRow = await client.query(
    `SELECT classstudent_id FROM classstudentstbl
     WHERE student_id = $1 AND class_id = $2 AND phase_number = $3
       AND program_enrollment_status = 'reserved'
       AND removed_at IS NULL`,
    [sid, classId, phaseNumber]
  );
  if (reservedRow.rows.length > 0) return;

  await client.query(
    `INSERT INTO classstudentstbl (student_id, class_id, enrolled_by, phase_number, program_enrollment_status)
     VALUES ($1, $2, $3, $4, $5)`,
    [sid, classId, upgradedBy, phaseNumber, PROGRAM_ENROLLMENT_STATUS.RESERVED]
  );
}

const parseClassIdFromInvoiceRemarks = (remarks) => {
  const text = String(remarks || '');
  const match = text.match(/CLASS_ID:(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
};

const parseTargetPhaseFromInvoiceRemarks = (remarks) => {
  const text = String(remarks || '');
  const targetMatch = text.match(/TARGET_PHASE:(\d+)/i);
  if (targetMatch) return parseInt(targetMatch[1], 10);
  const startMatch = text.match(/PHASE_START:(\d+)/i);
  if (startMatch) return parseInt(startMatch[1], 10);
  return null;
};

const isInstallmentPhaseInvoiceRow = (invoice) => {
  const desc = String(invoice?.invoice_description || '').toLowerCase();
  const remarks = String(invoice?.remarks || '').toLowerCase();
  if (desc.includes('downpayment')) return false;
  return (
    Boolean(invoice?.installmentinvoiceprofiles_id) ||
    remarks.includes('target_phase:') ||
    remarks.includes('auto-generated from installment invoice') ||
    remarks.includes('installment plan for')
  );
};

/**
 * Promote pending_enrollment when a phase/installment invoice is paid but no
 * installment profile is linked (e.g. profile deleted or never created).
 *
 * @returns {Promise<boolean>} true when a pending row was promoted
 */
export async function promotePendingEnrollmentIfPhaseInvoicePaid(
  client,
  { studentId, invoice, sourceLabel = 'System (Auto-enrolled via installment payment)' }
) {
  const sid = Number(studentId);
  const invoiceStatus = String(invoice?.status || '').trim();
  if (
    !sid ||
    Number.isNaN(sid) ||
    !invoice ||
    !['Paid', 'Partially Paid'].includes(invoiceStatus)
  ) {
    return false;
  }
  if (!isInstallmentPhaseInvoiceRow(invoice)) {
    return false;
  }

  let classId = parseClassIdFromInvoiceRemarks(invoice.remarks);
  if (!classId) {
    const dpRes = await client.query(
      `SELECT i.remarks
       FROM invoicestbl i
       INNER JOIN invoicestudentstbl ist ON ist.invoice_id = i.invoice_id
       WHERE ist.student_id = $1
         AND i.status = 'Paid'
         AND i.invoice_description ILIKE '%downpayment%'
         AND i.remarks ILIKE '%CLASS_ID:%'
       ORDER BY i.invoice_id DESC
       LIMIT 1`,
      [sid]
    );
    classId = parseClassIdFromInvoiceRemarks(dpRes.rows[0]?.remarks);
  }
  if (!classId) {
    const pendingRes = await client.query(
      `SELECT class_id, phase_number
       FROM classstudentstbl
       WHERE student_id = $1
         AND program_enrollment_status = 'pending_enrollment'
         AND removed_at IS NULL
       ORDER BY classstudent_id DESC
       LIMIT 1`,
      [sid]
    );
    if (pendingRes.rows[0]?.class_id != null) {
      classId = Number(pendingRes.rows[0].class_id);
    }
  }
  if (!classId) return false;

  let targetPhase = parseTargetPhaseFromInvoiceRemarks(invoice.remarks);
  if (targetPhase == null || Number.isNaN(targetPhase)) {
    const pendingPhaseRes = await client.query(
      `SELECT phase_number
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2
         AND program_enrollment_status = 'pending_enrollment'
         AND removed_at IS NULL
       ORDER BY classstudent_id DESC
       LIMIT 1`,
      [sid, classId]
    );
    targetPhase = pendingPhaseRes.rows[0]?.phase_number != null
      ? parseInt(String(pendingPhaseRes.rows[0].phase_number), 10)
      : 1;
  }
  if (!Number.isFinite(targetPhase) || targetPhase < 1) targetPhase = 1;

  const dpCheck = await client.query(
    `SELECT 1
     FROM invoicestbl i
     INNER JOIN invoicestudentstbl ist ON ist.invoice_id = i.invoice_id
     WHERE ist.student_id = $1
       AND i.status = 'Paid'
       AND i.invoice_description ILIKE '%downpayment%'
       AND i.remarks ILIKE $2
     LIMIT 1`,
    [sid, `%CLASS_ID:${classId}%`]
  );
  if (dpCheck.rows.length === 0) {
    return false;
  }

  const enrollStatus = await determineRejoinAwarePhaseStatus({
    db: client,
    studentId: sid,
    classId,
    phaseNumber: targetPhase,
    defaultStatus: PROGRAM_ENROLLMENT_STATUS.NEW,
  });

  const promoted = await client.query(
    `UPDATE classstudentstbl
     SET program_enrollment_status = $1,
         enrolled_by = $2,
         enrolled_at = COALESCE(enrolled_at, CURRENT_TIMESTAMP)
     WHERE student_id = $3 AND class_id = $4 AND phase_number = $5
       AND program_enrollment_status IN ('pending_enrollment', 'reserved')
       AND removed_at IS NULL
     RETURNING classstudent_id`,
    [enrollStatus, sourceLabel, sid, classId, targetPhase]
  );
  if (promoted.rows.length > 0) {
    console.log(
      `✅ Promoted pending_enrollment → ${enrollStatus} for student ${sid} class ${classId} phase ${targetPhase} (orphan installment invoice ${invoice.invoice_id})`
    );
    return true;
  }
  return false;
}

/**
 * When downpayment is reverted (invoice unpaid / payment removed), delete the
 * pending_enrollment placeholder row for that installment profile (if any).
 *
 * @param {import('pg').PoolClient} client
 * @param {number} installmentProfileId
 */
export async function removePendingEnrollmentPlaceholderForProfile(client, installmentProfileId) {
  const pid = parseInt(String(installmentProfileId), 10);
  if (!Number.isFinite(pid)) return;

  const r = await client.query(
    `SELECT student_id, class_id, phase_start
     FROM installmentinvoiceprofilestbl
     WHERE installmentinvoiceprofiles_id = $1`,
    [pid]
  );
  if (!r.rows.length) return;
  const { student_id: stu, class_id: cid, phase_start: ps } = r.rows[0];
  if (stu == null || cid == null) return;
  const phaseNum = ps != null ? parseInt(String(ps), 10) : 1;
  const ph = Number.isFinite(phaseNum) && phaseNum > 0 ? phaseNum : 1;

  await client.query(
    `DELETE FROM classstudentstbl
     WHERE student_id = $1 AND class_id = $2 AND phase_number = $3
       AND program_enrollment_status = 'pending_enrollment'`,
    [stu, cid, ph]
  );
}

/**
 * Convenience: always returns 'dropped' (used for unenrollment sites).
 */
export function getDroppedStatus() {
  return PROGRAM_ENROLLMENT_STATUS.DROPPED;
}

/**
 * Returns the human-readable label for a program_enrollment_status value.
 */
export function getStatusLabel(status) {
  const labels = {
    reserved:           'Reserved',
    pending_enrollment: 'Pending enrollment',
    new:                'New',
    re_enrolled:        'Re-enroll',
    upsell:             'Upsell',
    rejoin:             'Rejoin',
    dropped:            'Not enrolled',
    completed:          'Completed',
  };
  return labels[status] || status || '—';
}

/**
 * Latest installment plan for a student/class (active or inactive after drop/unenroll).
 * Used by rejoin-invoice so billing progress (generated_count, etc.) is preserved.
 */
export async function findInstallmentProfileForRejoin(db, studentId, classId) {
  const sid = Number(studentId);
  const cid = Number(classId);
  if (!sid || !cid) return null;

  const result = await db.query(
    `SELECT installmentinvoiceprofiles_id, amount, package_id, generated_count,
            phase_start, total_phases, is_active, downpayment_paid
     FROM installmentinvoiceprofilestbl
     WHERE student_id = $1 AND class_id = $2
     ORDER BY installmentinvoiceprofiles_id DESC
     LIMIT 1`,
    [sid, cid]
  );
  return result.rows[0] || null;
}

/** @param {string|null|undefined} remarks */
export function parseInstallmentProfileIdFromRemarks(remarks) {
  const match = String(remarks || '').match(/INSTALLMENT_PROFILE_ID:(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

/** @param {string|null|undefined} remarks */
export function isRejoinClassInvoice(remarks) {
  return /REJOIN_PHASE:\d+/.test(String(remarks || ''));
}

/** @param {string|null|undefined} remarks */
export function parseRejoinPhaseFromRemarks(remarks) {
  const match = String(remarks || '').match(/REJOIN_PHASE:(\d+)/);
  const phase = match ? parseInt(match[1], 10) : NaN;
  return Number.isFinite(phase) && phase > 0 ? phase : null;
}

/**
 * When a rejoin invoice is created, align billing position to the rejoin phase
 * (skipped dropped phases are not counted).
 */
export async function alignInstallmentProfileForRejoinInvoice(db, profileId, rejoinPhaseNumber) {
  const pid = Number(profileId);
  const rejoinPhase = Number(rejoinPhaseNumber);
  if (!pid || !Number.isFinite(rejoinPhase) || rejoinPhase <= 0) return null;

  const profileRes = await db.query(
    `SELECT installmentinvoiceprofiles_id, phase_start, generated_count
     FROM installmentinvoiceprofilestbl
     WHERE installmentinvoiceprofiles_id = $1`,
    [pid]
  );
  const profile = profileRes.rows[0];
  if (!profile) return null;

  const phaseStart = profile.phase_start != null ? parseInt(profile.phase_start, 10) : 1;
  const safeStart = Number.isFinite(phaseStart) && phaseStart > 0 ? phaseStart : 1;
  const targetGenerated = Math.max(0, rejoinPhase - safeStart);

  const result = await db.query(
    `UPDATE installmentinvoiceprofilestbl
     SET generated_count = GREATEST(COALESCE(generated_count, 0), $1)
     WHERE installmentinvoiceprofiles_id = $2
     RETURNING installmentinvoiceprofiles_id, generated_count, phase_start`,
    [targetGenerated, pid]
  );
  return result.rows[0] || null;
}

/**
 * After rejoin payment: reactivate profile, advance generated_count past the paid
 * rejoin phase, and refresh installment schedule dates when applicable.
 */
export async function syncInstallmentProfileAfterRejoinPayment(db, profileId, studentId, rejoinPhaseNumber) {
  const pid = Number(profileId);
  const sid = Number(studentId);
  const rejoinPhase = Number(rejoinPhaseNumber);
  if (!pid || !sid || !Number.isFinite(rejoinPhase) || rejoinPhase <= 0) return null;

  const profileRes = await db.query(
    `SELECT ip.*,
            ii.installmentinvoicedtl_id,
            ii.next_generation_date AS sched_next_gen_date,
            ii.next_invoice_month AS sched_next_inv_month,
            ii.frequency AS ii_frequency
     FROM installmentinvoiceprofilestbl ip
     LEFT JOIN LATERAL (
       SELECT installmentinvoicedtl_id, next_generation_date, next_invoice_month, frequency
       FROM installmentinvoicestbl
       WHERE installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
       ORDER BY
         CASE WHEN UPPER(COALESCE(status, '')) = 'PENDING' THEN 0 ELSE 1 END,
         scheduled_date DESC NULLS LAST,
         installmentinvoicedtl_id DESC
       LIMIT 1
     ) ii ON true
     WHERE ip.installmentinvoiceprofiles_id = $1
       AND ip.student_id = $2`,
    [pid, sid]
  );
  const profile = profileRes.rows[0];
  if (!profile) return null;

  const phaseStart = profile.phase_start != null ? parseInt(profile.phase_start, 10) : 1;
  const safeStart = Number.isFinite(phaseStart) && phaseStart > 0 ? phaseStart : 1;
  const afterPaidGenerated = Math.max(
    parseInt(profile.generated_count || 0, 10) || 0,
    rejoinPhase - safeStart + 1
  );

  const updated = await db.query(
    `UPDATE installmentinvoiceprofilestbl
     SET is_active = true,
         generated_count = $1
     WHERE installmentinvoiceprofiles_id = $2
       AND student_id = $3
     RETURNING installmentinvoiceprofiles_id, generated_count, phase_start, is_active`,
    [afterPaidGenerated, pid, sid]
  );
  if (!updated.rows.length) return null;

  const { buildPhaseInstallmentSchedule, isPhaseInstallmentProfile } = await import(
    './phaseInstallmentUtils.js'
  );

  if (isPhaseInstallmentProfile(profile) && profile.installmentinvoicedtl_id) {
    try {
      const schedule = await buildPhaseInstallmentSchedule({
        db,
        profile: { ...profile, generated_count: afterPaidGenerated },
        generatedCountOverride: afterPaidGenerated,
      });
      if (schedule?.next_generation_date && schedule?.next_invoice_month) {
        await db.query(
          `UPDATE installmentinvoicestbl
           SET next_generation_date = $1,
               next_invoice_month = $2
           WHERE installmentinvoicedtl_id = $3`,
          [
            schedule.next_generation_date,
            schedule.next_invoice_month,
            profile.installmentinvoicedtl_id,
          ]
        );
      }
    } catch (scheduleErr) {
      console.warn(
        `[Rejoin] Could not refresh installment schedule for profile ${pid}:`,
        scheduleErr.message
      );
    }
  }

  return updated.rows[0];
}
