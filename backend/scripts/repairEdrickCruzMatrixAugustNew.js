/**
 * Edrick Romulus L. Cruz — month matrix: Phase 5 "new" in August.
 *
 * Student: 672 · jilopez031389@yahoo.com
 * Class: 94 VMM_Playgroup_TTh 1:00 PM · Profile: 497 · Branch: VMM (1)
 * Phase 5 classstudent: 1953 · INV-2363 (TARGET_PHASE:5)
 * Plan: Playgroup Installment Plan 2 (phase_start=5, 6 phases)
 *
 * Current: enrolled_at 2026-07-28 → July new / August Active
 * Expected: August new → September Active
 *
 * Run:
 *   node backend/scripts/repairEdrickCruzMatrixAugustNew.js --production
 *   node backend/scripts/repairEdrickCruzMatrixAugustNew.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_ID = 672;
const STUDENT_EMAIL = 'jilopez031389@yahoo.com';
const CLASS_ID = 94;
const BRANCH_ID = 1;
const PROFILE_ID = 497;
const PHASE5_CLASSSTUDENT_ID = 1953;
const PHASE5_INVOICE_ID = 2363;
const TARGET_PHASE = 5;

const AUG_ENROLLED_AT = '2026-08-01 12:00:00';
const FIRST_BILLING_MONTH = '2026-08-01';
const PHASE5_ISSUE = '2026-08-01';
const PHASE5_DUE = '2026-08-05';

const REPAIR_NOTE =
  'Ops repair 2026-08-07 — Edrick Cruz matrix new month July→August (phase 5 enrolled_at + due)';

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
    `\nEdrick Cruz — matrix August new${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`DB: ${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV}`);
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
    if (!student) {
      throw new Error(`Student ${STUDENT_ID} / ${STUDENT_EMAIL} not found`);
    }
    console.log('Student:', student.full_name, student.email);

    const enroll = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status,
                TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD HH24:MI') AS enrolled
         FROM classstudentstbl
         WHERE classstudent_id = $1
           AND student_id = $2
           AND class_id = $3`,
        [PHASE5_CLASSSTUDENT_ID, STUDENT_ID, CLASS_ID]
      )
    ).rows[0];
    if (!enroll || Number(enroll.phase_number) !== TARGET_PHASE) {
      throw new Error(
        `Phase ${TARGET_PHASE} enrollment ${PHASE5_CLASSSTUDENT_ID} not found (got ${JSON.stringify(enroll)})`
      );
    }
    if (String(enroll.program_enrollment_status) !== 'new') {
      throw new Error(`Expected status new, got ${enroll.program_enrollment_status}`);
    }

    const inv = (
      await client.query(
        `SELECT invoice_id, status, remarks,
                TO_CHAR(TIMEZONE('Asia/Manila', issue_date), 'YYYY-MM-DD') AS issue,
                TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due,
                installmentinvoiceprofiles_id
         FROM invoicestbl
         WHERE invoice_id = $1`,
        [PHASE5_INVOICE_ID]
      )
    ).rows[0];
    if (!inv || Number(inv.installmentinvoiceprofiles_id) !== PROFILE_ID) {
      throw new Error(`INV-${PHASE5_INVOICE_ID} not on profile ${PROFILE_ID}`);
    }
    if (!String(inv.remarks || '').includes(`TARGET_PHASE:${TARGET_PHASE}`)) {
      throw new Error(`INV-${PHASE5_INVOICE_ID} is not TARGET_PHASE:${TARGET_PHASE}`);
    }

    const profile = (
      await client.query(
        `SELECT installmentinvoiceprofiles_id, phase_start, total_phases, generated_count,
                TO_CHAR(first_billing_month, 'YYYY-MM-DD') AS first_billing
         FROM installmentinvoiceprofilestbl
         WHERE installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      )
    ).rows[0];

    console.log('\nBEFORE enrollment:', enroll);
    console.log('BEFORE invoice:', {
      invoice_id: inv.invoice_id,
      status: inv.status,
      issue: inv.issue,
      due: inv.due,
    });
    console.log('BEFORE profile first_billing:', profile?.first_billing);
    console.log('BEFORE matrix:');
    console.table(await previewMatrix(query));

    console.log('\nPlanned:');
    console.log(
      `  1. classstudent ${PHASE5_CLASSSTUDENT_ID} enrolled_at → ${AUG_ENROLLED_AT}`
    );
    console.log(
      `  2. INV-${PHASE5_INVOICE_ID} issue/due → ${PHASE5_ISSUE} / ${PHASE5_DUE}`
    );
    console.log(`  3. Profile ${PROFILE_ID} first_billing_month → ${FIRST_BILLING_MONTH}`);
    console.log('  4. Expect matrix: Aug new, Sep Active (July not new)');

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
      [AUG_ENROLLED_AT, REPAIR_NOTE, PHASE5_CLASSSTUDENT_ID, STUDENT_ID, CLASS_ID]
    );
    console.log(`✅ enrolled_at → ${AUG_ENROLLED_AT}`);

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
      [PHASE5_ISSUE, PHASE5_DUE, PHASE5_INVOICE_ID, REPAIR_NOTE, PROFILE_ID]
    );
    await syncProgramPaymentStatusForInvoice(client, PHASE5_INVOICE_ID);
    console.log(`✅ INV-${PHASE5_INVOICE_ID} → ${PHASE5_ISSUE} / ${PHASE5_DUE}`);

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET first_billing_month = $1::date
       WHERE installmentinvoiceprofiles_id = $2
         AND student_id = $3`,
      [FIRST_BILLING_MONTH, PROFILE_ID, STUDENT_ID]
    );
    console.log(`✅ first_billing_month → ${FIRST_BILLING_MONTH}`);

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
    console.log('\nRefresh Student History → Invoices and Re-enrollment month matrix.');
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
