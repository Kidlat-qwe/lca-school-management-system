/**
 * Repair Aelia Luna M. Pelito — phase 9 dates/enrollment + generate phase 10.
 *
 * Profile 113 | VMP_Nursery_MWF_9:30AM | phase_start 7 | 4 local phases (7–10)
 *
 * Fixes:
 *  - INV 1179 (phase 8): issue 2026-04-25, due 2026-05-05 (paid)
 *  - INV 1489 (phase 9): issue 2026-05-25, due 2026-06-05, remove penalty, unpaid
 *  - Remove erroneous phase 9 delinquency drop (not enrolled until paid)
 *  - Reactivate profile and generate phase 10 (issue 2026-06-25, due 2026-07-05)
 *
 * Run:
 *   node backend/scripts/repairAeliaPelitoInstallmentPhases.js
 *   node backend/scripts/repairAeliaPelitoInstallmentPhases.js --apply
 *   node backend/scripts/repairAeliaPelitoInstallmentPhases.js --apply --generate
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { rewriteTargetPhaseInRemarks } from '../utils/installmentPhaseBillingSync.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';
import {
  buildPhaseInstallmentSchedule,
  isPhaseInstallmentProfile,
} from '../utils/phaseInstallmentUtils.js';
import { coerceToManilaYmd, formatYmdLocal } from '../utils/dateUtils.js';
import { generateInvoiceFromInstallment } from '../utils/installmentInvoiceGenerator.js';

const STUDENT_EMAIL = 'aelialuna0817@gmail.com';
const STUDENT_ID = 259;
const PROFILE_ID = 113;
const PHASE_10 = 10;
const PHASE_10_ISSUE = '2026-06-25';
const PHASE_10_DUE = '2026-07-05';

const INVOICE_FIXES = {
  1179: { absolute_phase: 8, issue_date: '2026-04-25', due_date: '2026-05-05' },
  1489: {
    absolute_phase: 9,
    issue_date: '2026-05-25',
    due_date: '2026-06-05',
    reset_status_to_unpaid: true,
    clear_penalty: true,
  },
};

const args = new Set(process.argv.slice(2));
const isApply = args.has('--apply');
const isGenerate = args.has('--generate');

const ymd = (value) => (value == null ? '' : String(value).slice(0, 10));

async function loadProfileRow(client) {
  const res = await client.query(
    `SELECT ip.*, ii.installmentinvoicedtl_id, ii.next_generation_date, ii.next_invoice_month,
            ii.status AS ii_status, ii.frequency AS ii_frequency,
            ii.total_amount_including_tax, ii.total_amount_excluding_tax,
            u.full_name, u.email, c.class_name
     FROM installmentinvoiceprofilestbl ip
     INNER JOIN installmentinvoicestbl ii
       ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
     INNER JOIN userstbl u ON u.user_id = ip.student_id
     LEFT JOIN classestbl c ON c.class_id = ip.class_id
     WHERE ip.installmentinvoiceprofiles_id = $1`,
    [PROFILE_ID]
  );
  return res.rows[0] || null;
}

async function loadPhaseInvoice(client, absolutePhase) {
  const res = await client.query(
    `SELECT invoice_id, status, invoice_ar_number,
            TO_CHAR(TIMEZONE('Asia/Manila', issue_date), 'YYYY-MM-DD') AS issue_ymd,
            TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due_ymd,
            remarks
     FROM invoicestbl
     WHERE installmentinvoiceprofiles_id = $1
       AND remarks ILIKE $2
     ORDER BY invoice_id DESC
     LIMIT 1`,
    [PROFILE_ID, `%TARGET_PHASE:${absolutePhase}%`]
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
    `\nAelia Pelito — installment repair${isApply ? ' (APPLY)' : ' (DRY RUN)'}${isGenerate ? ' + GENERATE' : ''}\n`
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

    const dropped = await client.query(
      `SELECT classstudent_id, phase_number, program_enrollment_status, removed_reason
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2 AND phase_number = 9
         AND program_enrollment_status = 'dropped'`,
      [STUDENT_ID, row.class_id]
    );

    const phase10Before = await loadPhaseInvoice(client, PHASE_10);
    const workingCount = 3;

    console.log('\nCurrent invoices:');
    for (const phase of [7, 8, 9, 10]) {
      const inv = await loadPhaseInvoice(client, phase);
      console.log(`  Phase ${phase}:`, inv || '—');
    }

    console.log('\nPhase 9 dropped row:', dropped.rows[0] || 'none');
    console.log('Phase 10 invoice:', phase10Before || 'not generated');

    const invoiceChanges = [];
    for (const [idStr, target] of Object.entries(INVOICE_FIXES)) {
      const invoiceId = Number(idStr);
      const inv = (
        await client.query(`SELECT * FROM invoicestbl WHERE invoice_id = $1`, [invoiceId])
      ).rows[0];
      if (!inv) throw new Error(`Invoice ${invoiceId} missing`);
      invoiceChanges.push({
        invoice_id: invoiceId,
        phase: target.absolute_phase,
        issue: `${ymd(inv.issue_date)} → ${target.issue_date}`,
        due: `${ymd(inv.due_date)} → ${target.due_date}`,
        status: target.reset_status_to_unpaid ? `${inv.status} → Unpaid` : inv.status,
        penalty: target.clear_penalty ? 'clear if present' : '—',
      });
    }

    console.log('\nPlanned invoice fixes:');
    console.table(invoiceChanges);

    if (dropped.rows.length) {
      console.log('\nPlanned enrollment fix: DELETE phase 9 dropped row (student not enrolled until paid)');
    }

    const sched = await buildPhaseInstallmentSchedule({
      db: client,
      profile: row,
      generatedCountOverride: workingCount,
    });

    console.log('\nCanonical phase 10 schedule (generated_count=3, before invoice date fixes):');
    console.table([
      {
        phase: sched?.current_phase_number,
        issue: sched?.current_issue_date,
        due: sched?.current_due_date,
        gen: sched?.current_generation_date,
        month: sched?.current_invoice_month,
      },
    ]);
    console.log(`Target phase 10 after repair: issue ${PHASE_10_ISSUE}, due ${PHASE_10_DUE}`);

    if (isGenerate && !phase10Before) {
      console.log('\nWill generate phase 10 invoice after queue sync.');
    }

    if (!isApply) {
      console.log('\nRe-run with --apply. Add --generate to create phase 10.');
      return;
    }

    await client.query('BEGIN');

    for (const [idStr, target] of Object.entries(INVOICE_FIXES)) {
      const invoiceId = Number(idStr);
      const inv = (
        await client.query(`SELECT * FROM invoicestbl WHERE invoice_id = $1`, [invoiceId])
      ).rows[0];
      const curTp = parseTargetPhase(inv.remarks);
      const nextRemarks =
        curTp === target.absolute_phase
          ? inv.remarks
          : rewriteTargetPhaseInRemarks(inv.remarks, target.absolute_phase);
      const nextStatus =
        target.reset_status_to_unpaid && inv.status !== 'Paid' ? 'Unpaid' : inv.status;

      await client.query(
        `UPDATE invoicestbl
         SET issue_date = $1::date,
             due_date = $2::date,
             remarks = $3,
             status = $4,
             late_penalty_applied_for_due_date = NULL
         WHERE invoice_id = $5`,
        [target.issue_date, target.due_date, nextRemarks, nextStatus, invoiceId]
      );

      if (target.clear_penalty) {
        const cleared = await clearInvoicePenalty(client, invoiceId);
        if (cleared) console.log(`✅ Cleared penalty on invoice ${invoiceId}`);
      }

      await syncProgramPaymentStatusForInvoice(client, invoiceId);
      console.log(`✅ Invoice ${invoiceId} (phase ${target.absolute_phase}) dates updated`);
    }

    if (dropped.rows.length) {
      await client.query(`DELETE FROM classstudentstbl WHERE classstudent_id = $1`, [
        dropped.rows[0].classstudent_id,
      ]);
      console.log('✅ Removed erroneous phase 9 dropped enrollment');
    }

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET generated_count = $1, is_active = true
       WHERE installmentinvoiceprofiles_id = $2`,
      [workingCount, PROFILE_ID]
    );

    const schedAfter = await buildPhaseInstallmentSchedule({
      db: client,
      profile: { ...row, generated_count: workingCount },
      generatedCountOverride: workingCount,
    });

    const queueGen = schedAfter?.current_generation_date || PHASE_10_ISSUE;
    const queueMonth = schedAfter?.current_invoice_month || '2026-07-01';

    await client.query(
      `UPDATE installmentinvoicestbl
       SET status = NULL,
           next_generation_date = $1,
           next_invoice_month = $2
       WHERE installmentinvoicedtl_id = $3`,
      [queueGen, queueMonth, row.installmentinvoicedtl_id]
    );
    console.log('✅ Profile reactivated; queue synced for phase 10:', queueGen, queueMonth);

    await client.query('COMMIT');

    if (isGenerate && !phase10Before) {
      const fresh = await loadProfileRow(client);
      const installmentInvoice = {
        installmentinvoicedtl_id: fresh.installmentinvoicedtl_id,
        installmentinvoiceprofiles_id: fresh.installmentinvoiceprofiles_id,
        next_generation_date: fresh.next_generation_date,
        next_invoice_month: fresh.next_invoice_month,
        frequency: fresh.ii_frequency || fresh.frequency,
        total_amount_including_tax: fresh.total_amount_including_tax,
        total_amount_excluding_tax: fresh.total_amount_excluding_tax,
        status: fresh.ii_status,
      };

      const result = await generateInvoiceFromInstallment(installmentInvoice, {
        student_id: fresh.student_id,
        branch_id: fresh.branch_id,
        package_id: fresh.package_id,
        amount: fresh.amount,
        frequency: fresh.frequency,
        description: fresh.description,
        generated_count: fresh.generated_count,
        class_id: fresh.class_id,
        total_phases: fresh.total_phases,
        phase_start: fresh.phase_start,
      });

      console.log('✅ Generated phase 10 invoice:', {
        invoice_id: result.invoice_id,
        issue: formatYmdLocal(result.issue_date),
        due: formatYmdLocal(result.due_date),
      });

      const phase10Inv = await loadPhaseInvoice(client, PHASE_10);
      if (
        phase10Inv &&
        (phase10Inv.issue_ymd !== PHASE_10_ISSUE || phase10Inv.due_ymd !== PHASE_10_DUE)
      ) {
        await client.query(
          `UPDATE invoicestbl SET issue_date = $1::date, due_date = $2::date WHERE invoice_id = $3`,
          [PHASE_10_ISSUE, PHASE_10_DUE, phase10Inv.invoice_id]
        );
        await syncProgramPaymentStatusForInvoice(client, phase10Inv.invoice_id);
        console.log(`✅ Phase 10 dates corrected to ${PHASE_10_ISSUE} / ${PHASE_10_DUE}`);
      }

      await client.query(
        `UPDATE installmentinvoiceprofilestbl SET is_active = false WHERE installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      );
      console.log('✅ Profile marked inactive (all 4 phases generated)');
    }

    console.log('\n--- AFTER ---');
    for (const phase of [7, 8, 9, 10]) {
      console.log(`Phase ${phase}:`, (await loadPhaseInvoice(client, phase)) || '—');
    }
    const enrollAfter = await client.query(
      `SELECT phase_number, program_enrollment_status, removed_at
       FROM classstudentstbl WHERE student_id = $1 AND class_id = $2 ORDER BY phase_number`,
      [STUDENT_ID, row.class_id]
    );
    console.log('Enrollment:', enrollAfter.rows);

    const finalRow = await loadProfileRow(client);
    console.log('Profile:', {
      generated_count: finalRow.generated_count,
      is_active: finalRow.is_active,
      queue_gen: ymd(finalRow.next_generation_date),
      queue_month: ymd(finalRow.next_invoice_month),
      ii_status: finalRow.ii_status,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error('Repair failed:', err.message);
  process.exit(1);
});
