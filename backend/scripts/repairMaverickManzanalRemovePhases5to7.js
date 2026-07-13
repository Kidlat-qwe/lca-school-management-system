/**
 * Maverick Raziel Viola Manzanal — remove Playgroup phases generated after
 * unpaid Phase 4 delinquency drop.
 *
 * Profile 94 | NC_Playgroup_TTh_9:30-10:30PM (class 57)
 *
 * Keep:
 *   Phase 2 INV-268 Paid (new)
 *   Phase 3 INV-275 Paid (re_enrolled)
 *   Phase 4 INV-1480 Unpaid + dropped (legitimate unpaid drop)
 *
 * Delete (generated after Phase 4 unpaid drop):
 *   Phase 5 INV-1545
 *   Phase 6 INV-1589
 *   Phase 7 INV-1812
 *
 * Also removes Phase 5–6 delinquency drop enrollment rows and sets
 * generated_count → 3. Profile stays inactive while Phase 4 is unpaid.
 *
 * Run:
 *   node backend/scripts/repairMaverickManzanalRemovePhases5to7.js
 *   node backend/scripts/repairMaverickManzanalRemovePhases5to7.js --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';

const STUDENT_EMAIL = 'shaimanzanal@icloud.com';
const STUDENT_ID = 171;
const PROFILE_ID = 94;
const CLASS_ID = 57;
const KEEP_PHASE4_INVOICE_ID = 1480;
const DELETE_INVOICE_IDS = [1545, 1589, 1812]; // phases 5, 6, 7
const TARGET_GENERATED_COUNT = 3; // phases 2, 3, 4 remain
const REPAIR_NOTE =
  'Ops repair 2026-07-13 — Maverick remove Playgroup phases 5–7 after unpaid Phase 4 drop';

const isApply = process.argv.includes('--apply');

async function deleteInvoiceCascade(client, invoiceId) {
  const payments = await client.query(
    `SELECT payment_id FROM paymenttbl WHERE invoice_id = $1`,
    [invoiceId]
  );
  if (payments.rows.length) {
    throw new Error(
      `Invoice ${invoiceId} has ${payments.rows.length} payment(s); refuse to delete`
    );
  }
  await client.query(`DELETE FROM program_payment_statustbl WHERE invoice_id = $1`, [
    invoiceId,
  ]);
  await client.query(`DELETE FROM invoicestudentstbl WHERE invoice_id = $1`, [invoiceId]);
  await client.query(`DELETE FROM invoiceitemstbl WHERE invoice_id = $1`, [invoiceId]);
  await client.query(
    `UPDATE invoicestbl SET balance_invoice_id = NULL WHERE balance_invoice_id = $1`,
    [invoiceId]
  );
  await client.query(`DELETE FROM invoicestbl WHERE invoice_id = $1`, [invoiceId]);
}

async function loadState(client) {
  const student = (
    await client.query(
      `SELECT user_id, full_name, email FROM userstbl
       WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))`,
      [STUDENT_EMAIL]
    )
  ).rows[0];

  const profile = (
    await client.query(
      `SELECT ip.installmentinvoiceprofiles_id, ip.student_id, ip.class_id,
              ip.phase_start, ip.total_phases, ip.generated_count, ip.is_active,
              ii.installmentinvoicedtl_id, ii.status AS ii_status,
              TO_CHAR(ii.next_generation_date, 'YYYY-MM-DD') AS next_gen,
              TO_CHAR(ii.next_invoice_month, 'YYYY-MM-DD') AS next_month
       FROM installmentinvoiceprofilestbl ip
       LEFT JOIN installmentinvoicestbl ii
         ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
       WHERE ip.installmentinvoiceprofiles_id = $1`,
      [PROFILE_ID]
    )
  ).rows[0];

  const invoices = (
    await client.query(
      `SELECT invoice_id, status, amount, remarks,
              TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue,
              TO_CHAR(due_date, 'YYYY-MM-DD') AS due,
              (SELECT COUNT(*)::int FROM paymenttbl p WHERE p.invoice_id = i.invoice_id) AS pay_count
       FROM invoicestbl i
       WHERE installmentinvoiceprofiles_id = $1
       ORDER BY invoice_id`,
      [PROFILE_ID]
    )
  ).rows.map((r) => ({ ...r, phase: parseTargetPhase(r.remarks) }));

  const enrollments = (
    await client.query(
      `SELECT classstudent_id, phase_number, program_enrollment_status,
              TO_CHAR(TIMEZONE('Asia/Manila', removed_at), 'YYYY-MM-DD') AS removed,
              enrolled_by, removed_reason
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2
       ORDER BY phase_number, classstudent_id`,
      [STUDENT_ID, CLASS_ID]
    )
  ).rows;

  return { student, profile, invoices, enrollments };
}

async function main() {
  console.log(
    `\nMaverick — remove Playgroup phases 5–7${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );

  const client = await getClient();

  try {
    const before = await loadState(client);
    if (!before.student || Number(before.student.user_id) !== STUDENT_ID) {
      throw new Error(`Student ${STUDENT_EMAIL} (id ${STUDENT_ID}) not found`);
    }
    if (!before.profile || Number(before.profile.student_id) !== STUDENT_ID) {
      throw new Error(`Profile ${PROFILE_ID} not found for student ${STUDENT_ID}`);
    }
    if (Number(before.profile.class_id) !== CLASS_ID) {
      throw new Error(`Profile class_id=${before.profile.class_id}, expected ${CLASS_ID}`);
    }

    console.log('Student:', before.student.full_name, before.student.email);
    console.log('Profile BEFORE:', {
      generated_count: before.profile.generated_count,
      total_phases: before.profile.total_phases,
      phase_start: before.profile.phase_start,
      is_active: before.profile.is_active,
      ii_status: before.profile.ii_status,
      next_gen: before.profile.next_gen,
    });
    console.log('\nInvoices BEFORE:');
    console.table(
      before.invoices.map((i) => ({
        inv: i.invoice_id,
        phase: i.phase,
        status: i.status,
        issue: i.issue,
        due: i.due,
        amount: i.amount,
        pays: i.pay_count,
      }))
    );
    console.log('\nEnrollments BEFORE:');
    console.table(
      before.enrollments.map((e) => ({
        id: e.classstudent_id,
        phase: e.phase_number,
        status: e.program_enrollment_status,
        removed: e.removed,
      }))
    );

    for (const id of DELETE_INVOICE_IDS) {
      const inv = before.invoices.find((i) => Number(i.invoice_id) === id);
      if (!inv) throw new Error(`Expected invoice ${id} missing`);
      if (Number(inv.pay_count) > 0) {
        throw new Error(`Invoice ${id} has payments; refuse to delete`);
      }
      if (['Paid', 'Partially Paid'].includes(inv.status)) {
        throw new Error(`Invoice ${id} is ${inv.status}; refuse to delete`);
      }
    }

    const phase4 = before.invoices.find(
      (i) => Number(i.invoice_id) === KEEP_PHASE4_INVOICE_ID
    );
    if (!phase4 || Number(phase4.phase) !== 4) {
      throw new Error(`Phase 4 INV-${KEEP_PHASE4_INVOICE_ID} must remain`);
    }

    const dropEnrollments = before.enrollments.filter(
      (e) =>
        [5, 6, 7].includes(Number(e.phase_number)) &&
        e.program_enrollment_status === 'dropped'
    );

    console.log('\nPlanned:');
    for (const id of DELETE_INVOICE_IDS) {
      const inv = before.invoices.find((i) => Number(i.invoice_id) === id);
      console.log(`  • DELETE INV-${id} (phase ${inv.phase})`);
    }
    for (const e of dropEnrollments) {
      console.log(
        `  • DELETE classstudent ${e.classstudent_id} (phase ${e.phase_number} dropped)`
      );
    }
    console.log(`  • generated_count → ${TARGET_GENERATED_COUNT}`);
    console.log('  • keep profile is_active=false (Phase 4 still unpaid/dropped)');
    console.log('  • Note:', REPAIR_NOTE);

    if (!isApply) {
      console.log('\nDry run complete. Re-run with --apply to write changes.');
      return;
    }

    await client.query('BEGIN');

    for (const id of DELETE_INVOICE_IDS) {
      await deleteInvoiceCascade(client, id);
      console.log(`✅ Deleted INV-${id}`);
    }

    for (const e of dropEnrollments) {
      await client.query(`DELETE FROM classstudentstbl WHERE classstudent_id = $1`, [
        e.classstudent_id,
      ]);
      console.log(
        `✅ Deleted classstudent ${e.classstudent_id} (phase ${e.phase_number})`
      );
    }

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET generated_count = $1,
           is_active = false
       WHERE installmentinvoiceprofiles_id = $2`,
      [TARGET_GENERATED_COUNT, PROFILE_ID]
    );

    // Stop further auto-generation while Phase 4 remains unpaid/dropped.
    if (before.profile.installmentinvoicedtl_id) {
      await client.query(
        `UPDATE installmentinvoicestbl
         SET status = 'Generated',
             next_generation_date = NULL,
             next_invoice_month = NULL
         WHERE installmentinvoicedtl_id = $1`,
        [before.profile.installmentinvoicedtl_id]
      );
    }

    await client.query('COMMIT');
    console.log('\n✅ Applied.');

    const after = await loadState(client);
    console.log('\nInvoices AFTER:');
    console.table(
      after.invoices.map((i) => ({
        inv: i.invoice_id,
        phase: i.phase,
        status: i.status,
        issue: i.issue,
        due: i.due,
        amount: i.amount,
      }))
    );
    console.log('\nEnrollments AFTER:');
    console.table(
      after.enrollments.map((e) => ({
        id: e.classstudent_id,
        phase: e.phase_number,
        status: e.program_enrollment_status,
        removed: e.removed,
      }))
    );
    console.log('Profile AFTER:', {
      generated_count: after.profile.generated_count,
      is_active: after.profile.is_active,
      ii_status: after.profile.ii_status,
      next_gen: after.profile.next_gen,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
