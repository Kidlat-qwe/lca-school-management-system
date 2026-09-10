/**
 * Kael Devin Burayag Hamdan (myrna01@gmail.com, user 524) —
 * Fix Phase 4–7 due dates on Playgroup installment plan (profile 307, class 91).
 *
 * Current (wrong cadence after advance pays):
 *   P4 INV-754  due 2026-06-05
 *   P5 INV-1216 due 2026-07-05
 *   P6 INV-1889 due 2026-10-05
 *   P7 INV-2392 due 2026-12-05
 *
 * Target:
 *   P4 due 2026-07-05
 *   P5 due 2026-08-05
 *   P6 due 2026-09-05
 *   P7 due 2026-10-05
 *
 * Issue dates / payments / amounts are left unchanged.
 * Clears late_penalty stamp if present (dues move forward; no amount rewrite).
 *
 * Run (from backend/):
 *   node scripts/repairKaelHamdanPhase4567DueDates.js --production
 *   node scripts/repairKaelHamdanPhase4567DueDates.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_ID = 524;
const STUDENT_EMAIL = 'myrna01@gmail.com';
const PROFILE_ID = 307;
const CLASS_ID = 91;

const PHASE_TARGETS = [
  { invoiceId: 754, phase: 4, dueDate: '2026-07-05' },
  { invoiceId: 1216, phase: 5, dueDate: '2026-08-05' },
  { invoiceId: 1889, phase: 6, dueDate: '2026-09-05' },
  { invoiceId: 2392, phase: 7, dueDate: '2026-10-05' },
];

const REPAIR_NOTE =
  'Ops repair 2026-09-08 — Kael Hamdan Phase 4–7 due Jul/Aug/Sep/Oct 5';

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

async function main() {
  console.log(
    `\nKael Hamdan — Phase 4–7 due dates${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
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
    if (!student) throw new Error(`Student ${STUDENT_ID} / ${STUDENT_EMAIL} not found`);
    console.log(`Student: ${student.full_name} (${student.email})`);

    const profile = (
      await client.query(
        `SELECT installmentinvoiceprofiles_id, class_id, phase_start, total_phases,
                generated_count, is_active
         FROM installmentinvoiceprofilestbl
         WHERE installmentinvoiceprofiles_id = $1
           AND student_id = $2
           AND class_id = $3`,
        [PROFILE_ID, STUDENT_ID, CLASS_ID]
      )
    ).rows[0];
    if (!profile) throw new Error(`Profile ${PROFILE_ID} not found for student/class`);
    console.log('Profile:', profile);

    for (const target of PHASE_TARGETS) {
      const inv = (
        await client.query(
          `SELECT i.invoice_id, i.status, i.remarks,
                  TO_CHAR(i.issue_date, 'YYYY-MM-DD') AS issue,
                  TO_CHAR(i.due_date, 'YYYY-MM-DD') AS due,
                  i.installmentinvoiceprofiles_id,
                  i.late_penalty_applied_for_due_date::text AS late_pen
           FROM invoicestbl i
           WHERE i.invoice_id = $1`,
          [target.invoiceId]
        )
      ).rows[0];
      if (!inv) throw new Error(`INV-${target.invoiceId} not found`);
      if (Number(inv.installmentinvoiceprofiles_id) !== PROFILE_ID) {
        throw new Error(
          `INV-${target.invoiceId} profile ${inv.installmentinvoiceprofiles_id} != ${PROFILE_ID}`
        );
      }

      const linked = (
        await client.query(
          `SELECT 1 FROM invoicestudentstbl WHERE invoice_id = $1 AND student_id = $2`,
          [target.invoiceId, STUDENT_ID]
        )
      ).rows[0];
      if (!linked) {
        throw new Error(`INV-${target.invoiceId} not linked to student ${STUDENT_ID}`);
      }

      const parsedPhase = parseTargetPhase(inv.remarks);
      if (parsedPhase != null && Number(parsedPhase) !== target.phase) {
        throw new Error(
          `INV-${target.invoiceId} TARGET_PHASE:${parsedPhase} != expected ${target.phase}`
        );
      }

      console.log(
        `  P${target.phase} INV-${target.invoiceId}: due ${inv.due} → ${target.dueDate}` +
          ` (issue ${inv.issue}, status ${inv.status})`
      );

      await client.query(
        `UPDATE invoicestbl
         SET due_date = $1::date,
             late_penalty_applied_for_due_date = NULL,
             remarks = $2
         WHERE invoice_id = $3`,
        [target.dueDate, appendNote(inv.remarks, REPAIR_NOTE), target.invoiceId]
      );

      await syncProgramPaymentStatusForInvoice(client, target.invoiceId);
    }

    console.log('\nAfter (in transaction):');
    for (const target of PHASE_TARGETS) {
      const inv = (
        await client.query(
          `SELECT invoice_id,
                  TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue,
                  TO_CHAR(due_date, 'YYYY-MM-DD') AS due,
                  status
           FROM invoicestbl WHERE invoice_id = $1`,
          [target.invoiceId]
        )
      ).rows[0];
      console.log(
        `  P${target.phase} INV-${inv.invoice_id}: issue ${inv.issue} due ${inv.due} (${inv.status})`
      );
      if (inv.due !== target.dueDate) {
        throw new Error(`INV-${target.invoiceId} due is ${inv.due}, expected ${target.dueDate}`);
      }
    }

    console.log('\n✅ Phase 4–7 due dates match target.');

    if (isApply) {
      await client.query('COMMIT');
      console.log('\nCommitted.');
    } else {
      await client.query('ROLLBACK');
      console.log('\nDry run — rolled back. Re-run with --apply to commit.');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\nFailed:', err.message || err);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main();
