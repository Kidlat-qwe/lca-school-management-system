/**
 * James Adam J. Vitto (KG_1-3PM class 83) — August Inactive under grace / partial Phase 2.
 *
 * Phase 2 advance is Partially Paid (₱566 open, due 2026-08-05). Phase 3 INV-2178
 * was generated while Phase 2 is incomplete (UI warns to settle Phase 2 first).
 *
 * Plan:
 *  1. Cancel + detach premature Phase 3 INV-2178
 *  2. generated_count 3 → 2
 *  3. Queue → Aug 25 / Sep 01 / scheduled Sep 05
 *  4. DELETE Phase 2 classstudent 1899 (Aug re_enrolled blocked Inactive overlay).
 *     After removal: Jul new → Aug Inactive from unpaid Phase 2 due (grace/overdue).
 *  Phase 1 + Phase 2 invoices untouched (dates/amounts/payments).
 *
 * Run:
 *   node backend/scripts/repairJamesVittoAugustInactive.js --production
 *   node backend/scripts/repairJamesVittoAugustInactive.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';

const STUDENT_ID = 583;
const STUDENT_EMAIL = 'ladyannjuan@gmail.com';
const CLASS_ID = 83;
const BRANCH_ID = 5;
const PROFILE_ID = 388;
const PHASE3_INVOICE_ID = 2178;
const PHASE2_CLASSSTUDENT_ID = 1899;
const EXPECTED_PHASE = 3;

const NEXT_GEN = '2026-08-25';
const NEXT_MONTH = '2026-09-01';
const SCHEDULED_DUE = '2026-09-05';
const EXPECTED_GENERATED_COUNT = 2;

const REPAIR_NOTE =
  'Ops repair 2026-08-07 — James Vitto cancel premature Phase 3; Aug Inactive (partial P2 under grace)';

const isApply = process.argv.includes('--apply');

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

async function main() {
  console.log(
    `\nJames Vitto — Aug Inactive + cancel Phase 3${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`Note: ${REPAIR_NOTE}\n`);

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const student = (
      await client.query(
        `SELECT user_id, full_name, email FROM userstbl
         WHERE user_id = $1 AND LOWER(TRIM(email)) = LOWER(TRIM($2))`,
        [STUDENT_ID, STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student) throw new Error('Student not found');
    console.log('Student:', student.full_name, student.email);

    const inv = (
      await client.query(
        `SELECT invoice_id, status, amount, remarks,
                installmentinvoiceprofiles_id AS profile_id,
                TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue,
                TO_CHAR(due_date, 'YYYY-MM-DD') AS due
         FROM invoicestbl WHERE invoice_id = $1`,
        [PHASE3_INVOICE_ID]
      )
    ).rows[0];
    if (!inv) throw new Error(`INV-${PHASE3_INVOICE_ID} not found`);
    if (Number(inv.profile_id) !== PROFILE_ID) {
      throw new Error(`INV profile mismatch`);
    }
    if (parseTargetPhase(inv.remarks) !== EXPECTED_PHASE) {
      throw new Error(`INV is not TARGET_PHASE:${EXPECTED_PHASE}`);
    }
    if (String(inv.status) !== 'Unpaid') {
      throw new Error(`Phase 3 status ${inv.status} — expected Unpaid`);
    }

    const payments = (
      await client.query(
        `SELECT payment_id, status, approval_status
         FROM paymenttbl WHERE invoice_id = $1`,
        [PHASE3_INVOICE_ID]
      )
    ).rows;
    if (
      payments.some(
        (p) =>
          String(p.status) === 'Completed' &&
          String(p.approval_status || '') !== 'Rejected'
      )
    ) {
      throw new Error('Phase 3 has completed payments — refuse');
    }

    const phase2Cs = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status,
                TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD HH24:MI') AS enrolled,
                TO_CHAR(TIMEZONE('Asia/Manila', removed_at), 'YYYY-MM-DD') AS removed
         FROM classstudentstbl
         WHERE classstudent_id = $1 AND student_id = $2 AND class_id = $3`,
        [PHASE2_CLASSSTUDENT_ID, STUDENT_ID, CLASS_ID]
      )
    ).rows[0];
    if (!phase2Cs || Number(phase2Cs.phase_number) !== 2) {
      throw new Error(`Phase 2 classstudent ${PHASE2_CLASSSTUDENT_ID} not found`);
    }

    const profile = (
      await client.query(
        `SELECT ip.installmentinvoiceprofiles_id, ip.generated_count,
                ii.installmentinvoicedtl_id,
                TO_CHAR(ii.next_generation_date,'YYYY-MM-DD') AS next_gen,
                TO_CHAR(ii.next_invoice_month,'YYYY-MM-DD') AS next_month,
                TO_CHAR(ii.scheduled_date,'YYYY-MM-DD') AS scheduled
         FROM installmentinvoiceprofilestbl ip
         LEFT JOIN installmentinvoicestbl ii
           ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
         WHERE ip.installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      )
    ).rows[0];

    const p2Invoices = (
      await client.query(
        `SELECT invoice_id, status,
                TO_CHAR(issue_date,'YYYY-MM-DD') AS issue,
                TO_CHAR(due_date,'YYYY-MM-DD') AS due,
                amount
         FROM invoicestbl
         WHERE installmentinvoiceprofiles_id = $1
           AND remarks ILIKE '%TARGET_PHASE:2%'
         ORDER BY invoice_id`,
        [PROFILE_ID]
      )
    ).rows;

    console.log('BEFORE Phase 3:', inv);
    console.log('BEFORE Phase 2 CS:', phase2Cs);
    console.log('BEFORE Phase 2 invoices (untouched):');
    console.table(p2Invoices);
    console.log('BEFORE profile/queue:', profile);
    const txQuery = (text, params) => client.query(text, params);

    console.log('BEFORE matrix:');
    console.table(await previewMatrix(query));

    console.log('\nPlanned:');
    console.log(`  1. Cancel + detach INV-${PHASE3_INVOICE_ID} (premature Phase 3)`);
    console.log(
      `  2. generated_count ${profile.generated_count} → ${EXPECTED_GENERATED_COUNT}`
    );
    console.log(
      `  3. Queue → ${NEXT_GEN} / ${NEXT_MONTH} / scheduled ${SCHEDULED_DUE}`
    );
    console.log(
      `  4. DELETE classstudent ${PHASE2_CLASSSTUDENT_ID} (Phase 2) so Aug → Inactive`
    );
    console.log('  5. Phase 1 + Phase 2 invoices untouched');
    console.log('  6. Expect matrix: Jul new, Aug Inactive');

    const nextRemarks = [inv.remarks, REPAIR_NOTE].filter(Boolean).join(';');
    await client.query(
      `UPDATE invoicestbl
       SET status = 'Cancelled',
           installmentinvoiceprofiles_id = NULL,
           remarks = $1
       WHERE invoice_id = $2 AND installmentinvoiceprofiles_id = $3`,
      [nextRemarks, PHASE3_INVOICE_ID, PROFILE_ID]
    );
    await client.query(`DELETE FROM program_payment_statustbl WHERE invoice_id = $1`, [
      PHASE3_INVOICE_ID,
    ]);

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET generated_count = $1
       WHERE installmentinvoiceprofiles_id = $2`,
      [EXPECTED_GENERATED_COUNT, PROFILE_ID]
    );

    await client.query(
      `UPDATE installmentinvoicestbl
       SET status = NULL,
           next_generation_date = $1::date,
           next_invoice_month = $2::date,
           scheduled_date = $3::date
       WHERE installmentinvoicedtl_id = $4`,
      [NEXT_GEN, NEXT_MONTH, SCHEDULED_DUE, profile.installmentinvoicedtl_id]
    );

    // Remove Phase 2 enrollment row so Aug is not locked as re_enrolled.
    await client.query(
      `DELETE FROM classstudentstbl
       WHERE classstudent_id = $1
         AND student_id = $2
         AND class_id = $3
         AND phase_number = 2`,
      [PHASE2_CLASSSTUDENT_ID, STUDENT_ID, CLASS_ID]
    );

    const afterInv = (
      await client.query(
        `SELECT invoice_id, status, installmentinvoiceprofiles_id
         FROM invoicestbl WHERE invoice_id = $1`,
        [PHASE3_INVOICE_ID]
      )
    ).rows[0];
    const afterCs = (
      await client.query(
        `SELECT classstudent_id FROM classstudentstbl WHERE classstudent_id = $1`,
        [PHASE2_CLASSSTUDENT_ID]
      )
    ).rows[0];
    const afterProfile = (
      await client.query(
        `SELECT ip.generated_count,
                TO_CHAR(ii.next_generation_date,'YYYY-MM-DD') AS next_gen,
                TO_CHAR(ii.next_invoice_month,'YYYY-MM-DD') AS next_month,
                TO_CHAR(ii.scheduled_date,'YYYY-MM-DD') AS scheduled
         FROM installmentinvoiceprofilestbl ip
         LEFT JOIN installmentinvoicestbl ii
           ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
         WHERE ip.installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      )
    ).rows[0];
    const afterMatrix = await previewMatrix(txQuery);

    console.log('\nAFTER Phase 3:', afterInv);
    console.log('AFTER Phase 2 CS:', afterCs || 'deleted');
    console.log('AFTER profile/queue:', afterProfile);
    console.log('AFTER matrix (in-transaction):');
    console.table(afterMatrix);

    if (afterInv.status !== 'Cancelled' || afterInv.installmentinvoiceprofiles_id != null) {
      throw new Error('Phase 3 cancel validation failed');
    }
    if (Number(afterProfile.generated_count) !== EXPECTED_GENERATED_COUNT) {
      throw new Error('generated_count validation failed');
    }
    if (
      afterProfile.next_gen !== NEXT_GEN ||
      afterProfile.next_month !== NEXT_MONTH ||
      afterProfile.scheduled !== SCHEDULED_DUE
    ) {
      throw new Error('Queue validation failed');
    }
    if (afterCs) {
      throw new Error('Phase 2 CS delete validation failed');
    }

    const byMonth = Object.fromEntries(afterMatrix.map((c) => [c.month, c]));
    if (byMonth['2026-08']?.label !== 'Inactive') {
      console.warn(
        `⚠ August expected Inactive, got ${byMonth['2026-08']?.label || 'missing'}`
      );
    } else {
      console.log('\n✅ August Inactive');
    }

    if (!isApply) {
      await client.query('ROLLBACK');
      console.log('\nRolled back (dry run). Re-run with --apply to commit.');
      return;
    }

    await client.query('COMMIT');
    console.log('\nCommitted. Refresh Student History + re-enrollment matrix.');
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
