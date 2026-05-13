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
 *   dropped            – student was unenrolled / removed.
 *   completed          – student finished their enrolled phases / class (set by cron).
 */

export const PROGRAM_ENROLLMENT_STATUS = Object.freeze({
  RESERVED:           'reserved',
  PENDING_ENROLLMENT: 'pending_enrollment',
  NEW:                'new',
  RE_ENROLLED:        're_enrolled',
  UPSELL:             'upsell',
  DROPPED:            'dropped',
  COMPLETED:          'completed',
});

/** Values that count as "actively enrolled" (used by student_statustbl trigger). */
export const ACTIVE_ENROLLMENT_STATUSES = [
  PROGRAM_ENROLLMENT_STATUS.NEW,
  PROGRAM_ENROLLMENT_STATUS.RE_ENROLLED,
  PROGRAM_ENROLLMENT_STATUS.UPSELL,
];

/** Ordered program level tags from lowest to highest. */
const LEVEL_ORDER = [
  'Playgroup',
  'Nursery',
  'Pre-Kindergarten',
  'Kindergarten',
  'Grade School',
];

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
 * @returns {Promise<string>} One of the PROGRAM_ENROLLMENT_STATUS values.
 */
export async function determineEnrollmentStatus({ db, studentId, classId, enrollmentType }) {
  // Fast-path: payment context determines status directly
  if (enrollmentType === 'reservation') return PROGRAM_ENROLLMENT_STATUS.RESERVED;
  if (enrollmentType === 'downpayment') return PROGRAM_ENROLLMENT_STATUS.PENDING_ENROLLMENT;

  // Check whether this student has ANY prior class enrollment (any status, any class)
  const priorResult = await db.query(
    `SELECT c.level_tag
     FROM classstudentstbl cs
     JOIN classestbl c ON cs.class_id = c.class_id
     WHERE cs.student_id = $1
       AND cs.class_id != $2
     LIMIT 50`,
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
  const currentLevelIdx = LEVEL_ORDER.indexOf(currentLevel);

  // Upsell: student has a prior enrollment in a LOWER level program
  if (currentLevelIdx > 0) {
    const isUpsell = priorResult.rows.some((row) => {
      const prevIdx = LEVEL_ORDER.indexOf(row.level_tag);
      return prevIdx !== -1 && prevIdx < currentLevelIdx;
    });
    if (isUpsell) return PROGRAM_ENROLLMENT_STATUS.UPSELL;
  }

  return PROGRAM_ENROLLMENT_STATUS.RE_ENROLLED;
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
       AND program_enrollment_status IN ('new', 're_enrolled', 'upsell')
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
    pending_enrollment: 'Pending Enrollment',
    new:                'New',
    re_enrolled:        'Re-enrolled',
    upsell:             'Upsell',
    dropped:            'Dropped',
    completed:          'Completed',
  };
  return labels[status] || status || '—';
}
