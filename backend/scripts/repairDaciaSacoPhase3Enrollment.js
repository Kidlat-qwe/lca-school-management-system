/**
 * Repair Dacia Candice L. Saco — phase 4 enrollment row should be phase 3.
 *
 * INV-564 (April billing / local phase 3) was paid 2026-05-25 but classstudentstbl
 * got phase_number 4 because generated_count was ahead of paid count.
 * INV-1005 (phase 4) payment has no enrollment row after the fix.
 *
 * Run:  node scripts/repairDaciaSacoPhase3Enrollment.js --dry-run
 * Apply: node scripts/repairDaciaSacoPhase3Enrollment.js --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';

const STUDENT_ID = 48;
const CLASS_ID = 33;
const MISALIGNED_CLASSSTUDENT_ID = 942;
const PHASE3_PAYMENT_ID = 884;
const PHASE3_INVOICE_ID = 564;
const PHASE4_PAYMENT_ID = 922;
const PHASE4_INVOICE_ID = 1005;
const CORRECT_PHASE3 = 3;
const CORRECT_PHASE4 = 4;

const isDryRun = !process.argv.includes('--apply');

async function printMatrix(queryFn, label) {
  const matrix = await loadStudentMonthEnrollmentMatrix(queryFn, { year: 2026 });
  const track = (matrix.students || []).find(
    (s) => s.student_id === STUDENT_ID && s.class_id === CLASS_ID
  );
  console.log(`\n${label} (Feb–Jun):`);
  for (const key of ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06']) {
    const cell = track?.months?.[key];
    console.log(`  ${key}: ${cell?.label || '—'}`);
  }
}

async function main() {
  console.log(`\nRepair Dacia Saco phase enrollment${isDryRun ? ' (DRY RUN)' : ' (APPLY)'}\n`);

  const client = await getClient();
  try {
    const userRes = await client.query(
      `SELECT user_id, full_name, email FROM userstbl WHERE user_id = $1`,
      [STUDENT_ID]
    );
    const rowRes = await client.query(
      `SELECT classstudent_id, student_id, class_id, phase_number, program_enrollment_status, enrolled_at, enrolled_by, removed_at
       FROM classstudentstbl WHERE classstudent_id = $1`,
      [MISALIGNED_CLASSSTUDENT_ID]
    );
    const pay3Res = await client.query(
      `SELECT payment_id, invoice_id, status, approval_status, created_at
       FROM paymenttbl WHERE payment_id = $1`,
      [PHASE3_PAYMENT_ID]
    );
    const pay4Res = await client.query(
      `SELECT payment_id, invoice_id, status, approval_status, created_at
       FROM paymenttbl WHERE payment_id = $1`,
      [PHASE4_PAYMENT_ID]
    );
    const phase3Conflict = await client.query(
      `SELECT classstudent_id FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2 AND phase_number = $3 AND removed_at IS NULL`,
      [STUDENT_ID, CLASS_ID, CORRECT_PHASE3]
    );

    console.log('Student:', userRes.rows[0]);
    console.log('Misaligned row:', rowRes.rows[0]);
    console.log('Phase 3 payment:', pay3Res.rows[0]);
    console.log('Phase 4 payment:', pay4Res.rows[0]);
    console.log('Existing phase 3 row:', phase3Conflict.rows[0] || null);

    if (!rowRes.rows[0]) {
      throw new Error(`classstudent_id ${MISALIGNED_CLASSSTUDENT_ID} not found`);
    }
    if (Number(rowRes.rows[0].student_id) !== STUDENT_ID) {
      throw new Error('classstudent row does not belong to Dacia');
    }
    if (Number(pay3Res.rows[0]?.invoice_id) !== PHASE3_INVOICE_ID) {
      throw new Error('Phase 3 payment is not linked to INV-564');
    }
    if (Number(pay4Res.rows[0]?.invoice_id) !== PHASE4_INVOICE_ID) {
      throw new Error('Phase 4 payment is not linked to INV-1005');
    }

    const phase4Check = await client.query(
      `SELECT classstudent_id FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2 AND phase_number = $3 AND removed_at IS NULL`,
      [STUDENT_ID, CLASS_ID, CORRECT_PHASE4]
    );

    const currentPhase = Number(rowRes.rows[0].phase_number);

    if (currentPhase === CORRECT_PHASE3 && phase4Check.rows.length > 0) {
      console.log('Enrollment already fully aligned — nothing to do.');
      await printMatrix(client.query.bind(client), 'Current matrix');
      return;
    }

    if (currentPhase === CORRECT_PHASE3 && phase4Check.rows.length === 0) {
      await printMatrix(client.query.bind(client), 'Current matrix');
      if (isDryRun) {
        console.log('\nWould INSERT phase 4 re_enrolled row from payment 922 timestamp');
        return;
      }
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO classstudentstbl
           (student_id, class_id, enrolled_by, phase_number, program_enrollment_status, enrolled_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          STUDENT_ID,
          CLASS_ID,
          'System (Repair — aligned phase 4 enrollment to INV-1005 payment)',
          CORRECT_PHASE4,
          're_enrolled',
          pay4Res.rows[0].created_at,
        ]
      );
      await client.query('COMMIT');
      console.log('\n✅ Inserted phase 4 enrollment row');
      await printMatrix(client.query.bind(client), 'Matrix after repair');
      return;
    }

    if (currentPhase !== CORRECT_PHASE4) {
      throw new Error(
        `Unexpected phase_number ${currentPhase} on classstudent_id ${MISALIGNED_CLASSSTUDENT_ID}`
      );
    }
    if (phase3Conflict.rows.length > 0) {
      throw new Error('Active phase 3 row already exists — manual review required');
    }

    await printMatrix(client.query.bind(client), 'Current matrix');

    if (isDryRun) {
      console.log('\nWould UPDATE classstudent_id 942: phase_number 4 → 3 (re_enrolled)');
      console.log('Would INSERT phase 4 re_enrolled row from payment 922 timestamp');
      console.log('\nExpected after repair: Feb=new, Mar=re-enrolled, Apr=re-enrolled, May=re-enrolled');
      return;
    }

    await client.query('BEGIN');
    await client.query(
      `UPDATE classstudentstbl
       SET phase_number = $1,
           program_enrollment_status = 're_enrolled',
           enrolled_by = $2,
           enrolled_at = $3
       WHERE classstudent_id = $4`,
      [
        CORRECT_PHASE3,
        'System (Repair — aligned phase 3 enrollment to INV-564 payment)',
        pay3Res.rows[0].created_at,
        MISALIGNED_CLASSSTUDENT_ID,
      ]
    );

    await client.query(
      `INSERT INTO classstudentstbl
         (student_id, class_id, enrolled_by, phase_number, program_enrollment_status, enrolled_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        STUDENT_ID,
        CLASS_ID,
        'System (Repair — aligned phase 4 enrollment to INV-1005 payment)',
        CORRECT_PHASE4,
        're_enrolled',
        pay4Res.rows[0].created_at,
      ]
    );

    await client.query('COMMIT');
    console.log('\n✅ Repaired enrollment rows for Dacia Saco');

    await printMatrix(client.query.bind(client), 'Matrix after repair');
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
