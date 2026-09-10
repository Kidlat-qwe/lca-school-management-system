/**
 * Lucio Kendrick Ardina (kiiimconcepcion@gmail.com, user 34) —
 * Fix Phase 7 advance-payment due + ungenerate premature Phase 8.
 *
 * Profile 23 · Class 42 SOMO_Pre-Kinder_TThS_9:30-10:30AM · Branch 3
 *
 * Current:
 *   P7 parent INV-2436 / balance INV-2437 Partially Paid, due 2027-02-05
 *   P8 INV-2633 Unpaid (premature while P7 still open), issue Aug 25 / due Sep 5
 *   generated_count 8 · queue Oct 25 / Nov 01
 *
 * Target:
 *   P7 due → 2026-09-05 (advance payment cadence)
 *   Phase 8 Not Generated (cancel + detach INV-2633)
 *   generated_count 7
 *   Queue next_generation 2026-08-25 / next_invoice_month 2026-09-01
 *
 * Run (from backend/):
 *   node scripts/repairLucioArdinaPhase7DueUngenerate8.js --production
 *   node scripts/repairLucioArdinaPhase7DueUngenerate8.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_ID = 34;
const STUDENT_EMAIL = 'kiiimconcepcion@gmail.com';
const CLASS_ID = 42;
const PROFILE_ID = 23;
const PHASE7_PARENT_INVOICE_ID = 2436;
const PHASE7_BALANCE_INVOICE_ID = 2437;
const PHASE8_INVOICE_ID = 2633;

const PHASE7_DUE = '2026-09-05';
const EXPECTED_GENERATED_COUNT = 7;
const NEXT_GEN = '2026-08-25';
const NEXT_MONTH = '2026-09-01';

const REPAIR_NOTE =
  'Ops repair 2026-09-08 — Lucio Ardina Phase 7 advance due Feb→Sep 5; cancel premature Phase 8';

const isApply = process.argv.includes('--apply');

function appendNote(existing, note, maxLen = 2000) {
  const cur = String(existing || '').trim();
  const add = String(note || '').trim();
  if (!add) return cur || null;
  if (cur.toLowerCase().includes(add.toLowerCase())) return cur;
  if (!cur) return add.length <= maxLen ? add : add.slice(0, maxLen);
  const joined = `${cur};${add}`;
  if (joined.length <= maxLen) return joined;
  return cur.length <= maxLen ? cur : cur.slice(0, maxLen);
}

async function loadInvoice(client, invoiceId) {
  const res = await client.query(
    `SELECT invoice_id, status, remarks, amount::text,
            installmentinvoiceprofiles_id, parent_invoice_id, balance_invoice_id,
            TO_CHAR(TIMEZONE('Asia/Manila', issue_date), 'YYYY-MM-DD') AS issue,
            TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due
     FROM invoicestbl
     WHERE invoice_id = $1`,
    [invoiceId]
  );
  return res.rows[0] || null;
}

async function main() {
  console.log(
    `\nLucio Ardina — Phase 7 due + ungenerate Phase 8${
      isApply ? ' (APPLY)' : ' (DRY RUN)'
    }\n`
  );
  console.log(`Note: ${REPAIR_NOTE}`);
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
         WHERE user_id = $1
           AND LOWER(TRIM(email)) = LOWER(TRIM($2))
           AND user_type = 'Student'`,
        [STUDENT_ID, STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student) throw new Error('Student not found');
    console.log(`Student: ${student.full_name} (${student.email})`);

    const profile = (
      await client.query(
        `SELECT ip.installmentinvoiceprofiles_id, ip.class_id, ip.generated_count, ip.is_active,
                ii.installmentinvoicedtl_id,
                TO_CHAR(TIMEZONE('Asia/Manila', ii.next_generation_date), 'YYYY-MM-DD') AS next_gen,
                TO_CHAR(TIMEZONE('Asia/Manila', ii.next_invoice_month), 'YYYY-MM-DD') AS next_month
         FROM installmentinvoiceprofilestbl ip
         LEFT JOIN installmentinvoicestbl ii
           ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
         WHERE ip.installmentinvoiceprofiles_id = $1
           AND ip.student_id = $2
           AND ip.class_id = $3`,
        [PROFILE_ID, STUDENT_ID, CLASS_ID]
      )
    ).rows[0];
    if (!profile) throw new Error(`Profile ${PROFILE_ID} not found`);
    console.log('Profile before:', profile);

    const parent = await loadInvoice(client, PHASE7_PARENT_INVOICE_ID);
    const balance = await loadInvoice(client, PHASE7_BALANCE_INVOICE_ID);
    const phase8 = await loadInvoice(client, PHASE8_INVOICE_ID);

    if (!parent) throw new Error(`INV-${PHASE7_PARENT_INVOICE_ID} missing`);
    if (!balance) throw new Error(`INV-${PHASE7_BALANCE_INVOICE_ID} missing`);
    if (!phase8) throw new Error(`INV-${PHASE8_INVOICE_ID} missing`);

    if (Number(parent.installmentinvoiceprofiles_id) !== PROFILE_ID) {
      throw new Error('Phase 7 parent not on expected profile');
    }
    if (Number(balance.installmentinvoiceprofiles_id) !== PROFILE_ID) {
      throw new Error('Phase 7 balance not on expected profile');
    }
    if (Number(phase8.installmentinvoiceprofiles_id) !== PROFILE_ID) {
      throw new Error('Phase 8 invoice not on expected profile');
    }
    if (parseTargetPhase(parent.remarks) !== 7) {
      throw new Error(`INV-${PHASE7_PARENT_INVOICE_ID} is not TARGET_PHASE:7`);
    }
    if (parseTargetPhase(balance.remarks) !== 7) {
      throw new Error(`INV-${PHASE7_BALANCE_INVOICE_ID} is not TARGET_PHASE:7`);
    }
    if (parseTargetPhase(phase8.remarks) !== 8) {
      throw new Error(`INV-${PHASE8_INVOICE_ID} is not TARGET_PHASE:8`);
    }
    if (String(parent.status) === 'Paid' && String(balance.status) === 'Paid') {
      throw new Error('Phase 7 chain is fully Paid — abort (unexpected for this repair)');
    }
    if (String(phase8.status) === 'Paid') {
      throw new Error(`INV-${PHASE8_INVOICE_ID} is Paid — abort`);
    }

    const p8Pays = (
      await client.query(
        `SELECT payment_id FROM paymenttbl
         WHERE invoice_id = $1 AND status = 'Completed'`,
        [PHASE8_INVOICE_ID]
      )
    ).rows;
    if (p8Pays.length) {
      throw new Error(`INV-${PHASE8_INVOICE_ID} has completed payments — abort`);
    }

    console.log('\nBefore:');
    console.table([
      {
        inv: parent.invoice_id,
        role: 'P7 parent',
        status: parent.status,
        issue: parent.issue,
        due: parent.due,
        amount: parent.amount,
      },
      {
        inv: balance.invoice_id,
        role: 'P7 balance',
        status: balance.status,
        issue: balance.issue,
        due: balance.due,
        amount: balance.amount,
      },
      {
        inv: phase8.invoice_id,
        role: 'P8',
        status: phase8.status,
        issue: phase8.issue,
        due: phase8.due,
        amount: phase8.amount,
      },
    ]);

    console.log('\nPlanned:');
    console.log(
      `  1. INV-${PHASE7_PARENT_INVOICE_ID} / INV-${PHASE7_BALANCE_INVOICE_ID} due → ${PHASE7_DUE}`
    );
    console.log(`  2. Cancel + detach Phase 8 INV-${PHASE8_INVOICE_ID}`);
    console.log(
      `  3. generated_count → ${EXPECTED_GENERATED_COUNT}; queue → ${NEXT_GEN} / ${NEXT_MONTH}`
    );

    for (const row of [parent, balance]) {
      if (row.due === PHASE7_DUE) {
        console.log(`  · INV-${row.invoice_id} due already ${PHASE7_DUE}`);
        continue;
      }
      await client.query(
        `UPDATE invoicestbl
         SET due_date = ($1::date + TIME '12:00'),
             late_penalty_applied_for_due_date = NULL,
             remarks = $2
         WHERE invoice_id = $3`,
        [PHASE7_DUE, appendNote(row.remarks, REPAIR_NOTE), row.invoice_id]
      );
      try {
        await syncProgramPaymentStatusForInvoice(client, row.invoice_id);
      } catch (e) {
        console.warn(`⚠ syncProgramPaymentStatus INV-${row.invoice_id}:`, e.message);
      }
      console.log(`→ INV-${row.invoice_id} due → ${PHASE7_DUE}`);
    }

    const phase8Cancelled = /^cancell?ed$/i.test(String(phase8.status || ''));
    if (!phase8Cancelled) {
      await client.query(
        `UPDATE invoicestbl
         SET status = 'Cancelled',
             installmentinvoiceprofiles_id = NULL,
             remarks = $1
         WHERE invoice_id = $2
           AND installmentinvoiceprofiles_id = $3`,
        [appendNote(phase8.remarks, REPAIR_NOTE), PHASE8_INVOICE_ID, PROFILE_ID]
      );
      await client.query(`DELETE FROM program_payment_statustbl WHERE invoice_id = $1`, [
        PHASE8_INVOICE_ID,
      ]);
      console.log(`→ Cancelled + detached INV-${PHASE8_INVOICE_ID}`);
    } else {
      console.log(`  · INV-${PHASE8_INVOICE_ID} already cancelled`);
    }

    const p8Enrolls = (
      await client.query(
        `SELECT classstudent_id, program_enrollment_status
         FROM classstudentstbl
         WHERE student_id = $1 AND class_id = $2 AND phase_number = 8`,
        [STUDENT_ID, CLASS_ID]
      )
    ).rows;
    for (const row of p8Enrolls) {
      await client.query(`DELETE FROM classstudentstbl WHERE classstudent_id = $1`, [
        row.classstudent_id,
      ]);
      console.log(`→ DELETE Phase 8 CS ${row.classstudent_id}`);
    }
    if (!p8Enrolls.length) {
      console.log('  · No Phase 8 enrollment rows');
    }

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET generated_count = $1,
           is_active = true
       WHERE installmentinvoiceprofiles_id = $2
         AND student_id = $3`,
      [EXPECTED_GENERATED_COUNT, PROFILE_ID, STUDENT_ID]
    );
    console.log(`→ generated_count → ${EXPECTED_GENERATED_COUNT}`);

    if (!profile.installmentinvoicedtl_id) {
      throw new Error('No installment queue row for profile');
    }
    await client.query(
      `UPDATE installmentinvoicestbl
       SET status = NULL,
           next_generation_date = $1::date,
           next_invoice_month = $2::date,
           scheduled_date = $1::date
       WHERE installmentinvoicedtl_id = $3
         AND installmentinvoiceprofiles_id = $4`,
      [NEXT_GEN, NEXT_MONTH, profile.installmentinvoicedtl_id, PROFILE_ID]
    );
    console.log(`→ Queue → ${NEXT_GEN} / ${NEXT_MONTH}`);

    const parentAfter = await loadInvoice(client, PHASE7_PARENT_INVOICE_ID);
    const balanceAfter = await loadInvoice(client, PHASE7_BALANCE_INVOICE_ID);
    const phase8After = (
      await client.query(
        `SELECT invoice_id, status, installmentinvoiceprofiles_id,
                TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due
         FROM invoicestbl WHERE invoice_id = $1`,
        [PHASE8_INVOICE_ID]
      )
    ).rows[0];
    const profileAfter = (
      await client.query(
        `SELECT ip.generated_count, ip.is_active,
                TO_CHAR(TIMEZONE('Asia/Manila', ii.next_generation_date), 'YYYY-MM-DD') AS next_gen,
                TO_CHAR(TIMEZONE('Asia/Manila', ii.next_invoice_month), 'YYYY-MM-DD') AS next_month
         FROM installmentinvoiceprofilestbl ip
         LEFT JOIN installmentinvoicestbl ii
           ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
         WHERE ip.installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      )
    ).rows[0];

    console.log('\nAfter (in transaction):');
    console.table([
      {
        inv: parentAfter.invoice_id,
        status: parentAfter.status,
        due: parentAfter.due,
      },
      {
        inv: balanceAfter.invoice_id,
        status: balanceAfter.status,
        due: balanceAfter.due,
      },
      {
        inv: phase8After.invoice_id,
        status: phase8After.status,
        profile_id: phase8After.installmentinvoiceprofiles_id,
        due: phase8After.due,
      },
    ]);
    console.log('Profile/queue:', profileAfter);

    if (parentAfter.due !== PHASE7_DUE || balanceAfter.due !== PHASE7_DUE) {
      throw new Error('Phase 7 due validation failed');
    }
    if (!/^cancell?ed$/i.test(String(phase8After.status || ''))) {
      throw new Error('Phase 8 cancel validation failed');
    }
    if (phase8After.installmentinvoiceprofiles_id != null) {
      throw new Error('Phase 8 still attached to profile');
    }
    if (Number(profileAfter.generated_count) !== EXPECTED_GENERATED_COUNT) {
      throw new Error('generated_count validation failed');
    }
    if (profileAfter.next_gen !== NEXT_GEN || profileAfter.next_month !== NEXT_MONTH) {
      throw new Error('queue validation failed');
    }

    console.log('\n✅ Repair verified.');

    if (isApply) {
      await client.query('COMMIT');
      console.log('\n✅ Applied.');
    } else {
      await client.query('ROLLBACK');
      console.log('\nDry run — rolled back. Re-run with --apply to commit.');
    }
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('\nFailed:', err.message || err);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main();
