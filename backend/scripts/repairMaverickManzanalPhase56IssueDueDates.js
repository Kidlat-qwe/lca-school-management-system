/**
 * Maverick Raziel Viola Manzanal (shaimanzanal@icloud.com) — correct Plan 1
 * Playgroup Phase 5 & 6 installment invoice issue_date and due_date.
 *
 * Profile 94 — Phase 2 - Plan 1 (NO DP) / NC_Playgroup_TTh_9:30-10:30PM
 *
 * Target dates (25th issue / 5th next-month due):
 *   Phase 5 — INV-1545: issue 2026-04-25, due 2026-05-05
 *   Phase 6 — INV-1589: issue 2026-05-25, due 2026-06-05
 *
 * Clears late-penalty markers/line items so the due-date job can re-apply
 * against the corrected due dates. Does not change Phase 4 or Phase 7.
 *
 * Run:
 *   node backend/scripts/repairMaverickManzanalPhase56IssueDueDates.js
 *   node backend/scripts/repairMaverickManzanalPhase56IssueDueDates.js --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_EMAIL = 'shaimanzanal@icloud.com';
const STUDENT_ID = 171;
const PROFILE_ID = 94;
const CLASS_ID = 57;
const REPAIR_NOTE =
  'Ops repair 2026-07-13 — Maverick Manzanal Plan 1 Playgroup phase 5–6 issue/due dates';

const PHASE_TARGETS = {
  1545: { absolute_phase: 5, issue_date: '2026-04-25', due_date: '2026-05-05' },
  1589: { absolute_phase: 6, issue_date: '2026-05-25', due_date: '2026-06-05' },
};

const isApply = process.argv.includes('--apply');

const ymd = (value) => (value == null ? '' : String(value).slice(0, 10));

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
    `\nMaverick Manzanal — Plan 1 phase 5–6 issue/due repair${
      isApply ? ' (APPLY)' : ' (DRY RUN)'
    }\n`
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
      throw new Error(`Student ${STUDENT_EMAIL} (id ${STUDENT_ID}) not found`);
    }

    const profile = (
      await client.query(
        `SELECT * FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      )
    ).rows[0];
    if (!profile || Number(profile.student_id) !== STUDENT_ID) {
      throw new Error(`Profile ${PROFILE_ID} not found for student ${STUDENT_ID}`);
    }
    if (Number(profile.class_id) !== CLASS_ID) {
      throw new Error(
        `Profile ${PROFILE_ID} class_id=${profile.class_id}, expected ${CLASS_ID}`
      );
    }

    console.log('Student:', student.full_name, student.email);
    console.log('Profile:', {
      id: PROFILE_ID,
      package_hint: 'Phase 2 - Plan 1 (NO DP)',
      phase_start: profile.phase_start,
      total_phases: profile.total_phases,
      generated_count: profile.generated_count,
      class_id: profile.class_id,
    });
    console.log('Note:', REPAIR_NOTE);

    for (const [invoiceIdStr, target] of Object.entries(PHASE_TARGETS)) {
      const invoiceId = Number(invoiceIdStr);
      const inv = (
        await client.query(
          `SELECT invoice_id, status, remarks, amount,
                  issue_date::text AS issue_date,
                  due_date::text AS due_date,
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

      const curIssue = ymd(inv.issue_date);
      const curDue = ymd(inv.due_date);
      const dateChange = curIssue !== target.issue_date || curDue !== target.due_date;

      if (dateChange) {
        changes.push({
          invoice_id: invoiceId,
          phase: target.absolute_phase,
          status: inv.status,
          amount: inv.amount,
          from_issue: curIssue,
          from_due: curDue,
          to_issue: target.issue_date,
          to_due: target.due_date,
          clear_penalty: inv.late_penalty ? 'yes' : 'if present',
        });
      } else {
        console.log(
          `Phase ${target.absolute_phase} INV-${invoiceId}: already ${curIssue} / ${curDue}`
        );
      }
    }

    if (!changes.length) {
      console.log('\nNo invoice date changes needed.');
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
         SET issue_date = $1::date,
             due_date = $2::date,
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

    await client.query('COMMIT');

    const verify = await client.query(
      `SELECT invoice_id, status, amount,
              TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue_ymd,
              TO_CHAR(due_date, 'YYYY-MM-DD') AS due_ymd,
              late_penalty_applied_for_due_date::text AS late_penalty
       FROM invoicestbl
       WHERE invoice_id IN (1480, 1545, 1589, 1812)
       ORDER BY invoice_id`
    );
    console.log('\nVerified phases 4–7:');
    console.table(verify.rows);
    console.log('\nDone. Phase 4 and Phase 7 were not modified.');
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
