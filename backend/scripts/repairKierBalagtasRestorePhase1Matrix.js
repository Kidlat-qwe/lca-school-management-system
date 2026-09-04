/**
 * Repair Kier Balagtas (it.kier@little-champion.com) — restore Phase 1 enrollment
 * so Report → Student Status (Sep 2026) counts Active.
 *
 * Cause: classstudent_id 803 (Phase 1 `new`) has removed_at from a test unenroll
 * ("asdasd"). Matrix clears that Sept cell; Phase 2 `re_enrolled` bills to Oct.
 *
 * Run (from backend/):
 *   node scripts/repairKierBalagtasRestorePhase1Matrix.js
 *   node scripts/repairKierBalagtasRestorePhase1Matrix.js --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import {
  isMonthMatrixCellActiveForOperationalDashboard,
  loadStudentMonthEnrollmentMatrix,
} from '../lib/enrollmentRateMetrics.js';

const STUDENT_ID = 38;
const EMAIL = 'it.kier@little-champion.com';
const CLASS_ID = 56;
const PHASE1_CS_ID = 803;
const MONTH = '2026-09';

const args = new Set(process.argv.slice(2));
const isApply = args.has('--apply');

async function dumpMatrix(queryFn, branchId) {
  const matrix = await loadStudentMonthEnrollmentMatrix(queryFn, {
    year: 2026,
    branchId,
  });
  const tracks = (matrix.students || []).filter((s) => Number(s.student_id) === STUDENT_ID);
  for (const track of tracks) {
    const cells = [];
    for (const m of matrix.months || []) {
      const c = track.months?.[m.key];
      if (!c) continue;
      if (c.mark === '1' || c.mark === '✓' || c.mark === 'X' || c.label || c.status) {
        cells.push({
          month: m.key,
          label: c.label || '',
          status: c.status || '',
          mark: c.mark || '',
          phase: c.phase_number ?? '',
          cleared: Boolean(c.cleared_after_removal),
          counts_active: isMonthMatrixCellActiveForOperationalDashboard(c, track, m.key),
        });
      }
    }
    console.table(cells);
  }
}

async function main() {
  console.log(
    `\nKier Balagtas — restore Phase 1 for Sept matrix${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );

  const client = await getClient();
  const queryFn = (text, params) => client.query(text, params);

  try {
    const user = (
      await client.query(
        `SELECT user_id, full_name, email, branch_id FROM userstbl WHERE user_id = $1`,
        [STUDENT_ID]
      )
    ).rows[0];
    if (!user || user.email?.toLowerCase() !== EMAIL.toLowerCase()) {
      throw new Error('Student mismatch');
    }

    const row = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status,
                removed_at, removed_reason, removed_by,
                TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD') AS enrolled_ymd
         FROM classstudentstbl
         WHERE classstudent_id = $1`,
        [PHASE1_CS_ID]
      )
    ).rows[0];

    if (!row) throw new Error(`classstudent ${PHASE1_CS_ID} not found`);
    if (Number(row.phase_number) !== 1) throw new Error('Expected phase 1');
    if (row.program_enrollment_status !== 'new') {
      throw new Error(`Expected status new, got ${row.program_enrollment_status}`);
    }

    console.log('BEFORE Phase 1 row:');
    console.table([row]);
    console.log('\nBEFORE matrix:');
    await dumpMatrix(queryFn, user.branch_id);

    if (!row.removed_at) {
      console.log('\nPhase 1 already has removed_at NULL — nothing to repair.');
      return;
    }

    console.log('\nPlanned: clear removed_at / removed_reason / removed_by on Phase 1 (803).');

    if (!isApply) {
      console.log('Dry run only. Re-run with --apply to commit.');
      return;
    }

    await client.query('BEGIN');
    await client.query(
      `UPDATE classstudentstbl
       SET removed_at = NULL,
           removed_reason = NULL,
           removed_by = NULL
       WHERE classstudent_id = $1
         AND student_id = $2
         AND class_id = $3`,
      [PHASE1_CS_ID, STUDENT_ID, CLASS_ID]
    );
    await client.query('COMMIT');
    console.log('✅ Phase 1 removed_at cleared.');

    const after = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status,
                removed_at, removed_reason
         FROM classstudentstbl WHERE classstudent_id = $1`,
        [PHASE1_CS_ID]
      )
    ).rows[0];
    console.log('\nAFTER Phase 1 row:');
    console.table([after]);
    console.log('\nAFTER matrix:');
    await dumpMatrix(queryFn, user.branch_id);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nFailed:', err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  });
