/**
 * Fix Kier Balagtas Phase 3 rejoin due date → first session of Phase 3.
 *
 * INV-723 currently due 2026-09-04 (payment day). Phase 3 session 1 is 2026-12-03.
 *
 * Run (from backend/):
 *   node scripts/repairKierBalagtasRejoinDueDate.js
 *   node scripts/repairKierBalagtasRejoinDueDate.js --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { resolveRejoinInvoiceDueDateYmd } from '../utils/rejoinDroppedPhaseSettlement/index.js';

const INVOICE_ID = 723;
const CLASS_ID = 56;
const PHASE = 3;
const STUDENT_EMAIL = 'it.kier@little-champion.com';

const isApply = process.argv.includes('--apply');

async function main() {
  console.log(`\nKier rejoin due-date fix${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`);
  const client = await getClient();
  try {
    const inv = (
      await client.query(
        `SELECT i.invoice_id, i.status, i.remarks,
                TO_CHAR(TIMEZONE('Asia/Manila', i.issue_date), 'YYYY-MM-DD') AS issue,
                TO_CHAR(TIMEZONE('Asia/Manila', i.due_date), 'YYYY-MM-DD') AS due,
                u.email
         FROM invoicestbl i
         JOIN invoicestudentstbl ist ON ist.invoice_id = i.invoice_id
         JOIN userstbl u ON u.user_id = ist.student_id
         WHERE i.invoice_id = $1`,
        [INVOICE_ID]
      )
    ).rows[0];

    if (!inv) throw new Error(`Invoice ${INVOICE_ID} not found`);
    if (String(inv.email || '').toLowerCase() !== STUDENT_EMAIL.toLowerCase()) {
      throw new Error(`Email mismatch: ${inv.email}`);
    }

    const dueYmd = await resolveRejoinInvoiceDueDateYmd(client, {
      classId: CLASS_ID,
      phaseNumber: PHASE,
    });
    if (!dueYmd) throw new Error(`No Phase ${PHASE} sessions for class ${CLASS_ID}`);

    console.table([{ invoice_id: inv.invoice_id, issue: inv.issue, due_before: inv.due, due_after: dueYmd }]);

    if (!isApply) {
      console.log('Dry run only. Re-run with --apply.');
      return;
    }

    await client.query(
      `UPDATE invoicestbl
       SET due_date = ($1::date + TIME '12:00'),
           late_penalty_applied_for_due_date = NULL
       WHERE invoice_id = $2`,
      [dueYmd, INVOICE_ID]
    );
    console.log(`✅ INV-${INVOICE_ID} due_date → ${dueYmd}`);
  } finally {
    client.release();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Failed:', err.message);
    process.exit(1);
  });
