/**
 * Ezra Gabrielle M. Cañete — late-start Phase 4 + Phase 5 due + Aug/Sep matrix.
 *
 * Student: 599 · jericacanete01@gmail.com
 * Class: 162 VMP_Pre-Kindergarten_MWF 11AM · Profile: 410 · Branch: VMP (6)
 *
 * Issues:
 *   - False Phase 3 delinquency drop + unpaid INV-1330 (student was not dropped)
 *   - Plan should start at Phase 4 as "new" (not show Phase 3)
 *   - Phase 5 enrollment is "rejoin"; should be "re_enrolled"
 *   - INV-1884 (Phase 5 advance) due 2026-09-05 → should be 2026-08-05
 *   - Month matrix: May dropped / Jul rejoin / Aug Active
 *     Expected: Jul new → Aug re-enrolled → Sep Active
 *
 * Run:
 *   node backend/scripts/repairEzraCanetePhase4StartMatrix.js --production
 *   node backend/scripts/repairEzraCanetePhase4StartMatrix.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';
import { rewriteTargetPhaseInRemarks } from '../utils/installmentPhaseBillingSync.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_ID = 599;
const STUDENT_EMAIL = 'jericacanete01@gmail.com';
const CLASS_ID = 162;
const BRANCH_ID = 6;
const PROFILE_ID = 410;

const PHASE3_CLASSSTUDENT_ID = 1951;
const PHASE4_CLASSSTUDENT_ID = 1165;
const PHASE5_CLASSSTUDENT_ID = 1571;

const PHASE3_INVOICE_ID = 1330;
const PHASE4_INVOICE_ID = 1331;
const PHASE5_INVOICE_ID = 1884;
const DOWNPAYMENT_INVOICE_ID = 1329;

const PHASE4_ENROLLED_AT = '2026-07-01 12:00:00';
const PHASE5_ENROLLED_AT = '2026-08-01 12:00:00';
const PHASE5_DUE = '2026-08-05';

const NEW_PHASE_START = 4;
const NEW_TOTAL_PHASES = 7; // absolute phases 4–10
const NEW_GENERATED_COUNT = 2; // paid Phase 4 + Phase 5

const REPAIR_NOTE =
  'Ops repair 2026-08-07 — Ezra Cañete late-start Phase 4 new; hide false P3 drop; P5 re_enrolled due Aug 5; matrix Jul new / Aug re-enrolled / Sep Active';

const isApply = process.argv.includes('--apply');

const EXPECTED_MATRIX = [
  ['2026-07', 'new'],
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
  for (const [month, label] of EXPECTED_MATRIX) {
    const cell = byMonth[month];
    if (!cell || cell.label !== label) {
      problems.push(
        `${month}: expected ${label}, got ${cell ? `${cell.label} (phase ${cell.phase})` : 'missing'}`
      );
    }
  }
  if (byMonth['2026-05']?.label === 'dropped') {
    problems.push('2026-05: still shows dropped (expected blank)');
  }
  return problems;
}

async function main() {
  console.log(
    `\nEzra Cañete — Phase 4 late-start + Aug/Sep matrix${
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

    const profile = (
      await client.query(
        `SELECT installmentinvoiceprofiles_id, class_id, phase_start, total_phases,
                generated_count, is_active, downpayment_invoice_id
         FROM installmentinvoiceprofilestbl
         WHERE installmentinvoiceprofiles_id = $1 AND student_id = $2`,
        [PROFILE_ID, STUDENT_ID]
      )
    ).rows[0];
    if (!profile || Number(profile.class_id) !== CLASS_ID) {
      throw new Error(`Profile ${PROFILE_ID} not found on class ${CLASS_ID}`);
    }

    const enrollments = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status,
                TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD HH24:MI') AS enrolled,
                TO_CHAR(TIMEZONE('Asia/Manila', removed_at), 'YYYY-MM-DD HH24:MI') AS removed,
                LEFT(COALESCE(removed_reason, ''), 70) AS removed_reason
         FROM classstudentstbl
         WHERE student_id = $1 AND class_id = $2
         ORDER BY phase_number, classstudent_id`,
        [STUDENT_ID, CLASS_ID]
      )
    ).rows;

    const invoices = (
      await client.query(
        `SELECT invoice_id, invoice_ar_number, status,
                TO_CHAR(TIMEZONE('Asia/Manila', issue_date), 'YYYY-MM-DD') AS issue,
                TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due,
                LEFT(COALESCE(remarks, ''), 90) AS remarks
         FROM invoicestbl
         WHERE installmentinvoiceprofiles_id = $1
            OR invoice_id = ANY($2::int[])
         ORDER BY invoice_id`,
        [PROFILE_ID, [DOWNPAYMENT_INVOICE_ID, PHASE3_INVOICE_ID, PHASE4_INVOICE_ID, PHASE5_INVOICE_ID]]
      )
    ).rows;

    console.log('\nBEFORE profile:');
    console.table([profile]);
    console.log('BEFORE enrollments:');
    console.table(enrollments);
    console.log('BEFORE invoices:');
    console.table(invoices);
    console.log('BEFORE matrix:');
    console.table(await previewMatrix(query));

    const p3 = enrollments.find((e) => Number(e.classstudent_id) === PHASE3_CLASSSTUDENT_ID);
    const p4 = enrollments.find((e) => Number(e.classstudent_id) === PHASE4_CLASSSTUDENT_ID);
    const p5 = enrollments.find((e) => Number(e.classstudent_id) === PHASE5_CLASSSTUDENT_ID);
    const inv3 = invoices.find((i) => Number(i.invoice_id) === PHASE3_INVOICE_ID);
    const inv4 = invoices.find((i) => Number(i.invoice_id) === PHASE4_INVOICE_ID);
    const inv5 = invoices.find((i) => Number(i.invoice_id) === PHASE5_INVOICE_ID);

    if (!p4 || Number(p4.phase_number) !== 4) {
      throw new Error(`Phase 4 enrollment ${PHASE4_CLASSSTUDENT_ID} missing`);
    }
    if (!p5 || Number(p5.phase_number) !== 5) {
      throw new Error(`Phase 5 enrollment ${PHASE5_CLASSSTUDENT_ID} missing`);
    }
    if (!inv5 || !String(inv5.remarks || '').includes('TARGET_PHASE:5')) {
      throw new Error(`INV-${PHASE5_INVOICE_ID} is not TARGET_PHASE:5`);
    }
    if (inv3 && String(inv3.status) === 'Paid') {
      throw new Error(`INV-${PHASE3_INVOICE_ID} is Paid — refuse to cancel`);
    }

    console.log('\nPlanned:');
    console.log(
      `  1. Profile ${PROFILE_ID}: phase_start ${profile.phase_start}→${NEW_PHASE_START}, total_phases ${profile.total_phases}→${NEW_TOTAL_PHASES}, generated_count ${profile.generated_count}→${NEW_GENERATED_COUNT}`
    );
    console.log(
      `  2. DELETE false Phase 3 drop classstudent ${PHASE3_CLASSSTUDENT_ID}` +
        (p3 ? ` (${p3.program_enrollment_status})` : ' (already gone)')
    );
    console.log(
      `  3. Cancel unpaid INV-${PHASE3_INVOICE_ID}` +
        (inv3 ? ` (${inv3.status} ${inv3.issue}/${inv3.due})` : ' (already gone)')
    );
    console.log(
      `  4. Phase 4 classstudent ${PHASE4_CLASSSTUDENT_ID}: status new, enrolled_at → ${PHASE4_ENROLLED_AT}`
    );
    console.log(
      `  5. Phase 5 classstudent ${PHASE5_CLASSSTUDENT_ID}: rejoin→re_enrolled, enrolled_at → ${PHASE5_ENROLLED_AT}`
    );
    console.log(
      `  6. INV-${PHASE5_INVOICE_ID} due ${inv5.due} → ${PHASE5_DUE} (issue stays ${inv5.issue})`
    );
    console.log(`  7. Ensure INV-${PHASE4_INVOICE_ID} has TARGET_PHASE:4`);
    console.log('  8. Expect matrix: Jul new, Aug re-enrolled, Sep Active (no May dropped)');

    if (!isApply) {
      console.log('\nDry run only. Re-run with --apply to commit.');
      return;
    }

    await client.query('BEGIN');

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET phase_start = $1,
           total_phases = $2,
           generated_count = $3
       WHERE installmentinvoiceprofiles_id = $4
         AND student_id = $5`,
      [NEW_PHASE_START, NEW_TOTAL_PHASES, NEW_GENERATED_COUNT, PROFILE_ID, STUDENT_ID]
    );
    console.log(
      `✅ Profile → phase_start ${NEW_PHASE_START}, total_phases ${NEW_TOTAL_PHASES}, generated_count ${NEW_GENERATED_COUNT}`
    );

    if (p3) {
      await client.query(`DELETE FROM classstudentstbl WHERE classstudent_id = $1`, [
        PHASE3_CLASSSTUDENT_ID,
      ]);
      console.log(`✅ Deleted false Phase 3 drop classstudent ${PHASE3_CLASSSTUDENT_ID}`);
    }

    if (inv3 && !['Cancelled', 'Canceled'].includes(String(inv3.status))) {
      await client.query(
        `UPDATE invoicestbl
         SET status = 'Cancelled',
             remarks = CASE
               WHEN remarks ILIKE '%' || $2 || '%' THEN remarks
               WHEN remarks IS NULL OR TRIM(remarks) = '' THEN $2
               ELSE remarks || ' | ' || $2
             END
         WHERE invoice_id = $1`,
        [PHASE3_INVOICE_ID, REPAIR_NOTE]
      );
      console.log(`✅ Cancelled INV-${PHASE3_INVOICE_ID}`);
    }

    await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = 'new',
           enrolled_at = $1::timestamp,
           removed_at = NULL,
           removed_reason = NULL,
           enrolled_by = CASE
             WHEN enrolled_by IS NULL OR TRIM(enrolled_by) = '' THEN $2
             WHEN enrolled_by ILIKE '%' || $2 || '%' THEN enrolled_by
             ELSE enrolled_by || ' | ' || $2
           END
       WHERE classstudent_id = $3
         AND student_id = $4
         AND class_id = $5`,
      [PHASE4_ENROLLED_AT, REPAIR_NOTE, PHASE4_CLASSSTUDENT_ID, STUDENT_ID, CLASS_ID]
    );
    console.log(`✅ Phase 4 → new @ ${PHASE4_ENROLLED_AT}`);

    await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = 're_enrolled',
           enrolled_at = $1::timestamp,
           removed_at = NULL,
           removed_reason = NULL,
           enrolled_by = CASE
             WHEN enrolled_by IS NULL OR TRIM(enrolled_by) = '' THEN $2
             WHEN enrolled_by ILIKE '%' || $2 || '%' THEN enrolled_by
             ELSE enrolled_by || ' | ' || $2
           END
       WHERE classstudent_id = $3
         AND student_id = $4
         AND class_id = $5`,
      [PHASE5_ENROLLED_AT, REPAIR_NOTE, PHASE5_CLASSSTUDENT_ID, STUDENT_ID, CLASS_ID]
    );
    console.log(`✅ Phase 5 → re_enrolled @ ${PHASE5_ENROLLED_AT}`);

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
      [PHASE5_DUE, PHASE5_INVOICE_ID, REPAIR_NOTE, PROFILE_ID]
    );
    await syncProgramPaymentStatusForInvoice(client, PHASE5_INVOICE_ID);
    console.log(`✅ INV-${PHASE5_INVOICE_ID} due → ${PHASE5_DUE}`);

    if (inv4) {
      const fullInv4 = (
        await client.query(`SELECT remarks FROM invoicestbl WHERE invoice_id = $1`, [
          PHASE4_INVOICE_ID,
        ])
      ).rows[0];
      const nextRemarks = String(fullInv4?.remarks || '').includes('TARGET_PHASE:')
        ? rewriteTargetPhaseInRemarks(fullInv4.remarks, 4)
        : `${fullInv4?.remarks || ''};TARGET_PHASE:4`.replace(/^;/, '');
      await client.query(
        `UPDATE invoicestbl
         SET remarks = $1
         WHERE invoice_id = $2`,
        [nextRemarks, PHASE4_INVOICE_ID]
      );
      console.log(`✅ INV-${PHASE4_INVOICE_ID} TARGET_PHASE:4`);
    }

    await client.query(
      `UPDATE invoicestbl
       SET remarks = REPLACE(REPLACE(remarks, 'PHASE_START:3', 'PHASE_START:4'), 'PHASE_START:3;', 'PHASE_START:4;')
       WHERE invoice_id = $1
         AND remarks ILIKE '%PHASE_START:3%'`,
      [DOWNPAYMENT_INVOICE_ID]
    );

    await client.query('COMMIT');

    const afterCells = await previewMatrix(query);
    console.log('\nAFTER matrix:');
    console.table(afterCells);
    const problems = assertExpected(afterCells);
    if (problems.length) {
      console.warn('\n⚠ Matrix not fully aligned:');
      problems.forEach((p) => console.warn('  -', p));
    } else {
      console.log('\n✅ Matrix: Jul new, Aug re-enrolled, Sep Active.');
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
