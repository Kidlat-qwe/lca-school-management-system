/**
 * Repair Andrei Caleb Ethan V. Atienza enrollment statuses:
 *   Phase 6 — new
 *   Phase 7 — dropped
 *   Phase 8 — rejoin (first active after drop)
 *   Phase 9+ — re_enrolled
 *
 * Also removes orphan Phase 2 row below package phase_start (6).
 *
 * Run:  node scripts/repairAndreiAtienzaEnrollment.js --dry-run
 * Apply: node scripts/repairAndreiAtienzaEnrollment.js --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';
import { determineRejoinAwarePhaseStatus } from '../utils/enrollmentStatus.js';
import { resolveProfilePhaseStart } from '../utils/phaseInstallmentUtils.js';

const STUDENT_ID = 247;
const CLASS_ID = 58;
const PHASE_8_CLASSSTUDENT_ID = 1094;
const ORPHAN_PHASE2_CLASSSTUDENT_ID = 740;

const isDryRun = !process.argv.includes('--apply');

async function main() {
  console.log(`\nRepair Andrei Atienza enrollment${isDryRun ? ' (DRY RUN)' : ' (APPLY)'}\n`);

  const client = await getClient();
  try {
    const profileRes = await client.query(
      `SELECT phase_start FROM installmentinvoiceprofilestbl
       WHERE student_id = $1 AND class_id = $2 ORDER BY installmentinvoiceprofiles_id DESC LIMIT 1`,
      [STUDENT_ID, CLASS_ID]
    );
    const phaseStart = resolveProfilePhaseStart(profileRes.rows[0] || {});

    const rowsRes = await client.query(
      `SELECT classstudent_id, phase_number, program_enrollment_status, removed_at
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2
       ORDER BY phase_number, classstudent_id`,
      [STUDENT_ID, CLASS_ID]
    );

    console.log('Current rows:');
    for (const r of rowsRes.rows) {
      console.log(`  P${r.phase_number} cs=${r.classstudent_id} ${r.program_enrollment_status}`);
    }

    const phase8Status = await determineRejoinAwarePhaseStatus({
      db: client,
      studentId: STUDENT_ID,
      classId: CLASS_ID,
      phaseNumber: 8,
      defaultStatus: 're_enrolled',
    });

    console.log(`\nPhase 8 resolved status: ${phase8Status} (expected: rejoin)`);
    if (phase8Status !== 'rejoin') {
      throw new Error(`determineRejoinAwarePhaseStatus returned ${phase8Status}, expected rejoin`);
    }

    if (isDryRun) {
      console.log('\nWould:');
      console.log(`  UPDATE cs ${PHASE_8_CLASSSTUDENT_ID} phase 8 -> rejoin`);
      console.log(`  DELETE cs ${ORPHAN_PHASE2_CLASSSTUDENT_ID} orphan phase 2`);
      const matrix = await loadStudentMonthEnrollmentMatrix(client.query.bind(client), { year: 2026 });
      const track = (matrix.students || []).find(
        (s) => s.student_id === STUDENT_ID && s.class_id === CLASS_ID
      );
      console.log('\nCurrent matrix:');
      for (const m of matrix.months || []) {
        const cell = track?.months?.[m.key];
        if (cell?.mark === '1' || cell?.label) {
          console.log(`  ${m.key}: ${cell.label} [${cell.status}]`);
        }
      }
      return;
    }

    await client.query('BEGIN');

    await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = 'rejoin',
           enrolled_by = $1
       WHERE classstudent_id = $2`,
      [
        'System (Repair — first active phase after delinquency drop)',
        PHASE_8_CLASSSTUDENT_ID,
      ]
    );

    await client.query(`DELETE FROM classstudentstbl WHERE classstudent_id = $1`, [
      ORPHAN_PHASE2_CLASSSTUDENT_ID,
    ]);

    await client.query('COMMIT');
    console.log('\n✅ Phase 8 -> rejoin');
    console.log('✅ Deleted orphan phase 2 row');

    const matrix = await loadStudentMonthEnrollmentMatrix(client.query.bind(client), { year: 2026 });
    const track = (matrix.students || []).find(
      (s) => s.student_id === STUDENT_ID && s.class_id === CLASS_ID
    );
    console.log('\nMatrix after repair:');
    for (const m of matrix.months || []) {
      const cell = track?.months?.[m.key];
      if (cell?.mark === '1' || cell?.label) {
        console.log(`  ${m.key}: ${cell.label} [${cell.status}]`);
      }
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
