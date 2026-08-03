/**
 * Liana Amelia Perez — month re-enrollment matrix: move "new" to August.
 *
 * Class: 57 NC_Playgroup_TTh_9:30-10:30PM | Profile: 506 | Branch: Guiguinto (5)
 * Email: larperezmd@gmail.com · user_id 678
 *
 * Phase 8 paid Aug 1, but enrolled_at was 2026-07-31 → July "new" / August Active.
 * Expected: August new → September Active.
 *
 * Run:
 *   node backend/scripts/repairLianaPerezMatrixAugustNew.js --production
 *   node backend/scripts/repairLianaPerezMatrixAugustNew.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_ID = 678;
const STUDENT_EMAIL = 'larperezmd@gmail.com';
const CLASS_ID = 57;
const BRANCH_ID = 5;
const PROFILE_ID = 506;
const PHASE8_CLASSSTUDENT_ID = 2008;
const PHASE8_INVOICE_ID = 2389;

const AUG_ENROLLED_AT = '2026-08-01 12:00:00';
const PHASE8_ISSUE = '2026-08-01';
const PHASE8_DUE = '2026-08-05';
const REPAIR_NOTE =
  'Ops repair 2026-08-01 — Liana Perez matrix new month July→August (phase 8 enrolled_at + due)';

const isApply = process.argv.includes('--apply');

const EXPECTED = [
  ['2026-08', 'new'],
  ['2026-09', 'Active'],
];

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
  if (byMonth['2026-07']?.label === 'new') {
    problems.push('2026-07: still shows new (expected blank / not new)');
  }
  return problems;
}

async function main() {
  console.log(
    `\nLiana Perez — matrix August new${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`DB: ${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV}`);

  const client = await getClient();
  try {
    const student = (
      await client.query(
        `SELECT user_id, full_name, email FROM userstbl
         WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))`,
        [STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student || Number(student.user_id) !== STUDENT_ID) {
      throw new Error(`Student ${STUDENT_EMAIL} (id ${STUDENT_ID}) not found`);
    }
    console.log('Student:', student.full_name, student.email);

    const enroll = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status,
                TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD HH24:MI') AS enrolled
         FROM classstudentstbl WHERE classstudent_id = $1`,
        [PHASE8_CLASSSTUDENT_ID]
      )
    ).rows[0];
    if (!enroll || Number(enroll.phase_number) !== 8) {
      throw new Error(`Enrollment ${PHASE8_CLASSSTUDENT_ID} phase 8 not found`);
    }

    const inv = (
      await client.query(
        `SELECT invoice_id,
                TO_CHAR(TIMEZONE('Asia/Manila', issue_date), 'YYYY-MM-DD') AS issue,
                TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due
         FROM invoicestbl WHERE invoice_id = $1`,
        [PHASE8_INVOICE_ID]
      )
    ).rows[0];

    console.log('\nBEFORE enrollment:', enroll);
    console.log('BEFORE invoice:', inv);
    console.log('BEFORE matrix:');
    console.table(await previewMatrix(query));

    console.log('\nPlanned:');
    console.log(`  1. classstudent ${PHASE8_CLASSSTUDENT_ID} enrolled_at → ${AUG_ENROLLED_AT}`);
    console.log(
      `  2. INV-${PHASE8_INVOICE_ID} issue/due → ${PHASE8_ISSUE} / ${PHASE8_DUE}`
    );
    console.log('  3. Expect matrix: Aug new, Sep Active');

    if (!isApply) {
      console.log('\nDry run only. Re-run with --apply to commit.');
      return;
    }

    await client.query('BEGIN');

    await client.query(
      `UPDATE classstudentstbl
       SET enrolled_at = $1::timestamp,
           enrolled_by = CASE
             WHEN enrolled_by IS NULL OR TRIM(enrolled_by) = '' THEN $2
             WHEN enrolled_by ILIKE '%' || $2 || '%' THEN enrolled_by
             ELSE enrolled_by || ' | ' || $2
           END
       WHERE classstudent_id = $3
         AND student_id = $4
         AND class_id = $5`,
      [AUG_ENROLLED_AT, REPAIR_NOTE, PHASE8_CLASSSTUDENT_ID, STUDENT_ID, CLASS_ID]
    );
    console.log(
      `✅ enrolled_at → ${AUG_ENROLLED_AT} (Manila wall clock, timestamp without time zone)`
    );

    await client.query(
      `UPDATE invoicestbl
       SET issue_date = $1::date,
           due_date = $2::date,
           late_penalty_applied_for_due_date = NULL,
           remarks = CASE
             WHEN remarks ILIKE '%' || $4 || '%' THEN remarks
             WHEN remarks IS NULL OR TRIM(remarks) = '' THEN $4
             ELSE remarks || ' | ' || $4
           END
       WHERE invoice_id = $3
         AND installmentinvoiceprofiles_id = $5`,
      [PHASE8_ISSUE, PHASE8_DUE, PHASE8_INVOICE_ID, REPAIR_NOTE, PROFILE_ID]
    );
    await syncProgramPaymentStatusForInvoice(client, PHASE8_INVOICE_ID);
    console.log(`✅ INV-${PHASE8_INVOICE_ID} → ${PHASE8_ISSUE} / ${PHASE8_DUE}`);

    await client.query('COMMIT');

    const afterCells = await previewMatrix(query);
    console.log('\nAFTER matrix:');
    console.table(afterCells);
    const problems = assertExpected(afterCells);
    if (problems.length) {
      console.warn('\n⚠ Matrix not fully aligned:');
      problems.forEach((p) => console.warn('  -', p));
    } else {
      console.log('\n✅ Matrix: August new, September Active.');
    }
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
