/**
 * Xahari Vries Miranda — remove orphan Phase 2 enrollment below phase_start.
 *
 * Student: 475 · vinnierica.tapang@gmail.com
 * Class: 57 NC_Playgroup_TTh_9:30-10:30PM · Profile: 248 (phase_start=4)
 *
 * Orphan classstudent 796 (phase 2) skewed Active/Inactive billing anchor so
 * unpaid Phase 8 (due 2026-08-05) never mapped to August — matrix stayed Active
 * while invoice showed Under grace period.
 *
 * Engine fix (enrollmentRateMetrics lifecycle anchor respects phase_start) already
 * corrects August → Inactive. This script cleans the orphan row.
 *
 * Run:
 *   node backend/scripts/repairXahariMirandaOrphanPhase2.js --production
 *   node backend/scripts/repairXahariMirandaOrphanPhase2.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';
import { todayYmdManila } from '../utils/dateUtils.js';

const STUDENT_ID = 475;
const STUDENT_EMAIL = 'vinnierica.tapang@gmail.com';
const CLASS_ID = 57;
const BRANCH_ID = 5;
const PROFILE_ID = 248;
const PHASE2_CLASSSTUDENT_ID = 796;
const PHASE8_INVOICE_ID = 2327;

const REPAIR_NOTE =
  'Ops repair 2026-08-07 — Xahari Miranda delete orphan phase 2 below phase_start 4 (matrix Active under grace)';

const isApply = process.argv.includes('--apply');

async function previewMatrix(queryFn) {
  const matrix = await loadStudentMonthEnrollmentMatrix(queryFn, {
    year: 2026,
    branchId: BRANCH_ID,
    classId: CLASS_ID,
  });
  const track = (matrix.students || []).find(
    (s) => Number(s.student_id) === STUDENT_ID && Number(s.class_id) === CLASS_ID
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
        due: c.invoice_due_date || null,
      });
    }
  }
  return cells;
}

async function main() {
  console.log(
    `\nXahari Miranda — orphan Phase 2 cleanup${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`DB: ${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV}`);
  console.log(`Today Manila: ${todayYmdManila()}`);
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
    if (!student) throw new Error(`Student ${STUDENT_ID} / ${STUDENT_EMAIL} not found`);
    console.log('Student:', student.full_name, student.email);

    const profile = (
      await client.query(
        `SELECT installmentinvoiceprofiles_id, phase_start, total_phases, generated_count
         FROM installmentinvoiceprofilestbl
         WHERE installmentinvoiceprofiles_id = $1 AND student_id = $2`,
        [PROFILE_ID, STUDENT_ID]
      )
    ).rows[0];
    if (!profile || Number(profile.phase_start) !== 4) {
      throw new Error(`Expected profile ${PROFILE_ID} phase_start=4, got ${JSON.stringify(profile)}`);
    }

    const phase2 = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status,
                TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD') AS enrolled
         FROM classstudentstbl
         WHERE classstudent_id = $1 AND student_id = $2 AND class_id = $3`,
        [PHASE2_CLASSSTUDENT_ID, STUDENT_ID, CLASS_ID]
      )
    ).rows[0];

    const phase8 = (
      await client.query(
        `SELECT invoice_id, status,
                TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due,
                SUBSTRING(remarks FROM 'TARGET_PHASE:([0-9]+)') AS phase
         FROM invoicestbl
         WHERE invoice_id = $1`,
        [PHASE8_INVOICE_ID]
      )
    ).rows[0];

    console.log('\nBEFORE profile:', profile);
    console.log('BEFORE phase 2 enrollment:', phase2 || '(already gone)');
    console.log('BEFORE Phase 8 invoice:', phase8);
    console.log('BEFORE matrix:');
    console.table(await previewMatrix(query));

    const aug = (await previewMatrix(query)).find((c) => c.month === '2026-08');
    console.log('\nEngine status with current code:');
    console.log(
      `  August cell: ${aug ? `${aug.label} (due ${aug.due || '—'})` : 'missing'}`
    );
    console.log(
      '  (lifecycle now ignores enrollments below phase_start — Aug should be Inactive when Phase 8 is past due)'
    );

    console.log('\nPlanned:');
    if (phase2 && Number(phase2.phase_number) === 2) {
      console.log(
        `  1. DELETE orphan classstudent ${PHASE2_CLASSSTUDENT_ID} (phase 2 below phase_start 4)`
      );
    } else {
      console.log('  1. Phase 2 orphan already absent');
    }
    console.log('  2. Expect matrix Aug Inactive (Phase 8 due 2026-08-05 past today)');

    if (!phase2) {
      console.log('\nNo enrollment cleanup needed. Refresh Re-enrollment matrix after deploy of engine fix.');
      return;
    }

    if (!isApply) {
      console.log('\nDry run only. Re-run with --apply to commit.');
      return;
    }

    await client.query('BEGIN');
    await client.query(
      `DELETE FROM classstudentstbl
       WHERE classstudent_id = $1
         AND student_id = $2
         AND class_id = $3
         AND phase_number = 2`,
      [PHASE2_CLASSSTUDENT_ID, STUDENT_ID, CLASS_ID]
    );
    console.log(`✅ Deleted classstudent ${PHASE2_CLASSSTUDENT_ID}`);
    await client.query('COMMIT');

    const after = await previewMatrix(query);
    console.log('\nAFTER matrix:');
    console.table(after);
    const afterAug = after.find((c) => c.month === '2026-08');
    if (!afterAug || afterAug.label !== 'Inactive') {
      console.warn(`\n⚠ Expected Aug Inactive, got ${JSON.stringify(afterAug)}`);
    } else {
      console.log('\n✅ August Inactive.');
    }
    console.log('\nRefresh Re-enrollment month matrix.');
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
