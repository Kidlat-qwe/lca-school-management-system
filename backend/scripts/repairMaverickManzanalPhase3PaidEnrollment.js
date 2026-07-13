/**
 * Maverick Raziel Viola Manzanal — restore Playgroup Phase 3 enrollment.
 *
 * INV-275 is Paid (Mar 7), but classstudent 228 was overwritten to `dropped`
 * by installment delinquency on Jun 19. Paid phases should stay enrolled.
 *
 * Does NOT touch Phase 4–6 delinquency drops (those invoices are unpaid).
 *
 * Run:
 *   node backend/scripts/repairMaverickManzanalPhase3PaidEnrollment.js
 *   node backend/scripts/repairMaverickManzanalPhase3PaidEnrollment.js --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

const STUDENT_EMAIL = 'shaimanzanal@icloud.com';
const STUDENT_ID = 171;
const CLASS_ID = 57;
const PHASE3_CLASSSTUDENT_ID = 228;
const PHASE3_INVOICE_ID = 275;
const TARGET_STATUS = 're_enrolled';
const REPAIR_NOTE =
  'Ops repair 2026-07-13 — Maverick Phase 3 paid; clear erroneous delinquency drop';

const isApply = process.argv.includes('--apply');

async function main() {
  console.log(
    `\nMaverick Phase 3 paid enrollment restore${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );

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

    const inv = (
      await client.query(
        `SELECT invoice_id, status, remarks FROM invoicestbl WHERE invoice_id = $1`,
        [PHASE3_INVOICE_ID]
      )
    ).rows[0];
    if (!inv || inv.status !== 'Paid') {
      throw new Error(
        `INV-${PHASE3_INVOICE_ID} must be Paid (got ${inv?.status || 'missing'})`
      );
    }
    if (!String(inv.remarks || '').includes('TARGET_PHASE:3')) {
      throw new Error(`INV-${PHASE3_INVOICE_ID} is not TARGET_PHASE:3`);
    }

    const row = (
      await client.query(
        `SELECT classstudent_id, class_id, phase_number, program_enrollment_status,
                enrolled_by, removed_by, removed_reason,
                TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD HH24:MI') AS enrolled,
                TO_CHAR(TIMEZONE('Asia/Manila', removed_at), 'YYYY-MM-DD HH24:MI') AS removed
         FROM classstudentstbl
         WHERE classstudent_id = $1`,
        [PHASE3_CLASSSTUDENT_ID]
      )
    ).rows[0];

    if (!row) throw new Error(`classstudent ${PHASE3_CLASSSTUDENT_ID} not found`);
    if (Number(row.class_id) !== CLASS_ID || Number(row.phase_number) !== 3) {
      throw new Error(
        `Expected class ${CLASS_ID} phase 3; got class ${row.class_id} phase ${row.phase_number}`
      );
    }

    console.log('Student:', student.full_name, student.email);
    console.log('Invoice:', `INV-${PHASE3_INVOICE_ID}`, inv.status);
    console.log('\nCurrent Phase 3 enrollment:');
    console.table([row]);

    if (row.program_enrollment_status === TARGET_STATUS && !row.removed) {
      console.log(`\nAlready ${TARGET_STATUS} with no removed_at. Nothing to do.`);
      return;
    }

    console.log('\nPlanned:');
    console.log(`  • classstudent ${PHASE3_CLASSSTUDENT_ID}:`);
    console.log(`      status ${row.program_enrollment_status} → ${TARGET_STATUS}`);
    console.log('      clear removed_at / removed_reason / removed_by');
    console.log(`  • Note: ${REPAIR_NOTE}`);
    console.log('  • Phases 4–6 delinquency drops left unchanged');

    if (!isApply) {
      console.log('\nDry run complete. Re-run with --apply to write changes.');
      return;
    }

    await client.query('BEGIN');
    await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = $1,
           removed_at = NULL,
           removed_reason = NULL,
           removed_by = NULL,
           enrolled_by = CASE
             WHEN COALESCE(enrolled_by, '') ILIKE '%' || $2 || '%' THEN enrolled_by
             ELSE COALESCE(enrolled_by, '') || ' | ' || $2
           END
       WHERE classstudent_id = $3`,
      [TARGET_STATUS, REPAIR_NOTE, PHASE3_CLASSSTUDENT_ID]
    );
    await client.query('COMMIT');

    const after = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status,
                TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD HH24:MI') AS enrolled,
                TO_CHAR(TIMEZONE('Asia/Manila', removed_at), 'YYYY-MM-DD HH24:MI') AS removed,
                removed_reason
         FROM classstudentstbl
         WHERE classstudent_id = $1`,
        [PHASE3_CLASSSTUDENT_ID]
      )
    ).rows[0];

    console.log('\n✅ Applied. Phase 3 AFTER:');
    console.table([after]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
