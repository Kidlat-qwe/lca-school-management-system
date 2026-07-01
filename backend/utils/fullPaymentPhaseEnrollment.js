import {
  PROGRAM_ENROLLMENT_STATUS,
  determineRejoinAwarePhaseStatus,
} from './enrollmentStatus.js';

/**
 * Enroll or reactivate a student across a phase range after full payment (or conversion).
 */
export async function enrollStudentForFullPaymentPhases({
  client,
  studentId,
  classId,
  phaseStart,
  phaseEnd,
  sourceLabel,
}) {
  let insertedOrReactivated = 0;
  for (let phase = phaseStart; phase <= phaseEnd; phase++) {
    const activePhase = await client.query(
      `SELECT classstudent_id
       FROM classstudentstbl
       WHERE student_id = $1
         AND class_id = $2
         AND phase_number = $3
         AND program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin')
         AND removed_at IS NULL
       LIMIT 1`,
      [studentId, classId, phase]
    );
    if (activePhase.rows.length > 0) continue;

    const defaultStatus =
      phase === phaseEnd && phaseEnd > phaseStart
        ? PROGRAM_ENROLLMENT_STATUS.COMPLETED
        : Number(phase) === Number(phaseStart)
          ? PROGRAM_ENROLLMENT_STATUS.NEW
          : PROGRAM_ENROLLMENT_STATUS.RE_ENROLLED;

    const fullPayStatus = await determineRejoinAwarePhaseStatus({
      db: client,
      studentId,
      classId,
      phaseNumber: phase,
      defaultStatus,
    });

    const reservedPhase = await client.query(
      `SELECT classstudent_id
       FROM classstudentstbl
       WHERE student_id = $1
         AND class_id = $2
         AND phase_number = $3
         AND program_enrollment_status = 'reserved'
         AND removed_at IS NULL
       LIMIT 1`,
      [studentId, classId, phase]
    );
    if (reservedPhase.rows.length > 0) {
      await client.query(
        `UPDATE classstudentstbl
         SET program_enrollment_status = $1,
             enrolled_by = $2,
             enrolled_at = COALESCE(enrolled_at, CURRENT_TIMESTAMP),
             removed_at = NULL,
             removed_reason = NULL,
             removed_by = NULL
         WHERE classstudent_id = $3`,
        [fullPayStatus, sourceLabel, reservedPhase.rows[0].classstudent_id]
      );
      insertedOrReactivated += 1;
      continue;
    }

    const droppedPhase = await client.query(
      `SELECT classstudent_id
       FROM classstudentstbl
       WHERE student_id = $1
         AND class_id = $2
         AND phase_number = $3
         AND program_enrollment_status = 'dropped'
       ORDER BY removed_at DESC NULLS LAST, classstudent_id DESC
       LIMIT 1`,
      [studentId, classId, phase]
    );

    if (droppedPhase.rows.length > 0) {
      await client.query(
        `UPDATE classstudentstbl
         SET program_enrollment_status = $1,
             removed_at = NULL,
             removed_reason = NULL,
             removed_by = NULL,
             enrolled_by = $2,
             enrolled_at = CURRENT_TIMESTAMP
         WHERE classstudent_id = $3`,
        [fullPayStatus, sourceLabel, droppedPhase.rows[0].classstudent_id]
      );
    } else {
      await client.query(
        `INSERT INTO classstudentstbl (student_id, class_id, enrolled_by, phase_number, program_enrollment_status)
         VALUES ($1, $2, $3, $4, $5)`,
        [studentId, classId, sourceLabel, phase, fullPayStatus]
      );
    }

    insertedOrReactivated += 1;
  }

  return insertedOrReactivated;
}
