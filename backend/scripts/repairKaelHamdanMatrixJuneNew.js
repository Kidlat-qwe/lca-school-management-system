/**
 * Kael Devin Burayag Hamdan (myrna01@gmail.com, user 524) —
 * Month Re-enrollment: Phase 3 "new" shows May; should start in June.
 *
 * Production class 91 · VMM_Playgroup_SS 9:30 AM · profile 307 · Malolos (1)
 * phase_start = 3 · CS 626 · INV 753 (TARGET_PHASE:3)
 *
 * Current: enrolled_at 2026-05-02 → May new / Jun–Sep re-enrolled / Oct Active
 * Desired: Jun new → Jul–Sep re-enrolled / Oct completed-ish or Active
 *
 * Also: Phase 4 CS 627 stored as "new" → re_enrolled
 *
 * Updates:
 *   1. classstudent 626 enrolled_at → 2026-06-01
 *   2. INV-753 issue/due → 2026-05-25 / 2026-06-05
 *   3. profile first_billing_month → 2026-06-01
 *   4. classstudent 627 status → re_enrolled
 *
 * Run (from backend/):
 *   node scripts/repairKaelHamdanMatrixJuneNew.js --production
 *   node scripts/repairKaelHamdanMatrixJuneNew.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_ID = 524;
const STUDENT_EMAIL = 'myrna01@gmail.com';
const CLASS_ID = 91;
const BRANCH_ID = 1;
const PROFILE_ID = 307;
const PHASE = 3;
const CLASSSTUDENT_ID = 626;
const PHASE4_CLASSSTUDENT_ID = 627;
const INVOICE_ID = 753;

const JUN_ENROLLED_AT = '2026-06-01 12:00:00';
const FIRST_BILLING_MONTH = '2026-06-01';
const PHASE_ISSUE = '2026-05-25';
const PHASE_DUE = '2026-06-05';

const REPAIR_NOTE =
  'Ops repair 2026-09-05 — Kael Hamdan Phase 3 matrix new May→Jun';

function appendNote(existing, note, maxLen = 255) {
  const cur = String(existing || '').trim();
  const add = String(note || '').trim();
  if (!add) return cur || null;
  if (cur.toLowerCase().includes(add.toLowerCase())) return cur;
  if (!cur) return add.length <= maxLen ? add : add.slice(0, maxLen);
  const joined = `${cur} | ${add}`;
  if (joined.length <= maxLen) return joined;
  return cur.length <= maxLen ? cur : cur.slice(0, maxLen);
}

const isApply = process.argv.includes('--apply');

const EXPECTED = [
  ['2026-06', 'new'],
  ['2026-07', 're-enrolled'],
  ['2026-09', 're-enrolled'],
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
  if (byMonth['2026-05']?.label === 'new') {
    problems.push('2026-05: still shows new (expected blank / not new)');
  }
  return problems;
}

async function main() {
  console.log(
    `\nKael Hamdan — matrix June new${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
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
    if (!student) throw new Error(`Student ${STUDENT_ID} / ${STUDENT_EMAIL} not found`);
    console.log('Student:', student.full_name, student.email);

    const enroll = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status,
                TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD HH24:MI') AS enrolled
         FROM classstudentstbl
         WHERE classstudent_id = $1 AND student_id = $2 AND class_id = $3`,
        [CLASSSTUDENT_ID, STUDENT_ID, CLASS_ID]
      )
    ).rows[0];
    if (!enroll || Number(enroll.phase_number) !== PHASE) {
      throw new Error(`Phase ${PHASE} enrollment ${CLASSSTUDENT_ID} not found`);
    }
    if (String(enroll.program_enrollment_status) !== 'new') {
      throw new Error(`Expected status new, got ${enroll.program_enrollment_status}`);
    }

    const phase4 = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status
         FROM classstudentstbl
         WHERE classstudent_id = $1 AND student_id = $2 AND class_id = $3`,
        [PHASE4_CLASSSTUDENT_ID, STUDENT_ID, CLASS_ID]
      )
    ).rows[0];
    if (!phase4 || Number(phase4.phase_number) !== 4) {
      throw new Error(`Phase 4 enrollment ${PHASE4_CLASSSTUDENT_ID} not found`);
    }

    const inv = (
      await client.query(
        `SELECT invoice_id, status, remarks,
                TO_CHAR(TIMEZONE('Asia/Manila', issue_date), 'YYYY-MM-DD') AS issue,
                TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due,
                installmentinvoiceprofiles_id
         FROM invoicestbl WHERE invoice_id = $1`,
        [INVOICE_ID]
      )
    ).rows[0];
    if (!inv || Number(inv.installmentinvoiceprofiles_id) !== PROFILE_ID) {
      throw new Error(`INV-${INVOICE_ID} not on profile ${PROFILE_ID}`);
    }
    if (!String(inv.remarks || '').includes(`TARGET_PHASE:${PHASE}`)) {
      throw new Error(`INV-${INVOICE_ID} is not TARGET_PHASE:${PHASE}`);
    }

    const profile = (
      await client.query(
        `SELECT installmentinvoiceprofiles_id, phase_start,
                TO_CHAR(first_billing_month, 'YYYY-MM-DD') AS first_billing
         FROM installmentinvoiceprofilestbl
         WHERE installmentinvoiceprofiles_id = $1 AND student_id = $2`,
        [PROFILE_ID, STUDENT_ID]
      )
    ).rows[0];
    if (!profile || Number(profile.phase_start) !== PHASE) {
      throw new Error(`Expected phase_start=${PHASE} on profile ${PROFILE_ID}`);
    }

    console.log('BEFORE enrollment P3:', enroll);
    console.log('BEFORE enrollment P4:', phase4);
    console.log('BEFORE invoice:', {
      invoice_id: inv.invoice_id,
      issue: inv.issue,
      due: inv.due,
    });
    console.log('BEFORE first_billing:', profile.first_billing);
    console.log('BEFORE matrix:');
    console.table(await previewMatrix(query));

    const needsEnroll = !String(enroll.enrolled || '').startsWith('2026-06-01');
    const needsInvoice = inv.issue !== PHASE_ISSUE || inv.due !== PHASE_DUE;
    const needsBilling = profile.first_billing !== FIRST_BILLING_MONTH;
    const needsPhase4 = String(phase4.program_enrollment_status) !== 're_enrolled';

    console.log('\nPlanned:');
    console.log(
      needsEnroll
        ? `  1. CS ${CLASSSTUDENT_ID} enrolled_at ${enroll.enrolled} → ${JUN_ENROLLED_AT}`
        : '  1. enrolled_at already June'
    );
    console.log(
      needsInvoice
        ? `  2. INV-${INVOICE_ID} ${inv.issue}/${inv.due} → ${PHASE_ISSUE}/${PHASE_DUE}`
        : `  2. INV-${INVOICE_ID} already ${PHASE_ISSUE}/${PHASE_DUE}`
    );
    console.log(
      needsBilling
        ? `  3. Profile ${PROFILE_ID} first_billing ${profile.first_billing} → ${FIRST_BILLING_MONTH}`
        : `  3. first_billing already ${FIRST_BILLING_MONTH}`
    );
    console.log(
      needsPhase4
        ? `  4. CS ${PHASE4_CLASSSTUDENT_ID} status ${phase4.program_enrollment_status} → re_enrolled`
        : '  4. Phase 4 already re_enrolled'
    );
    console.log('  5. Expect matrix: Jun new; May not new; Sep re-enrolled');

    if (!needsEnroll && !needsInvoice && !needsBilling && !needsPhase4) {
      console.log('\nNo changes needed.');
      return;
    }

    if (!isApply) {
      console.log('\nDry run only. Re-run with --apply to commit.');
      return;
    }

    await client.query('BEGIN');

    if (needsEnroll) {
      const enrolledByRes = await client.query(
        `SELECT enrolled_by FROM classstudentstbl WHERE classstudent_id = $1`,
        [CLASSSTUDENT_ID]
      );
      const nextEnrolledBy = appendNote(enrolledByRes.rows[0]?.enrolled_by, REPAIR_NOTE, 255);
      await client.query(
        `UPDATE classstudentstbl
         SET enrolled_at = $1::timestamp,
             enrolled_by = $2
         WHERE classstudent_id = $3
           AND student_id = $4
           AND class_id = $5`,
        [JUN_ENROLLED_AT, nextEnrolledBy, CLASSSTUDENT_ID, STUDENT_ID, CLASS_ID]
      );
      console.log(`✅ enrolled_at → ${JUN_ENROLLED_AT}`);
    }

    if (needsInvoice) {
      await client.query(
        `UPDATE invoicestbl
         SET issue_date = $1::date,
             due_date = $2::date,
             late_penalty_applied_for_due_date = NULL
         WHERE invoice_id = $3
           AND installmentinvoiceprofiles_id = $4`,
        [PHASE_ISSUE, PHASE_DUE, INVOICE_ID, PROFILE_ID]
      );
      await syncProgramPaymentStatusForInvoice(client, INVOICE_ID);
      console.log(`✅ INV-${INVOICE_ID} → ${PHASE_ISSUE} / ${PHASE_DUE}`);
    }

    if (needsBilling) {
      await client.query(
        `UPDATE installmentinvoiceprofilestbl
         SET first_billing_month = $1::date
         WHERE installmentinvoiceprofiles_id = $2
           AND student_id = $3`,
        [FIRST_BILLING_MONTH, PROFILE_ID, STUDENT_ID]
      );
      console.log(`✅ first_billing_month → ${FIRST_BILLING_MONTH}`);
    }

    if (needsPhase4) {
      await client.query(
        `UPDATE classstudentstbl
         SET program_enrollment_status = 're_enrolled'
         WHERE classstudent_id = $1
           AND student_id = $2
           AND class_id = $3`,
        [PHASE4_CLASSSTUDENT_ID, STUDENT_ID, CLASS_ID]
      );
      console.log(`✅ Phase 4 CS ${PHASE4_CLASSSTUDENT_ID} → re_enrolled`);
    }

    await client.query('COMMIT');
    console.log('\n✅ Committed.');

    const after = await previewMatrix(query);
    console.log('\nAFTER matrix:');
    console.table(after);
    const problems = assertExpected(after);
    if (problems.length) {
      console.warn('⚠️ Matrix validation:');
      for (const p of problems) console.warn('  -', p);
    } else {
      console.log('Matrix OK: Jun new; May not new; Sep re-enrolled.');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
