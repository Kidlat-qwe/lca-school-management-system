/**
 * CHLOE SOFIA M. EVANGELISTA — fix Phase 7 invoice issue/due dates.
 *
 * Student: 270 · jhec292000@yahoo.com
 * Profile: 448 · INV-1538 / INV-1539 (TARGET_PHASE:7)
 *
 * Target:
 *   issue_date 2026-08-25
 *   due_date   2026-09-05
 *   installment queue scheduled_date → 2026-09-05
 *
 * Run:
 *   node backend/scripts/repairChloeEvangelistaPhase7Dates.js
 *   node backend/scripts/repairChloeEvangelistaPhase7Dates.js --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_ID = 270;
const STUDENT_EMAIL = 'jhec292000@yahoo.com';
const PROFILE_ID = 448;
const PHASE7_INVOICE_IDS = [1538, 1539];

const TARGET_ISSUE = '2026-08-25';
const TARGET_DUE = '2026-09-05';

const REPAIR_NOTE =
  'Ops repair 2026-08-28 — Chloe Evangelista Phase 7 dates Aug 25 / Sep 5';

const isApply = process.argv.includes('--apply');

async function loadInvoice(client, invoiceId) {
  const r = await client.query(
    `SELECT invoice_id, status, remarks,
            installmentinvoiceprofiles_id AS profile_id,
            TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue,
            TO_CHAR(due_date, 'YYYY-MM-DD') AS due
     FROM invoicestbl WHERE invoice_id = $1`,
    [invoiceId]
  );
  const row = r.rows[0] || null;
  if (row) row.phase = parseTargetPhase(row.remarks);
  return row;
}

async function main() {
  console.log(
    `\nChloe Evangelista — Phase 7 dates → ${TARGET_ISSUE} / ${TARGET_DUE}` +
      `${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );

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
    if (!student) throw new Error('Student not found or email mismatch');
    console.log('Student:', student.full_name, `(id ${student.user_id})`);

    for (const invoiceId of PHASE7_INVOICE_IDS) {
      const inv = await loadInvoice(client, invoiceId);
      if (!inv || Number(inv.profile_id) !== PROFILE_ID) {
        throw new Error(`INV-${invoiceId} not on profile ${PROFILE_ID}`);
      }
      if (Number(inv.phase) !== 7) {
        throw new Error(`INV-${invoiceId} TARGET_PHASE:${inv.phase}, expected 7`);
      }
      console.log(`INV-${invoiceId} BEFORE:`, {
        issue: inv.issue,
        due: inv.due,
        status: inv.status,
      });
    }

    const queueBefore = (
      await client.query(
        `SELECT installmentinvoicedtl_id,
                TO_CHAR(next_generation_date, 'YYYY-MM-DD') AS next_gen,
                TO_CHAR(next_invoice_month, 'YYYY-MM-DD') AS next_month,
                TO_CHAR(scheduled_date, 'YYYY-MM-DD') AS scheduled
         FROM installmentinvoicestbl
         WHERE installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      )
    ).rows[0];
    console.log('Queue BEFORE:', queueBefore);

    for (const invoiceId of PHASE7_INVOICE_IDS) {
      const inv = await loadInvoice(client, invoiceId);
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
        [TARGET_ISSUE, TARGET_DUE, remarks, invoiceId, PROFILE_ID]
      );
      try {
        await syncProgramPaymentStatusForInvoice(client, invoiceId);
      } catch (e) {
        console.warn(`⚠ sync INV-${invoiceId}:`, e.message);
      }
      console.log(`✅ INV-${invoiceId} → ${TARGET_ISSUE} / ${TARGET_DUE}`);
    }

    if (queueBefore?.installmentinvoicedtl_id) {
      await client.query(
        `UPDATE installmentinvoicestbl
         SET scheduled_date = $1::date
         WHERE installmentinvoicedtl_id = $2
           AND installmentinvoiceprofiles_id = $3`,
        [TARGET_DUE, queueBefore.installmentinvoicedtl_id, PROFILE_ID]
      );
      console.log(`✅ Queue scheduled_date → ${TARGET_DUE}`);
    }

    for (const invoiceId of PHASE7_INVOICE_IDS) {
      const inv = await loadInvoice(client, invoiceId);
      if (inv.issue !== TARGET_ISSUE || inv.due !== TARGET_DUE) {
        throw new Error(`INV-${invoiceId} dates ${inv.issue}/${inv.due} ≠ target`);
      }
    }

    const queueAfter = (
      await client.query(
        `SELECT TO_CHAR(next_generation_date, 'YYYY-MM-DD') AS next_gen,
                TO_CHAR(next_invoice_month, 'YYYY-MM-DD') AS next_month,
                TO_CHAR(scheduled_date, 'YYYY-MM-DD') AS scheduled
         FROM installmentinvoicestbl
         WHERE installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      )
    ).rows[0];
    console.log('Queue AFTER:', queueAfter);

    console.log('\nExpected UI Phase 7: Issued Aug 25, 2026 · Due Sep 5, 2026');

    if (!isApply) {
      await client.query('ROLLBACK');
      console.log('\nDry run only — rolled back. Re-run with --apply to commit.');
      return;
    }

    await client.query('COMMIT');
    console.log('\nCommitted. Refresh Student History → Invoices.');
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
