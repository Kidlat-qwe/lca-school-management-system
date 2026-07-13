/**
 * Isaac Brylle T. Gauna (student 118) — Nursery matrix cell alignment (class 56).
 *
 * Issues:
 *   - Phase 1 "new" appears in March; first billing / class start is February.
 *   - Phase 4 after delinquency drop should be "rejoin", not re_enrolled.
 *
 * Class: NC_Nursery_MWF_11:00-12:00PM (56) | Profile: 83 | Branch: LCA Guiguinto
 *
 * Expected matrix after repair:
 *   Feb new → Mar/Apr/May re-enrolled → Jun rejoin → Jul dropped → Aug Inactive
 *
 * Run:
 *   node backend/scripts/repairIsaacGaunaNurseryMatrixFebruary.js
 *   node backend/scripts/repairIsaacGaunaNurseryMatrixFebruary.js --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';
import { determineRejoinAwarePhaseStatus } from '../utils/enrollmentStatus.js';

const STUDENT_ID = 118;
const CLASS_ID = 56;
const PROFILE_ID = 83;
const PHASE1_CLASSSTUDENT_ID = 219;
const PHASE4_CLASSSTUDENT_ID = 852;
const FEB_CLASS_START_AT = '2026-02-04T00:00:00+08:00';
const FIRST_BILLING_MONTH = '2026-02-01T00:00:00+08:00';
const REPAIR_NOTE = 'Ops repair — matrix new month February + phase 4 rejoin after drop';

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
    `\nIsaac Gauna — Nursery matrix February new${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
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
      phaseNumber: 4,
      defaultStatus: 're_enrolled',
    });
    console.log(`\ndetermineRejoinAwarePhaseStatus(phase 4): ${rejoinStatus}`);
    if (rejoinStatus !== 'rejoin') {
      throw new Error(`Expected phase 4 rejoin, got ${rejoinStatus}`);
    }

    console.log('\nPlanned changes:');
    console.log(
      `  • UPDATE classstudent ${PHASE1_CLASSSTUDENT_ID} enrolled_at → 2026-02-04 (class start)`
    );
    console.log(
      `  • UPDATE classstudent ${PHASE4_CLASSSTUDENT_ID} program_enrollment_status → rejoin`
    );
    console.log(
      `  • UPDATE installment profile ${PROFILE_ID} first_billing_month → 2026-02-01`
    );

    if (!isApply) {
      await client.query('BEGIN');
      await client.query(
        `UPDATE classstudentstbl
         SET enrolled_at = $1::timestamptz,
             enrolled_by = COALESCE(enrolled_by, '') || ' | ' || $2
         WHERE classstudent_id = $3`,
        [FEB_CLASS_START_AT, REPAIR_NOTE, PHASE1_CLASSSTUDENT_ID]
      );
      await client.query(
        `UPDATE classstudentstbl
         SET program_enrollment_status = 'rejoin',
             enrolled_by = COALESCE(enrolled_by, '') || ' | ' || $1
         WHERE classstudent_id = $2`,
        [`${REPAIR_NOTE} (phase 4)`, PHASE4_CLASSSTUDENT_ID]
      );
      await client.query(
        `UPDATE installmentinvoiceprofilestbl
         SET first_billing_month = $1::timestamptz
         WHERE installmentinvoiceprofiles_id = $2`,
        [FIRST_BILLING_MONTH, PROFILE_ID]
      );
      console.log('\nMatrix AFTER (transaction preview — will rollback):');
      console.table(await previewMatrix(client.query.bind(client)));
      await client.query('ROLLBACK');
      console.log('\nDRY RUN — re-run with --apply to persist');
      return;
    }

    await client.query('BEGIN');

    await client.query(
      `UPDATE classstudentstbl
       SET enrolled_at = $1::timestamptz,
           enrolled_by = COALESCE(enrolled_by, '') || ' | ' || $2
       WHERE classstudent_id = $3`,
      [FEB_CLASS_START_AT, REPAIR_NOTE, PHASE1_CLASSSTUDENT_ID]
    );

    await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = 'rejoin',
           enrolled_by = COALESCE(enrolled_by, '') || ' | ' || $1
       WHERE classstudent_id = $2`,
      [`${REPAIR_NOTE} (phase 4)`, PHASE4_CLASSSTUDENT_ID]
    );

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET first_billing_month = $1::timestamptz
       WHERE installmentinvoiceprofiles_id = $2`,
      [FIRST_BILLING_MONTH, PROFILE_ID]
    );

    await client.query('COMMIT');
    console.log('\n✅ Applied Isaac Gauna Nursery matrix alignment.');

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
