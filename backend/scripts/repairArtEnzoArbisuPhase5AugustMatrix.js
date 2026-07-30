/**
 * Art Enzo M. Arbisu — phase 5 "new" belongs in August, not July.
 *
 * Profile #490 (phase_start=5) on VMM_Playgroup_TTh 1:00 PM (class 94).
 * Enrolled phase 5 as `new` with enrolled_at 2026-07-14, so Month Re-enrollment
 * and Report → Student Status put him in July. Ops: phase 5 billing month is August.
 *
 * Fix:
 *   - classstudent #1871 enrolled_at → 2026-08-01 (matrix billing anchor)
 *   - Phase 5 INV-2003 issue/due → 2026-07-25 / 2026-08-05 (August cycle)
 *
 * Run (from backend/):
 *   node scripts/repairArtEnzoArbisuPhase5AugustMatrix.js --production
 *   node scripts/repairArtEnzoArbisuPhase5AugustMatrix.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import {
  buildMonthMatrixActiveTrackRows,
  isMonthMatrixCellActiveForOperationalDashboard,
  loadStudentMonthEnrollmentMatrix,
} from '../lib/enrollmentRateMetrics.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_EMAIL = 'magz_remie1580@yahoo.com';
const STUDENT_ID = 663;
const CLASS_ID = 94;
const CLASSSTUDENT_ID = 1871;
const PROFILE_ID = 490;
const PHASE5_INVOICE_ID = 2003;

const TARGET_ENROLLED_AT = '2026-08-01';
const TARGET_ISSUE_DATE = '2026-07-25';
const TARGET_DUE_DATE = '2026-08-05';

const REPAIR_NOTE =
  'Ops repair — Art Enzo Arbisu phase 5 new month July→August (enrolled_at + INV-2003 dates)';

const isApply = process.argv.includes('--apply');

async function previewMatrixCells(queryFn) {
  const matrix = await loadStudentMonthEnrollmentMatrix(queryFn, {
    year: 2026,
    branchId: 1,
    classId: CLASS_ID,
  });
  const track = (matrix.students || []).find(
    (s) => Number(s.student_id) === STUDENT_ID && Number(s.class_id) === CLASS_ID
  );
  if (!track) return { cells: [], julyActive: false, augustActive: false };

  const cells = [];
  for (const key of ['2026-06', '2026-07', '2026-08', '2026-09']) {
    const c = track.months?.[key];
    if (!c) continue;
    if (c.mark === '1' || c.mark === '✓' || c.mark === 'X' || c.label) {
      cells.push({
        month: key,
        label: c.label,
        status: c.status,
        phase: c.phase_number ?? null,
        mark: c.mark,
        payment_lifecycle: Boolean(c.payment_lifecycle),
        report_active: isMonthMatrixCellActiveForOperationalDashboard(c, track, key),
      });
    }
  }

  const julyActive = buildMonthMatrixActiveTrackRows([track], '2026-07').some(
    (r) => Number(r.student_id) === STUDENT_ID
  );
  const augustActive = buildMonthMatrixActiveTrackRows([track], '2026-08').some(
    (r) => Number(r.student_id) === STUDENT_ID
  );

  return { cells, julyActive, augustActive };
}

async function main() {
  console.log(
    `\nArt Enzo Arbisu — phase 5 August matrix repair${
      isApply ? ' (APPLY)' : ' (DRY RUN)'
    }\n`
  );
  console.log(`Note: ${REPAIR_NOTE}\n`);

  const client = await getClient();

  try {
    const student = (
      await client.query(
        `SELECT user_id, full_name, email FROM userstbl
         WHERE user_id = $1 AND LOWER(TRIM(email)) = LOWER(TRIM($2))`,
        [STUDENT_ID, STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student) {
      throw new Error(`Student ${STUDENT_ID} / ${STUDENT_EMAIL} not found`);
    }

    const enrollment = (
      await client.query(
        `SELECT classstudent_id, class_id, phase_number, program_enrollment_status,
                TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD') AS enrolled_ymd
         FROM classstudentstbl
         WHERE classstudent_id = $1`,
        [CLASSSTUDENT_ID]
      )
    ).rows[0];
    if (!enrollment || Number(enrollment.class_id) !== CLASS_ID) {
      throw new Error(`Enrollment ${CLASSSTUDENT_ID} not found on class ${CLASS_ID}`);
    }
    if (Number(enrollment.phase_number) !== 5) {
      throw new Error(
        `Expected phase 5, got phase ${enrollment.phase_number}`
      );
    }
    if (String(enrollment.program_enrollment_status) !== 'new') {
      throw new Error(
        `Expected status new, got ${enrollment.program_enrollment_status}`
      );
    }

    const invoice = (
      await client.query(
        `SELECT invoice_id, status, remarks,
                TO_CHAR(TIMEZONE('Asia/Manila', issue_date), 'YYYY-MM-DD') AS issue_ymd,
                TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due_ymd,
                installmentinvoiceprofiles_id
         FROM invoicestbl
         WHERE invoice_id = $1`,
        [PHASE5_INVOICE_ID]
      )
    ).rows[0];
    if (!invoice || Number(invoice.installmentinvoiceprofiles_id) !== PROFILE_ID) {
      throw new Error(`Phase 5 invoice ${PHASE5_INVOICE_ID} not on profile ${PROFILE_ID}`);
    }
    if (!String(invoice.remarks || '').includes('TARGET_PHASE:5')) {
      throw new Error(`Invoice ${PHASE5_INVOICE_ID} is not TARGET_PHASE:5`);
    }

    console.log('Student:', student.full_name, student.email);
    console.log('Enrollment before:');
    console.table([enrollment]);
    console.log('Phase 5 invoice before:');
    console.table([
      {
        invoice_id: invoice.invoice_id,
        status: invoice.status,
        issue_ymd: invoice.issue_ymd,
        due_ymd: invoice.due_ymd,
      },
    ]);

    console.log('\nMatrix BEFORE:');
    const before = await previewMatrixCells(query);
    console.table(before.cells);
    console.log(
      `Report active — July: ${before.julyActive ? 'YES' : 'no'} | August: ${
        before.augustActive ? 'YES' : 'no'
      }`
    );

    const needsEnroll =
      enrollment.enrolled_ymd !== TARGET_ENROLLED_AT;
    const needsInvoice =
      invoice.issue_ymd !== TARGET_ISSUE_DATE || invoice.due_ymd !== TARGET_DUE_DATE;

    console.log('\nPlanned changes:');
    if (needsEnroll) {
      console.log(
        `  • classstudent ${CLASSSTUDENT_ID} enrolled_at: ${enrollment.enrolled_ymd} → ${TARGET_ENROLLED_AT}`
      );
    } else {
      console.log(`  • enrolled_at already ${TARGET_ENROLLED_AT}`);
    }
    if (needsInvoice) {
      console.log(
        `  • INV-${PHASE5_INVOICE_ID}: ${invoice.issue_ymd}/${invoice.due_ymd} → ${TARGET_ISSUE_DATE}/${TARGET_DUE_DATE}`
      );
    } else {
      console.log(
        `  • INV-${PHASE5_INVOICE_ID} already ${TARGET_ISSUE_DATE}/${TARGET_DUE_DATE}`
      );
    }
    console.log('\nExpected matrix AFTER:');
    console.table([
      { month: '2026-07', label: '(empty / not new)' },
      { month: '2026-08', label: 'new', phase: 5 },
      { month: '2026-09', label: 'Active (lifecycle) if unpaid next' },
    ]);

    if (!needsEnroll && !needsInvoice) {
      console.log('\nNo changes needed.');
      return;
    }

    if (!isApply) {
      console.log('\nDry run only. Re-run with --apply to write changes.');
      return;
    }

    await client.query('BEGIN');

    if (needsEnroll) {
      // classstudentstbl.enrolled_at is timestamp WITHOUT time zone.
      // Matrix uses TIMEZONE('Asia/Manila', enrolled_at), which treats the stored
      // wall clock as Manila local — do NOT store a UTC-converted timestamptz.
      await client.query(
        `UPDATE classstudentstbl
         SET enrolled_at = $1::timestamp,
             enrolled_by = CASE
               WHEN enrolled_by IS NULL OR BTRIM(enrolled_by) = '' THEN $2
               WHEN enrolled_by LIKE '%' || $2 || '%' THEN enrolled_by
               ELSE enrolled_by || ' | ' || $2
             END
         WHERE classstudent_id = $3`,
        [`${TARGET_ENROLLED_AT} 12:00:00`, REPAIR_NOTE, CLASSSTUDENT_ID]
      );
      console.log(`✅ enrolled_at → ${TARGET_ENROLLED_AT} 12:00:00 (Manila wall clock)`);
    }

    if (needsInvoice) {
      await client.query(
        `UPDATE invoicestbl
         SET issue_date = ($1::date + TIME '12:00'),
             due_date = ($2::date + TIME '12:00'),
             late_penalty_applied_for_due_date = NULL
         WHERE invoice_id = $3`,
        [TARGET_ISSUE_DATE, TARGET_DUE_DATE, PHASE5_INVOICE_ID]
      );
      await syncProgramPaymentStatusForInvoice(client, PHASE5_INVOICE_ID);
      console.log(
        `✅ INV-${PHASE5_INVOICE_ID} → issue ${TARGET_ISSUE_DATE} / due ${TARGET_DUE_DATE}`
      );
    }

    await client.query('COMMIT');

    console.log('\nMatrix AFTER:');
    const after = await previewMatrixCells(query);
    console.table(after.cells);
    console.log(
      `Report active — July: ${after.julyActive ? 'YES' : 'no'} | August: ${
        after.augustActive ? 'YES' : 'no'
      }`
    );

    if (after.julyActive) {
      console.warn('\n⚠ July still counts as Report-active — inspect matrix cells.');
    }
    if (!after.augustActive) {
      console.warn('\n⚠ August does not count as Report-active — inspect matrix cells.');
    }

    console.log(`\n${REPAIR_NOTE}`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error('\nFailed:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
