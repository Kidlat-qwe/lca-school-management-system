/**
 * Kiev Zion Z. Serrano — correct Phase 2–4 installment issue_date / due_date.
 *
 * Profile 384 | VMM_Nursery_MWF 2:30 PM
 *   Phase 2 INV-2281 → issue 2026-05-25, due 2026-06-05
 *   Phase 3 INV-2336 → issue 2026-06-25, due 2026-07-05
 *   Phase 4 INV-2352 → issue 2026-07-25, due 2026-08-05
 *
 * Run:
 *   node backend/scripts/repairKievSerranoPhase234Dates.js --production
 *   node backend/scripts/repairKievSerranoPhase234Dates.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_EMAIL = 'juliepearlserrano01@gmail.com';
const STUDENT_ID = 581;
const PROFILE_ID = 384;

const TARGETS = [
  { invoiceId: 2281, phase: 2, issue: '2026-05-25', due: '2026-06-05' },
  { invoiceId: 2336, phase: 3, issue: '2026-06-25', due: '2026-07-05' },
  { invoiceId: 2352, phase: 4, issue: '2026-07-25', due: '2026-08-05' },
];

const REPAIR_NOTE =
  'Ops repair 2026-08-01 — Kiev Serrano Phase2–4 issue/due dates (May25/Jun5, Jun25/Jul5, Jul25/Aug5)';

const isApply = process.argv.includes('--apply');

async function loadInvoice(client, invoiceId) {
  const r = await client.query(
    `SELECT invoice_id, status, amount, remarks, installmentinvoiceprofiles_id AS profile_id,
            TO_CHAR(TIMEZONE('Asia/Manila', issue_date), 'YYYY-MM-DD') AS issue,
            TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due
     FROM invoicestbl
     WHERE invoice_id = $1`,
    [invoiceId]
  );
  return r.rows[0] || null;
}

async function main() {
  console.log(
    `\nKiev Serrano — Phase 2–4 issue/due dates${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`DB: ${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV}`);

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
    console.log('Student:', student.full_name, student.email);

    console.log('\nBEFORE:');
    for (const t of TARGETS) {
      const inv = await loadInvoice(client, t.invoiceId);
      if (!inv) throw new Error(`INV-${t.invoiceId} not found`);
      if (Number(inv.profile_id) !== PROFILE_ID) {
        throw new Error(`INV-${t.invoiceId} profile ${inv.profile_id} ≠ ${PROFILE_ID}`);
      }
      const phase = parseTargetPhase(inv.remarks);
      if (phase !== t.phase) {
        throw new Error(`INV-${t.invoiceId} phase ${phase} ≠ ${t.phase}`);
      }
      console.table([
        {
          inv: inv.invoice_id,
          phase,
          status: inv.status,
          issue: inv.issue,
          due: inv.due,
          target_issue: t.issue,
          target_due: t.due,
        },
      ]);
    }

    if (!isApply) {
      console.log('\nDry run only — no writes. Re-run with --apply to commit.');
      return;
    }

    await client.query('BEGIN');

    for (const t of TARGETS) {
      await client.query(
        `UPDATE invoicestbl
         SET issue_date = $1::date,
             due_date = $2::date,
             late_penalty_applied_for_due_date = NULL,
             remarks = CASE
               WHEN remarks ILIKE '%' || $4 || '%' THEN remarks
               WHEN remarks IS NULL OR TRIM(remarks) = '' THEN $4
               ELSE remarks || ' | ' || $4
             END
         WHERE invoice_id = $3`,
        [t.issue, t.due, t.invoiceId, REPAIR_NOTE]
      );
      await syncProgramPaymentStatusForInvoice(client, t.invoiceId);
      console.log(`✅ INV-${t.invoiceId} Phase ${t.phase} → ${t.issue} / ${t.due}`);
    }

    await client.query('COMMIT');

    console.log('\nAFTER:');
    for (const t of TARGETS) {
      const inv = await loadInvoice(client, t.invoiceId);
      console.table([
        {
          inv: inv.invoice_id,
          phase: parseTargetPhase(inv.remarks),
          status: inv.status,
          issue: inv.issue,
          due: inv.due,
        },
      ]);
    }
    console.log('\n✅ Apply complete. Refresh Student history → Invoices.');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('\n❌ Repair failed:', err?.message || err);
    throw err;
  } finally {
    client.release();
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
