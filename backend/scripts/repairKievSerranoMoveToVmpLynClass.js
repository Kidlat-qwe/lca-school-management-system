/**
 * Kiev Zion Z. Serrano — move installment plan + enrollments to display class.
 *
 * From: class 110 VMM_Nursery_MWF 2:30 PM (billing-only / wrong class shown)
 * To:   class 120 VMP_NURSERY_TCHR LYN_MWF 1:00 PM (actual class)
 *
 * - Profile 384.class_id → 120
 * - Soft-drop class 110 phase rows (1743, 1983)
 * - Keep/align class 120 phase 1 (1025) as new
 * - Ensure class 120 phase 2 re_enrolled
 * - Tag downpayment remarks CLASS_ID:120
 *
 * Run:
 *   node backend/scripts/repairKievSerranoMoveToVmpLynClass.js --production
 *   node backend/scripts/repairKievSerranoMoveToVmpLynClass.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

const STUDENT_EMAIL = 'juliepearlserrano01@gmail.com';
const STUDENT_ID = 581;
const PROFILE_ID = 384;
const FROM_CLASS_ID = 110;
const TO_CLASS_ID = 120;

const FROM_PHASE1_ID = 1743;
const FROM_PHASE2_ID = 1983;
const TO_PHASE1_ID = 1025;

const DOWNPAYMENT_INVOICE_ID = 1212;

const REPAIR_NOTE =
  'Ops repair 2026-08-01 — Kiev Serrano move plan/enrollments to VMP_NURSERY_TCHR LYN_MWF 1:00 PM (class 120)';

const isApply = process.argv.includes('--apply');

async function loadActiveEnrollments(client) {
  const r = await client.query(
    `SELECT cs.classstudent_id, cs.class_id, c.class_name, cs.phase_number,
            cs.program_enrollment_status,
            TO_CHAR(TIMEZONE('Asia/Manila', cs.enrolled_at), 'YYYY-MM-DD') AS enrolled,
            TO_CHAR(TIMEZONE('Asia/Manila', cs.removed_at), 'YYYY-MM-DD') AS removed
     FROM classstudentstbl cs
     LEFT JOIN classestbl c ON c.class_id = cs.class_id
     WHERE cs.student_id = $1
     ORDER BY cs.class_id, cs.phase_number, cs.classstudent_id`,
    [STUDENT_ID]
  );
  return r.rows;
}

async function main() {
  console.log(
    `\nKiev Serrano — move to VMP Lyn 1:00 PM${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`DB: ${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV}`);

  const client = await getClient();
  try {
    const student = (
      await client.query(
        `SELECT user_id, full_name, email FROM userstbl
         WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))`,
        [STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student || Number(student.user_id) !== STUDENT_ID) {
      throw new Error(`Student ${STUDENT_EMAIL} (id ${STUDENT_ID}) not found`);
    }
    console.log('Student:', student.full_name, student.email);

    const profile = (
      await client.query(
        `SELECT installmentinvoiceprofiles_id, class_id, is_active
         FROM installmentinvoiceprofilestbl
         WHERE installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      )
    ).rows[0];
    if (!profile || Number(profile.class_id) !== FROM_CLASS_ID) {
      throw new Error(
        `Profile ${PROFILE_ID} class_id=${profile?.class_id}, expected ${FROM_CLASS_ID}`
      );
    }

    const toClass = (
      await client.query(
        `SELECT class_id, class_name, branch_id FROM classestbl WHERE class_id = $1`,
        [TO_CLASS_ID]
      )
    ).rows[0];
    if (!toClass || !/LYN/i.test(toClass.class_name || '')) {
      throw new Error(`Target class ${TO_CLASS_ID} not found or unexpected name`);
    }
    console.log('Target class:', toClass.class_name);

    console.log('\nBEFORE enrollments:');
    console.table(await loadActiveEnrollments(client));
    console.log('BEFORE profile class_id:', profile.class_id);

    console.log('\nPlanned:');
    console.log(`  1. Profile ${PROFILE_ID} class_id ${FROM_CLASS_ID} → ${TO_CLASS_ID}`);
    console.log(`  2. Soft-drop class ${FROM_CLASS_ID} rows ${FROM_PHASE1_ID}, ${FROM_PHASE2_ID}`);
    console.log(`  3. Align class ${TO_CLASS_ID} phase 1 (${TO_PHASE1_ID}) → new`);
    console.log(`  4. Ensure class ${TO_CLASS_ID} phase 2 → re_enrolled`);
    console.log(`  5. Downpayment INV-${DOWNPAYMENT_INVOICE_ID} remarks CLASS_ID → ${TO_CLASS_ID}`);

    if (!isApply) {
      console.log('\nDry run only — no writes. Re-run with --apply to commit.');
      return;
    }

    await client.query('BEGIN');

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET class_id = $1
       WHERE installmentinvoiceprofiles_id = $2
         AND student_id = $3`,
      [TO_CLASS_ID, PROFILE_ID, STUDENT_ID]
    );
    console.log(`✅ Profile ${PROFILE_ID} → class ${TO_CLASS_ID}`);

    for (const id of [FROM_PHASE1_ID, FROM_PHASE2_ID]) {
      await client.query(
        `UPDATE classstudentstbl
         SET program_enrollment_status = 'dropped',
             removed_at = TIMEZONE('Asia/Manila', CURRENT_TIMESTAMP),
             removed_reason = $1,
             removed_by = NULL
         WHERE classstudent_id = $2
           AND student_id = $3
           AND class_id = $4`,
        [REPAIR_NOTE, id, STUDENT_ID, FROM_CLASS_ID]
      );
      console.log(`✅ Soft-dropped classstudent ${id} on class ${FROM_CLASS_ID}`);
    }

    await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = 'new',
           enrolled_at = '2026-06-02 12:00:00+08'::timestamptz,
           removed_at = NULL,
           removed_reason = NULL,
           removed_by = NULL,
           enrolled_by = COALESCE(enrolled_by, $1)
       WHERE classstudent_id = $2
         AND student_id = $3
         AND class_id = $4
         AND phase_number = 1`,
      [REPAIR_NOTE, TO_PHASE1_ID, STUDENT_ID, TO_CLASS_ID]
    );
    console.log(`✅ Class ${TO_CLASS_ID} phase 1 (${TO_PHASE1_ID}) → new`);

    const existingPhase2 = (
      await client.query(
        `SELECT classstudent_id FROM classstudentstbl
         WHERE student_id = $1 AND class_id = $2 AND phase_number = 2
         ORDER BY classstudent_id DESC LIMIT 1`,
        [STUDENT_ID, TO_CLASS_ID]
      )
    ).rows[0];

    if (existingPhase2) {
      await client.query(
        `UPDATE classstudentstbl
         SET program_enrollment_status = 're_enrolled',
             enrolled_at = '2026-07-31 12:00:00+08'::timestamptz,
             removed_at = NULL,
             removed_reason = NULL,
             removed_by = NULL,
             enrolled_by = COALESCE(enrolled_by, $1)
         WHERE classstudent_id = $2`,
        [REPAIR_NOTE, existingPhase2.classstudent_id]
      );
      console.log(
        `✅ Class ${TO_CLASS_ID} phase 2 (${existingPhase2.classstudent_id}) → re_enrolled`
      );
    } else {
      const inserted = await client.query(
        `INSERT INTO classstudentstbl
           (student_id, class_id, enrolled_by, phase_number, program_enrollment_status, enrolled_at)
         VALUES ($1, $2, $3, 2, 're_enrolled', '2026-07-31 12:00:00+08'::timestamptz)
         RETURNING classstudent_id`,
        [STUDENT_ID, TO_CLASS_ID, REPAIR_NOTE]
      );
      console.log(
        `✅ Inserted class ${TO_CLASS_ID} phase 2 (${inserted.rows[0].classstudent_id}) → re_enrolled`
      );
    }

    await client.query(
      `UPDATE invoicestbl
       SET remarks = regexp_replace(COALESCE(remarks, ''), 'CLASS_ID:\\d+', 'CLASS_ID:' || $2)
       WHERE invoice_id = $1
         AND remarks ILIKE '%CLASS_ID:%'`,
      [DOWNPAYMENT_INVOICE_ID, String(TO_CLASS_ID)]
    );
    console.log(`✅ Downpayment remarks CLASS_ID → ${TO_CLASS_ID}`);

    await client.query('COMMIT');

    const afterProfile = (
      await client.query(
        `SELECT ip.installmentinvoiceprofiles_id, ip.class_id, c.class_name
         FROM installmentinvoiceprofilestbl ip
         LEFT JOIN classestbl c ON c.class_id = ip.class_id
         WHERE ip.installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      )
    ).rows[0];

    console.log('\nAFTER profile:', afterProfile);
    console.log('AFTER enrollments:');
    console.table(await loadActiveEnrollments(client));
    console.log('\n✅ Apply complete. Refresh Student history.');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('\n❌ Repair failed:', err?.message || err);
    throw err;
  } finally {
    client.release();
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
