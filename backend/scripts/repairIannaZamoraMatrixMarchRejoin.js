/**
 * Ianna Ysabell D. Zamora (student 352) — month re-enrollment matrix alignment.
 *
 * Issues:
 *   - Phase 1 "new" appears in April; class starts March 3 and first generation is March 25.
 *   - Phase 2 incorrectly stored as "new" (should be re_enrolled).
 *   - Phase 5 after delinquency drops stored as re_enrolled (should be rejoin).
 *
 * Class: 53 VMP_NURSERY_TThS_11:00 AM | Profile: 149 | Branch: LCA Pampanga
 *
 * Expected matrix after repair:
 *   Mar new → Apr re-enrolled → May/Jun dropped → Jul rejoin → Aug Active
 *
 * Run:
 *   node backend/scripts/repairIannaZamoraMatrixMarchRejoin.js
 *   node backend/scripts/repairIannaZamoraMatrixMarchRejoin.js --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';
import { determineRejoinAwarePhaseStatus } from '../utils/enrollmentStatus.js';

const STUDENT_ID = 352;
const CLASS_ID = 53;
const BRANCH_ID = 6;
const PROFILE_ID = 149;
const PHASE1_CLASSSTUDENT_ID = 326;
const PHASE2_CLASSSTUDENT_ID = 625;
const PHASE5_CLASSSTUDENT_ID = 1514;
const MARCH_ENROLLED_AT = '2026-03-25T00:00:00+08:00';
const FIRST_BILLING_MONTH = '2026-03-01T00:00:00+08:00';
const REPAIR_NOTE = 'Ops repair — matrix new month March + phase 5 rejoin after drop';

const isApply = process.argv.includes('--apply');

async function previewMatrix(queryFn) {
  const matrix = await loadStudentMonthEnrollmentMatrix(queryFn, {
    year: 2026,
    branchId: BRANCH_ID,
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
    `\nIanna Zamora — matrix March new + rejoin${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );

  const client = await getClient();
  try {
    const enrollments = (
      await client.query(
        `SELECT cs.classstudent_id, cs.phase_number, cs.program_enrollment_status,
                TO_CHAR(TIMEZONE('Asia/Manila', cs.enrolled_at), 'YYYY-MM-DD HH24:MI') AS enrolled_manila,
                TO_CHAR(TIMEZONE('Asia/Manila', cs.removed_at), 'YYYY-MM-DD') AS removed_manila
         FROM classstudentstbl cs
         WHERE cs.student_id = $1 AND cs.class_id = $2
         ORDER BY cs.phase_number, cs.classstudent_id`,
        [STUDENT_ID, CLASS_ID]
      )
    ).rows;

    console.log('Current enrollments:');
    console.table(enrollments);

    console.log('\nMatrix BEFORE:');
    console.table(await previewMatrix(query));

    const rejoinStatus = await determineRejoinAwarePhaseStatus({
      db: client,
      studentId: STUDENT_ID,
      classId: CLASS_ID,
      phaseNumber: 5,
      defaultStatus: 're_enrolled',
    });
    console.log(`\ndetermineRejoinAwarePhaseStatus(phase 5): ${rejoinStatus}`);
    if (rejoinStatus !== 'rejoin') {
      throw new Error(`Expected phase 5 rejoin, got ${rejoinStatus}`);
    }

    console.log('\nPlanned changes:');
    console.log(
      `  • UPDATE classstudent ${PHASE1_CLASSSTUDENT_ID} enrolled_at → 2026-03-25 (Manila)`
    );
    console.log(
      `  • UPDATE classstudent ${PHASE2_CLASSSTUDENT_ID} program_enrollment_status new → re_enrolled`
    );
    console.log(
      `  • UPDATE classstudent ${PHASE5_CLASSSTUDENT_ID} program_enrollment_status → rejoin`
    );
    console.log(
      `  • UPDATE installment profile ${PROFILE_ID} first_billing_month → 2026-03-01`
    );
    console.log('\nExpected matrix AFTER:');
    console.table([
      { month: '2026-03', label: 'new', phase: 1 },
      { month: '2026-04', label: 're-enrolled', phase: 2 },
      { month: '2026-05', label: 'dropped', phase: 3 },
      { month: '2026-06', label: 'dropped', phase: 4 },
      { month: '2026-07', label: 'rejoin', phase: 5 },
      { month: '2026-08', label: 'Active', phase: null },
    ]);

    if (!isApply) {
      console.log('\nDRY RUN — re-run with --apply');
      return;
    }

    await client.query('BEGIN');

    await client.query(
      `UPDATE classstudentstbl
       SET enrolled_at = $1::timestamptz,
           enrolled_by = COALESCE(enrolled_by, '') || ' | ' || $2
       WHERE classstudent_id = $3`,
      [MARCH_ENROLLED_AT, REPAIR_NOTE, PHASE1_CLASSSTUDENT_ID]
    );

    await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = 're_enrolled',
           enrolled_by = COALESCE(enrolled_by, '') || ' | ' || $1
       WHERE classstudent_id = $2
         AND program_enrollment_status = 'new'`,
      [`${REPAIR_NOTE} (phase 2)`, PHASE2_CLASSSTUDENT_ID]
    );

    await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = 'rejoin',
           enrolled_by = COALESCE(enrolled_by, '') || ' | ' || $1
       WHERE classstudent_id = $2`,
      [`${REPAIR_NOTE} (phase 5)`, PHASE5_CLASSSTUDENT_ID]
    );

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET first_billing_month = $1::timestamptz
       WHERE installmentinvoiceprofiles_id = $2`,
      [FIRST_BILLING_MONTH, PROFILE_ID]
    );

    await client.query('COMMIT');
    console.log('\n✅ Applied Ianna Zamora matrix alignment.');

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
