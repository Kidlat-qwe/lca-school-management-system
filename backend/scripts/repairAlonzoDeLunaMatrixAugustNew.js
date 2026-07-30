/**
 * Alonzo Xavier De Luna — month re-enrollment matrix: move "new" to August.
 *
 * Class: 50 SOMO_Playgroup_SS_11:00-12:00PM | Profile: 495 | Branch: Vista Mall Cavite (3)
 * Email: larainerabago@gmail.com · user_id 669
 *
 * Invoice Enrollment: Phase 6 **new** (late-start installment, phase_start 6).
 * Matrix was showing July new / August Inactive|Active because phase 6
 * enrolled_at was 2026-07-26.
 *
 * Expected matrix after repair:
 *   Aug new → Sep Active
 *
 * Usage (from backend/):
 *   node scripts/repairAlonzoDeLunaMatrixAugustNew.js
 *   node scripts/repairAlonzoDeLunaMatrixAugustNew.js --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';

const STUDENT_ID = 669;
const STUDENT_EMAIL = 'larainerabago@gmail.com';
const CLASS_ID = 50;
const BRANCH_ID = 3;
const PROFILE_ID = 495;
const PHASE6_CLASSSTUDENT_ID = 1936;

const AUG_ENROLLED_AT = '2026-08-25 12:00:00+08';
const FIRST_BILLING_MONTH = '2026-08-01';

const REPAIR_NOTE =
  'Ops repair — Alonzo De Luna matrix new month August (phase 6 late-start)';

const isApply = process.argv.includes('--apply');

const EXPECTED = [
  ['2026-08', 'new'],
  ['2026-09', 'Active'],
];

function serialQuery(client) {
  let chain = Promise.resolve();
  return (text, params) => {
    const run = () => client.query(text, params);
    const p = chain.then(run, run);
    chain = p.then(
      () => undefined,
      () => undefined
    );
    return p;
  };
}

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

function assertExpected(cells) {
  const byMonth = Object.fromEntries(cells.map((c) => [c.month, c]));
  const problems = [];
  for (const [month, label] of EXPECTED) {
    const cell = byMonth[month];
    if (!cell || cell.label !== label) {
      problems.push(
        `${month}: expected ${label}, got ${cell ? `${cell.label} (phase ${cell.phase})` : 'missing'}`
      );
    }
  }
  // July should no longer show new
  if (byMonth['2026-07']?.label === 'new') {
    problems.push('2026-07: still shows new (expected blank / not new)');
  }
  return problems;
}

async function main() {
  console.log(
    `\nAlonzo De Luna — matrix August new${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`Note: ${REPAIR_NOTE}\n`);

  const client = await getClient();
  const q = serialQuery(client);

  try {
    const student = (
      await q(
        `SELECT user_id, full_name, email FROM userstbl WHERE user_id = $1`,
        [STUDENT_ID]
      )
    ).rows[0];
    if (!student || String(student.email || '').toLowerCase() !== STUDENT_EMAIL) {
      throw new Error(`Expected ${STUDENT_EMAIL} (user_id ${STUDENT_ID})`);
    }

    const beforeCs = (
      await q(
        `SELECT classstudent_id, phase_number, program_enrollment_status,
                TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD HH24:MI') AS enrolled,
                TO_CHAR(TIMEZONE('Asia/Manila', removed_at), 'YYYY-MM-DD') AS removed
         FROM classstudentstbl
         WHERE student_id = $1 AND class_id = $2
         ORDER BY phase_number, classstudent_id`,
        [STUDENT_ID, CLASS_ID]
      )
    ).rows;

    const profile = (
      await q(
        `SELECT installmentinvoiceprofiles_id, is_active, phase_start, generated_count,
                TO_CHAR(first_billing_month, 'YYYY-MM-DD') AS first_billing_month
         FROM installmentinvoiceprofilestbl
         WHERE installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      )
    ).rows[0];
    if (!profile) throw new Error(`Profile ${PROFILE_ID} not found`);

    console.log(`Student: ${student.full_name} <${student.email}>`);
    console.log(`Class ${CLASS_ID} | Profile ${PROFILE_ID} | Branch ${BRANCH_ID}`);
    console.log('\nBEFORE classstudents:');
    console.table(beforeCs);
    console.log('BEFORE profile:', profile);
    console.log('\nBEFORE month matrix:');
    console.table(await previewMatrix(query));

    console.log('\nPlanned changes:');
    console.log(
      `  • classstudent ${PHASE6_CLASSSTUDENT_ID} enrolled_at → 2026-08-25 (phase 6 new)`
    );
    console.log(
      `  • profile ${PROFILE_ID} first_billing_month → 2026-08-01`
    );
    console.log('\nExpected AFTER:');
    console.table(EXPECTED.map(([month, label]) => ({ month, label })));

    await client.query('BEGIN');

    await q(
      `UPDATE classstudentstbl
       SET enrolled_at = $1::timestamptz,
           enrolled_by = COALESCE(enrolled_by, '') || ' | ' || $2
       WHERE classstudent_id = $3
         AND student_id = $4
         AND class_id = $5
         AND phase_number = 6`,
      [AUG_ENROLLED_AT, REPAIR_NOTE, PHASE6_CLASSSTUDENT_ID, STUDENT_ID, CLASS_ID]
    );

    await q(
      `UPDATE installmentinvoiceprofilestbl
       SET first_billing_month = $1::date
       WHERE installmentinvoiceprofiles_id = $2
         AND student_id = $3`,
      [FIRST_BILLING_MONTH, PROFILE_ID, STUDENT_ID]
    );

    const afterCs = (
      await q(
        `SELECT classstudent_id, phase_number, program_enrollment_status,
                TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD HH24:MI') AS enrolled
         FROM classstudentstbl
         WHERE student_id = $1 AND class_id = $2
         ORDER BY phase_number, classstudent_id`,
        [STUDENT_ID, CLASS_ID]
      )
    ).rows;
    console.log('\nAFTER classstudents (in transaction):');
    console.table(afterCs);

    const afterMatrix = await previewMatrix(q);
    console.log('\nAFTER month matrix (in transaction):');
    console.table(afterMatrix);

    const problems = assertExpected(afterMatrix);
    if (problems.length) {
      await client.query('ROLLBACK');
      console.error('\nMatrix preview did not match expected:');
      for (const p of problems) console.error('  -', p);
      process.exitCode = 1;
      return;
    }

    if (!isApply) {
      await client.query('ROLLBACK');
      console.log('\nDRY RUN OK — re-run with --apply to persist.');
      return;
    }

    await client.query('COMMIT');
    console.log('\n✅ Applied Alonzo De Luna August new matrix alignment.');
    console.log('\nMatrix AFTER commit:');
    console.table(await previewMatrix(query));
    console.log('Refresh Month Re-enrollment page.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error('Repair failed:', err?.message || err);
  process.exit(1);
});
