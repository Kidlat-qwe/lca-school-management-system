/**
 * Jianna Mavelle Mirabuenos (student 642) — shift installment start Phase 2 → Phase 4.
 *
 * Keep invoice issue_date, due_date, and payment_date unchanged.
 *
 * Changes:
 *   - profile #470 phase_start 2 → 4; total_phases 9 → 7 (phases 4–10)
 *   - INV-1845 TARGET_PHASE:2 → TARGET_PHASE:4
 *   - DP INV-1844 PHASE_START:2 → PHASE_START:4
 *   - classstudent 1487 (and dropped 1486) phase_number 2 → 4
 *
 * Run:
 *   node backend/scripts/repairJiannaMirabuenosPhaseStart4.js
 *   node backend/scripts/repairJiannaMirabuenosPhaseStart4.js --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';
import { rewriteTargetPhaseInRemarks } from '../utils/installmentPhaseBillingSync.js';

const STUDENT_ID = 642;
const PROFILE_ID = 470;
const CLASS_ID = 92;
const BRANCH_ID = 1;
const PHASE_INVOICE_ID = 1845;
const DP_INVOICE_ID = 1844;
const ACTIVE_CS_ID = 1487;
const DROPPED_CS_ID = 1486;
const NEW_PHASE_START = 4;
const NEW_TOTAL_PHASES = 7; // 4..10
const REPAIR_NOTE = ' | Ops repair — phase_start 2→4 (keep issue/due/paid dates)';

const isApply = process.argv.includes('--apply');

async function previewMatrix() {
  const matrix = await loadStudentMonthEnrollmentMatrix(query, {
    year: 2026,
    branchId: BRANCH_ID,
    classId: CLASS_ID,
  });
  const track = (matrix.students || []).find(
    (s) => s.student_id === STUDENT_ID && s.class_id === CLASS_ID
  );
  const cells = [];
  for (const m of matrix.months || []) {
    const c = track?.months?.[m.key];
    if (c && (c.mark === '1' || c.mark === '✓' || c.mark === 'X' || c.label)) {
      cells.push({
        month: m.key,
        label: c.label,
        status: c.status,
        phase: c.phase_number,
      });
    }
  }
  return cells;
}

async function snapshot(client) {
  const profile = (
    await client.query(
      `SELECT installmentinvoiceprofiles_id, phase_start, total_phases, generated_count,
              TO_CHAR(TIMEZONE('Asia/Manila', first_billing_month),'YYYY-MM-DD') AS first_billing
       FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1`,
      [PROFILE_ID]
    )
  ).rows[0];

  const invoices = (
    await client.query(
      `SELECT invoice_id, invoice_ar_number AS ar, status,
              TO_CHAR(issue_date,'YYYY-MM-DD') AS issue,
              TO_CHAR(due_date,'YYYY-MM-DD') AS due,
              remarks
       FROM invoicestbl WHERE invoice_id IN ($1, $2) ORDER BY invoice_id`,
      [DP_INVOICE_ID, PHASE_INVOICE_ID]
    )
  ).rows;

  const payments = (
    await client.query(
      `SELECT payment_id, invoice_id,
              TO_CHAR(TIMEZONE('Asia/Manila', issue_date),'YYYY-MM-DD') AS payment_issue,
              payable_amount::text AS amount, status, approval_status
       FROM paymenttbl WHERE invoice_id IN ($1, $2) ORDER BY payment_id`,
      [DP_INVOICE_ID, PHASE_INVOICE_ID]
    )
  ).rows;

  const enrollments = (
    await client.query(
      `SELECT classstudent_id, phase_number, program_enrollment_status
       FROM classstudentstbl
       WHERE classstudent_id IN ($1, $2)
       ORDER BY classstudent_id`,
      [DROPPED_CS_ID, ACTIVE_CS_ID]
    )
  ).rows;

  return { profile, invoices, payments, enrollments };
}

async function main() {
  console.log(
    `\nJianna Mirabuenos — phase_start 2 → 4${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );

  const client = await getClient();
  try {
    const before = await snapshot(client);
    console.log('Profile BEFORE:', before.profile);
    console.log('Invoices BEFORE:');
    for (const i of before.invoices) {
      console.log({
        id: i.invoice_id,
        ar: i.ar,
        status: i.status,
        issue: i.issue,
        due: i.due,
        remarks: i.remarks,
      });
    }
    console.log('Payments BEFORE:');
    console.table(before.payments);
    console.log('Enrollments BEFORE:');
    console.table(before.enrollments);
    console.log('Matrix BEFORE:');
    console.table(await previewMatrix());

    const phaseInv = before.invoices.find((i) => i.invoice_id === PHASE_INVOICE_ID);
    if (!phaseInv) throw new Error('Phase invoice 1845 not found');
    if (String(phaseInv.issue) !== '2026-07-01' || String(phaseInv.due) !== '2026-05-08') {
      console.warn('Note: issue/due differ from expected Jul 01 / May 08 — will still preserve current values.');
    }

    console.log('\nPlanned:');
    console.log('  • profile phase_start 2→4, total_phases 9→7');
    console.log('  • INV-1845 TARGET_PHASE 2→4 (issue/due unchanged)');
    console.log('  • DP remarks PHASE_START 2→4');
    console.log('  • classstudent phase_number 2→4');
    console.log('  • payments untouched');

    if (!isApply) {
      console.log('\nDRY RUN — re-run with --apply');
      return;
    }

    await client.query('BEGIN');

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET phase_start = $1,
           total_phases = $2
       WHERE installmentinvoiceprofiles_id = $3`,
      [NEW_PHASE_START, NEW_TOTAL_PHASES, PROFILE_ID]
    );

    const newRemarks = rewriteTargetPhaseInRemarks(phaseInv.remarks, NEW_PHASE_START);
    // Keep issue_date and due_date unchanged — only retarget phase in remarks.
    await client.query(`UPDATE invoicestbl SET remarks = $1 WHERE invoice_id = $2`, [
      newRemarks,
      PHASE_INVOICE_ID,
    ]);

    const dp = before.invoices.find((i) => i.invoice_id === DP_INVOICE_ID);
    if (dp?.remarks) {
      const dpRemarks = String(dp.remarks)
        .replace(/PHASE_START:\d+/i, `PHASE_START:${NEW_PHASE_START}`)
        .replace(/PHASE_END:\d+/i, 'PHASE_END:10');
      await client.query(`UPDATE invoicestbl SET remarks = $1 WHERE invoice_id = $2`, [
        dpRemarks,
        DP_INVOICE_ID,
      ]);
    }

    await client.query(
      `UPDATE classstudentstbl
       SET phase_number = $1,
           enrolled_by = COALESCE(enrolled_by, '') || $2
       WHERE classstudent_id = ANY($3::int[])`,
      [NEW_PHASE_START, REPAIR_NOTE, [DROPPED_CS_ID, ACTIVE_CS_ID]]
    );

    await client.query('COMMIT');
    console.log('\nApplied.');

    const after = await snapshot(client);
    console.log('Profile AFTER:', after.profile);
    console.log('Invoices AFTER:');
    for (const i of after.invoices) {
      console.log({
        id: i.invoice_id,
        ar: i.ar,
        status: i.status,
        issue: i.issue,
        due: i.due,
        remarks: i.remarks,
      });
    }
    console.log('Payments AFTER (unchanged):');
    console.table(after.payments);
    console.log('Enrollments AFTER:');
    console.table(after.enrollments);
    console.log('Matrix AFTER:');
    console.table(await previewMatrix());
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error('Repair failed:', err.message);
  process.exit(1);
});
