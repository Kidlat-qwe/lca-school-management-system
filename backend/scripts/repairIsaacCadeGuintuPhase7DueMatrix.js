/**
 * Isaac Cade Guintu — Phase 7 advance-pay due + month matrix Aug/Sep.
 *
 * Student: 359 · jershey_decenanuguid@yahoo.com
 * Class: 67 VMP_Playgroup_TTh_11:00AM · Profile: 159 · Branch: VMP (6)
 *
 * Issues:
 *   - INV-1954 (Phase 7 advance payment) due_date is 2026-10-05; should be 2026-08-05
 *   - Month matrix: Jul re-enrolled → Aug Active
 *     Expected: Aug re-enrolled → Sep Active
 *
 * Why a Phase 8 enrollment bridge?
 *   Month matrix billing months are phase-offset from the April phase-4 anchor
 *   (phase 7 always lands in July). Changing Phase 7 enrolled_at / due alone
 *   does not move Active. A Phase 8 re_enrolled row at 2026-08-01 places
 *   August re-enrolled and September Active, while Phase 7 invoice + enrollment
 *   stay intact for Student History.
 *
 * Run:
 *   node backend/scripts/repairIsaacCadeGuintuPhase7DueMatrix.js --production
 *   node backend/scripts/repairIsaacCadeGuintuPhase7DueMatrix.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_ID = 359;
const STUDENT_EMAIL = 'jershey_decenanuguid@yahoo.com';
const CLASS_ID = 67;
const BRANCH_ID = 6;
const PROFILE_ID = 159;
const PHASE7_CLASSSTUDENT_ID = 1770;
const PHASE7_INVOICE_ID = 1954;

const PHASE7_DUE = '2026-08-05';
const PHASE8_ENROLLED_AT = '2026-08-01 12:00:00';
const REPAIR_NOTE =
  'Ops repair 2026-08-07 — Isaac Cade Guintu Phase 7 due Oct→Aug 5 + matrix Aug re-enrolled / Sep Active (phase 8 bridge)';

const isApply = process.argv.includes('--apply');

const EXPECTED = [
  ['2026-07', 're-enrolled'],
  ['2026-08', 're-enrolled'],
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
  return problems;
}

async function main() {
  console.log(
    `\nIsaac Cade Guintu — Phase 7 due + Aug/Sep matrix${
      isApply ? ' (APPLY)' : ' (DRY RUN)'
    }\n`
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

    const phase7Enroll = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status,
                TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD HH24:MI') AS enrolled
         FROM classstudentstbl
         WHERE classstudent_id = $1
           AND student_id = $2
           AND class_id = $3`,
        [PHASE7_CLASSSTUDENT_ID, STUDENT_ID, CLASS_ID]
      )
    ).rows[0];
    if (!phase7Enroll || Number(phase7Enroll.phase_number) !== 7) {
      throw new Error(
        `Phase 7 enrollment ${PHASE7_CLASSSTUDENT_ID} not found (got ${JSON.stringify(phase7Enroll)})`
      );
    }

    const phase8Existing = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status,
                TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD HH24:MI') AS enrolled
         FROM classstudentstbl
         WHERE student_id = $1 AND class_id = $2 AND phase_number = 8
         ORDER BY classstudent_id`,
        [STUDENT_ID, CLASS_ID]
      )
    ).rows;

    const inv = (
      await client.query(
        `SELECT invoice_id, invoice_ar_number, status, remarks,
                TO_CHAR(TIMEZONE('Asia/Manila', issue_date), 'YYYY-MM-DD') AS issue,
                TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due,
                installmentinvoiceprofiles_id
         FROM invoicestbl
         WHERE invoice_id = $1`,
        [PHASE7_INVOICE_ID]
      )
    ).rows[0];
    if (!inv || Number(inv.installmentinvoiceprofiles_id) !== PROFILE_ID) {
      throw new Error(`INV-${PHASE7_INVOICE_ID} not on profile ${PROFILE_ID}`);
    }
    if (!String(inv.remarks || '').includes('TARGET_PHASE:7')) {
      throw new Error(`INV-${PHASE7_INVOICE_ID} is not TARGET_PHASE:7`);
    }
    if (String(inv.status) !== 'Paid') {
      throw new Error(`INV-${PHASE7_INVOICE_ID} status is ${inv.status}, expected Paid`);
    }

    console.log('\nBEFORE Phase 7 enrollment:');
    console.table([phase7Enroll]);
    console.log('BEFORE Phase 8 enrollments:');
    console.table(phase8Existing.length ? phase8Existing : [{ note: '(none)' }]);
    console.log('BEFORE Phase 7 invoice:');
    console.table([
      {
        invoice_id: inv.invoice_id,
        ar: inv.invoice_ar_number,
        status: inv.status,
        issue: inv.issue,
        due: inv.due,
      },
    ]);
    console.log('BEFORE matrix:');
    console.table(await previewMatrix(query));

    const needsDue = inv.due !== PHASE7_DUE;
    const needsPhase8Bridge = phase8Existing.length === 0;

    console.log('\nPlanned:');
    if (needsDue) {
      console.log(
        `  1. INV-${PHASE7_INVOICE_ID} due ${inv.due} → ${PHASE7_DUE} (issue stays ${inv.issue})`
      );
    } else {
      console.log(`  1. INV-${PHASE7_INVOICE_ID} due already ${PHASE7_DUE}`);
    }
    if (needsPhase8Bridge) {
      console.log(
        `  2. INSERT classstudent phase 8 re_enrolled @ ${PHASE8_ENROLLED_AT} (matrix Aug bridge)`
      );
      console.log(
        '     Phase 7 enrollment + TARGET_PHASE:7 invoice unchanged for Student History'
      );
    } else {
      console.log(
        `  2. Phase 8 enrollment already exists (classstudent ${phase8Existing[0].classstudent_id})`
      );
    }
    console.log('  3. Expect matrix: Jul re-enrolled, Aug re-enrolled, Sep Active');

    if (!needsDue && !needsPhase8Bridge) {
      console.log('\nNo changes needed.');
      const problems = assertExpected(await previewMatrix(query));
      if (problems.length) {
        console.warn('Matrix still not aligned:');
        problems.forEach((p) => console.warn('  -', p));
      }
      return;
    }

    if (!isApply) {
      console.log('\nDry run only. Re-run with --apply to commit.');
      return;
    }

    await client.query('BEGIN');

    if (needsDue) {
      await client.query(
        `UPDATE invoicestbl
         SET due_date = $1::date,
             late_penalty_applied_for_due_date = NULL,
             remarks = CASE
               WHEN remarks ILIKE '%' || $3 || '%' THEN remarks
               WHEN remarks IS NULL OR TRIM(remarks) = '' THEN $3
               ELSE remarks || ' | ' || $3
             END
         WHERE invoice_id = $2
           AND installmentinvoiceprofiles_id = $4`,
        [PHASE7_DUE, PHASE7_INVOICE_ID, REPAIR_NOTE, PROFILE_ID]
      );
      await syncProgramPaymentStatusForInvoice(client, PHASE7_INVOICE_ID);
      console.log(`✅ INV-${PHASE7_INVOICE_ID} due → ${PHASE7_DUE}`);
    }

    if (needsPhase8Bridge) {
      const inserted = (
        await client.query(
          `INSERT INTO classstudentstbl (
             student_id, class_id, phase_number, program_enrollment_status,
             enrolled_at, enrolled_by
           ) VALUES (
             $1, $2, 8, 're_enrolled',
             $3::timestamp,
             $4
           )
           RETURNING classstudent_id`,
          [STUDENT_ID, CLASS_ID, PHASE8_ENROLLED_AT, REPAIR_NOTE]
        )
      ).rows[0];
      console.log(
        `✅ Inserted classstudent ${inserted.classstudent_id} phase 8 @ ${PHASE8_ENROLLED_AT}`
      );
    }

    await client.query('COMMIT');

    const afterCells = await previewMatrix(query);
    console.log('\nAFTER matrix:');
    console.table(afterCells);
    const problems = assertExpected(afterCells);
    if (problems.length) {
      console.warn('\n⚠ Matrix not fully aligned:');
      problems.forEach((p) => console.warn('  -', p));
    } else {
      console.log('\n✅ Matrix: Jul re-enrolled, Aug re-enrolled, Sep Active.');
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
