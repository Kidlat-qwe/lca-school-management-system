/**
 * Jeana Olivia H. Castro + Atasha Cailin O. Ochengco —
 * Phase 2 late-July enroll → matrix August new / September Active.
 *
 * Both on class 151 VMM_Playgroup_TTh 11:00 AM (branch 1), phase_start=2.
 *
 * | Student | ID  | Profile | Phase 2 CS | Phase 2 INV |
 * |---------|-----|--------|------------|-------------|
 * | Jeana   | 674 | 503    | 1967       | 2375        |
 * | Atasha  | 676 | 504    | 1987       | 2379        |
 *
 * Current: July new / August Active
 * Expected: August new / September Active
 *
 * Run:
 *   node backend/scripts/repairJeanaAtashaMatrixAugustNew.js --production
 *   node backend/scripts/repairJeanaAtashaMatrixAugustNew.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const CLASS_ID = 151;
const BRANCH_ID = 1;

const AUG_ENROLLED_AT = '2026-08-01 12:00:00';
const FIRST_BILLING_MONTH = '2026-08-01';
const PHASE2_ISSUE = '2026-08-01';
const PHASE2_DUE = '2026-08-05';

const REPAIR_NOTE =
  'Ops repair 2026-08-07 — Phase 2 matrix new month July→August (enrolled_at + due)';

const STUDENTS = [
  {
    label: 'Jeana Olivia H. Castro',
    studentId: 674,
    email: 'joanahipe@gmail.com',
    profileId: 503,
    classstudentId: 1967,
    invoiceId: 2375,
  },
  {
    label: 'Atasha Cailin O. Ochengco',
    studentId: 676,
    email: 'arochengco@gmail.com',
    profileId: 504,
    classstudentId: 1987,
    invoiceId: 2379,
  },
];

const isApply = process.argv.includes('--apply');

const EXPECTED = [
  ['2026-08', 'new'],
  ['2026-09', 'Active'],
];

async function previewMatrix(queryFn, studentId) {
  const matrix = await loadStudentMonthEnrollmentMatrix(queryFn, {
    year: 2026,
    branchId: BRANCH_ID,
    classId: CLASS_ID,
  });
  const track = (matrix.students || []).find(
    (s) => Number(s.student_id) === studentId && Number(s.class_id) === CLASS_ID
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

async function repairOne(client, student) {
  console.log(`\n-------- ${student.label} --------`);

  const row = (
    await client.query(
      `SELECT user_id, full_name, email FROM userstbl
       WHERE user_id = $1 AND LOWER(TRIM(email)) = LOWER(TRIM($2))`,
      [student.studentId, student.email]
    )
  ).rows[0];
  if (!row) {
    throw new Error(`Student ${student.studentId} / ${student.email} not found`);
  }
  console.log('Student:', row.full_name, row.email);

  const enroll = (
    await client.query(
      `SELECT classstudent_id, phase_number, program_enrollment_status,
              TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD HH24:MI') AS enrolled
       FROM classstudentstbl
       WHERE classstudent_id = $1
         AND student_id = $2
         AND class_id = $3`,
      [student.classstudentId, student.studentId, CLASS_ID]
    )
  ).rows[0];
  if (!enroll || Number(enroll.phase_number) !== 2) {
    throw new Error(
      `Phase 2 enrollment ${student.classstudentId} not found (got ${JSON.stringify(enroll)})`
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
      [student.invoiceId]
    )
  ).rows[0];
  if (!inv || Number(inv.installmentinvoiceprofiles_id) !== student.profileId) {
    throw new Error(`INV-${student.invoiceId} not on profile ${student.profileId}`);
  }
  if (!String(inv.remarks || '').includes('TARGET_PHASE:2')) {
    throw new Error(`INV-${student.invoiceId} is not TARGET_PHASE:2`);
  }

  const profile = (
    await client.query(
      `SELECT installmentinvoiceprofiles_id, phase_start,
              TO_CHAR(first_billing_month, 'YYYY-MM-DD') AS first_billing
       FROM installmentinvoiceprofilestbl
       WHERE installmentinvoiceprofiles_id = $1 AND student_id = $2`,
      [student.profileId, student.studentId]
    )
  ).rows[0];
  if (!profile || Number(profile.phase_start) !== 2) {
    throw new Error(`Expected phase_start=2 on profile ${student.profileId}`);
  }

  console.log('BEFORE enrollment:', enroll);
  console.log('BEFORE invoice:', {
    invoice_id: inv.invoice_id,
    status: inv.status,
    issue: inv.issue,
    due: inv.due,
  });
  console.log('BEFORE first_billing:', profile.first_billing);
  console.log('BEFORE matrix:');
  console.table(await previewMatrix(query, student.studentId));

  const needsEnroll = !String(enroll.enrolled || '').startsWith('2026-08-01');
  const needsInvoice = inv.issue !== PHASE2_ISSUE || inv.due !== PHASE2_DUE;
  const needsBilling = profile.first_billing !== FIRST_BILLING_MONTH;

  console.log('\nPlanned:');
  if (needsEnroll) {
    console.log(
      `  1. classstudent ${student.classstudentId} enrolled_at → ${AUG_ENROLLED_AT}`
    );
  } else {
    console.log(`  1. enrolled_at already August`);
  }
  if (needsInvoice) {
    console.log(
      `  2. INV-${student.invoiceId} ${inv.issue}/${inv.due} → ${PHASE2_ISSUE}/${PHASE2_DUE}`
    );
  } else {
    console.log(`  2. INV-${student.invoiceId} already ${PHASE2_ISSUE}/${PHASE2_DUE}`);
  }
  if (needsBilling) {
    console.log(
      `  3. Profile ${student.profileId} first_billing_month → ${FIRST_BILLING_MONTH}`
    );
  } else {
    console.log(`  3. first_billing_month already ${FIRST_BILLING_MONTH}`);
  }
  console.log('  4. Expect matrix: Aug new, Sep Active');

  return { needsEnroll, needsInvoice, needsBilling, student, inv };
}

async function applyOne(client, plan) {
  const { student, needsEnroll, needsInvoice, needsBilling } = plan;

  if (needsEnroll) {
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
      [AUG_ENROLLED_AT, REPAIR_NOTE, student.classstudentId, student.studentId, CLASS_ID]
    );
    console.log(`✅ enrolled_at → ${AUG_ENROLLED_AT}`);
  }

  if (needsInvoice) {
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
      [PHASE2_ISSUE, PHASE2_DUE, student.invoiceId, REPAIR_NOTE, student.profileId]
    );
    await syncProgramPaymentStatusForInvoice(client, student.invoiceId);
    console.log(`✅ INV-${student.invoiceId} → ${PHASE2_ISSUE} / ${PHASE2_DUE}`);
  }

  if (needsBilling) {
    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET first_billing_month = $1::date
       WHERE installmentinvoiceprofiles_id = $2
         AND student_id = $3`,
      [FIRST_BILLING_MONTH, student.profileId, student.studentId]
    );
    console.log(`✅ first_billing_month → ${FIRST_BILLING_MONTH}`);
  }
}

async function main() {
  console.log(
    `\nJeana + Atasha — matrix August new${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`DB: ${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV}`);
  console.log(`Class ${CLASS_ID} · Branch ${BRANCH_ID}`);
  console.log(`Note: ${REPAIR_NOTE}`);

  const client = await getClient();
  try {
    const plans = [];
    for (const student of STUDENTS) {
      plans.push(await repairOne(client, student));
    }

    const anyWork = plans.some((p) => p.needsEnroll || p.needsInvoice || p.needsBilling);
    if (!anyWork) {
      console.log('\nNo changes needed for either student.');
      return;
    }

    if (!isApply) {
      console.log('\nDry run only. Re-run with --apply to commit.');
      return;
    }

    await client.query('BEGIN');
    for (const plan of plans) {
      console.log(`\nApplying ${plan.student.label}...`);
      await applyOne(client, plan);
    }
    await client.query('COMMIT');

    console.log('\n======== AFTER ========');
    for (const plan of plans) {
      const afterCells = await previewMatrix(query, plan.student.studentId);
      console.log(`\n${plan.student.label}:`);
      console.table(afterCells);
      const problems = assertExpected(afterCells);
      if (problems.length) {
        console.warn('⚠ Matrix not fully aligned:');
        problems.forEach((p) => console.warn('  -', p));
      } else {
        console.log('✅ Aug new, Sep Active');
      }
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
