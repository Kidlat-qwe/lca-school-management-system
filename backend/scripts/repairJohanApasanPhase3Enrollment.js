/**
 * Repair Johan Caeleb Ragos Apasan — phase 4 enrollment row should be phase 3.
 *
 * INV-1158 (TARGET_PHASE:3) was paid 2026-05-28 but classstudentstbl got phase_number 4,
 * leaving April blank on the month re-enrollment matrix.
 *
 * Run:  node scripts/repairJohanApasanPhase3Enrollment.js --dry-run
 * Apply: node scripts/repairJohanApasanPhase3Enrollment.js --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';

const STUDENT_ID = 18;
const CLASS_ID = 25;
const MISALIGNED_CLASSSTUDENT_ID = 964;
const PAYMENT_ID = 914;
const PHASE3_INVOICE_ID = 1158;
const CORRECT_PHASE = 3;

const isDryRun = !process.argv.includes('--apply');

async function main() {
  console.log(`\nRepair Johan Apasan phase enrollment${isDryRun ? ' (DRY RUN)' : ' (APPLY)'}\n`);

  const client = await getClient();
  try {
    const userRes = await client.query(
      `SELECT user_id, full_name, email FROM userstbl WHERE user_id = $1`,
      [STUDENT_ID]
    );
    const rowRes = await client.query(
      `SELECT classstudent_id, student_id, class_id, phase_number, program_enrollment_status, enrolled_at, enrolled_by, removed_at
       FROM classstudentstbl
       WHERE classstudent_id = $1`,
      [MISALIGNED_CLASSSTUDENT_ID]
    );
    const payRes = await client.query(
      `SELECT payment_id, invoice_id, status, approval_status, created_at
       FROM paymenttbl WHERE payment_id = $1`,
      [PAYMENT_ID]
    );
    const invRes = await client.query(
      `SELECT invoice_id, status, remarks FROM invoicestbl WHERE invoice_id = $1`,
      [PHASE3_INVOICE_ID]
    );
    const phase3Conflict = await client.query(
      `SELECT classstudent_id FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2 AND phase_number = $3 AND removed_at IS NULL`,
      [STUDENT_ID, CLASS_ID, CORRECT_PHASE]
    );

    console.log('Student:', userRes.rows[0]);
    console.log('Misaligned row:', rowRes.rows[0]);
    console.log('Payment:', payRes.rows[0]);
    console.log('Invoice:', invRes.rows[0]);
    console.log('Existing phase 3 row:', phase3Conflict.rows[0] || null);

    if (!rowRes.rows[0]) {
      throw new Error(`classstudent_id ${MISALIGNED_CLASSSTUDENT_ID} not found`);
    }
    if (Number(rowRes.rows[0].student_id) !== STUDENT_ID) {
      throw new Error('classstudent row does not belong to Johan');
    }
    if (Number(rowRes.rows[0].class_id) !== CLASS_ID) {
      throw new Error('classstudent row is not for the expected class');
    }
    if (Number(rowRes.rows[0].phase_number) !== 4) {
      throw new Error(
        `Expected phase_number 4 on classstudent_id ${MISALIGNED_CLASSSTUDENT_ID}, got ${rowRes.rows[0].phase_number}`
      );
    }
    if (phase3Conflict.rows.length > 0) {
      throw new Error('Active phase 3 row already exists — manual review required');
    }
    if (Number(payRes.rows[0]?.invoice_id) !== PHASE3_INVOICE_ID) {
      throw new Error('Payment is not linked to INV-1158 (TARGET_PHASE:3)');
    }

    if (isDryRun) {
      console.log('\nWould UPDATE classstudent_id 964: phase_number 4 → 3');
      const matrix = await loadStudentMonthEnrollmentMatrix(client.query.bind(client), { year: 2026 });
      const track = (matrix.students || []).find(
        (s) => s.student_id === STUDENT_ID && s.class_id === CLASS_ID
      );
      console.log('\nCurrent matrix (Feb–Jun):');
      for (const key of ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06']) {
        const cell = track?.months?.[key];
        console.log(`  ${key}: ${cell?.label || '—'}`);
      }
      console.log('\nAfter repair (expected): Feb=new, Mar=re-enrolled, Apr=re-enrolled, May=—');
      return;
    }

    await client.query('BEGIN');
    await client.query(
      `UPDATE classstudentstbl
       SET phase_number = $1,
           program_enrollment_status = 're_enrolled',
           enrolled_by = $2
       WHERE classstudent_id = $3`,
      [
        CORRECT_PHASE,
        'System (Repair — aligned phase 3 enrollment to TARGET_PHASE:3 payment)',
        MISALIGNED_CLASSSTUDENT_ID,
      ]
    );
    await client.query('COMMIT');
    console.log('\n✅ Updated classstudent_id 964: phase_number 4 → 3');

    const matrix = await loadStudentMonthEnrollmentMatrix(client.query.bind(client), { year: 2026 });
    const track = (matrix.students || []).find(
      (s) => s.student_id === STUDENT_ID && s.class_id === CLASS_ID
    );
    console.log('\nMatrix after repair (Feb–Jun):');
    for (const key of ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06']) {
      const cell = track?.months?.[key];
      console.log(`  ${key}: ${cell?.label || '—'}`);
    }
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('Repair failed:', err.message || err);
    process.exit(1);
  } finally {
    client.release();
  }
}

main().then(() => process.exit(0));
