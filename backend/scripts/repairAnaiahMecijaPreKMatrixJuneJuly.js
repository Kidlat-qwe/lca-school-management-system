/**
 * Anaiah Cali Tan Mecija (student 249) — Pre-K upsell matrix month alignment.
 *
 * Class: NC_Pre-Kinder_MWF_9:30AM (128) | Profile: 420 | Branch: LCA Guiguinto
 *
 * Issues:
 *   - first_billing_month was May; Pre-K class starts June 3 and phase 1 enrolled June 8.
 *   - Upsell merge on Nursery row painted May upsell / June re-enrolled (code fixed in
 *     enrollmentRateMetrics.js — display start uses later of handoff+1 vs higher first month).
 *
 * Expected matrix (Nursery anchor row):
 *   Apr completed → May - → Jun upsell → Jul re-enrolled → Aug Active
 *
 * Run:
 *   node backend/scripts/repairAnaiahMecijaPreKMatrixJuneJuly.js
 *   node backend/scripts/repairAnaiahMecijaPreKMatrixJuneJuly.js --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';

const STUDENT_ID = 249;
const ANCHOR_CLASS_ID = 79;
const BILLING_CLASS_ID = 128;
const BRANCH_ID = 5;
const PROFILE_ID = 420;
const FIRST_BILLING_MONTH = '2026-06-01T00:00:00+08:00';
const REPAIR_NOTE =
  'Ops repair 2026-07-13 — Anaiah Pre-K first_billing_month aligned to June class start';

const isApply = process.argv.includes('--apply');

async function previewMatrix(queryFn) {
  const matrix = await loadStudentMonthEnrollmentMatrix(queryFn, {
    year: 2026,
    branchId: BRANCH_ID,
  });
  const track = (matrix.students || []).find(
    (s) =>
      s.student_id === STUDENT_ID &&
      !s.hide_from_matrix &&
      (s.class_id === ANCHOR_CLASS_ID || s.matrix_merged_upsell_anchor)
  );
  if (!track) return [];
  const cells = [];
  for (const m of matrix.months || []) {
    const c = track.months?.[m.key];
    if (!c) continue;
    if (c.mark === '1' || c.mark === '✓' || c.label) {
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
    ['2026-04', 'completed'],
    ['2026-06', 'upsell'],
    ['2026-07', 're-enrolled'],
  ];
  const problems = [];
  for (const [month, label] of expect) {
    const cell = byMonth[month];
    if (!cell || cell.label !== label) {
      problems.push(`${month}: expected ${label}, got ${cell?.label ?? '(empty)'}`);
    }
  }
  if (byMonth['2026-05']) {
    problems.push('2026-05: expected empty, got ' + byMonth['2026-05'].label);
  }
  return problems;
}

async function main() {
  console.log(
    `\nAnaiah Mecija — Pre-K matrix alignment${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );

  const client = await getClient();

  try {
    const student = (
      await client.query(
        `SELECT user_id, full_name, email FROM userstbl WHERE user_id = $1`,
        [STUDENT_ID]
      )
    ).rows[0];
    if (!student) throw new Error(`Student ${STUDENT_ID} not found`);

    const profile = (
      await client.query(
        `SELECT installmentinvoiceprofiles_id, class_id,
                TO_CHAR(first_billing_month, 'YYYY-MM-DD') AS first_billing_month
         FROM installmentinvoiceprofilestbl
         WHERE installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      )
    ).rows[0];
    if (!profile) throw new Error(`Profile ${PROFILE_ID} not found`);

    console.log(`Student: ${student.full_name} (${student.email})`);
    console.log(`Profile ${PROFILE_ID} first_billing_month: ${profile.first_billing_month}`);

    console.log('\nMatrix BEFORE:');
    const before = await previewMatrix(query);
    console.table(before);

    console.log('\nPlanned changes:');
    console.log(
      `  • UPDATE profile ${PROFILE_ID}: first_billing_month → ${FIRST_BILLING_MONTH}`
    );

    console.log('\nExpected matrix AFTER:');
    console.table([
      { month: '2026-04', label: 'completed' },
      { month: '2026-05', label: '(empty)' },
      { month: '2026-06', label: 'upsell' },
      { month: '2026-07', label: 're-enrolled' },
      { month: '2026-08', label: 'Active' },
    ]);

    if (!isApply) {
      console.log('\nRe-run with --apply to update profile first_billing_month.');
      const problems = assertExpected(before);
      if (problems.length) {
        console.log('\nNote (code fix required): matrix may still differ until backend reloads enrollmentRateMetrics.js');
        console.log(problems.join('\n'));
      }
      return;
    }

    await client.query('BEGIN');
    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET first_billing_month = $1::timestamptz
       WHERE installmentinvoiceprofiles_id = $2`,
      [FIRST_BILLING_MONTH, PROFILE_ID]
    );
    await client.query('COMMIT');
    console.log('\n✅ Applied first_billing_month update.');

    console.log('\nMatrix AFTER:');
    const after = await previewMatrix(query);
    console.table(after);

    const problems = assertExpected(after);
    if (problems.length) {
      console.warn('\n⚠️ Post-apply checks:', problems.join('; '));
    } else {
      console.log('\n✅ Matrix matches expected Apr completed / May empty / Jun upsell / Jul re-enrolled.');
    }
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
    console.error(err);
    process.exit(1);
  });
