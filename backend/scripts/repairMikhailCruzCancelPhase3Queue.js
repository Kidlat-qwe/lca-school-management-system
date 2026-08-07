/**
 * Mikhail Cruz (KG_1-3PM class 83) — cancel premature Phase 3; reset queue.
 *
 * Phase 2 paid (correct). Phase 3 INV-2289 should not exist yet.
 * Queue: next_generation_date 2026-08-25, scheduled/due 2026-09-05
 *         (next_invoice_month 2026-09-01).
 *
 * Run:
 *   node backend/scripts/repairMikhailCruzCancelPhase3Queue.js --production
 *   node backend/scripts/repairMikhailCruzCancelPhase3Queue.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';

const STUDENT_ID = 530;
const STUDENT_EMAIL = 'abegailhernandez7@gmail.com';
const CLASS_ID = 83;
const BRANCH_ID = 5;
const PROFILE_ID = 314;
const PHASE3_INVOICE_ID = 2289;
const EXPECTED_PHASE = 3;

const NEXT_GEN = '2026-08-25';
const NEXT_MONTH = '2026-09-01';
const SCHEDULED_DUE = '2026-09-05';
const EXPECTED_GENERATED_COUNT = 2;

const REPAIR_NOTE =
  'Ops repair 2026-08-07 — Mikhail Cruz cancel premature Phase 3; queue Aug 25 / Sep 5';

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
    `\nMikhail Cruz — cancel Phase 3 + queue${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
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
        `SELECT invoice_id, status, amount, invoice_ar_number, remarks,
                installmentinvoiceprofiles_id AS profile_id,
                TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue,
                TO_CHAR(due_date, 'YYYY-MM-DD') AS due
         FROM invoicestbl WHERE invoice_id = $1`,
        [PHASE3_INVOICE_ID]
      )
    ).rows[0];
    if (!inv) throw new Error(`INV-${PHASE3_INVOICE_ID} not found`);
    if (Number(inv.profile_id) !== PROFILE_ID) {
      throw new Error(`INV profile ${inv.profile_id} ≠ ${PROFILE_ID}`);
    }
    const phase = parseTargetPhase(inv.remarks);
    if (phase !== EXPECTED_PHASE) {
      throw new Error(`Expected TARGET_PHASE:${EXPECTED_PHASE}, got ${phase}`);
    }
    if (!['Unpaid', 'unpaid'].includes(String(inv.status))) {
      throw new Error(`Phase 3 status is ${inv.status} — refuse (expected Unpaid)`);
    }

    const payments = (
      await client.query(
        `SELECT payment_id, status, approval_status, payable_amount
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
      throw new Error('Phase 3 has completed payments — refuse to cancel');
    }

    const profile = (
      await client.query(
        `SELECT ip.installmentinvoiceprofiles_id, ip.generated_count, ip.is_active,
                ii.installmentinvoicedtl_id,
                TO_CHAR(ii.next_generation_date,'YYYY-MM-DD') AS next_gen,
                TO_CHAR(ii.next_invoice_month,'YYYY-MM-DD') AS next_month,
                TO_CHAR(ii.scheduled_date,'YYYY-MM-DD') AS scheduled
         FROM installmentinvoiceprofilestbl ip
         LEFT JOIN installmentinvoicestbl ii
           ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
         WHERE ip.installmentinvoiceprofiles_id = $1
           AND ip.student_id = $2
           AND ip.class_id = $3`,
        [PROFILE_ID, STUDENT_ID, CLASS_ID]
      )
    ).rows[0];
    if (!profile) throw new Error('Profile not found');

    console.log('BEFORE invoice:', inv);
    console.log('BEFORE payments:', payments);
    console.log('BEFORE profile/queue:', profile);
    const txQuery = (text, params) => client.query(text, params);

    console.log('BEFORE matrix:');
    console.table(await previewMatrix(query));

    console.log('\nPlanned:');
    console.log(`  1. Cancel + detach INV-${PHASE3_INVOICE_ID} (Phase 3)`);
    console.log(
      `  2. generated_count ${profile.generated_count} → ${EXPECTED_GENERATED_COUNT}`
    );
    console.log(
      `  3. Queue → next_gen ${NEXT_GEN}, next_month ${NEXT_MONTH}, scheduled ${SCHEDULED_DUE}`
    );
    console.log('  4. Phase 2 invoices untouched; Phase 3 shows Not Generated');
    console.log('  5. Expect matrix: Jul new, Aug re-enrolled, Sep Active (no unpaid P3)');

    const nextRemarks = [inv.remarks, REPAIR_NOTE].filter(Boolean).join(';');

    await client.query(
      `UPDATE invoicestbl
       SET status = 'Cancelled',
           installmentinvoiceprofiles_id = NULL,
           remarks = $1
       WHERE invoice_id = $2
         AND installmentinvoiceprofiles_id = $3`,
      [nextRemarks, PHASE3_INVOICE_ID, PROFILE_ID]
    );

    await client.query(
      `DELETE FROM program_payment_statustbl WHERE invoice_id = $1`,
      [PHASE3_INVOICE_ID]
    );

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

    const afterInv = (
      await client.query(
        `SELECT invoice_id, status, installmentinvoiceprofiles_id,
                LEFT(remarks, 140) AS remarks
         FROM invoicestbl WHERE invoice_id = $1`,
        [PHASE3_INVOICE_ID]
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
    const remaining = (
      await client.query(
        `SELECT invoice_id, status,
                SUBSTRING(remarks FROM 'TARGET_PHASE:([0-9]+)') AS phase,
                TO_CHAR(issue_date,'YYYY-MM-DD') AS issue,
                TO_CHAR(due_date,'YYYY-MM-DD') AS due
         FROM invoicestbl
         WHERE installmentinvoiceprofiles_id = $1
           AND COALESCE(status,'') NOT IN ('Cancelled','Canceled')
         ORDER BY invoice_id`,
        [PROFILE_ID]
      )
    ).rows;

    console.log('\nAFTER invoice:', afterInv);
    console.log('AFTER profile/queue:', afterProfile);
    console.log('Remaining profile invoices:');
    console.table(remaining);
    console.log('AFTER matrix (in-transaction):');
    console.table(await previewMatrix(txQuery));

    if (afterInv.status !== 'Cancelled' || afterInv.installmentinvoiceprofiles_id != null) {
      throw new Error('Cancel/detach validation failed');
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
    if (remaining.some((r) => Number(r.phase) === 3)) {
      throw new Error('Phase 3 still on profile');
    }

    if (!isApply) {
      await client.query('ROLLBACK');
      console.log('\nRolled back (dry run). Re-run with --apply to commit.');
      return;
    }

    await client.query('COMMIT');
    console.log('\nCommitted. Refresh Student History → Invoices + Installment Logs.');
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
