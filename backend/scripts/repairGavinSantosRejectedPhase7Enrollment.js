/**
 * Gavin Ysmael Santos (student 548) — void Phase 7 enrollment after rejected payment.
 *
 * Invoice INV-1310 / AR 260971 is Rejected; payment 1089 was rejected, but
 * classstudent 1145 (phase 7 re_enrolled) remained — showing "re enrolled" on
 * Invoices and "re-enrolled" on July matrix.
 *
 * Run:
 *   node backend/scripts/repairGavinSantosRejectedPhase7Enrollment.js
 *   node backend/scripts/repairGavinSantosRejectedPhase7Enrollment.js --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';
import { voidInstallmentEnrollmentForRejectedInvoice } from '../utils/installmentEnrollmentSync.js';

const STUDENT_ID = 548;
const CLASS_ID = 57;
const INVOICE_ID = 1310;
const PHASE7_CLASSSTUDENT_ID = 1145;

const isApply = process.argv.includes('--apply');

async function previewMatrix(queryFn) {
  const matrix = await loadStudentMonthEnrollmentMatrix(queryFn, {
    year: 2026,
    branchId: 5,
    classId: CLASS_ID,
  });
  const track = (matrix.students || []).find(
    (s) => s.student_id === STUDENT_ID && s.class_id === CLASS_ID
  );
  if (!track) return [];
  const cells = [];
  for (const m of matrix.months || []) {
    const c = track.months?.[m.key];
    if (!c) continue;
    if (c.mark === '1' || c.mark === '✓' || c.mark === 'X' || c.label) {
      cells.push({
        month: m.key,
        label: c.label,
        status: c.status,
        phase: c.phase_number,
        mark: c.mark,
      });
    }
  }
  return cells;
}

async function main() {
  console.log(
    `\nGavin Santos — void rejected Phase 7 enrollment${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );

  const client = await getClient();
  try {
    const enrollments = (
      await client.query(
        `SELECT cs.classstudent_id, cs.phase_number, cs.program_enrollment_status,
                TO_CHAR(TIMEZONE('Asia/Manila', cs.enrolled_at), 'YYYY-MM-DD HH24:MI') AS enrolled_manila
         FROM classstudentstbl cs
         WHERE cs.student_id = $1 AND cs.class_id = $2
         ORDER BY cs.phase_number`,
        [STUDENT_ID, CLASS_ID]
      )
    ).rows;
    console.log('Current enrollments:');
    console.table(enrollments);

    const invoice = (
      await client.query(`SELECT * FROM invoicestbl WHERE invoice_id = $1`, [INVOICE_ID])
    ).rows[0];
    console.log('Invoice:', {
      invoice_id: invoice?.invoice_id,
      status: invoice?.status,
      ar: invoice?.invoice_ar_number,
      remarks: invoice?.remarks,
    });

    console.log('\nMatrix BEFORE:');
    console.table(await previewMatrix(query));

    console.log('\nPlanned:');
    console.log(`  • Void Phase 7 enrollment (classstudent ${PHASE7_CLASSSTUDENT_ID})`);
    console.log('  • Keep invoice Rejected (Pay Now / repay)');
    console.log('  • Expected: May new, Jun re-enrolled, Jul Inactive (no re-enrolled)');

    if (!isApply) {
      await client.query('BEGIN');
      await voidInstallmentEnrollmentForRejectedInvoice({
        client,
        invoice,
        studentId: STUDENT_ID,
        reason: 'Ops repair — rejected payment void phase 7 enrollment',
      });
      console.log('\nMatrix AFTER (preview — rollback):');
      console.table(await previewMatrix(client.query.bind(client)));
      await client.query('ROLLBACK');
      console.log('\nDRY RUN — re-run with --apply to persist');
      return;
    }

    await client.query('BEGIN');
    const result = await voidInstallmentEnrollmentForRejectedInvoice({
      client,
      invoice,
      studentId: STUDENT_ID,
      reason: 'Ops repair — rejected payment void phase 7 enrollment',
    });
    if (!result.removed) {
      // Fallback hard delete if void helper skipped
      await client.query(`DELETE FROM classstudentstbl WHERE classstudent_id = $1`, [
        PHASE7_CLASSSTUDENT_ID,
      ]);
      console.log('Fallback DELETE classstudent', PHASE7_CLASSSTUDENT_ID);
    }
    await client.query('COMMIT');
    console.log('\n✅ Applied. Void result:', result);
    console.log('\nMatrix AFTER:');
    console.table(await previewMatrix(query));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error('Repair failed:', err.message);
  process.exit(1);
});
