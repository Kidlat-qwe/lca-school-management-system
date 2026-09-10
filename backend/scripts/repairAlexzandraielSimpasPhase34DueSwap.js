/**
 * Alexzandraiel Jeice M. Simpas (jealclane@gmail.com, user 658) —
 * Switch Phase 3 and Phase 4 due dates (they are reversed).
 *
 * Profile 484 · Kindergarten class 160
 *
 * Current:
 *   P3 INV-2427 / leaf 2428 — due 2026-10-05
 *   P4 INV-2524 / leaf 2909 — due 2026-09-05
 *
 * Target:
 *   P3 due 2026-09-05
 *   P4 due 2026-10-05
 *
 * Issue dates, payments, and amounts are unchanged.
 *
 * Run (from backend/):
 *   node scripts/repairAlexzandraielSimpasPhase34DueSwap.js --production
 *   node scripts/repairAlexzandraielSimpasPhase34DueSwap.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_ID = 658;
const STUDENT_EMAIL = 'jealclane@gmail.com';
const PROFILE_ID = 484;

const PHASE3_DUE = '2026-09-05';
const PHASE4_DUE = '2026-10-05';

/** Parent + leaf invoices for each phase */
const PHASE3_INVOICE_IDS = [2427, 2428];
const PHASE4_INVOICE_IDS = [2524, 2909];

const REPAIR_NOTE =
  'Ops repair 2026-09-08 — Alexzandraiel Simpas swap P3/P4 due (Sep 5 / Oct 5)';

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

async function loadInvoice(client, invoiceId) {
  const inv = (
    await client.query(
      `SELECT invoice_id, status, remarks, installmentinvoiceprofiles_id,
              parent_invoice_id, balance_invoice_id,
              TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue,
              TO_CHAR(due_date, 'YYYY-MM-DD') AS due
       FROM invoicestbl WHERE invoice_id = $1`,
      [invoiceId]
    )
  ).rows[0];
  if (!inv) throw new Error(`INV-${invoiceId} not found`);
  return inv;
}

async function assertLinked(client, invoiceId) {
  const linked = (
    await client.query(
      `SELECT 1 FROM invoicestudentstbl WHERE invoice_id = $1 AND student_id = $2`,
      [invoiceId, STUDENT_ID]
    )
  ).rows[0];
  if (!linked) throw new Error(`INV-${invoiceId} not linked to student ${STUDENT_ID}`);
}

async function setDue(client, invoiceId, dueDate, remarks) {
  await client.query(
    `UPDATE invoicestbl
     SET due_date = $1::date,
         late_penalty_applied_for_due_date = NULL,
         remarks = $2
     WHERE invoice_id = $3`,
    [dueDate, appendNote(remarks, REPAIR_NOTE), invoiceId]
  );
  await syncProgramPaymentStatusForInvoice(client, invoiceId);
}

async function main() {
  console.log(
    `\nAlexzandraiel Simpas — swap P3/P4 due dates${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
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
    if (!student) throw new Error('Student not found');
    console.log(`Student: ${student.full_name} (${student.email})`);

    const profile = (
      await client.query(
        `SELECT installmentinvoiceprofiles_id, student_id, class_id
         FROM installmentinvoiceprofilestbl
         WHERE installmentinvoiceprofiles_id = $1 AND student_id = $2`,
        [PROFILE_ID, STUDENT_ID]
      )
    ).rows[0];
    if (!profile) throw new Error(`Profile ${PROFILE_ID} not found`);

    console.log('\nBefore:');
    for (const id of [...PHASE3_INVOICE_IDS, ...PHASE4_INVOICE_IDS]) {
      const inv = await loadInvoice(client, id);
      await assertLinked(client, id);
      if (Number(inv.installmentinvoiceprofiles_id) !== PROFILE_ID) {
        throw new Error(`INV-${id} not on profile ${PROFILE_ID}`);
      }
      const phase = parseTargetPhase(inv.remarks);
      console.log(
        `  INV-${id} phase=${phase} issue=${inv.issue} due=${inv.due} status=${inv.status}`
      );
    }

    // Validate current dues are swapped (P3=Oct 5, P4=Sep 5)
    for (const id of PHASE3_INVOICE_IDS) {
      const inv = await loadInvoice(client, id);
      if (parseTargetPhase(inv.remarks) !== 3) {
        throw new Error(`INV-${id} expected TARGET_PHASE:3`);
      }
      if (inv.due !== '2026-10-05') {
        throw new Error(`INV-${id} expected current due 2026-10-05, got ${inv.due}`);
      }
    }
    for (const id of PHASE4_INVOICE_IDS) {
      const inv = await loadInvoice(client, id);
      if (parseTargetPhase(inv.remarks) !== 4) {
        throw new Error(`INV-${id} expected TARGET_PHASE:4`);
      }
      if (inv.due !== '2026-09-05') {
        throw new Error(`INV-${id} expected current due 2026-09-05, got ${inv.due}`);
      }
    }

    for (const id of PHASE3_INVOICE_IDS) {
      const inv = await loadInvoice(client, id);
      await setDue(client, id, PHASE3_DUE, inv.remarks);
      console.log(`→ INV-${id} due → ${PHASE3_DUE}`);
    }
    for (const id of PHASE4_INVOICE_IDS) {
      const inv = await loadInvoice(client, id);
      await setDue(client, id, PHASE4_DUE, inv.remarks);
      console.log(`→ INV-${id} due → ${PHASE4_DUE}`);
    }

    console.log('\nAfter (in transaction):');
    for (const [ids, expected] of [
      [PHASE3_INVOICE_IDS, PHASE3_DUE],
      [PHASE4_INVOICE_IDS, PHASE4_DUE],
    ]) {
      for (const id of ids) {
        const inv = await loadInvoice(client, id);
        console.log(`  INV-${id} due=${inv.due}`);
        if (inv.due !== expected) {
          throw new Error(`INV-${id} due ${inv.due} != ${expected}`);
        }
      }
    }

    console.log('\n✅ Phase 3 due Sep 5; Phase 4 due Oct 5.');

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
