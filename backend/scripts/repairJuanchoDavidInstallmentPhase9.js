/**
 * Repair JUANCHO MIGUEL G. DAVID — phase 9 installment (invoice 1500).
 *
 * Profile 136 | VMP_Pre-Kindergarten_MWF_11AM | phase_start 7 | 4 local phases (7–10)
 *
 * Fixes:
 *  - INV 1500 (phase 9): remove late penalty, amount back to ₱4,999.00, status Unpaid
 *  - Correct issue/due dates (after phase 8) so delinquency auto-drop does not re-apply on plan load
 *  - Remove erroneous phase 9 delinquency drop (student not enrolled until paid)
 *  - Reactivate installment profile (is_active = true)
 *
 * Run:
 *   node backend/scripts/repairJuanchoDavidInstallmentPhase9.js
 *   node backend/scripts/repairJuanchoDavidInstallmentPhase9.js --apply
 */

import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import pkg from 'pg';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../.env') });

const { Pool } = pkg;

const pool = new Pool({
  host: process.env.DB_HOST_PRODUCTION,
  port: parseInt(process.env.DB_PORT_PRODUCTION || '5432', 10),
  database: process.env.DB_NAME_PRODUCTION,
  user: process.env.DB_USER_PRODUCTION,
  password: process.env.DB_PASSWORD_PRODUCTION,
  ssl: process.env.DB_SSL_PRODUCTION === 'true' ? { rejectUnauthorized: false } : false,
});

const STUDENT_EMAIL = 'daph.david1108@gmail.com';
const STUDENT_ID = 282;
const PROFILE_ID = 136;
const CLASS_ID = 64;
const PHASE_9_INVOICE_ID = 1500;
const PHASE_9 = 9;
/** Align with phase 8 billing cycle; due in future prevents auto-drop on plan view load */
const PHASE_9_ISSUE = '2026-07-25';
const PHASE_9_DUE = '2026-08-05';

const args = new Set(process.argv.slice(2));
const isApply = args.has('--apply');

const ymd = (value) => (value == null ? '' : String(value).slice(0, 10));

async function getClient() {
  const client = await pool.connect();
  await client.query('SET search_path TO public');
  return client;
}

async function loadProfileRow(client) {
  const res = await client.query(
    `SELECT ip.*, u.full_name, u.email, c.class_name
     FROM installmentinvoiceprofilestbl ip
     INNER JOIN userstbl u ON u.user_id = ip.student_id
     LEFT JOIN classestbl c ON c.class_id = ip.class_id
     WHERE ip.installmentinvoiceprofiles_id = $1`,
    [PROFILE_ID]
  );
  return res.rows[0] || null;
}

async function clearInvoicePenalty(client, invoiceId) {
  const items = await client.query(
    `SELECT invoice_item_id, penalty_amount, amount
     FROM invoiceitemstbl
     WHERE invoice_id = $1 AND COALESCE(penalty_amount, 0) > 0`,
    [invoiceId]
  );
  if (!items.rows.length) return false;

  for (const item of items.rows) {
    await client.query(
      `UPDATE invoiceitemstbl SET amount = 0, penalty_amount = 0 WHERE invoice_item_id = $1`,
      [item.invoice_item_id]
    );
  }

  const totals = await client.query(
    `SELECT COALESCE(SUM(amount), 0) - COALESCE(SUM(discount_amount), 0)
            + COALESCE(SUM(penalty_amount), 0) AS grand
     FROM invoiceitemstbl WHERE invoice_id = $1`,
    [invoiceId]
  );
  const grand = Number(totals.rows[0]?.grand || 0);
  await client.query(
    `UPDATE invoicestbl
     SET amount = $1, late_penalty_applied_for_due_date = NULL
     WHERE invoice_id = $2`,
    [grand, invoiceId]
  );
  return true;
}

async function main() {
  console.log(
    `\nJuancho David — phase 9 repair${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );

  const client = await getClient();
  try {
    const row = await loadProfileRow(client);
    if (!row || Number(row.student_id) !== STUDENT_ID) {
      throw new Error(`Profile ${PROFILE_ID} not found for student ${STUDENT_ID}`);
    }
    if (String(row.email).toLowerCase() !== STUDENT_EMAIL) {
      throw new Error(`Email mismatch: expected ${STUDENT_EMAIL}, got ${row.email}`);
    }

    console.log('Student:', row.full_name, `| Profile ${PROFILE_ID} | ${row.class_name}`);

    const inv = (
      await client.query(
        `SELECT invoice_id, status, amount, invoice_ar_number,
                TO_CHAR(TIMEZONE('Asia/Manila', issue_date), 'YYYY-MM-DD') AS issue_ymd,
                TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due_ymd,
                late_penalty_applied_for_due_date, remarks
         FROM invoicestbl WHERE invoice_id = $1`,
        [PHASE_9_INVOICE_ID]
      )
    ).rows[0];

    if (!inv) throw new Error(`Invoice ${PHASE_9_INVOICE_ID} not found`);
    if (!String(inv.remarks || '').includes(`TARGET_PHASE:${PHASE_9}`)) {
      throw new Error(`Invoice ${PHASE_9_INVOICE_ID} is not phase ${PHASE_9}`);
    }

    const penaltyItems = await client.query(
      `SELECT invoice_item_id, penalty_amount FROM invoiceitemstbl
       WHERE invoice_id = $1 AND COALESCE(penalty_amount, 0) > 0`,
      [PHASE_9_INVOICE_ID]
    );

    const dropped = await client.query(
      `SELECT classstudent_id, phase_number, program_enrollment_status, removed_reason
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2 AND phase_number = $3
         AND program_enrollment_status = 'dropped'`,
      [STUDENT_ID, CLASS_ID, PHASE_9]
    );

    console.log('\nCurrent phase 9 invoice:', inv);
    console.log('Penalty line items:', penaltyItems.rows);
    console.log('Phase 9 dropped enrollment:', dropped.rows[0] || 'none');
    console.log('Profile is_active:', row.is_active);

    console.log('\nPlanned fixes:');
    console.table([
      {
        step: 'invoice_penalty',
        detail: `${inv.amount} → 4999.00, clear late_penalty_applied_for_due_date`,
      },
      {
        step: 'invoice_dates',
        detail: `issue ${inv.issue_ymd} → ${PHASE_9_ISSUE}, due ${inv.due_ymd} → ${PHASE_9_DUE}`,
      },
      {
        step: 'invoice_status',
        detail: `${inv.status} → Unpaid`,
      },
      {
        step: 'enrollment',
        detail: dropped.rows.length
          ? `DELETE dropped row classstudent_id ${dropped.rows[0].classstudent_id}`
          : 'no dropped row',
      },
      {
        step: 'profile',
        detail: `is_active ${row.is_active} → true`,
      },
    ]);

    if (!isApply) {
      console.log('\nRe-run with --apply to commit changes.');
      return;
    }

    await client.query('BEGIN');

    const cleared = await clearInvoicePenalty(client, PHASE_9_INVOICE_ID);
    if (cleared) console.log(`✅ Cleared penalty on invoice ${PHASE_9_INVOICE_ID}`);

    await client.query(
      `UPDATE invoicestbl
       SET status = 'Unpaid',
           issue_date = $1::date,
           due_date = $2::date,
           late_penalty_applied_for_due_date = NULL
       WHERE invoice_id = $3`,
      [PHASE_9_ISSUE, PHASE_9_DUE, PHASE_9_INVOICE_ID]
    );
    console.log(
      `✅ Invoice ${PHASE_9_INVOICE_ID} set to Unpaid (${PHASE_9_ISSUE} / ${PHASE_9_DUE})`
    );

    await syncProgramPaymentStatusForInvoice(client, PHASE_9_INVOICE_ID);
    console.log('✅ Synced program payment status');

    if (dropped.rows.length) {
      await client.query(`DELETE FROM classstudentstbl WHERE classstudent_id = $1`, [
        dropped.rows[0].classstudent_id,
      ]);
      console.log('✅ Removed erroneous phase 9 dropped enrollment');
    }

    await client.query(
      `UPDATE installmentinvoiceprofilestbl SET is_active = true WHERE installmentinvoiceprofiles_id = $1`,
      [PROFILE_ID]
    );
    console.log('✅ Reactivated installment profile');

    await client.query('COMMIT');

    const after = (
      await client.query(
        `SELECT status, amount,
                TO_CHAR(TIMEZONE('Asia/Manila', issue_date), 'YYYY-MM-DD') AS issue_ymd,
                TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due_ymd
         FROM invoicestbl WHERE invoice_id = $1`,
        [PHASE_9_INVOICE_ID]
      )
    ).rows[0];

    const enrollAfter = await client.query(
      `SELECT phase_number, program_enrollment_status
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2 AND phase_number = $3`,
      [STUDENT_ID, CLASS_ID, PHASE_9]
    );

    const profileAfter = await client.query(
      `SELECT is_active FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1`,
      [PROFILE_ID]
    );

    console.log('\nAfter repair:');
    console.log('  Invoice:', after);
    console.log('  Phase 9 enrollment rows:', enrollAfter.rows);
    console.log('  Profile is_active:', profileAfter.rows[0]?.is_active);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
