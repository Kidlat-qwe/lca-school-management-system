/**
 * Repair Celestine Elora Relano Mendoza — phase 3 installment + phase 4 enrollment display.
 *
 * Profile 141 | VMP_Pre-Kindergarten_MWF_2:30PM | 10 phases
 *
 * Fixes:
 *  - INV 1083 (phase 3): remove late penalty (₱4,236.00), status Unpaid, keep issue/due dates
 *  - Tag invoice with TARGET_PHASE:3 and DELINQUENCY_DROP_WAIVED (prevents auto-drop on plan load)
 *  - Remove erroneous phase 3 delinquency drop (student not enrolled until paid)
 *  - Phase 4 enrollment remains re_enrolled (UI no longer shows rejoin once phase 3 drop is cleared)
 *  - Reactivate installment profile (is_active = true)
 *
 * Run:
 *   node backend/scripts/repairCelestineMendozaInstallmentPhases.js
 *   node backend/scripts/repairCelestineMendozaInstallmentPhases.js --apply
 *
 * IMPORTANT — database / API must match:
 *   - Scripts always write to **production** (`psms_production`).
 *   - Local `nodemon` uses `NODE_ENV` in `backend/.env` (set to `production` to test here).
 *   - Deployed API at cms.little-champion.com must include `DELINQUENCY_DROP_WAIVED` handling
 *     in `installmentDelinquencyDrop.js` or opening Student History will re-drop phase 3.
 */

import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import pkg from 'pg';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { rewriteTargetPhaseInRemarks } from '../utils/installmentPhaseBillingSync.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';
import { syncInstallmentDelinquencyDropsForProfile } from '../utils/installmentDelinquencyDrop.js';

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

const STUDENT_EMAIL = 'angelrelano14@gmail.com';
const STUDENT_ID = 287;
const PROFILE_ID = 141;
const CLASS_ID = 65;
const PHASE_3_INVOICE_ID = 1083;
const PHASE_3 = 3;
const PHASE_4_ENROLLMENT_ID = 1584;
const DROP_WAIVE_FLAG = 'DELINQUENCY_DROP_WAIVED';

const args = new Set(process.argv.slice(2));
const isApply = args.has('--apply');

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
    `SELECT invoice_item_id, penalty_amount
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

function buildPhase3Remarks(currentRemarks) {
  let remarks = String(currentRemarks || '').trim();
  if (parseTargetPhase(remarks) !== PHASE_3) {
    remarks = rewriteTargetPhaseInRemarks(remarks, PHASE_3);
  }
  if (!remarks.includes(DROP_WAIVE_FLAG)) {
    remarks = remarks ? `${remarks};${DROP_WAIVE_FLAG}` : DROP_WAIVE_FLAG;
  }
  return remarks;
}

async function main() {
  console.log(
    `\nCelestine Mendoza — phase 3 repair${isApply ? ' (APPLY)' : ' (DRY RUN)'}`
  );
  console.log(`Target DB: ${process.env.DB_NAME_PRODUCTION} (production)\n`);

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
        `SELECT invoice_id, status, amount, invoice_ar_number, remarks,
                TO_CHAR(TIMEZONE('Asia/Manila', issue_date), 'YYYY-MM-DD') AS issue_ymd,
                TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due_ymd,
                late_penalty_applied_for_due_date
         FROM invoicestbl WHERE invoice_id = $1`,
        [PHASE_3_INVOICE_ID]
      )
    ).rows[0];

    if (!inv) throw new Error(`Invoice ${PHASE_3_INVOICE_ID} not found`);

    const dropped = await client.query(
      `SELECT classstudent_id, phase_number, program_enrollment_status, removed_reason
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2 AND phase_number = $3
         AND program_enrollment_status = 'dropped'`,
      [STUDENT_ID, CLASS_ID, PHASE_3]
    );

    const phase4Enroll = (
      await client.query(
        `SELECT classstudent_id, program_enrollment_status
         FROM classstudentstbl WHERE classstudent_id = $1`,
        [PHASE_4_ENROLLMENT_ID]
      )
    ).rows[0];

    const nextRemarks = buildPhase3Remarks(inv.remarks);

    console.log('\nCurrent phase 3 invoice:', inv);
    console.log('Phase 3 dropped enrollment:', dropped.rows[0] || 'none');
    console.log('Phase 4 enrollment:', phase4Enroll || 'missing');
    console.log('Profile is_active:', row.is_active);
    console.log('Next remarks:', nextRemarks);

    console.log('\nPlanned fixes:');
    console.table([
      {
        step: 'invoice_penalty',
        detail: `${inv.amount} → 4236.00 (keep issue ${inv.issue_ymd}, due ${inv.due_ymd})`,
      },
      { step: 'invoice_status', detail: `${inv.status} → Unpaid` },
      { step: 'invoice_remarks', detail: 'add TARGET_PHASE:3 + DELINQUENCY_DROP_WAIVED' },
      {
        step: 'phase_3_enrollment',
        detail: dropped.rows.length
          ? `DELETE dropped row classstudent_id ${dropped.rows[0].classstudent_id}`
          : 'no dropped row',
      },
      {
        step: 'phase_4_enrollment',
        detail: phase4Enroll
          ? `${phase4Enroll.program_enrollment_status} → re_enrolled`
          : 'n/a',
      },
      { step: 'profile', detail: `is_active ${row.is_active} → true` },
    ]);

    if (!isApply) {
      console.log('\nRe-run with --apply to commit changes.');
      return;
    }

    await client.query('BEGIN');

    const cleared = await clearInvoicePenalty(client, PHASE_3_INVOICE_ID);
    if (cleared) console.log(`✅ Cleared penalty on invoice ${PHASE_3_INVOICE_ID}`);

    await client.query(
      `UPDATE invoicestbl
       SET status = 'Unpaid',
           remarks = $1,
           late_penalty_applied_for_due_date = NULL
       WHERE invoice_id = $2`,
      [nextRemarks, PHASE_3_INVOICE_ID]
    );
    console.log(`✅ Invoice ${PHASE_3_INVOICE_ID} set to Unpaid (dates unchanged)`);

    await syncProgramPaymentStatusForInvoice(client, PHASE_3_INVOICE_ID);
    console.log('✅ Synced program payment status');

    if (dropped.rows.length) {
      await client.query(`DELETE FROM classstudentstbl WHERE classstudent_id = $1`, [
        dropped.rows[0].classstudent_id,
      ]);
      console.log('✅ Removed erroneous phase 3 dropped enrollment');
    }

    if (phase4Enroll && phase4Enroll.program_enrollment_status !== 're_enrolled') {
      await client.query(
        `UPDATE classstudentstbl
         SET program_enrollment_status = 're_enrolled',
             removed_at = NULL,
             removed_reason = NULL,
             removed_by = NULL
         WHERE classstudent_id = $1`,
        [PHASE_4_ENROLLMENT_ID]
      );
      console.log('✅ Phase 4 enrollment set to re_enrolled');
    } else if (phase4Enroll) {
      console.log('✅ Phase 4 enrollment already re_enrolled in database');
    }

    await client.query(
      `UPDATE installmentinvoiceprofilestbl SET is_active = true WHERE installmentinvoiceprofiles_id = $1`,
      [PROFILE_ID]
    );
    console.log('✅ Reactivated installment profile');

    await client.query('COMMIT');

    const dropSync = await syncInstallmentDelinquencyDropsForProfile(client, PROFILE_ID);
    const afterInv = (
      await client.query(
        `SELECT status, amount, remarks,
                TO_CHAR(TIMEZONE('Asia/Manila', issue_date), 'YYYY-MM-DD') AS issue_ymd,
                TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due_ymd
         FROM invoicestbl WHERE invoice_id = $1`,
        [PHASE_3_INVOICE_ID]
      )
    ).rows[0];
    const enrollAfter = await client.query(
      `SELECT phase_number, program_enrollment_status
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2 AND phase_number IN (3, 4)
       ORDER BY phase_number`,
      [STUDENT_ID, CLASS_ID]
    );
    const profileAfter = await client.query(
      `SELECT is_active FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1`,
      [PROFILE_ID]
    );

    console.log('\nAfter repair:');
    console.log('  Invoice:', afterInv);
    console.log('  Phase 3/4 enrollment:', enrollAfter.rows);
    console.log('  Profile is_active:', profileAfter.rows[0]?.is_active);
    console.log('  Delinquency sync check:', dropSync);
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
