/**
 * Repair Kayleigh Beatrix Jao — enrollment labels phases 1–4:
 *   Phase 1: new
 *   Phase 2–4: re_enrolled
 *
 * Run:  node scripts/repairKayleighJaoEnrollmentLabels.js --dry-run
 * Apply: node scripts/repairKayleighJaoEnrollmentLabels.js --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

const STUDENT_ID = 82;
const CLASS_ID = 29;
const PHASE2_REJOIN_ROW_ID = 1242;
const PHASE4_REJOIN_ROW_ID = 1243;
const PHASE2_PAYMENT_ID = 1187;
const PHASE3_PAYMENT_ID = 693;
const PHASE4_PAYMENT_ID = 1188;

const isDryRun = !process.argv.includes('--apply');

async function main() {
  console.log(`\nRepair Kayleigh Jao enrollment labels${isDryRun ? ' (DRY RUN)' : ' (APPLY)'}\n`);

  const client = await getClient();
  try {
    const userRes = await client.query(
      `SELECT user_id, full_name, email FROM userstbl WHERE user_id = $1`,
      [STUDENT_ID]
    );
    const rowsRes = await client.query(
      `SELECT classstudent_id, phase_number, program_enrollment_status, removed_at
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2
       ORDER BY phase_number, classstudent_id`,
      [STUDENT_ID, CLASS_ID]
    );
    const pay2 = await client.query(
      `SELECT payment_id, invoice_id, created_at FROM paymenttbl WHERE payment_id = $1`,
      [PHASE2_PAYMENT_ID]
    );
    const pay3 = await client.query(
      `SELECT payment_id, invoice_id, created_at FROM paymenttbl WHERE payment_id = $1`,
      [PHASE3_PAYMENT_ID]
    );
    const pay4 = await client.query(
      `SELECT payment_id, invoice_id, created_at FROM paymenttbl WHERE payment_id = $1`,
      [PHASE4_PAYMENT_ID]
    );
    const phase3Existing = await client.query(
      `SELECT classstudent_id FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2 AND phase_number = 3 AND removed_at IS NULL`,
      [STUDENT_ID, CLASS_ID]
    );

    console.log('Student:', userRes.rows[0]);
    console.log('Current rows:', rowsRes.rows);
    console.log('Phase 3 active row:', phase3Existing.rows[0] || null);
    console.log('Phase 2 payment:', pay2.rows[0]);
    console.log('Phase 3 payment:', pay3.rows[0]);
    console.log('Phase 4 payment:', pay4.rows[0]);

    if (Number(pay3.rows[0]?.invoice_id) !== 1206) {
      throw new Error('Phase 3 payment must be on INV-1206');
    }

    if (isDryRun) {
      console.log('\nWould keep phase 1 as new');
      console.log(`Would UPDATE classstudent_id ${PHASE2_REJOIN_ROW_ID}: rejoin → re_enrolled`);
      console.log('Would INSERT phase 3 re_enrolled from payment 693');
      console.log(`Would UPDATE classstudent_id ${PHASE4_REJOIN_ROW_ID}: rejoin → re_enrolled`);
      return;
    }

    await client.query('BEGIN');

    await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = 're_enrolled',
           enrolled_by = $1,
           enrolled_at = $2
       WHERE classstudent_id = $3`,
      [
        'System (Repair — phase 2 re_enrolled, INV-806 payment)',
        pay2.rows[0].created_at,
        PHASE2_REJOIN_ROW_ID,
      ]
    );

    if (phase3Existing.rows.length === 0) {
      await client.query(
        `INSERT INTO classstudentstbl
           (student_id, class_id, enrolled_by, phase_number, program_enrollment_status, enrolled_at)
         VALUES ($1, $2, $3, 3, 're_enrolled', $4)`,
        [
          STUDENT_ID,
          CLASS_ID,
          'System (Repair — phase 3 re_enrolled, INV-1206 payment)',
          pay3.rows[0].created_at,
        ]
      );
    } else {
      await client.query(
        `UPDATE classstudentstbl
         SET program_enrollment_status = 're_enrolled',
             enrolled_by = $1,
             enrolled_at = $2
         WHERE classstudent_id = $3`,
        [
          'System (Repair — phase 3 re_enrolled, INV-1206 payment)',
          pay3.rows[0].created_at,
          phase3Existing.rows[0].classstudent_id,
        ]
      );
    }

    await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = 're_enrolled',
           enrolled_by = $1,
           enrolled_at = $2
       WHERE classstudent_id = $3`,
      [
        'System (Repair — phase 4 re_enrolled, INV-1401 payment)',
        pay4.rows[0].created_at,
        PHASE4_REJOIN_ROW_ID,
      ]
    );

    await client.query('COMMIT');

    const after = await client.query(
      `SELECT classstudent_id, phase_number, program_enrollment_status, removed_at
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2 AND removed_at IS NULL
       ORDER BY phase_number`,
      [STUDENT_ID, CLASS_ID]
    );
    console.log('\n✅ Repaired. Active enrollment rows:');
    for (const r of after.rows) console.log(r);
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
