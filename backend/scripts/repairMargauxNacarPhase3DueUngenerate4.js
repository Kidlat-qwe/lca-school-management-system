/**
 * Margaux Emilia Nacar (nepjuanillo@gmail.com, user 657) —
 * Fix Phase 3 advance-payment due + ungenerate premature Phase 4.
 *
 * Profile 483 · Class 154 SOMO_JULY_Pre-Kinder_MWF_9:30 AM · Branch 3
 *
 * Current:
 *   P3 parent INV-2425 / balance INV-2426 Partially Paid, due 2026-10-05
 *   P4 INV-2494 Unpaid (premature while P3 still open), issue Aug 25 / due Sep 5
 *   generated_count 4 · queue Oct 25 / Nov 01
 *
 * Target:
 *   P3 due → 2026-09-05 (advance payment cadence)
 *   Phase 4 Not Generated (cancel + detach INV-2494)
 *   generated_count 3
 *   Queue next_generation 2026-08-25 / next_invoice_month 2026-09-01
 *
 * Run (from backend/):
 *   node scripts/repairMargauxNacarPhase3DueUngenerate4.js --production
 *   node scripts/repairMargauxNacarPhase3DueUngenerate4.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_ID = 657;
const STUDENT_EMAIL = 'nepjuanillo@gmail.com';
const CLASS_ID = 154;
const PROFILE_ID = 483;
const PHASE3_PARENT_INVOICE_ID = 2425;
const PHASE3_BALANCE_INVOICE_ID = 2426;
const PHASE4_INVOICE_ID = 2494;

const PHASE3_DUE = '2026-09-05';
const EXPECTED_GENERATED_COUNT = 3;
const NEXT_GEN = '2026-08-25';
const NEXT_MONTH = '2026-09-01';

const REPAIR_NOTE =
  'Ops repair 2026-09-08 — Margaux Nacar Phase 3 advance due Oct→Sep 5; cancel premature Phase 4';

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
    `\nMargaux Nacar — Phase 3 due + ungenerate Phase 4${
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

    const parent = await loadInvoice(client, PHASE3_PARENT_INVOICE_ID);
    const balance = await loadInvoice(client, PHASE3_BALANCE_INVOICE_ID);
    const phase4 = await loadInvoice(client, PHASE4_INVOICE_ID);

    if (!parent) throw new Error(`INV-${PHASE3_PARENT_INVOICE_ID} missing`);
    if (!balance) throw new Error(`INV-${PHASE3_BALANCE_INVOICE_ID} missing`);
    if (!phase4) throw new Error(`INV-${PHASE4_INVOICE_ID} missing`);

    if (Number(parent.installmentinvoiceprofiles_id) !== PROFILE_ID) {
      throw new Error('Phase 3 parent not on expected profile');
    }
    if (Number(balance.installmentinvoiceprofiles_id) !== PROFILE_ID) {
      throw new Error('Phase 3 balance not on expected profile');
    }
    if (Number(phase4.installmentinvoiceprofiles_id) !== PROFILE_ID) {
      throw new Error('Phase 4 invoice not on expected profile');
    }
    if (parseTargetPhase(parent.remarks) !== 3) {
      throw new Error(`INV-${PHASE3_PARENT_INVOICE_ID} is not TARGET_PHASE:3`);
    }
    if (parseTargetPhase(balance.remarks) !== 3) {
      throw new Error(`INV-${PHASE3_BALANCE_INVOICE_ID} is not TARGET_PHASE:3`);
    }
    if (parseTargetPhase(phase4.remarks) !== 4) {
      throw new Error(`INV-${PHASE4_INVOICE_ID} is not TARGET_PHASE:4`);
    }
    if (String(parent.status) === 'Paid' && String(balance.status) === 'Paid') {
      throw new Error('Phase 3 chain is fully Paid — abort (unexpected for this repair)');
    }
    if (String(phase4.status) === 'Paid') {
      throw new Error(`INV-${PHASE4_INVOICE_ID} is Paid — abort`);
    }

    const p4Pays = (
      await client.query(
        `SELECT payment_id FROM paymenttbl
         WHERE invoice_id = $1 AND status = 'Completed'`,
        [PHASE4_INVOICE_ID]
      )
    ).rows;
    if (p4Pays.length) {
      throw new Error(`INV-${PHASE4_INVOICE_ID} has completed payments — abort`);
    }

    console.log('\nBefore:');
    console.table([
      {
        inv: parent.invoice_id,
        role: 'P3 parent',
        status: parent.status,
        issue: parent.issue,
        due: parent.due,
        amount: parent.amount,
      },
      {
        inv: balance.invoice_id,
        role: 'P3 balance',
        status: balance.status,
        issue: balance.issue,
        due: balance.due,
        amount: balance.amount,
      },
      {
        inv: phase4.invoice_id,
        role: 'P4',
        status: phase4.status,
        issue: phase4.issue,
        due: phase4.due,
        amount: phase4.amount,
      },
    ]);

    console.log('\nPlanned:');
    console.log(
      `  1. INV-${PHASE3_PARENT_INVOICE_ID} / INV-${PHASE3_BALANCE_INVOICE_ID} due → ${PHASE3_DUE}`
    );
    console.log(`  2. Cancel + detach Phase 4 INV-${PHASE4_INVOICE_ID}`);
    console.log(
      `  3. generated_count → ${EXPECTED_GENERATED_COUNT}; queue → ${NEXT_GEN} / ${NEXT_MONTH}`
    );

    for (const row of [parent, balance]) {
      if (row.due === PHASE3_DUE) {
        console.log(`  · INV-${row.invoice_id} due already ${PHASE3_DUE}`);
        continue;
      }
      await client.query(
        `UPDATE invoicestbl
         SET due_date = ($1::date + TIME '12:00'),
             late_penalty_applied_for_due_date = NULL,
             remarks = $2
         WHERE invoice_id = $3`,
        [PHASE3_DUE, appendNote(row.remarks, REPAIR_NOTE), row.invoice_id]
      );
      try {
        await syncProgramPaymentStatusForInvoice(client, row.invoice_id);
      } catch (e) {
        console.warn(`⚠ syncProgramPaymentStatus INV-${row.invoice_id}:`, e.message);
      }
      console.log(`→ INV-${row.invoice_id} due → ${PHASE3_DUE}`);
    }

    const phase4Cancelled = /^cancell?ed$/i.test(String(phase4.status || ''));
    if (!phase4Cancelled) {
      await client.query(
        `UPDATE invoicestbl
         SET status = 'Cancelled',
             installmentinvoiceprofiles_id = NULL,
             remarks = $1
         WHERE invoice_id = $2
           AND installmentinvoiceprofiles_id = $3`,
        [appendNote(phase4.remarks, REPAIR_NOTE), PHASE4_INVOICE_ID, PROFILE_ID]
      );
      await client.query(`DELETE FROM program_payment_statustbl WHERE invoice_id = $1`, [
        PHASE4_INVOICE_ID,
      ]);
      console.log(`→ Cancelled + detached INV-${PHASE4_INVOICE_ID}`);
    } else {
      console.log(`  · INV-${PHASE4_INVOICE_ID} already cancelled`);
    }

    const p4Enrolls = (
      await client.query(
        `SELECT classstudent_id, program_enrollment_status
         FROM classstudentstbl
         WHERE student_id = $1 AND class_id = $2 AND phase_number = 4`,
        [STUDENT_ID, CLASS_ID]
      )
    ).rows;
    for (const row of p4Enrolls) {
      await client.query(`DELETE FROM classstudentstbl WHERE classstudent_id = $1`, [
        row.classstudent_id,
      ]);
      console.log(`→ DELETE Phase 4 CS ${row.classstudent_id}`);
    }
    if (!p4Enrolls.length) {
      console.log('  · No Phase 4 enrollment rows');
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

    const parentAfter = await loadInvoice(client, PHASE3_PARENT_INVOICE_ID);
    const balanceAfter = await loadInvoice(client, PHASE3_BALANCE_INVOICE_ID);
    const phase4After = (
      await client.query(
        `SELECT invoice_id, status, installmentinvoiceprofiles_id,
                TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due
         FROM invoicestbl WHERE invoice_id = $1`,
        [PHASE4_INVOICE_ID]
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
        inv: phase4After.invoice_id,
        status: phase4After.status,
        profile_id: phase4After.installmentinvoiceprofiles_id,
        due: phase4After.due,
      },
    ]);
    console.log('Profile/queue:', profileAfter);

    if (parentAfter.due !== PHASE3_DUE || balanceAfter.due !== PHASE3_DUE) {
      throw new Error('Phase 3 due validation failed');
    }
    if (!/^cancell?ed$/i.test(String(phase4After.status || ''))) {
      throw new Error('Phase 4 cancel validation failed');
    }
    if (phase4After.installmentinvoiceprofiles_id != null) {
      throw new Error('Phase 4 still attached to profile');
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
