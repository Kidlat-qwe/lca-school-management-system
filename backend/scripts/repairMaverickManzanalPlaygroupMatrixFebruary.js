/**
 * Maverick Raziel Viola Manzanal (student 171) — Plan 1 Playgroup matrix alignment.
 *
 * Class: NC_Playgroup_TTh_9:30-10:30PM (57) | Profile: 94 | Branch: LCA Guiguinto
 *
 * Issues:
 *   - Phase 2 "new" appears in March; Plan 1 started February (INV-268 issue 2026-02-02).
 *   - first_billing_month was April; should be February.
 *   - Paid-overlay no longer paints Phase 3 as re-enrolled over dropped
 *     (code fix in enrollmentRateMetrics.js).
 *
 * Invoice Enrollment (Plan 1):
 *   P2 new → P3–P6 dropped → P7 rejoin
 *
 * Expected matrix after repair:
 *   Feb new → Mar–Jun dropped → Jul rejoin → Aug Active
 *
 * Run:
 *   node backend/scripts/repairMaverickManzanalPlaygroupMatrixFebruary.js
 *   node backend/scripts/repairMaverickManzanalPlaygroupMatrixFebruary.js --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';

const STUDENT_ID = 171;
const CLASS_ID = 57;
const BRANCH_ID = 5;
const PROFILE_ID = 94;
const PHASE2_CLASSSTUDENT_ID = 221;
const FEB_ENROLLED_AT = '2026-02-02T00:00:00+08:00';
const FIRST_BILLING_MONTH = '2026-02-01T00:00:00+08:00';
const REPAIR_NOTE =
  'Ops repair 2026-07-13 — Maverick Plan 1 Playgroup matrix new month February';

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

function assertExpected(cells) {
  const byMonth = Object.fromEntries(cells.map((c) => [c.month, c]));
  const expect = [
    ['2026-02', 'new'],
    ['2026-03', 'dropped'],
    ['2026-04', 'dropped'],
    ['2026-05', 'dropped'],
    ['2026-06', 'dropped'],
    ['2026-07', 'rejoin'],
    ['2026-08', 'Active'],
  ];
  const problems = [];
  for (const [month, label] of expect) {
    const cell = byMonth[month];
    if (!cell || cell.label !== label) {
      problems.push(
        `${month}: expected ${label}, got ${cell ? `${cell.label} (phase ${cell.phase})` : 'missing'}`
      );
    }
  }
  return problems;
}

async function main() {
  console.log(
    `\nMaverick Manzanal — Plan 1 Playgroup matrix February${
      isApply ? ' (APPLY)' : ' (DRY RUN)'
    }\n`
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

    const profile = (
      await client.query(
        `SELECT installmentinvoiceprofiles_id, phase_start, first_billing_month::text AS first_billing_month
         FROM installmentinvoiceprofilestbl
         WHERE installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      )
    ).rows[0];
    console.log('Profile:', profile);

    console.log('\nMatrix BEFORE:');
    console.table(await previewMatrix(query));

    console.log('\nPlanned changes:');
    console.log(
      `  • UPDATE classstudent ${PHASE2_CLASSSTUDENT_ID} enrolled_at → 2026-02-02 (phase 2 new)`
    );
    console.log(
      `  • UPDATE installment profile ${PROFILE_ID} first_billing_month → 2026-02-01`
    );
    console.log('\nExpected matrix AFTER:');
    console.table([
      { month: '2026-02', label: 'new', phase: 2 },
      { month: '2026-03', label: 'dropped', phase: 3 },
      { month: '2026-04', label: 'dropped', phase: 4 },
      { month: '2026-05', label: 'dropped', phase: 5 },
      { month: '2026-06', label: 'dropped', phase: 6 },
      { month: '2026-07', label: 'rejoin', phase: 7 },
      { month: '2026-08', label: 'Active', phase: null },
    ]);

    if (!isApply) {
      await client.query('BEGIN');
      await client.query(
        `UPDATE classstudentstbl
         SET enrolled_at = $1::timestamptz,
             enrolled_by = COALESCE(enrolled_by, '') || ' | ' || $2
         WHERE classstudent_id = $3`,
        [FEB_ENROLLED_AT, REPAIR_NOTE, PHASE2_CLASSSTUDENT_ID]
      );
      await client.query(
        `UPDATE installmentinvoiceprofilestbl
         SET first_billing_month = $1::timestamptz
         WHERE installmentinvoiceprofiles_id = $2`,
        [FIRST_BILLING_MONTH, PROFILE_ID]
      );
      const after = await previewMatrix(client.query.bind(client));
      console.log('\nMatrix AFTER (transaction preview — will rollback):');
      console.table(after);
      const problems = assertExpected(after);
      await client.query('ROLLBACK');
      if (problems.length) {
        console.error('\nPreview did not match expected:');
        for (const p of problems) console.error('  -', p);
        process.exitCode = 1;
        return;
      }
      console.log('\nDRY RUN OK — re-run with --apply to persist');
      return;
    }

    await client.query('BEGIN');
    await client.query(
      `UPDATE classstudentstbl
       SET enrolled_at = $1::timestamptz,
           enrolled_by = COALESCE(enrolled_by, '') || ' | ' || $2
       WHERE classstudent_id = $3`,
      [FEB_ENROLLED_AT, REPAIR_NOTE, PHASE2_CLASSSTUDENT_ID]
    );
    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET first_billing_month = $1::timestamptz
       WHERE installmentinvoiceprofiles_id = $2`,
      [FIRST_BILLING_MONTH, PROFILE_ID]
    );
    await client.query('COMMIT');
    console.log('\n✅ Applied Maverick Plan 1 Playgroup matrix alignment.');

    const after = await previewMatrix(query);
    console.log('\nMatrix AFTER:');
    console.table(after);
    const problems = assertExpected(after);
    if (problems.length) {
      console.error('\nApplied but matrix did not match expected:');
      for (const p of problems) console.error('  -', p);
      process.exitCode = 1;
    }
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
