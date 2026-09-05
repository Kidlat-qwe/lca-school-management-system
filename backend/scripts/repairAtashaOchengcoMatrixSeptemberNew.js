/**
 * Atasha Cailin O. Ochengco (arochengco@gmail.com, user 676) —
 * Phase 3 paid early, but program start is September → matrix "new" in September.
 *
 * Production class 151 · VMM_Playgroup_TTh 11:00 AM · profile 504 · Malolos (1)
 * phase_start = 3 · CS 1987 · INV 2379 (TARGET_PHASE:3)
 *
 * Current (after prior Aug shift repair):
 *   Aug new / Sep Active
 *
 * Desired:
 *   Sep new / Oct Active (August blank — not counted as Total Active)
 *
 * Updates:
 *   1. classstudent enrolled_at → 2026-09-01
 *   2. INV-2379 issue/due → 2026-09-01 / 2026-09-05
 *   3. profile first_billing_month → 2026-09-01
 *
 * Payment row dates are unchanged (paid early on 2026-07-31).
 *
 * Run (from backend/):
 *   node scripts/repairAtashaOchengcoMatrixSeptemberNew.js --production
 *   node scripts/repairAtashaOchengcoMatrixSeptemberNew.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_ID = 676;
const STUDENT_EMAIL = 'arochengco@gmail.com';
const CLASS_ID = 151;
const BRANCH_ID = 1;
const PROFILE_ID = 504;
const PHASE = 3;
const CLASSSTUDENT_ID = 1987;
const INVOICE_ID = 2379;

const SEP_ENROLLED_AT = '2026-09-01 12:00:00';
const FIRST_BILLING_MONTH = '2026-09-01';
const PHASE_ISSUE = '2026-09-01';
const PHASE_DUE = '2026-09-05';

const REPAIR_NOTE =
  'Ops repair 2026-09-05 — Atasha Phase 3 matrix new Aug→Sep';

/** Keep varchar(255) fields under limit when appending an ops note. */
function appendNote(existing, note, maxLen = 255) {
  const cur = String(existing || '').trim();
  const add = String(note || '').trim();
  if (!add) return cur || null;
  if (cur.toLowerCase().includes(add.toLowerCase())) return cur;
  if (!cur) return add.length <= maxLen ? add : add.slice(0, maxLen);
  const joined = `${cur} | ${add}`;
  if (joined.length <= maxLen) return joined;
  // Prefer keeping existing text; skip note if it won't fit.
  return cur.length <= maxLen ? cur : cur.slice(0, maxLen);
}

const isApply = process.argv.includes('--apply');

const EXPECTED = [
  ['2026-09', 'new'],
  ['2026-10', 'Active'],
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
  if (byMonth['2026-08']?.label === 'new') {
    problems.push('2026-08: still shows new (expected blank / not new)');
  }
  return problems;
}

async function main() {
  console.log(
    `\nAtasha Ochengco — matrix September new` +
      `${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`Note: ${REPAIR_NOTE}`);
  console.log(`DB: ${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV}`);
  if (process.env.DB_NAME !== 'psms_production') {
    console.warn('⚠️ Expected psms_production. Pass --production.');
  }

  const client = await getClient();
  try {
    const user = (
      await client.query(
        `SELECT user_id, full_name, email, branch_id
         FROM userstbl
         WHERE user_id = $1 AND LOWER(TRIM(email)) = LOWER(TRIM($2))`,
        [STUDENT_ID, STUDENT_EMAIL]
      )
    ).rows[0];
    if (!user) throw new Error(`Student ${STUDENT_ID} / ${STUDENT_EMAIL} not found`);
    if (Number(user.branch_id) !== BRANCH_ID) {
      throw new Error(`Branch mismatch (expected ${BRANCH_ID}, got ${user.branch_id})`);
    }
    console.log('Student:', user.full_name, user.email);

    const enroll = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status,
                TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD HH24:MI') AS enrolled
         FROM classstudentstbl
         WHERE classstudent_id = $1
           AND student_id = $2
           AND class_id = $3`,
        [CLASSSTUDENT_ID, STUDENT_ID, CLASS_ID]
      )
    ).rows[0];
    if (!enroll || Number(enroll.phase_number) !== PHASE) {
      throw new Error(
        `Phase ${PHASE} enrollment ${CLASSSTUDENT_ID} not found (got ${JSON.stringify(enroll)})`
      );
    }
    if (String(enroll.program_enrollment_status) !== 'new') {
      throw new Error(`Expected status new, got ${enroll.program_enrollment_status}`);
    }

    const inv = (
      await client.query(
        `SELECT invoice_id, status, remarks,
                TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue,
                TO_CHAR(due_date, 'YYYY-MM-DD') AS due,
                installmentinvoiceprofiles_id
         FROM invoicestbl
         WHERE invoice_id = $1`,
        [INVOICE_ID]
      )
    ).rows[0];
    if (!inv || Number(inv.installmentinvoiceprofiles_id) !== PROFILE_ID) {
      throw new Error(`INV-${INVOICE_ID} not on profile ${PROFILE_ID}`);
    }
    if (!String(inv.remarks || '').includes(`TARGET_PHASE:${PHASE}`)) {
      throw new Error(`INV-${INVOICE_ID} is not TARGET_PHASE:${PHASE}`);
    }
    if (String(inv.status) !== 'Paid') {
      throw new Error(`INV-${INVOICE_ID} status ${inv.status}, expected Paid`);
    }

    const profile = (
      await client.query(
        `SELECT installmentinvoiceprofiles_id, phase_start, total_phases,
                TO_CHAR(first_billing_month, 'YYYY-MM-DD') AS first_billing
         FROM installmentinvoiceprofilestbl
         WHERE installmentinvoiceprofiles_id = $1 AND student_id = $2`,
        [PROFILE_ID, STUDENT_ID]
      )
    ).rows[0];
    if (!profile || Number(profile.phase_start) !== PHASE) {
      throw new Error(`Expected phase_start=${PHASE} on profile ${PROFILE_ID}`);
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
    console.table(await previewMatrix(query));

    const needsEnroll = !String(enroll.enrolled || '').startsWith('2026-09-01');
    const needsInvoice = inv.issue !== PHASE_ISSUE || inv.due !== PHASE_DUE;
    const needsBilling = profile.first_billing !== FIRST_BILLING_MONTH;

    console.log('\nPlanned:');
    console.log(
      needsEnroll
        ? `  1. classstudent ${CLASSSTUDENT_ID} enrolled_at ${enroll.enrolled} → ${SEP_ENROLLED_AT}`
        : `  1. enrolled_at already September`
    );
    console.log(
      needsInvoice
        ? `  2. INV-${INVOICE_ID} ${inv.issue}/${inv.due} → ${PHASE_ISSUE}/${PHASE_DUE}`
        : `  2. INV-${INVOICE_ID} already ${PHASE_ISSUE}/${PHASE_DUE}`
    );
    console.log(
      needsBilling
        ? `  3. Profile ${PROFILE_ID} first_billing_month ${profile.first_billing} → ${FIRST_BILLING_MONTH}`
        : `  3. first_billing_month already ${FIRST_BILLING_MONTH}`
    );
    console.log('  4. Expect matrix: Sep new, Oct Active (Aug not new)');

    if (!needsEnroll && !needsInvoice && !needsBilling) {
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
        [SEP_ENROLLED_AT, nextEnrolledBy, CLASSSTUDENT_ID, STUDENT_ID, CLASS_ID]
      );
      console.log(`✅ enrolled_at → ${SEP_ENROLLED_AT}`);
    }

    if (needsInvoice) {
      // remarks may already be long (prior ops notes); only bump dates — do not append.
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
      console.log('Matrix OK: Sep new / Oct Active; Aug not new.');
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
    console.error('\nFailed:', err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  });
