/**
 * Align installment phasing for Celestine Elora Relano Mendoza (profile 141).
 *
 * Expected UI after repair (local API with DELINQUENCY_DROP_WAIVED deployed):
 *  - Pay Now on phase 3 while INV-1083 is unpaid
 *  - After phase 3 is paid → Pay Now advances to phase 5 (phase 4 already paid)
 *  - Enrollment: phase 3 unpaid → "—"; phase 4 → re-enrolled
 *  - After phase 3 paid → phases 3 and 4 both show re-enrolled
 *
 * Fixes:
 *  - INV 1083 (phase 3): penalty cleared, Unpaid, dates unchanged, TARGET_PHASE:3, DELINQUENCY_DROP_WAIVED
 *  - TARGET_PHASE tags on phase 1–2 invoices (333, 646) for slot alignment
 *  - Remove all phase 3 delinquency drop rows
 *  - Phase 4 enrollment → re_enrolled
 *  - generated_count = 4, profile is_active = true
 *
 * Run:
 *   node backend/scripts/repairCelestineMendozaPhasingAlignment.js
 *   node backend/scripts/repairCelestineMendozaPhasingAlignment.js --apply
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
const DROP_WAIVE_FLAG = 'DELINQUENCY_DROP_WAIVED';
const GENERATED_COUNT = 4;

/** local phase → invoice_id */
const PHASE_INVOICES = {
  1: 333,
  2: 646,
  3: 1083,
  4: 1698,
};

const PHASE_4_ENROLLMENT_ID = 1584;

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
    `SELECT invoice_item_id FROM invoiceitemstbl
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

function buildRemarks(currentRemarks, absolutePhase, { waiveDrop = false } = {}) {
  let remarks = String(currentRemarks || '').trim();
  if (parseTargetPhase(remarks) !== absolutePhase) {
    remarks = rewriteTargetPhaseInRemarks(remarks, absolutePhase);
  }
  if (waiveDrop && !remarks.includes(DROP_WAIVE_FLAG)) {
    remarks = remarks ? `${remarks};${DROP_WAIVE_FLAG}` : DROP_WAIVE_FLAG;
  }
  return remarks;
}

async function main() {
  console.log(
    `\nCelestine Mendoza — phasing alignment${isApply ? ' (APPLY)' : ' (DRY RUN)'}`
  );
  console.log(`Target DB: ${process.env.DB_NAME_PRODUCTION}\n`);

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

    const dropped = await client.query(
      `SELECT classstudent_id, phase_number, removed_reason
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2 AND program_enrollment_status = 'dropped'`,
      [STUDENT_ID, CLASS_ID]
    );

    const invoiceSnapshots = [];
    for (const [phaseStr, invoiceId] of Object.entries(PHASE_INVOICES)) {
      const phase = Number(phaseStr);
      const inv = (
        await client.query(
          `SELECT invoice_id, status, amount, remarks,
                  TO_CHAR(TIMEZONE('Asia/Manila', issue_date), 'YYYY-MM-DD') AS issue_ymd,
                  TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due_ymd
           FROM invoicestbl WHERE invoice_id = $1`,
          [invoiceId]
        )
      ).rows[0];
      if (!inv) throw new Error(`Invoice ${invoiceId} (phase ${phase}) not found`);
      invoiceSnapshots.push({
        phase,
        invoiceId,
        inv,
        nextRemarks: buildRemarks(inv.remarks, phase, { waiveDrop: phase === 3 }),
      });
    }

    console.log('\nDropped rows:', dropped.rows);
    console.log('generated_count:', row.generated_count, '→', GENERATED_COUNT);
    console.log('\nInvoice alignment:');
    console.table(
      invoiceSnapshots.map(({ phase, invoiceId, inv, nextRemarks }) => ({
        phase,
        invoice_id: invoiceId,
        status: inv.status,
        amount: inv.amount,
        issue: inv.issue_ymd,
        due: inv.due_ymd,
        remarks: nextRemarks.slice(0, 72) + (nextRemarks.length > 72 ? '…' : ''),
      }))
    );

    if (!isApply) {
      console.log('\nRe-run with --apply to commit.');
      return;
    }

    await client.query('BEGIN');

    for (const { phase, invoiceId, inv, nextRemarks } of invoiceSnapshots) {
      if (phase === 3) {
        await clearInvoicePenalty(client, invoiceId);
      }

      const nextStatus = phase === 3 && inv.status !== 'Paid' ? 'Unpaid' : inv.status;
      await client.query(
        `UPDATE invoicestbl
         SET remarks = $1,
             status = $2,
             late_penalty_applied_for_due_date = CASE
               WHEN $3::int = 3 THEN NULL
               ELSE late_penalty_applied_for_due_date
             END
         WHERE invoice_id = $4`,
        [nextRemarks, nextStatus, phase, invoiceId]
      );

      if (phase === 3) {
        await syncProgramPaymentStatusForInvoice(client, invoiceId);
      }
      console.log(`✅ Invoice ${invoiceId} → TARGET_PHASE:${phase}${phase === 3 ? ' + waiver' : ''}`);
    }

    for (const d of dropped.rows) {
      await client.query(`DELETE FROM classstudentstbl WHERE classstudent_id = $1`, [
        d.classstudent_id,
      ]);
      console.log(`✅ Removed dropped row ${d.classstudent_id} (phase ${d.phase_number})`);
    }

    await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = 're_enrolled',
           removed_at = NULL,
           removed_reason = NULL,
           removed_by = NULL
       WHERE classstudent_id = $1`,
      [PHASE_4_ENROLLMENT_ID]
    );
    console.log('✅ Phase 4 enrollment → re_enrolled');

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET is_active = true, generated_count = $1
       WHERE installmentinvoiceprofiles_id = $2`,
      [GENERATED_COUNT, PROFILE_ID]
    );
    console.log(`✅ Profile active, generated_count=${GENERATED_COUNT}`);

    await client.query('COMMIT');

    const dropSync = await syncInstallmentDelinquencyDropsForProfile(client, PROFILE_ID);
    const enrollAfter = await client.query(
      `SELECT phase_number, program_enrollment_status
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2
       ORDER BY phase_number`,
      [STUDENT_ID, CLASS_ID]
    );

    console.log('\nAfter alignment:');
    console.log('  Enrollment rows:', enrollAfter.rows);
    console.log('  Delinquency sync:', dropSync);
    console.log('\nExpected UI: Pay Now on phase 3; phase 3 enrollment "—"; phase 4 re-enrolled.');
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
