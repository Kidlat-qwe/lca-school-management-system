/**
 * Morgan Atlas Milag Aquino — month re-enrollment matrix alignment.
 *
 * Class: 89 VMM_Playgroup_TTh 9:30 AM | Profile: 296 | Branch: Vista Mall Malolos (1)
 * Email: kimberlymilag@gmail.com · user_id 514
 *
 * Invoice Enrollment (Student history):
 *   P1 new → P2 re-enrolled → P3 re-enrolled → P4 dropped → P5 rejoin
 *
 * Issues:
 *   - Phase 2 stored as "new" (should be re_enrolled)
 *   - Drop/rejoin timestamps clustered on 2026-07-26 so matrix skips July dropped
 *     and paints rejoin across Jul/Aug (Active only from Sep incorrectly timed)
 *   - Month matrix should start April with "new"
 *
 * Expected matrix after repair:
 *   Apr new → May re-enrolled → Jun re-enrolled → Jul dropped → Aug rejoin → Sep Active
 *
 * Usage (from backend/):
 *   node scripts/repairMorganAquinoPlaygroupMatrix.js
 *   node scripts/repairMorganAquinoPlaygroupMatrix.js --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';

const STUDENT_ID = 514;
const STUDENT_EMAIL = 'kimberlymilag@gmail.com';
const CLASS_ID = 89;
const BRANCH_ID = 1;
const PROFILE_ID = 296;

const PHASE1_ID = 569;
const PHASE2_ID = 638;
const PHASE3_ID = 1064;
const PHASE4_ID = 1937;
const PHASE5_ID = 1938;

/** Align enrolled_at to invoice issue months; drop on phase-4 due month; rejoin on Aug billing. */
const PHASE1_ENROLLED_AT = '2026-04-25 12:00:00+08';
const PHASE2_ENROLLED_AT = '2026-05-25 12:00:00+08';
const PHASE3_ENROLLED_AT = '2026-06-03 12:00:00+08';
const DROP_AT = '2026-07-05 12:00:00+08';
const REJOIN_ENROLLED_AT = '2026-08-05 12:00:00+08';
const FIRST_BILLING_MONTH = '2026-04-01';

const DROP_REASON =
  'Ops repair — Morgan Aquino matrix: Apr new → May/Jun re-enrolled → Jul dropped → Aug rejoin';

const REPAIR_NOTE = DROP_REASON;

const isApply = process.argv.includes('--apply');

const EXPECTED = [
  ['2026-04', 'new'],
  ['2026-05', 're-enrolled'],
  ['2026-06', 're-enrolled'],
  ['2026-07', 'dropped'],
  ['2026-08', 'rejoin'],
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
  return problems;
}

async function applyUpdates(q) {
  await q(
    `UPDATE classstudentstbl
     SET program_enrollment_status = 'new',
         enrolled_at = $1::timestamptz,
         removed_at = $2::timestamptz,
         removed_reason = $3,
         removed_by = NULL,
         enrolled_by = COALESCE(enrolled_by, 'System (Auto-enrolled via installment payment)')
     WHERE classstudent_id = $4
       AND student_id = $5
       AND class_id = $6`,
    [PHASE1_ENROLLED_AT, DROP_AT, DROP_REASON, PHASE1_ID, STUDENT_ID, CLASS_ID]
  );

  await q(
    `UPDATE classstudentstbl
     SET program_enrollment_status = 're_enrolled',
         enrolled_at = $1::timestamptz,
         removed_at = $2::timestamptz,
         removed_reason = $3,
         removed_by = NULL,
         enrolled_by = COALESCE(enrolled_by, 'System (Auto-enrolled via installment payment)')
     WHERE classstudent_id = $4
       AND student_id = $5
       AND class_id = $6`,
    [PHASE2_ENROLLED_AT, DROP_AT, DROP_REASON, PHASE2_ID, STUDENT_ID, CLASS_ID]
  );

  await q(
    `UPDATE classstudentstbl
     SET program_enrollment_status = 're_enrolled',
         enrolled_at = $1::timestamptz,
         removed_at = $2::timestamptz,
         removed_reason = $3,
         removed_by = NULL,
         enrolled_by = COALESCE(enrolled_by, 'System (Auto-enrolled via installment payment)')
     WHERE classstudent_id = $4
       AND student_id = $5
       AND class_id = $6`,
    [PHASE3_ENROLLED_AT, DROP_AT, DROP_REASON, PHASE3_ID, STUDENT_ID, CLASS_ID]
  );

  await q(
    `UPDATE classstudentstbl
     SET program_enrollment_status = 'dropped',
         enrolled_at = $1::timestamptz,
         removed_at = $2::timestamptz,
         removed_reason = $3,
         removed_by = NULL,
         enrolled_by = 'System (Drop marker)'
     WHERE classstudent_id = $4
       AND student_id = $5
       AND class_id = $6`,
    [DROP_AT, DROP_AT, DROP_REASON, PHASE4_ID, STUDENT_ID, CLASS_ID]
  );

  await q(
    `UPDATE classstudentstbl
     SET program_enrollment_status = 'rejoin',
         enrolled_at = $1::timestamptz,
         removed_at = NULL,
         removed_reason = NULL,
         removed_by = NULL,
         enrolled_by = COALESCE(enrolled_by, 'System (Auto-enrolled via installment payment)') || ' | ' || $2
     WHERE classstudent_id = $3
       AND student_id = $4
       AND class_id = $5`,
    [REJOIN_ENROLLED_AT, REPAIR_NOTE, PHASE5_ID, STUDENT_ID, CLASS_ID]
  );

  await q(
    `UPDATE installmentinvoiceprofilestbl
     SET first_billing_month = $1::date,
         is_active = true
     WHERE installmentinvoiceprofiles_id = $2
       AND student_id = $3`,
    [FIRST_BILLING_MONTH, PROFILE_ID, STUDENT_ID]
  );
}

async function main() {
  console.log(
    `\nMorgan Aquino — Playgroup month matrix${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
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
                TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD') AS enrolled,
                TO_CHAR(TIMEZONE('Asia/Manila', removed_at), 'YYYY-MM-DD') AS removed
         FROM classstudentstbl
         WHERE student_id = $1 AND class_id = $2
         ORDER BY phase_number, classstudent_id`,
        [STUDENT_ID, CLASS_ID]
      )
    ).rows;

    const profile = (
      await q(
        `SELECT installmentinvoiceprofiles_id, is_active, generated_count,
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

    console.log('\nExpected AFTER:');
    console.table(EXPECTED.map(([month, label]) => ({ month, label })));

    await client.query('BEGIN');
    await applyUpdates(q);

    const afterCs = (
      await q(
        `SELECT classstudent_id, phase_number, program_enrollment_status,
                TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD') AS enrolled,
                TO_CHAR(TIMEZONE('Asia/Manila', removed_at), 'YYYY-MM-DD') AS removed
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
    console.log('\n✅ Applied Morgan Aquino Playgroup matrix alignment.');
    console.log('\nMatrix AFTER commit:');
    console.table(await previewMatrix(query));
    console.log('Refresh Month Re-enrollment + Student history.');
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
