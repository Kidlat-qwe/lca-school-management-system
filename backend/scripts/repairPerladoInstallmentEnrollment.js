/**
 * Lz Grace Lutrania Perlado — realign installment after downpayment.
 *
 * Target:
 *   - Downpayment (INV-786/787 chain) May 05, 2026 — not a phase row
 *   - Phase 1 only: INV-789 issue 2026-06-25, due 2026-06-30, unpaid
 *   - Remove erroneous phase 3 invoice INV-1729
 *   - generated_count = 1; phase 1 enrollment = pending_enrollment
 *
 * Run:
 *   node backend/scripts/repairPerladoInstallmentEnrollment.js
 *   node backend/scripts/repairPerladoInstallmentEnrollment.js --apply
 */

import '../config/loadEnv.js';
import pkg from 'pg';
import { deriveInvoiceStatusForInvoice } from '../utils/invoicePaymentStatus.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';
import { buildPhaseInstallmentSchedule } from '../utils/phaseInstallmentUtils.js';
import { loadInstallmentProfilePhaseChains } from '../lib/installmentPaymentEligibility.js';
import { mapPhaseChainsToLocalSlots } from '../utils/installmentPhaseRowMapping.js';
import { resolveProfilePhaseStart } from '../utils/phaseInstallmentUtils.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';

const { Pool } = pkg;
const useProduction = process.argv.includes('--production');
const isApply = process.argv.includes('--apply');

const pool = new Pool({
  host: useProduction ? process.env.DB_HOST_PRODUCTION : process.env.DB_HOST,
  port: parseInt(
    (useProduction ? process.env.DB_PORT_PRODUCTION : process.env.DB_PORT) || '5432'
  ),
  database: useProduction
    ? process.env.DB_NAME_PRODUCTION || 'psms_production'
    : process.env.DB_NAME || 'psms_db',
  user: useProduction ? process.env.DB_USER_PRODUCTION : process.env.DB_USER,
  password: useProduction
    ? process.env.DB_PASSWORD_PRODUCTION
    : process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

const STUDENT_EMAIL = 'cherriemae.perlado@gmail.com';
const STUDENT_ID = 528;
const PROFILE_ID = 311;
const CLASS_ID = 88;
const DOWNPAYMENT_CHAIN_ROOT = 786;
const PHASE1_INVOICE_ID = 789;
const ORPHAN_INVOICE_ID = 1729;
const ENROLLMENT_ROW_ID = 868;
const PHASE1_ISSUE = '2026-06-25';
const PHASE1_DUE = '2026-06-30';
const REPAIR_NOTE = 'Ops repair 2026-06-29 — Perlado downpayment vs phase 1 billing';

async function sumCompletedSettlement(client, invoiceId) {
  const r = await client.query(
    `SELECT COALESCE(SUM(COALESCE(payable_amount, 0) + COALESCE(discount_amount, 0)), 0) AS total
     FROM paymenttbl
     WHERE invoice_id = $1
       AND status = 'Completed'
       AND COALESCE(approval_status, 'Pending') <> 'Rejected'`,
    [invoiceId]
  );
  return parseFloat(r.rows[0]?.total) || 0;
}

async function refreshInvoiceStatus(client, invoiceId) {
  const inv = (
    await client.query(`SELECT invoice_id, amount, status FROM invoicestbl WHERE invoice_id = $1`, [
      invoiceId,
    ])
  ).rows[0];
  if (!inv) return;
  const settled = await sumCompletedSettlement(client, invoiceId);
  const nextStatus = await deriveInvoiceStatusForInvoice(client, invoiceId, {
    totalSettled: settled,
    originalInvoiceAmount: inv.amount,
    previousStatus: inv.status,
  });
  if (nextStatus !== inv.status) {
    await client.query(`UPDATE invoicestbl SET status = $1 WHERE invoice_id = $2`, [
      nextStatus,
      invoiceId,
    ]);
  }
}

async function deleteInvoiceCascade(client, invoiceId) {
  await client.query(`DELETE FROM program_payment_statustbl WHERE invoice_id = $1`, [invoiceId]);
  await client.query(`DELETE FROM invoicestudentstbl WHERE invoice_id = $1`, [invoiceId]);
  await client.query(`DELETE FROM invoiceitemstbl WHERE invoice_id = $1`, [invoiceId]);
  await client.query(`DELETE FROM invoicestbl WHERE invoice_id = $1`, [invoiceId]);
}

async function loadPhaseMapping(client, profile) {
  const { phaseChains } = await loadInstallmentProfilePhaseChains(client, PROFILE_ID);
  const mapped = mapPhaseChainsToLocalSlots(phaseChains, profile);
  const phaseStart = resolveProfilePhaseStart(profile);
  const rows = [];
  for (const [local, chain] of [...mapped.entries()].sort((a, b) => a[0] - b[0])) {
    const rep = chain.representative;
    rows.push({
      display_phase: local + phaseStart - 1,
      invoice_id: rep.invoice_id,
      status: rep.status,
      ar: rep.invoice_ar_number,
      target: parseTargetPhase(rep.remarks),
      issue: rep.issue_date,
      due: rep.due_date,
    });
  }
  return rows;
}

async function main() {
  console.log(
    `\nPerlado installment repair — DB: ${useProduction ? 'production' : 'development'}${
      isApply ? ' (APPLY)' : ' (DRY RUN)'
    }\n`
  );

  const client = await pool.connect();
  try {
    const student = (
      await client.query(
        `SELECT user_id, full_name, email FROM userstbl
         WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))`,
        [STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student || Number(student.user_id) !== STUDENT_ID) {
      throw new Error(`Student ${STUDENT_EMAIL} not found`);
    }

    const profile = (
      await client.query(`SELECT * FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1`, [
        PROFILE_ID,
      ])
    ).rows[0];
    if (!profile || Number(profile.student_id) !== STUDENT_ID) {
      throw new Error(`Profile ${PROFILE_ID} not found`);
    }

    console.log('Student:', student.full_name);
    console.log('Before profile:', {
      downpayment_invoice_id: profile.downpayment_invoice_id,
      generated_count: profile.generated_count,
    });
    console.log('Before phase mapping:', await loadPhaseMapping(client, profile));

    const schedule = await buildPhaseInstallmentSchedule({
      db: client,
      profile: { ...profile, generated_count: 1 },
      generatedCountOverride: 1,
      issueDateOverride: PHASE1_ISSUE,
    });

    console.log('Queue schedule after phase 1 only:', {
      next_generation_date: schedule?.next_generation_date,
      next_due_date: schedule?.next_due_date,
      next_invoice_month: schedule?.next_invoice_month,
    });

    if (isApply) await client.query('BEGIN');

    if (isApply) {
      await client.query(
        `UPDATE installmentinvoiceprofilestbl
         SET downpayment_invoice_id = $1,
             generated_count = 1,
             is_active = true
         WHERE installmentinvoiceprofiles_id = $2`,
        [DOWNPAYMENT_CHAIN_ROOT, PROFILE_ID]
      );

      await client.query(
        `UPDATE invoicestbl
         SET issue_date = $1::date,
             due_date = $2::date,
             status = 'Unpaid',
             late_penalty_applied_for_due_date = NULL
         WHERE invoice_id = $3`,
        [PHASE1_ISSUE, PHASE1_DUE, PHASE1_INVOICE_ID]
      );

      await deleteInvoiceCascade(client, ORPHAN_INVOICE_ID);

      await client.query(
        `UPDATE installmentinvoicestbl
         SET scheduled_date = $1::date,
             status = NULL,
             next_generation_date = $2::date,
             next_invoice_month = $3::date
         WHERE installmentinvoiceprofiles_id = $4`,
        [
          schedule?.next_due_date || '2026-08-05',
          '2026-07-25',
          '2026-08-01',
          PROFILE_ID,
        ]
      );

      await client.query(
        `UPDATE classstudentstbl
         SET program_enrollment_status = 'pending_enrollment',
             removed_at = NULL,
             removed_reason = NULL,
             removed_by = NULL,
             enrolled_by = $1,
             enrolled_at = COALESCE(enrolled_at, CURRENT_TIMESTAMP)
         WHERE classstudent_id = $2`,
        [`${REPAIR_NOTE} — awaiting Phase 1 payment`, ENROLLMENT_ROW_ID]
      );

      await refreshInvoiceStatus(client, DOWNPAYMENT_CHAIN_ROOT);
      await refreshInvoiceStatus(client, 787);
      await refreshInvoiceStatus(client, PHASE1_INVOICE_ID);

      await syncProgramPaymentStatusForInvoice(client, DOWNPAYMENT_CHAIN_ROOT);
      await syncProgramPaymentStatusForInvoice(client, 787);
      await syncProgramPaymentStatusForInvoice(client, PHASE1_INVOICE_ID);
    }

    const afterProfile = (
      await client.query(`SELECT * FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1`, [
        PROFILE_ID,
      ])
    ).rows[0];

    console.log('\nAfter profile:', {
      downpayment_invoice_id: afterProfile.downpayment_invoice_id,
      generated_count: afterProfile.generated_count,
    });
    console.log('After phase mapping:', await loadPhaseMapping(client, afterProfile));

    const enrollment = (
      await client.query(`SELECT * FROM classstudentstbl WHERE classstudent_id = $1`, [ENROLLMENT_ROW_ID])
    ).rows[0];
    console.log('Enrollment:', enrollment);

    const phase1 = (
      await client.query(
        `SELECT invoice_id, status,
                TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue_ymd,
                TO_CHAR(due_date, 'YYYY-MM-DD') AS due_ymd,
                remarks
         FROM invoicestbl WHERE invoice_id = $1`,
        [PHASE1_INVOICE_ID]
      )
    ).rows[0];
    console.log('Phase 1 invoice:', phase1);

    const orphan = (
      await client.query(`SELECT invoice_id FROM invoicestbl WHERE invoice_id = $1`, [ORPHAN_INVOICE_ID])
    ).rows;
    console.log('Orphan invoice 1729 exists:', orphan.length > 0);

    if (isApply) {
      await client.query('COMMIT');
      console.log('\n✅ Applied successfully.');
    } else {
      console.log('\nDRY RUN — no changes written. Re-run with --apply --production');
    }
  } catch (error) {
    if (isApply) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
