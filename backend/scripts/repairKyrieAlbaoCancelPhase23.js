/**
 * Kyrie Robles Albao — cancel premature Phase 2 + Phase 3 invoices.
 *
 * Phase 1 (INV-2007) is unpaid and enrollment dropped (delinquency).
 * Phase 2 INV-2077 and Phase 3 INV-2187 must not exist / show Not Generated.
 * Profile #491 stays inactive. generated_count 3 → 1.
 *
 * Run:
 *   node backend/scripts/repairKyrieAlbaoCancelPhase23.js --production
 *   node backend/scripts/repairKyrieAlbaoCancelPhase23.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';

const STUDENT_ID = 623;
const STUDENT_EMAIL = 'andee.albao@gmail.com';
const CLASS_ID = 83;
const PROFILE_ID = 491;
const PHASE1_INVOICE_ID = 2007;
const CANCEL_INVOICES = [
  { invoiceId: 2077, phase: 2 },
  { invoiceId: 2187, phase: 3 },
];
const EXPECTED_GENERATED_COUNT = 1;

const REPAIR_NOTE =
  'Ops repair 2026-08-07 — Kyrie Albao cancel Phase 2/3 (Phase 1 dropped unpaid; no further phases)';

const isApply = process.argv.includes('--apply');

async function main() {
  console.log(
    `\nKyrie Albao — cancel Phase 2 + 3${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
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

    const profile = (
      await client.query(
        `SELECT installmentinvoiceprofiles_id, generated_count, total_phases, is_active,
                downpayment_invoice_id
         FROM installmentinvoiceprofilestbl
         WHERE installmentinvoiceprofiles_id = $1
           AND student_id = $2
           AND class_id = $3`,
        [PROFILE_ID, STUDENT_ID, CLASS_ID]
      )
    ).rows[0];
    if (!profile) throw new Error(`Profile ${PROFILE_ID} not found`);

    const phase1 = (
      await client.query(
        `SELECT invoice_id, status,
                TO_CHAR(issue_date,'YYYY-MM-DD') AS issue,
                TO_CHAR(due_date,'YYYY-MM-DD') AS due,
                remarks
         FROM invoicestbl WHERE invoice_id = $1`,
        [PHASE1_INVOICE_ID]
      )
    ).rows[0];
    if (!phase1) throw new Error(`Phase 1 INV-${PHASE1_INVOICE_ID} not found`);
    if (parseTargetPhase(phase1.remarks) !== 1) {
      throw new Error('INV-2007 is not TARGET_PHASE:1');
    }
    if (String(phase1.status) !== 'Unpaid') {
      throw new Error(`Phase 1 status is ${phase1.status} — expected Unpaid`);
    }

    const enrollments = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status,
                TO_CHAR(TIMEZONE('Asia/Manila', removed_at),'YYYY-MM-DD') AS removed
         FROM classstudentstbl
         WHERE student_id = $1 AND class_id = $2
         ORDER BY phase_number`,
        [STUDENT_ID, CLASS_ID]
      )
    ).rows;

    const queueRows = (
      await client.query(
        `SELECT installmentinvoicedtl_id, status,
                TO_CHAR(next_generation_date,'YYYY-MM-DD') AS next_gen,
                TO_CHAR(next_invoice_month,'YYYY-MM-DD') AS next_month,
                TO_CHAR(scheduled_date,'YYYY-MM-DD') AS scheduled
         FROM installmentinvoicestbl
         WHERE installmentinvoiceprofiles_id = $1
         ORDER BY installmentinvoicedtl_id`,
        [PROFILE_ID]
      )
    ).rows;

    console.log('BEFORE profile:', profile);
    console.log('BEFORE Phase 1 (keep):', phase1);
    console.log('BEFORE enrollments:');
    console.table(enrollments);
    console.log('BEFORE queue rows:');
    console.table(queueRows);

    const cancelPlan = [];
    for (const item of CANCEL_INVOICES) {
      const inv = (
        await client.query(
          `SELECT invoice_id, status, remarks,
                  installmentinvoiceprofiles_id AS profile_id,
                  TO_CHAR(issue_date,'YYYY-MM-DD') AS issue,
                  TO_CHAR(due_date,'YYYY-MM-DD') AS due
           FROM invoicestbl WHERE invoice_id = $1`,
          [item.invoiceId]
        )
      ).rows[0];
      if (!inv) throw new Error(`INV-${item.invoiceId} not found`);
      if (Number(inv.profile_id) !== PROFILE_ID) {
        throw new Error(`INV-${item.invoiceId} not on profile ${PROFILE_ID}`);
      }
      if (parseTargetPhase(inv.remarks) !== item.phase) {
        throw new Error(
          `INV-${item.invoiceId} expected TARGET_PHASE:${item.phase}, got ${parseTargetPhase(inv.remarks)}`
        );
      }
      if (['Cancelled', 'Canceled'].includes(String(inv.status))) {
        console.log(`INV-${item.invoiceId} already cancelled — skip`);
        continue;
      }
      if (String(inv.status) !== 'Unpaid') {
        throw new Error(
          `INV-${item.invoiceId} status ${inv.status} — refuse (expected Unpaid)`
        );
      }
      const payments = (
        await client.query(
          `SELECT payment_id, status, approval_status
           FROM paymenttbl WHERE invoice_id = $1`,
          [item.invoiceId]
        )
      ).rows;
      if (
        payments.some(
          (p) =>
            String(p.status) === 'Completed' &&
            String(p.approval_status || '') !== 'Rejected'
        )
      ) {
        throw new Error(`INV-${item.invoiceId} has completed payments — refuse`);
      }
      cancelPlan.push({ ...item, inv, payments });
    }

    console.log('\nPlanned:');
    for (const c of cancelPlan) {
      console.log(
        `  • Cancel + detach INV-${c.invoiceId} (Phase ${c.phase}) ${c.inv.issue}/${c.inv.due}`
      );
    }
    console.log(
      `  • generated_count ${profile.generated_count} → ${EXPECTED_GENERATED_COUNT}`
    );
    console.log('  • Clear installment queue next_* dates (profile inactive)');
    console.log('  • Phase 1 INV-2007 untouched (Unpaid / dropped)');
    console.log('  • Expect Phase 2 + 3: Not Generated');

    for (const c of cancelPlan) {
      const nextRemarks = [c.inv.remarks, REPAIR_NOTE].filter(Boolean).join(';');
      await client.query(
        `UPDATE invoicestbl
         SET status = 'Cancelled',
             installmentinvoiceprofiles_id = NULL,
             remarks = $1
         WHERE invoice_id = $2
           AND installmentinvoiceprofiles_id = $3`,
        [nextRemarks, c.invoiceId, PROFILE_ID]
      );
      await client.query(`DELETE FROM program_payment_statustbl WHERE invoice_id = $1`, [
        c.invoiceId,
      ]);
    }

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET generated_count = $1
       WHERE installmentinvoiceprofiles_id = $2`,
      [EXPECTED_GENERATED_COUNT, PROFILE_ID]
    );

    // Stop further auto-generation on inactive dropped plan.
    await client.query(
      `UPDATE installmentinvoicestbl
       SET status = 'Generated',
           next_generation_date = NULL,
           next_invoice_month = NULL
       WHERE installmentinvoiceprofiles_id = $1`,
      [PROFILE_ID]
    );

    const afterInvoices = (
      await client.query(
        `SELECT invoice_id, status, installmentinvoiceprofiles_id,
                SUBSTRING(remarks FROM 'TARGET_PHASE:([0-9]+)') AS phase,
                TO_CHAR(issue_date,'YYYY-MM-DD') AS issue,
                TO_CHAR(due_date,'YYYY-MM-DD') AS due
         FROM invoicestbl
         WHERE invoice_id = ANY($1::int[])
            OR installmentinvoiceprofiles_id = $2
         ORDER BY invoice_id`,
        [
          [PHASE1_INVOICE_ID, ...CANCEL_INVOICES.map((c) => c.invoiceId)],
          PROFILE_ID,
        ]
      )
    ).rows;

    const afterProfile = (
      await client.query(
        `SELECT installmentinvoiceprofiles_id, generated_count, is_active
         FROM installmentinvoiceprofilestbl
         WHERE installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      )
    ).rows[0];

    const afterQueue = (
      await client.query(
        `SELECT installmentinvoicedtl_id, status,
                TO_CHAR(next_generation_date,'YYYY-MM-DD') AS next_gen,
                TO_CHAR(next_invoice_month,'YYYY-MM-DD') AS next_month
         FROM installmentinvoicestbl
         WHERE installmentinvoiceprofiles_id = $1
         ORDER BY installmentinvoicedtl_id`,
        [PROFILE_ID]
      )
    ).rows;

    console.log('\nAFTER invoices:');
    console.table(afterInvoices);
    console.log('AFTER profile:', afterProfile);
    console.log('AFTER queue:');
    console.table(afterQueue);

    const p1 = afterInvoices.find((r) => Number(r.invoice_id) === PHASE1_INVOICE_ID);
    if (!p1 || p1.status !== 'Unpaid' || Number(p1.installmentinvoiceprofiles_id) !== PROFILE_ID) {
      throw new Error('Phase 1 must remain Unpaid on profile');
    }
    for (const c of CANCEL_INVOICES) {
      const row = afterInvoices.find((r) => Number(r.invoice_id) === c.invoiceId);
      if (!row || row.status !== 'Cancelled' || row.installmentinvoiceprofiles_id != null) {
        throw new Error(`INV-${c.invoiceId} cancel/detach validation failed`);
      }
    }
    if (Number(afterProfile.generated_count) !== EXPECTED_GENERATED_COUNT) {
      throw new Error('generated_count validation failed');
    }
    if (
      afterInvoices.some(
        (r) =>
          Number(r.installmentinvoiceprofiles_id) === PROFILE_ID &&
          ['2', '3'].includes(String(r.phase)) &&
          !['Cancelled', 'Canceled'].includes(String(r.status))
      )
    ) {
      throw new Error('Phase 2/3 still active on profile');
    }

    if (!isApply) {
      await client.query('ROLLBACK');
      console.log('\nRolled back (dry run). Re-run with --apply to commit.');
      return;
    }

    await client.query('COMMIT');
    console.log(
      '\nCommitted. Refresh Student History — Phase 2/3 should show Not Generated.'
    );
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
