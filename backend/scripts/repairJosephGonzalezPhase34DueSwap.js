/**
 * Joseph Lee Mykael G. Gonzalez (gergontrucking@gmail.com, user 602) —
 * swap Phase 3 ↔ Phase 4 due dates.
 *
 * Profile 449
 *   Phase 3 chain: INV-1966 → INV-1967  (current due 2026-09-05)
 *   Phase 4 chain: INV-2170 → INV-2412  (current due 2026-08-05)
 *
 * Desired:
 *   Phase 3 → due 2026-08-05
 *   Phase 4 → due 2026-09-05
 *
 * Issue dates / payments / amounts are unchanged.
 *
 * Run (from backend/):
 *   node scripts/repairJosephGonzalezPhase34DueSwap.js --production
 *   node scripts/repairJosephGonzalezPhase34DueSwap.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_ID = 602;
const STUDENT_EMAIL = 'gergontrucking@gmail.com';
const PROFILE_ID = 449;

const PHASE3_INVOICE_IDS = [1966, 1967];
const PHASE4_INVOICE_IDS = [2170, 2412];

const PHASE3_DUE = '2026-08-05'; // after swap
const PHASE4_DUE = '2026-09-05'; // after swap

const REPAIR_NOTE =
  'Ops repair 2026-09-05 — Joseph Gonzalez swap Phase 3/4 due dates (P3→Aug 5, P4→Sep 5)';

const isApply = process.argv.includes('--apply');

async function loadInvoices(client, ids) {
  const r = await client.query(
    `SELECT i.invoice_id, i.status,
            substring(i.remarks from 'TARGET_PHASE:([0-9]+)') AS phase,
            TO_CHAR(i.issue_date, 'YYYY-MM-DD') AS issue,
            TO_CHAR(i.due_date, 'YYYY-MM-DD') AS due,
            i.parent_invoice_id, i.balance_invoice_id,
            i.installmentinvoiceprofiles_id
     FROM invoicestbl i
     WHERE i.invoice_id = ANY($1::int[])
     ORDER BY i.invoice_id`,
    [ids]
  );
  return r.rows;
}

async function main() {
  console.log(
    `\nJoseph Gonzalez — Phase 3/4 due date swap` +
      `${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`Note: ${REPAIR_NOTE}`);
  console.log(`DB: ${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV}`);
  if (process.env.DB_NAME !== 'psms_production') {
    console.warn('⚠️ Expected psms_production. Pass --production.');
  }

  const client = await getClient();
  try {
    const student = (
      await client.query(
        `SELECT user_id, full_name, email
         FROM userstbl
         WHERE user_id = $1 AND LOWER(TRIM(email)) = LOWER(TRIM($2))`,
        [STUDENT_ID, STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student) throw new Error(`Student ${STUDENT_ID} / ${STUDENT_EMAIL} not found`);
    console.log('Student:', student.full_name, student.email);

    const allIds = [...PHASE3_INVOICE_IDS, ...PHASE4_INVOICE_IDS];
    for (const id of allIds) {
      const linked = (
        await client.query(
          `SELECT 1 FROM invoicestudentstbl WHERE invoice_id = $1 AND student_id = $2`,
          [id, STUDENT_ID]
        )
      ).rows[0];
      if (!linked) throw new Error(`INV-${id} not linked to student ${STUDENT_ID}`);
    }

    const before = await loadInvoices(client, allIds);
    console.log('\nBEFORE:');
    console.table(before);

    for (const id of PHASE3_INVOICE_IDS) {
      const row = before.find((r) => Number(r.invoice_id) === id);
      if (!row) throw new Error(`Missing Phase 3 INV-${id}`);
      if (String(row.phase) !== '3') {
        throw new Error(`INV-${id} expected TARGET_PHASE:3, got ${row.phase}`);
      }
      if (Number(row.installmentinvoiceprofiles_id) !== PROFILE_ID) {
        throw new Error(`INV-${id} not on profile ${PROFILE_ID}`);
      }
    }
    for (const id of PHASE4_INVOICE_IDS) {
      const row = before.find((r) => Number(r.invoice_id) === id);
      if (!row) throw new Error(`Missing Phase 4 INV-${id}`);
      if (String(row.phase) !== '4') {
        throw new Error(`INV-${id} expected TARGET_PHASE:4, got ${row.phase}`);
      }
    }

    const p3DueNow = before.find((r) => Number(r.invoice_id) === 1966)?.due;
    const p4DueNow = before.find((r) => Number(r.invoice_id) === 2170)?.due;
    console.log('\nPlanned:');
    console.log(`  Phase 3 (INV ${PHASE3_INVOICE_IDS.join(', ')}): due ${p3DueNow} → ${PHASE3_DUE}`);
    console.log(`  Phase 4 (INV ${PHASE4_INVOICE_IDS.join(', ')}): due ${p4DueNow} → ${PHASE4_DUE}`);
    console.log('  Clear late_penalty_applied_for_due_date on those invoices');

    if (!isApply) {
      console.log('\nDry run only. Re-run with --apply to commit.');
      return;
    }

    await client.query('BEGIN');

    await client.query(
      `UPDATE invoicestbl
       SET due_date = $1::date,
           late_penalty_applied_for_due_date = NULL,
           remarks = CASE
             WHEN remarks ILIKE '%' || $3 || '%' THEN remarks
             WHEN remarks IS NULL OR TRIM(remarks) = '' THEN $3
             ELSE LEFT(remarks || ' | ' || $3, 2000)
           END
       WHERE invoice_id = ANY($2::int[])`,
      [PHASE3_DUE, PHASE3_INVOICE_IDS, REPAIR_NOTE]
    );

    await client.query(
      `UPDATE invoicestbl
       SET due_date = $1::date,
           late_penalty_applied_for_due_date = NULL,
           remarks = CASE
             WHEN remarks ILIKE '%' || $3 || '%' THEN remarks
             WHEN remarks IS NULL OR TRIM(remarks) = '' THEN $3
             ELSE LEFT(remarks || ' | ' || $3, 2000)
           END
       WHERE invoice_id = ANY($2::int[])`,
      [PHASE4_DUE, PHASE4_INVOICE_IDS, REPAIR_NOTE]
    );

    for (const id of allIds) {
      await syncProgramPaymentStatusForInvoice(client, id);
    }

    await client.query('COMMIT');
    console.log('\n✅ Due dates swapped.');

    const after = await loadInvoices(client, allIds);
    console.log('\nAFTER:');
    console.table(after);

    for (const id of PHASE3_INVOICE_IDS) {
      const row = after.find((r) => Number(r.invoice_id) === id);
      if (row?.due !== PHASE3_DUE) {
        throw new Error(`Validation failed INV-${id}: due ${row?.due} != ${PHASE3_DUE}`);
      }
    }
    for (const id of PHASE4_INVOICE_IDS) {
      const row = after.find((r) => Number(r.invoice_id) === id);
      if (row?.due !== PHASE4_DUE) {
        throw new Error(`Validation failed INV-${id}: due ${row?.due} != ${PHASE4_DUE}`);
      }
    }
    console.log('Validated: Phase 3 due Aug 5, Phase 4 due Sep 5.');
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
    console.error('\nFailed:', err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  });
