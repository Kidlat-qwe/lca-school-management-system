/**
 * kenjin liu — fix Phase 9 invoice issue/due dates.
 *
 * Student email: khenchai22@gmail.com
 * Invoice: INV-2340 (TARGET_PHASE:9) · AR 262005
 *
 * Before (from Student History screenshot):
 *   Issued 2026-07-25 · Due 2026-08-05 · Unpaid / Overdue
 *
 * Target:
 *   issue_date 2026-08-25
 *   due_date   2026-09-05
 *   installment queue scheduled_date → 2026-09-05 (when queue row exists)
 *
 * Run (production DB — this student lives in psms_production):
 *   node backend/scripts/repairKenjinLiuPhase9Dates.js --production
 *   node backend/scripts/repairKenjinLiuPhase9Dates.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_EMAIL = 'khenchai22@gmail.com';
const PHASE9_INVOICE_ID = 2340;
const EXPECTED_PHASE = 9;

const TARGET_ISSUE = '2026-08-25';
const TARGET_DUE = '2026-09-05';

const REPAIR_NOTE =
  'Ops repair 2026-09-01 — kenjin liu Phase 9 dates Aug 25 / Sep 5';

const isApply = process.argv.includes('--apply');

async function loadInvoice(client, invoiceId) {
  const r = await client.query(
    `SELECT i.invoice_id, i.status, i.remarks,
            i.installmentinvoiceprofiles_id AS profile_id,
            ip.student_id,
            TO_CHAR(i.issue_date, 'YYYY-MM-DD') AS issue,
            TO_CHAR(i.due_date, 'YYYY-MM-DD') AS due
     FROM invoicestbl i
     LEFT JOIN installmentinvoiceprofilestbl ip
       ON ip.installmentinvoiceprofiles_id = i.installmentinvoiceprofiles_id
     WHERE i.invoice_id = $1`,
    [invoiceId]
  );
  const row = r.rows[0] || null;
  if (row) row.phase = parseTargetPhase(row.remarks);
  return row;
}

async function main() {
  console.log(
    `\nkenjin liu — Phase 9 (INV-${PHASE9_INVOICE_ID}) → ${TARGET_ISSUE} / ${TARGET_DUE}` +
      `${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`DB: ${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV}`);
  if (process.env.DB_NAME !== 'psms_production') {
    console.warn('⚠️ Expected psms_production. Pass --production.');
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const student = (
      await client.query(
        `SELECT user_id, full_name, email
         FROM userstbl
         WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))
         ORDER BY user_id
         LIMIT 1`,
        [STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student) {
      throw new Error(`Student not found for email ${STUDENT_EMAIL}`);
    }
    console.log('Student:', student.full_name, `(id ${student.user_id})`);

    const inv = await loadInvoice(client, PHASE9_INVOICE_ID);
    if (!inv) {
      throw new Error(`INV-${PHASE9_INVOICE_ID} not found`);
    }
    if (Number(inv.student_id) !== Number(student.user_id)) {
      throw new Error(
        `INV-${PHASE9_INVOICE_ID} student_id ${inv.student_id} ≠ ${student.user_id}`
      );
    }
    if (Number(inv.phase) !== EXPECTED_PHASE) {
      throw new Error(
        `INV-${PHASE9_INVOICE_ID} TARGET_PHASE:${inv.phase}, expected ${EXPECTED_PHASE}`
      );
    }
    if (!inv.profile_id) {
      throw new Error(`INV-${PHASE9_INVOICE_ID} has no installment profile`);
    }

    const profileId = Number(inv.profile_id);
    console.log('Profile:', profileId);
    console.log(`INV-${PHASE9_INVOICE_ID} BEFORE:`, {
      issue: inv.issue,
      due: inv.due,
      status: inv.status,
      phase: inv.phase,
    });

    const queueBefore = (
      await client.query(
        `SELECT installmentinvoicedtl_id,
                TO_CHAR(next_generation_date, 'YYYY-MM-DD') AS next_gen,
                TO_CHAR(next_invoice_month, 'YYYY-MM-DD') AS next_month,
                TO_CHAR(scheduled_date, 'YYYY-MM-DD') AS scheduled
         FROM installmentinvoicestbl
         WHERE installmentinvoiceprofiles_id = $1
         ORDER BY installmentinvoicedtl_id
         LIMIT 1`,
        [profileId]
      )
    ).rows[0];
    console.log('Queue BEFORE:', queueBefore || '(none)');

    let remarks = String(inv.remarks || '');
    if (!remarks.includes(REPAIR_NOTE)) {
      remarks = remarks ? `${remarks};${REPAIR_NOTE}` : REPAIR_NOTE;
    }

    await client.query(
      `UPDATE invoicestbl
       SET issue_date = $1::date,
           due_date = $2::date,
           remarks = $3
       WHERE invoice_id = $4
         AND installmentinvoiceprofiles_id = $5`,
      [TARGET_ISSUE, TARGET_DUE, remarks, PHASE9_INVOICE_ID, profileId]
    );

    try {
      await syncProgramPaymentStatusForInvoice(client, PHASE9_INVOICE_ID);
    } catch (e) {
      console.warn(`⚠ sync INV-${PHASE9_INVOICE_ID}:`, e.message);
    }
    console.log(`✅ INV-${PHASE9_INVOICE_ID} → ${TARGET_ISSUE} / ${TARGET_DUE}`);

    if (queueBefore?.installmentinvoicedtl_id) {
      await client.query(
        `UPDATE installmentinvoicestbl
         SET scheduled_date = $1::date
         WHERE installmentinvoicedtl_id = $2
           AND installmentinvoiceprofiles_id = $3`,
        [TARGET_DUE, queueBefore.installmentinvoicedtl_id, profileId]
      );
      console.log(`✅ Queue scheduled_date → ${TARGET_DUE}`);
    }

    const invAfter = await loadInvoice(client, PHASE9_INVOICE_ID);
    if (invAfter.issue !== TARGET_ISSUE || invAfter.due !== TARGET_DUE) {
      throw new Error(
        `INV-${PHASE9_INVOICE_ID} dates ${invAfter.issue}/${invAfter.due} ≠ target`
      );
    }
    console.log(`INV-${PHASE9_INVOICE_ID} AFTER:`, {
      issue: invAfter.issue,
      due: invAfter.due,
      status: invAfter.status,
    });

    const queueAfter = (
      await client.query(
        `SELECT TO_CHAR(next_generation_date, 'YYYY-MM-DD') AS next_gen,
                TO_CHAR(next_invoice_month, 'YYYY-MM-DD') AS next_month,
                TO_CHAR(scheduled_date, 'YYYY-MM-DD') AS scheduled
         FROM installmentinvoicestbl
         WHERE installmentinvoiceprofiles_id = $1
         ORDER BY installmentinvoicedtl_id
         LIMIT 1`,
        [profileId]
      )
    ).rows[0];
    console.log('Queue AFTER:', queueAfter || '(none)');

    console.log('\nExpected UI Phase 9: Issued Aug 25, 2026 · Due Sep 5, 2026');

    if (!isApply) {
      await client.query('ROLLBACK');
      console.log('\nDry run only — rolled back. Re-run with --apply to commit.');
      return;
    }

    await client.query('COMMIT');
    console.log('\nCommitted. Refresh Student History → Installment.');
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
