/**
 * Kiev Zion Z. Serrano (student 581, Pampanga) — hide VMM 2:30 PM from
 * Student History → Enrolled class. Student only attends VMP 1:00 PM.
 *
 * Background: an ops matrix repair inserted an active phase-1 `new` row on
 * billing class 110 (VMM_Nursery_MWF 2:30 PM) while the real auto-enrollment
 * is on display class 120 (VMP_NURSERY_TCHR LYN_MWF 1:00 PM). Both appeared
 * as enrolled classes.
 *
 * Fix: soft-drop classstudent 1743 on class 110. Combined with active-only
 * filter on GET /students/:id/classes, only the 1:00 PM class remains listed.
 * Installment profile 384 stays on class 110 for billing history.
 *
 * Run:
 *   node backend/scripts/repairKievZionSerranoHideBillingClassEnrollment.js
 *   node backend/scripts/repairKievZionSerranoHideBillingClassEnrollment.js --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

const STUDENT_ID = 581;
const STUDENT_EMAIL = 'juliepearlserrano01@gmail.com';
const BILLING_CLASS_ID = 110; // VMM 2:30 PM — remove from enrolled modal
const DISPLAY_CLASS_ID = 120; // VMP 1:00 PM — keep
const BILLING_CLASSSTUDENT_ID = 1743;
const REPAIR_NOTE =
  'Ops repair 2026-07-13 — hide billing-class enrollment; student attends VMP 1:00 PM only';

const isApply = process.argv.includes('--apply');

async function loadActiveClasses(client) {
  const r = await client.query(
    `SELECT cs.classstudent_id, cs.class_id, c.class_name, cs.phase_number,
            cs.program_enrollment_status,
            cs.removed_at IS NOT NULL AS removed
     FROM classstudentstbl cs
     LEFT JOIN classestbl c ON c.class_id = cs.class_id
     WHERE cs.student_id = $1
       AND cs.removed_at IS NULL
       AND cs.program_enrollment_status IN (
         'new', 're_enrolled', 'upsell', 'rejoin', 'completed',
         'pending_enrollment', 'reserved'
       )
     ORDER BY cs.class_id, cs.phase_number`,
    [STUDENT_ID]
  );
  return r.rows;
}

async function main() {
  console.log(
    `\nKiev Serrano — hide 2:30 PM billing class from Enrolled class${
      isApply ? ' (APPLY)' : ' (DRY RUN)'
    }\n`
  );

  const client = await getClient();
  try {
    const student = (
      await client.query(
        `SELECT user_id, full_name, email FROM userstbl
         WHERE user_id = $1 AND LOWER(TRIM(email)) = LOWER(TRIM($2))`,
        [STUDENT_ID, STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student) throw new Error(`Student ${STUDENT_ID} / ${STUDENT_EMAIL} not found`);
    console.log('Student:', student.full_name, student.email);

    const target = (
      await client.query(
        `SELECT classstudent_id, class_id, phase_number, program_enrollment_status,
                removed_at, enrolled_by
         FROM classstudentstbl WHERE classstudent_id = $1`,
        [BILLING_CLASSSTUDENT_ID]
      )
    ).rows[0];
    if (!target) throw new Error(`classstudent ${BILLING_CLASSSTUDENT_ID} not found`);
    if (Number(target.class_id) !== BILLING_CLASS_ID) {
      throw new Error(
        `classstudent ${BILLING_CLASSSTUDENT_ID} is class ${target.class_id}, expected ${BILLING_CLASS_ID}`
      );
    }

    const display = (
      await client.query(
        `SELECT classstudent_id, class_id, program_enrollment_status, removed_at
         FROM classstudentstbl
         WHERE student_id = $1 AND class_id = $2
           AND removed_at IS NULL
           AND program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin', 'completed')
         ORDER BY classstudent_id DESC LIMIT 1`,
        [STUDENT_ID, DISPLAY_CLASS_ID]
      )
    ).rows[0];
    if (!display) {
      throw new Error(
        `Active enrollment on display class ${DISPLAY_CLASS_ID} (1:00 PM) not found — abort`
      );
    }

    console.log('\nActive enrollments BEFORE (modal candidates):');
    console.table(await loadActiveClasses(client));

    console.log('\nPlanned:');
    console.log(
      `  • Soft-drop classstudent ${BILLING_CLASSSTUDENT_ID} on class ${BILLING_CLASS_ID} (2:30 PM)`
    );
    console.log(
      `  • Keep classstudent ${display.classstudent_id} on class ${DISPLAY_CLASS_ID} (1:00 PM)`
    );

    if (!isApply) {
      console.log('\nDry run complete. Re-run with --apply to write changes.');
      return;
    }

    if (target.removed_at || target.program_enrollment_status === 'dropped') {
      console.log('\nAlready dropped — nothing to update.');
      return;
    }

    await client.query('BEGIN');
    await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = 'dropped',
           removed_at = CURRENT_TIMESTAMP,
           removed_reason = $1,
           removed_by = $2
       WHERE classstudent_id = $3`,
      [REPAIR_NOTE, 'System (Ops repair)', BILLING_CLASSSTUDENT_ID]
    );
    await client.query('COMMIT');

    console.log('\n✅ Soft-dropped billing-class enrollment.');
    console.log('\nActive enrollments AFTER (modal candidates):');
    console.table(await loadActiveClasses(client));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error('Repair failed:', err.message || err);
  process.exit(1);
});
