/**
 * Jaliyah Callie Almendras — correct installment invoice issue/due dates and
 * TARGET_PHASE remarks to match the same class billing cadence as Kirsten Mahinay
 * (SOMO_Playgroup_TTh_9:30-10:30AM, class 47).
 *
 * Absolute class phase dates (25th issue / 5th next-month due):
 *   Phase 2 — issue 2026-03-25, due 2026-04-05  (INV-347)
 *   Phase 3 — issue 2026-04-25, due 2026-05-05  (INV-605)
 *   Phase 4 — issue 2026-05-25, due 2026-06-05  (INV-1043)
 *   Phase 5 — issue 2026-06-25, due 2026-07-05  (INV-1525)
 *
 * Also resets INV-1525 status to Unpaid after date correction (was Rejected from
 * a bad payment attempt while dates duplicated phase 4).
 *
 * Run:
 *   node backend/scripts/repairJaliyahAlmendrasInstallmentIssueDueDates.js
 *   node backend/scripts/repairJaliyahAlmendrasInstallmentIssueDueDates.js --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { rewriteTargetPhaseInRemarks } from '../utils/installmentPhaseBillingSync.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';
import { buildPhaseInstallmentSchedule } from '../utils/phaseInstallmentUtils.js';
import { coerceToManilaYmd } from '../utils/dateUtils.js';

const STUDENT_EMAIL = 'rinadeleon713@gmail.com';
const STUDENT_ID = 353;
const PROFILE_ID = 150;

const PHASE_TARGETS = {
  347: { absolute_phase: 2, issue_date: '2026-03-25', due_date: '2026-04-05' },
  605: { absolute_phase: 3, issue_date: '2026-04-25', due_date: '2026-05-05' },
  1043: { absolute_phase: 4, issue_date: '2026-05-25', due_date: '2026-06-05' },
  1525: {
    absolute_phase: 5,
    issue_date: '2026-06-25',
    due_date: '2026-07-05',
    reset_status_to_unpaid: true,
  },
};

const isApply = process.argv.includes('--apply');

const ymd = (value) => (value == null ? '' : String(value).slice(0, 10));

async function main() {
  console.log(
    `\nJaliyah Almendras — installment issue/due date repair${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );

  const client = await getClient();
  const changes = [];

  try {
    const student = (
      await client.query(
        `SELECT user_id, full_name, email FROM userstbl
         WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))`,
        [STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student || Number(student.user_id) !== STUDENT_ID) {
      throw new Error(`Student ${STUDENT_EMAIL} not found`);
    }

    const profile = (
      await client.query(`SELECT * FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1`, [
        PROFILE_ID,
      ])
    ).rows[0];
    if (!profile || Number(profile.student_id) !== STUDENT_ID) {
      throw new Error(`Profile ${PROFILE_ID} not found`);
    }

    console.log('Student:', student.full_name);
    console.log('Profile:', {
      id: PROFILE_ID,
      phase_start: profile.phase_start,
      generated_count: profile.generated_count,
      class_id: profile.class_id,
    });

    for (const [invoiceIdStr, target] of Object.entries(PHASE_TARGETS)) {
      const invoiceId = Number(invoiceIdStr);
      const inv = (
        await client.query(
          `SELECT invoice_id, status, remarks,
                  issue_date::text AS issue_date,
                  due_date::text AS due_date,
                  installmentinvoiceprofiles_id
           FROM invoicestbl WHERE invoice_id = $1`,
          [invoiceId]
        )
      ).rows[0];

      if (!inv) throw new Error(`Invoice ${invoiceId} not found`);
      if (Number(inv.installmentinvoiceprofiles_id) !== PROFILE_ID) {
        throw new Error(`Invoice ${invoiceId} not on profile ${PROFILE_ID}`);
      }

      const curIssue = ymd(inv.issue_date);
      const curDue = ymd(inv.due_date);
      const curTp = parseTargetPhase(inv.remarks);
      const nextRemarks =
        curTp === target.absolute_phase
          ? inv.remarks
          : rewriteTargetPhaseInRemarks(inv.remarks, target.absolute_phase);

      const dateChange = curIssue !== target.issue_date || curDue !== target.due_date;
      const remarkChange = nextRemarks !== inv.remarks;
      const statusChange = target.reset_status_to_unpaid && inv.status !== 'Unpaid';

      if (dateChange || remarkChange || statusChange) {
        changes.push({
          invoice_id: invoiceId,
          phase: target.absolute_phase,
          status: inv.status,
          from_issue: curIssue,
          from_due: curDue,
          to_issue: target.issue_date,
          to_due: target.due_date,
          target_phase: `${curTp ?? '—'} → ${target.absolute_phase}`,
          reset_status: statusChange ? `${inv.status} → Unpaid` : '—',
        });
      }
    }

    if (!changes.length) {
      console.log('\nNo changes needed — dates already match Kirsten class cadence.');
    } else {
      console.log('\nPlanned changes:');
      console.table(changes);
    }

    const sched = await buildPhaseInstallmentSchedule({
      db: client,
      profile: {
        installmentinvoiceprofiles_id: profile.installmentinvoiceprofiles_id,
        class_id: profile.class_id,
        phase_start: profile.phase_start,
        total_phases: profile.total_phases,
        generated_count: profile.generated_count,
      },
      generatedCountOverride: parseInt(profile.generated_count || 0, 10),
    });

    const ii = (
      await client.query(`SELECT * FROM installmentinvoicestbl WHERE installmentinvoiceprofiles_id = $1`, [
        PROFILE_ID,
      ])
    ).rows[0];

    const expectedGen = sched?.current_generation_date;
    const expectedMonth = sched?.current_invoice_month;
    const storedGen = coerceToManilaYmd(ii?.next_generation_date);
    const storedMonth = coerceToManilaYmd(ii?.next_invoice_month);

    console.log('\nInstallment invoice queue (Installment Invoice Logs):');
    console.table([
      {
        stored_next_gen: storedGen,
        stored_next_month: storedMonth,
        schedule_next_gen: expectedGen,
        schedule_next_month: expectedMonth,
        needs_queue_sync: storedGen !== expectedGen || storedMonth !== expectedMonth,
      },
    ]);

    if (!isApply) {
      if (changes.length) console.log('\nRe-run with --apply to write changes.');
      return;
    }

    await client.query('BEGIN');

    for (const [invoiceIdStr, target] of Object.entries(PHASE_TARGETS)) {
      const invoiceId = Number(invoiceIdStr);
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
             late_penalty_applied_for_due_date = NULL,
             amount = CASE WHEN $5 THEN $6::numeric ELSE amount END
         WHERE invoice_id = $7`,
        [
          target.issue_date,
          target.due_date,
          nextRemarks,
          nextStatus,
          target.reset_status_to_unpaid && nextStatus === 'Unpaid',
          profile.amount || '5146.00',
          invoiceId,
        ]
      );

      await client.query(
        `DELETE FROM invoiceitemstbl
         WHERE invoice_id = $1 AND COALESCE(penalty_amount, 0) > 0`,
        [invoiceId]
      );

      await syncProgramPaymentStatusForInvoice(client, invoiceId);
    }

    if (ii && expectedGen && expectedMonth && (storedGen !== expectedGen || storedMonth !== expectedMonth)) {
      await client.query(
        `UPDATE installmentinvoicestbl
         SET status = NULL, next_generation_date = $1, next_invoice_month = $2
         WHERE installmentinvoicedtl_id = $3`,
        [expectedGen, expectedMonth, ii.installmentinvoicedtl_id]
      );
      console.log(`✅ Queue synced → ${expectedGen} / ${expectedMonth}`);
    }

    await client.query('COMMIT');

    const verify = (
      await client.query(
        `SELECT invoice_id, status, remarks,
                TO_CHAR(TIMEZONE('Asia/Manila', issue_date), 'YYYY-MM-DD') AS issue,
                TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due
         FROM invoicestbl
         WHERE installmentinvoiceprofiles_id = $1
           AND invoice_id <> $2
         ORDER BY invoice_id`,
        [PROFILE_ID, profile.downpayment_invoice_id]
      )
    ).rows;

    console.log('\nAfter repair:');
    console.table(
      verify.map((r) => ({
        invoice_id: r.invoice_id,
        target_phase: parseTargetPhase(r.remarks),
        issue: r.issue,
        due: r.due,
        status: r.status,
      }))
    );

    console.log('\n✅ Done. Refresh Student History → Invoices for Jaliyah.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nFailed:', err.message || err);
    process.exit(1);
  });
