/**
 * Andrei Caleb Ethan V. Atienza (juliven_atienza@lifelinediag.com) —
 * correct Nursery Phase 6–9 installment invoice issue_date and due_date.
 *
 * Profile 97 — Nursery Phase 6 Old Rate (NO DP) / NC_Nursery_MWF_4:00-5:00PM
 *
 * Target dates:
 *   Phase 6 — INV-278:  issue 2026-02-22, due 2026-02-22  (already correct)
 *   Phase 7 — INV-294:  issue 2026-03-25, due 2026-04-05
 *   Phase 8 — INV-773 (+ balance INV-774): issue 2026-04-25, due 2026-05-05
 *   Phase 9 — INV-1201: issue 2026-05-25, due 2026-06-05
 *   Phase 10 — not generated yet (target when generated: issue 2026-06-25, due 2026-07-05)
 *
 * Clears late-penalty markers/line items so the due-date job can re-apply
 * against the corrected due dates.
 *
 * Run:
 *   node backend/scripts/repairAndreiAtienzaPhase610IssueDueDates.js
 *   node backend/scripts/repairAndreiAtienzaPhase610IssueDueDates.js --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_EMAIL = 'juliven_atienza@lifelinediag.com';
const STUDENT_ID = 247;
const PROFILE_ID = 97;
const CLASS_ID = 58;
const REPAIR_NOTE =
  'Ops repair 2026-07-13 — Andrei Atienza Nursery phase 6–9 issue/due dates';

/** invoice_id → target absolute phase + dates */
const PHASE_TARGETS = {
  278: { absolute_phase: 6, issue_date: '2026-02-22', due_date: '2026-02-22' },
  294: { absolute_phase: 7, issue_date: '2026-03-25', due_date: '2026-04-05' },
  773: { absolute_phase: 8, issue_date: '2026-04-25', due_date: '2026-05-05' },
  // Balance continuation of phase 8 — keep payment-day issue_date, align due date
  774: {
    absolute_phase: 8,
    issue_date: null,
    due_date: '2026-05-05',
    keep_issue_date: true,
  },
  1201: { absolute_phase: 9, issue_date: '2026-05-25', due_date: '2026-06-05' },
};

const PHASE10_TARGET = { issue_date: '2026-06-25', due_date: '2026-07-05' };

const isApply = process.argv.includes('--apply');

const ymd = (value) => (value == null ? '' : String(value).slice(0, 10));

async function clearPenaltyAndRecalcAmount(client, invoiceId) {
  const inv = (
    await client.query(
      `SELECT status FROM invoicestbl WHERE invoice_id = $1`,
      [invoiceId]
    )
  ).rows[0];

  await client.query(
    `DELETE FROM invoiceitemstbl
     WHERE invoice_id = $1 AND COALESCE(penalty_amount, 0) > 0`,
    [invoiceId]
  );

  // Paid invoices store remaining balance (0). Only recalc amount for open invoices.
  if (String(inv?.status || '') === 'Paid') {
    await client.query(
      `UPDATE invoicestbl
       SET late_penalty_applied_for_due_date = NULL
       WHERE invoice_id = $1`,
      [invoiceId]
    );
    return;
  }

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
    `\nAndrei Atienza — Nursery phase 6–9 issue/due repair${
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
      package_hint: 'Nursery - Phase 6 - Old Rate (NO DP)',
      phase_start: profile.phase_start,
      total_phases: profile.total_phases,
      generated_count: profile.generated_count,
      class_id: profile.class_id,
      is_active: profile.is_active,
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
      const toIssue = target.keep_issue_date ? curIssue : target.issue_date;
      const toDue = target.due_date;
      const dateChange = curIssue !== toIssue || curDue !== toDue;

      if (dateChange) {
        changes.push({
          invoice_id: invoiceId,
          phase: target.absolute_phase,
          status: inv.status,
          amount: inv.amount,
          from_issue: curIssue,
          from_due: curDue,
          to_issue: toIssue,
          to_due: toDue,
          clear_penalty: inv.late_penalty ? 'yes' : 'if present',
        });
      } else {
        console.log(
          `Phase ${target.absolute_phase} INV-${invoiceId}: already ${curIssue} / ${curDue}`
        );
      }
    }

    const phase10 = (
      await client.query(
        `SELECT invoice_id, remarks,
                TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue,
                TO_CHAR(due_date, 'YYYY-MM-DD') AS due
         FROM invoicestbl
         WHERE installmentinvoiceprofiles_id = $1
           AND remarks ILIKE '%TARGET_PHASE:10%'
         ORDER BY invoice_id
         LIMIT 1`,
        [PROFILE_ID]
      )
    ).rows[0];

    if (phase10) {
      console.log(
        `\nPhase 10 INV-${phase10.invoice_id}: ${phase10.issue} / ${phase10.due}` +
          ` (target ${PHASE10_TARGET.issue_date} / ${PHASE10_TARGET.due_date})`
      );
    } else {
      console.log(
        `\nPhase 10: not generated yet. Target when generated: ${PHASE10_TARGET.issue_date} / ${PHASE10_TARGET.due_date}`
      );
    }

    if (!changes.length) {
      console.log('\nNo invoice date changes needed for phases 6–9.');
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
      const inv = (
        await client.query(
          `SELECT issue_date::text AS issue_date FROM invoicestbl WHERE invoice_id = $1`,
          [invoiceId]
        )
      ).rows[0];
      const toIssue = target.keep_issue_date
        ? ymd(inv.issue_date)
        : target.issue_date;
      const toDue = target.due_date;

      await client.query(
        `UPDATE invoicestbl
         SET issue_date = $1::date,
             due_date = $2::date,
             late_penalty_applied_for_due_date = NULL
         WHERE invoice_id = $3`,
        [toIssue, toDue, invoiceId]
      );
      await clearPenaltyAndRecalcAmount(client, invoiceId);
      await syncProgramPaymentStatusForInvoice(client, invoiceId);
      console.log(
        `✅ Phase ${target.absolute_phase} INV-${invoiceId}: ${toIssue} / ${toDue}`
      );
    }

    await client.query('COMMIT');

    const verify = await client.query(
      `SELECT invoice_id, status, amount,
              TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue_ymd,
              TO_CHAR(due_date, 'YYYY-MM-DD') AS due_ymd,
              late_penalty_applied_for_due_date::text AS late_penalty,
              remarks
       FROM invoicestbl
       WHERE invoice_id IN (278, 294, 773, 774, 1201)
       ORDER BY invoice_id`
    );
    console.log('\nVerified phases 6–9:');
    console.table(
      verify.rows.map((r) => ({
        invoice_id: r.invoice_id,
        phase: parseTargetPhase(r.remarks),
        status: r.status,
        amount: r.amount,
        issue: r.issue_ymd,
        due: r.due_ymd,
        late_penalty: r.late_penalty,
      }))
    );
    console.log(
      '\nDone. Phase 10 remains Not Generated (generate separately if needed).'
    );
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
