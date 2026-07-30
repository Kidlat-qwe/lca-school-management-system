/**
 * Repair Margarette Celine P. Endico — Phase 4 & 5 issue/due dates + installment queue.
 *
 * After phase 5 was generated (INV-2074), dates landed wrong:
 *   Phase 4 (INV-1439) currently shows June 25 / July 05 (those belong on Phase 5)
 *   Phase 5 (INV-2074) shows August 26 / August 26
 *
 * Ops-correct cadence (25th issue / 5th due):
 *   Phase 4 — INV-1439: issue 2026-05-25, due 2026-06-05
 *   Phase 5 — INV-2074: issue 2026-06-25, due 2026-07-05
 *   Installment queue: next_generation_date 2026-07-25, next_invoice_month 2026-08-01
 *
 * Run (from backend/):
 *   node scripts/repairMargaretEndicoPhase45IssueDueDates.js --production
 *   node scripts/repairMargaretEndicoPhase45IssueDueDates.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { formatYmdLocal } from '../utils/dateUtils.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_EMAIL = 'endico.kiel@yahoo.com';
const STUDENT_ID = 620;
const PROFILE_ID = 436;
const INSTALLMENT_DTL_ID = 433;

const PHASE_TARGETS = {
  1439: { absolute_phase: 4, issue_date: '2026-05-25', due_date: '2026-06-05' },
  2074: { absolute_phase: 5, issue_date: '2026-06-25', due_date: '2026-07-05' },
};

const QUEUE_TARGET = {
  next_generation_date: '2026-07-25',
  next_invoice_month: '2026-08-01',
};

const REPAIR_NOTE =
  'Ops repair — Margaret Endico phase 4/5 issue-due + queue Jul 25 / Aug 01';

const isApply = process.argv.includes('--apply');

const ymd = (value) => {
  if (value == null) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  return formatYmdLocal(value).slice(0, 10);
};

async function clearPenaltyAndRecalcAmount(client, invoiceId) {
  await client.query(
    `DELETE FROM invoiceitemstbl
     WHERE invoice_id = $1 AND COALESCE(penalty_amount, 0) > 0`,
    [invoiceId]
  );

  const totals = await client.query(
    `SELECT COALESCE(SUM(amount), 0) - COALESCE(SUM(discount_amount), 0)
            + COALESCE(SUM(penalty_amount), 0) AS grand
     FROM invoiceitemstbl
     WHERE invoice_id = $1`,
    [invoiceId]
  );
  const grand = Number(totals.rows[0]?.grand || 0);
  await client.query(
    `UPDATE invoicestbl
     SET amount = $1,
         late_penalty_applied_for_due_date = NULL
     WHERE invoice_id = $2`,
    [grand, invoiceId]
  );
}

async function main() {
  console.log(
    `\nMargaret Endico — phase 4/5 issue-due + queue repair${
      isApply ? ' (APPLY)' : ' (DRY RUN)'
    }\n`
  );
  console.log(`Note: ${REPAIR_NOTE}\n`);

  const client = await getClient();

  try {
    const student = (
      await client.query(
        `SELECT user_id, full_name, email FROM userstbl
         WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))`,
        [STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student || Number(student.user_id) !== STUDENT_ID) {
      throw new Error(`Student ${STUDENT_EMAIL} (id ${STUDENT_ID}) not found`);
    }

    const profile = (
      await client.query(
        `SELECT ip.installmentinvoiceprofiles_id, ip.student_id, ip.generated_count,
                ip.phase_start, ip.total_phases,
                ii.installmentinvoicedtl_id,
                TO_CHAR(TIMEZONE('Asia/Manila', ii.next_generation_date), 'YYYY-MM-DD') AS next_gen,
                TO_CHAR(TIMEZONE('Asia/Manila', ii.next_invoice_month), 'YYYY-MM-DD') AS next_month
         FROM installmentinvoiceprofilestbl ip
         INNER JOIN installmentinvoicestbl ii
           ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
         WHERE ip.installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      )
    ).rows[0];

    if (!profile || Number(profile.student_id) !== STUDENT_ID) {
      throw new Error(`Profile ${PROFILE_ID} not found for student ${STUDENT_ID}`);
    }

    console.log('Student:', student.full_name, student.email);
    console.log('Profile:', {
      id: PROFILE_ID,
      phase_start: profile.phase_start,
      generated_count: profile.generated_count,
      total_phases: profile.total_phases,
      queue_next_gen: profile.next_gen,
      queue_next_month: profile.next_month,
    });

    const changes = [];

    for (const [invoiceIdStr, target] of Object.entries(PHASE_TARGETS)) {
      const invoiceId = Number(invoiceIdStr);
      const inv = (
        await client.query(
          `SELECT invoice_id, status, remarks, amount,
                  TO_CHAR(TIMEZONE('Asia/Manila', issue_date), 'YYYY-MM-DD') AS issue_ymd,
                  TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due_ymd,
                  installmentinvoiceprofiles_id,
                  late_penalty_applied_for_due_date::text AS late_penalty
           FROM invoicestbl WHERE invoice_id = $1`,
          [invoiceId]
        )
      ).rows[0];

      if (!inv) throw new Error(`Invoice ${invoiceId} not found`);
      if (Number(inv.installmentinvoiceprofiles_id) !== PROFILE_ID) {
        throw new Error(`Invoice ${invoiceId} not on profile ${PROFILE_ID}`);
      }

      const curTp = parseTargetPhase(inv.remarks);
      if (curTp != null && Number(curTp) !== target.absolute_phase) {
        throw new Error(
          `Invoice ${invoiceId} TARGET_PHASE=${curTp}, expected ${target.absolute_phase}`
        );
      }

      const dateChange =
        inv.issue_ymd !== target.issue_date || inv.due_ymd !== target.due_date;

      if (dateChange) {
        changes.push({
          invoice_id: invoiceId,
          phase: target.absolute_phase,
          status: inv.status,
          from_issue: inv.issue_ymd,
          from_due: inv.due_ymd,
          to_issue: target.issue_date,
          to_due: target.due_date,
          clear_penalty: inv.late_penalty ? 'yes' : 'if present',
        });
      } else {
        console.log(
          `Phase ${target.absolute_phase} INV-${invoiceId}: already ${inv.issue_ymd} / ${inv.due_ymd}`
        );
      }
    }

    const queueChange =
      profile.next_gen !== QUEUE_TARGET.next_generation_date ||
      profile.next_month !== QUEUE_TARGET.next_invoice_month;

    if (queueChange) {
      changes.push({
        invoice_id: 'queue',
        phase: '—',
        status: '—',
        from_issue: profile.next_gen,
        from_due: profile.next_month,
        to_issue: QUEUE_TARGET.next_generation_date,
        to_due: QUEUE_TARGET.next_invoice_month,
        clear_penalty: 'n/a (next_gen / next_month)',
      });
    } else {
      console.log(
        `Queue already ${QUEUE_TARGET.next_generation_date} / ${QUEUE_TARGET.next_invoice_month}`
      );
    }

    if (!changes.length) {
      console.log('\nNo changes needed.');
      return;
    }

    console.log('\nPlanned changes:');
    console.table(changes);

    if (!isApply) {
      console.log('\nDry run complete. Re-run with --apply to write changes.');
      return;
    }

    await client.query('BEGIN');

    for (const [invoiceIdStr, target] of Object.entries(PHASE_TARGETS)) {
      const invoiceId = Number(invoiceIdStr);
      await client.query(
        `UPDATE invoicestbl
         SET issue_date = ($1::date + TIME '12:00'),
             due_date = ($2::date + TIME '12:00'),
             late_penalty_applied_for_due_date = NULL
         WHERE invoice_id = $3`,
        [target.issue_date, target.due_date, invoiceId]
      );
      await clearPenaltyAndRecalcAmount(client, invoiceId);
      await syncProgramPaymentStatusForInvoice(client, invoiceId);
      console.log(
        `✅ Phase ${target.absolute_phase} INV-${invoiceId}: ${target.issue_date} / ${target.due_date}`
      );
    }

    await client.query(
      `UPDATE installmentinvoicestbl
       SET status = NULL,
           next_generation_date = $1::date,
           next_invoice_month = $2::date
       WHERE installmentinvoicedtl_id = $3`,
      [
        QUEUE_TARGET.next_generation_date,
        QUEUE_TARGET.next_invoice_month,
        INSTALLMENT_DTL_ID,
      ]
    );
    console.log(
      `✅ Queue → ${QUEUE_TARGET.next_generation_date} / ${QUEUE_TARGET.next_invoice_month}`
    );

    await client.query('COMMIT');

    const verifyInv = await client.query(
      `SELECT invoice_id, status,
              TO_CHAR(TIMEZONE('Asia/Manila', issue_date), 'YYYY-MM-DD') AS issue_ymd,
              TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due_ymd
       FROM invoicestbl
       WHERE invoice_id IN (1439, 2074)
       ORDER BY invoice_id`
    );
    console.log('\nVerified invoices:');
    console.table(verifyInv.rows);

    const verifyQ = await client.query(
      `SELECT TO_CHAR(TIMEZONE('Asia/Manila', next_generation_date), 'YYYY-MM-DD') AS next_gen,
              TO_CHAR(TIMEZONE('Asia/Manila', next_invoice_month), 'YYYY-MM-DD') AS next_month
       FROM installmentinvoicestbl
       WHERE installmentinvoicedtl_id = $1`,
      [INSTALLMENT_DTL_ID]
    );
    console.log('\nVerified queue:');
    console.table(verifyQ.rows);

    console.log(`\n${REPAIR_NOTE}`);
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
