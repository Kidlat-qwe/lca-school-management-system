/**
 * Shao Kun Calingasin Wang — shift payments so Phase 2 is unpaid (Pay Now, no penalty).
 *
 * Student: 115 · calingasinhelen@gmail.com
 * Profile: 81 · class 56 NC_Nursery_MWF_11:00-12:00PM
 *
 * Mapping (highest phase first):
 *   PAY-1507 INV-1507 (Phase 5) → INV-1805 (Phase 6)
 *   PAY-1062 INV-1091 (Phase 4) → INV-1507 (Phase 5)
 *   PAY-654  INV-611  (Phase 3) → INV-1091 (Phase 4)
 *   PAY-283  INV-257  (Phase 2) → INV-611  (Phase 3)
 *
 * Expected after apply:
 *   Phase 1 Paid (unchanged)
 *   Phase 2 Unpaid ₱5,146 + Pay Now, enrollment —
 *   Phases 3–6 Paid
 *   Phase 7 Unpaid — Pay Now moves here after Phase 2 is paid
 *
 * Run:
 *   node backend/scripts/repairShaoKunShiftPhasePayments.js --production
 *   node backend/scripts/repairShaoKunShiftPhasePayments.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { rewriteTargetPhaseInRemarks } from '../utils/installmentPhaseBillingSync.js';
import { deriveInvoiceStatusForInvoice } from '../utils/invoicePaymentStatus.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_ID = 115;
const STUDENT_EMAIL = 'calingasinhelen@gmail.com';
const CLASS_ID = 56;
const PROFILE_ID = 81;

const PHASE1_INVOICE_ID = 249;
const PHASE2_INVOICE_ID = 257;
const PHASE3_INVOICE_ID = 611;
const PHASE4_INVOICE_ID = 1091;
const PHASE5_INVOICE_ID = 1507;
const PHASE6_INVOICE_ID = 1805;
const PHASE7_INVOICE_ID = 2317;
const PHASE2_CLASSSTUDENT_ID = 346;
const PHASE6_CLASSSTUDENT_ID = 2110;

const BASE_AMOUNT = 5146;
const DROP_WAIVE_FLAG = 'DELINQUENCY_DROP_WAIVED';

/** Highest destination first so invoice_id slots are free. */
const PAYMENT_MOVES = [
  { payment_id: 1507, from_invoice_id: PHASE5_INVOICE_ID, to_invoice_id: PHASE6_INVOICE_ID },
  { payment_id: 1062, from_invoice_id: PHASE4_INVOICE_ID, to_invoice_id: PHASE5_INVOICE_ID },
  { payment_id: 654, from_invoice_id: PHASE3_INVOICE_ID, to_invoice_id: PHASE4_INVOICE_ID },
  { payment_id: 283, from_invoice_id: PHASE2_INVOICE_ID, to_invoice_id: PHASE3_INVOICE_ID },
];

const ALL_PHASE_INVOICE_IDS = [
  PHASE1_INVOICE_ID,
  PHASE2_INVOICE_ID,
  PHASE3_INVOICE_ID,
  PHASE4_INVOICE_ID,
  PHASE5_INVOICE_ID,
  PHASE6_INVOICE_ID,
  PHASE7_INVOICE_ID,
];

const REPAIR_NOTE =
  'Ops repair 2026-08-12 — Shao Kun shift payments P2→P3→P4→P5→P6; Phase 2 unpaid Pay Now no penalty';

const isApply = process.argv.includes('--apply');
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function loadInvoice(client, invoiceId) {
  const r = await client.query(
    `SELECT invoice_id, status, amount, invoice_ar_number,
            installmentinvoiceprofiles_id AS profile_id,
            TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue,
            TO_CHAR(due_date, 'YYYY-MM-DD') AS due,
            LEFT(COALESCE(remarks,''), 160) AS remarks
     FROM invoicestbl WHERE invoice_id = $1`,
    [invoiceId]
  );
  const row = r.rows[0] || null;
  if (row) row.phase = parseTargetPhase(row.remarks);
  return row;
}

async function loadPayment(client, paymentId) {
  const r = await client.query(
    `SELECT payment_id, invoice_id, payable_amount, status, approval_status, reference_number
     FROM paymenttbl WHERE payment_id = $1`,
    [paymentId]
  );
  return r.rows[0] || null;
}

async function sumCompletedSettlement(client, invoiceId) {
  const r = await client.query(
    `SELECT COALESCE(SUM(COALESCE(payable_amount, 0) + COALESCE(discount_amount, 0)), 0)::numeric AS settled
     FROM paymenttbl
     WHERE invoice_id = $1
       AND status = 'Completed'
       AND COALESCE(approval_status, 'Pending') <> 'Rejected'`,
    [invoiceId]
  );
  return round2(r.rows[0]?.settled);
}

async function clearInvoicePenalty(client, invoiceId) {
  const items = await client.query(
    `SELECT invoice_item_id
     FROM invoiceitemstbl
     WHERE invoice_id = $1 AND COALESCE(penalty_amount, 0) > 0`,
    [invoiceId]
  );
  for (const item of items.rows) {
    await client.query(
      `UPDATE invoiceitemstbl SET penalty_amount = 0 WHERE invoice_item_id = $1`,
      [item.invoice_item_id]
    );
  }
  if (items.rows.length) {
    await client.query(
      `UPDATE invoicestbl SET late_penalty_applied_for_due_date = NULL WHERE invoice_id = $1`,
      [invoiceId]
    );
  }
  return items.rows.length;
}

async function recalcInvoiceAmountFromItems(client, invoiceId) {
  const totals = await client.query(
    `SELECT COALESCE(SUM(amount), 0) - COALESCE(SUM(COALESCE(discount_amount, 0)), 0)
            + COALESCE(SUM(COALESCE(penalty_amount, 0)), 0) AS grand
     FROM invoiceitemstbl WHERE invoice_id = $1`,
    [invoiceId]
  );
  const grand = round2(totals.rows[0]?.grand);
  await client.query(`UPDATE invoicestbl SET amount = $1 WHERE invoice_id = $2`, [
    grand,
    invoiceId,
  ]);
  return grand;
}

async function refreshInvoiceStatus(client, invoiceId, { forceOriginalAmount = null } = {}) {
  const inv = await loadInvoice(client, invoiceId);
  if (!inv) return null;
  const settled = await sumCompletedSettlement(client, invoiceId);
  const original =
    forceOriginalAmount != null
      ? forceOriginalAmount
      : settled > 0 && Number(inv.amount) === 0
        ? settled
        : Number(inv.amount) || BASE_AMOUNT;
  const status = await deriveInvoiceStatusForInvoice(client, invoiceId, {
    totalSettled: settled,
    originalInvoiceAmount: original,
    previousStatus: inv.status,
  });
  const amount = status === 'Paid' ? 0 : original;
  await client.query(
    `UPDATE invoicestbl SET status = $1::text, amount = $2::numeric WHERE invoice_id = $3`,
    [status, amount, invoiceId]
  );
  try {
    await syncProgramPaymentStatusForInvoice(client, invoiceId);
  } catch (e) {
    console.warn(`⚠ syncProgramPaymentStatus INV-${invoiceId}:`, e.message);
  }
  return { invoice_id: invoiceId, status, amount, settled };
}

async function movePayment(client, { payment_id, from_invoice_id, to_invoice_id }) {
  const pay = await loadPayment(client, payment_id);
  if (!pay) throw new Error(`PAY-${payment_id} not found`);
  if (Number(pay.invoice_id) !== Number(from_invoice_id)) {
    throw new Error(
      `PAY-${payment_id} on INV-${pay.invoice_id}, expected INV-${from_invoice_id}`
    );
  }
  if (String(pay.status) !== 'Completed') {
    throw new Error(`PAY-${payment_id} status ${pay.status}, expected Completed`);
  }

  await client.query(
    `UPDATE paymenttbl
     SET invoice_id = $1,
         remarks = CASE
           WHEN remarks IS NULL OR TRIM(remarks) = '' THEN $2
           ELSE remarks || ' | ' || $2
         END
     WHERE payment_id = $3 AND invoice_id = $4`,
    [to_invoice_id, REPAIR_NOTE, payment_id, from_invoice_id]
  );

  await client.query(
    `UPDATE acknowledgement_receiptstbl
     SET invoice_id = $1
     WHERE payment_id = $2 AND (invoice_id IS NULL OR invoice_id = $3)`,
    [to_invoice_id, payment_id, from_invoice_id]
  );

  console.log(`✅ Moved PAY-${payment_id}: INV-${from_invoice_id} → INV-${to_invoice_id}`);
}

async function ensureTargetPhase(client, invoiceId, phase) {
  const inv = await loadInvoice(client, invoiceId);
  if (!inv) return;
  let next = rewriteTargetPhaseInRemarks(inv.remarks || '', phase);
  if (!next.includes(REPAIR_NOTE)) next = `${next};${REPAIR_NOTE}`;
  await client.query(`UPDATE invoicestbl SET remarks = $1 WHERE invoice_id = $2`, [
    next,
    invoiceId,
  ]);
}

async function loadEnrollments(client) {
  const r = await client.query(
    `SELECT classstudent_id, phase_number, program_enrollment_status AS status,
            TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD') AS enrolled,
            TO_CHAR(TIMEZONE('Asia/Manila', removed_at), 'YYYY-MM-DD') AS removed
     FROM classstudentstbl
     WHERE student_id = $1 AND class_id = $2
     ORDER BY phase_number, classstudent_id`,
    [STUDENT_ID, CLASS_ID]
  );
  return r.rows;
}

async function snapshot(client) {
  const invoices = (
    await client.query(
      `SELECT i.invoice_id, i.status, i.amount, i.invoice_ar_number,
              TO_CHAR(i.issue_date, 'YYYY-MM-DD') AS issue,
              TO_CHAR(i.due_date, 'YYYY-MM-DD') AS due,
              SUBSTRING(i.remarks FROM 'TARGET_PHASE:([0-9]+)') AS phase,
              LEFT(COALESCE(i.remarks,''), 90) AS remarks
       FROM invoicestbl i
       WHERE i.invoice_id = ANY($1::int[])
       ORDER BY i.invoice_id`,
      [ALL_PHASE_INVOICE_IDS]
    )
  ).rows.map((r) => ({ ...r, phase: r.phase != null ? Number(r.phase) : parseTargetPhase(r.remarks) }));

  const payments = (
    await client.query(
      `SELECT payment_id, invoice_id, payable_amount, status, approval_status,
              TO_CHAR(issue_date, 'YYYY-MM-DD') AS paid_on
       FROM paymenttbl
       WHERE invoice_id = ANY($1::int[])
       ORDER BY invoice_id, payment_id`,
      [ALL_PHASE_INVOICE_IDS]
    )
  ).rows;

  return { invoices, payments };
}

function simulatePayNow(invoices, enrollments) {
  const droppedUnpaid = new Set();
  for (const e of enrollments) {
    if (String(e.status).toLowerCase() !== 'dropped') continue;
    const inv = invoices.find((i) => i.phase === Number(e.phase_number));
    if (inv && String(inv.status).toLowerCase() !== 'paid') {
      droppedUnpaid.add(Number(e.phase_number));
    }
  }
  const unpaidDropPhase = [...droppedUnpaid].sort((a, b) => a - b).pop() ?? null;

  for (const inv of [...invoices].sort((a, b) => (a.phase || 0) - (b.phase || 0))) {
    const phase = inv.phase;
    if (phase == null) continue;
    if (unpaidDropPhase != null && phase > unpaidDropPhase) continue;
    if (droppedUnpaid.has(phase)) continue;
    if (String(inv.status).toLowerCase() === 'paid') continue;
    if (String(inv.status).toLowerCase() === 'cancelled') continue;
    return { phase, invoice_id: inv.invoice_id, status: inv.status, amount: inv.amount };
  }
  return null;
}

async function main() {
  console.log(
    `\nShao Kun — shift payments P2→P6; Phase 2 Pay Now` +
      `${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
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
        `SELECT user_id, full_name, email FROM userstbl
         WHERE user_id = $1 AND LOWER(TRIM(email)) = LOWER(TRIM($2))`,
        [STUDENT_ID, STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student) throw new Error('Student not found');
    console.log('Student:', student.full_name, student.email);

    const profile = (
      await client.query(
        `SELECT installmentinvoiceprofiles_id, class_id, is_active, generated_count
         FROM installmentinvoiceprofilestbl
         WHERE installmentinvoiceprofiles_id = $1 AND student_id = $2 AND class_id = $3`,
        [PROFILE_ID, STUDENT_ID, CLASS_ID]
      )
    ).rows[0];
    if (!profile) throw new Error('Profile not found');
    console.log('Profile BEFORE:', profile);

    console.log('\nEnrollments BEFORE:');
    console.table(await loadEnrollments(client));

    console.log('\nBEFORE invoices / payments:');
    const before = await snapshot(client);
    console.table(before.invoices);
    console.table(before.payments);

    for (const mv of PAYMENT_MOVES) {
      const pay = await loadPayment(client, mv.payment_id);
      if (!pay || Number(pay.invoice_id) !== mv.from_invoice_id) {
        throw new Error(
          `Guard failed: PAY-${mv.payment_id} expected on INV-${mv.from_invoice_id}, got ${pay?.invoice_id}`
        );
      }
    }

    const p6 = await loadInvoice(client, PHASE6_INVOICE_ID);
    if (!p6 || Number(p6.profile_id) !== PROFILE_ID) {
      throw new Error('Phase 6 invoice missing from profile');
    }
    if (String(p6.status).toLowerCase() === 'paid') {
      throw new Error('Phase 6 already Paid — refuse');
    }

    console.log('\nPlanned:');
    console.log('  1. PAY-1507 Phase 5 → Phase 6; clear P6 penalty; mark Paid');
    console.log('  2. PAY-1062 Phase 4 → Phase 5; mark Paid');
    console.log('  3. PAY-654  Phase 3 → Phase 4; mark Paid');
    console.log('  4. PAY-283  Phase 2 → Phase 3; mark Paid');
    console.log('  5. INV-257 Phase 2 → Unpaid ₱5146, no penalty, Pay Now');
    console.log('  6. Delete Phase 2 enrollment CS 346 (enrollment —)');
    console.log('  7. Phase 6 CS 2110 dropped → re_enrolled');
    console.log('  8. Reactivate profile; waive delinquency re-drop on Phase 2');

    for (const mv of PAYMENT_MOVES) {
      await movePayment(client, mv);
    }

    await clearInvoicePenalty(client, PHASE6_INVOICE_ID);
    await recalcInvoiceAmountFromItems(client, PHASE6_INVOICE_ID);
    await ensureTargetPhase(client, PHASE6_INVOICE_ID, 6);
    console.log(
      '  Phase 6 refresh:',
      await refreshInvoiceStatus(client, PHASE6_INVOICE_ID, { forceOriginalAmount: BASE_AMOUNT })
    );

    await ensureTargetPhase(client, PHASE5_INVOICE_ID, 5);
    console.log(
      '  Phase 5 refresh:',
      await refreshInvoiceStatus(client, PHASE5_INVOICE_ID, { forceOriginalAmount: BASE_AMOUNT })
    );

    await ensureTargetPhase(client, PHASE4_INVOICE_ID, 4);
    console.log(
      '  Phase 4 refresh:',
      await refreshInvoiceStatus(client, PHASE4_INVOICE_ID, { forceOriginalAmount: BASE_AMOUNT })
    );

    await ensureTargetPhase(client, PHASE3_INVOICE_ID, 3);
    console.log(
      '  Phase 3 refresh:',
      await refreshInvoiceStatus(client, PHASE3_INVOICE_ID, { forceOriginalAmount: BASE_AMOUNT })
    );

    await clearInvoicePenalty(client, PHASE2_INVOICE_ID);
    await recalcInvoiceAmountFromItems(client, PHASE2_INVOICE_ID);
    const p2Settled = await sumCompletedSettlement(client, PHASE2_INVOICE_ID);
    if (p2Settled > 0.01) {
      throw new Error(`Phase 2 still has settlement ₱${p2Settled} — abort`);
    }

    const p2Inv = await loadInvoice(client, PHASE2_INVOICE_ID);
    let p2Remarks = rewriteTargetPhaseInRemarks(p2Inv.remarks || '', 2);
    if (!p2Remarks.includes(DROP_WAIVE_FLAG)) {
      p2Remarks = `${p2Remarks};${DROP_WAIVE_FLAG}`;
    }
    if (!p2Remarks.includes(REPAIR_NOTE)) {
      p2Remarks = `${p2Remarks};${REPAIR_NOTE}`;
    }

    await client.query(
      `UPDATE invoicestbl
       SET status = 'Unpaid',
           amount = $1::numeric,
           invoice_ar_number = NULL,
           late_penalty_applied_for_due_date = NULL,
           remarks = $2
       WHERE invoice_id = $3`,
      [BASE_AMOUNT, p2Remarks, PHASE2_INVOICE_ID]
    );
    try {
      await syncProgramPaymentStatusForInvoice(client, PHASE2_INVOICE_ID);
    } catch (e) {
      console.warn('⚠ sync Phase 2:', e.message);
    }
    console.log(`✅ INV-${PHASE2_INVOICE_ID} → Unpaid ₱${BASE_AMOUNT} (Pay Now, no penalty)`);

    const delP2 = await client.query(
      `DELETE FROM classstudentstbl
       WHERE classstudent_id = $1 AND student_id = $2 AND class_id = $3 AND phase_number = 2
       RETURNING classstudent_id`,
      [PHASE2_CLASSSTUDENT_ID, STUDENT_ID, CLASS_ID]
    );
    if (!delP2.rows.length) {
      throw new Error(`Failed to delete Phase 2 CS ${PHASE2_CLASSSTUDENT_ID}`);
    }
    console.log(`✅ Deleted Phase 2 enrollment CS ${PHASE2_CLASSSTUDENT_ID}`);

    const restP6 = await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = 're_enrolled',
           removed_at = NULL,
           removed_reason = NULL,
           removed_by = NULL
       WHERE classstudent_id = $1 AND student_id = $2 AND class_id = $3 AND phase_number = 6
       RETURNING classstudent_id, program_enrollment_status AS status`,
      [PHASE6_CLASSSTUDENT_ID, STUDENT_ID, CLASS_ID]
    );
    if (!restP6.rows.length || restP6.rows[0].status !== 're_enrolled') {
      throw new Error('Failed to restore Phase 6 enrollment');
    }
    console.log(`✅ Phase 6 CS ${PHASE6_CLASSSTUDENT_ID} → re_enrolled`);

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET is_active = true
       WHERE installmentinvoiceprofiles_id = $1 AND student_id = $2`,
      [PROFILE_ID, STUDENT_ID]
    );
    console.log('✅ Profile is_active → true');

    console.log('\nAFTER invoices / payments:');
    const after = await snapshot(client);
    console.table(after.invoices);
    console.table(after.payments);

    console.log('\nEnrollments AFTER:');
    const afterEnroll = await loadEnrollments(client);
    console.table(afterEnroll);

    const p2 = after.invoices.find((i) => Number(i.invoice_id) === PHASE2_INVOICE_ID);
    const p6After = after.invoices.find((i) => Number(i.invoice_id) === PHASE6_INVOICE_ID);
    const p7 = after.invoices.find((i) => Number(i.invoice_id) === PHASE7_INVOICE_ID);
    const p2Pays = after.payments.filter((p) => Number(p.invoice_id) === PHASE2_INVOICE_ID);
    const p6Pays = after.payments.filter((p) => Number(p.invoice_id) === PHASE6_INVOICE_ID);

    if (String(p2?.status) !== 'Unpaid' || p2Pays.length !== 0) {
      throw new Error('Phase 2 did not end Unpaid with zero payments');
    }
    if (round2(p2?.amount) !== BASE_AMOUNT) {
      throw new Error(`Phase 2 amount ${p2?.amount}, expected ${BASE_AMOUNT}`);
    }
    if (String(p6After?.status) !== 'Paid' || p6Pays.length !== 1) {
      throw new Error(`Phase 6 status ${p6After?.status} payments=${p6Pays.length}, expected Paid/1`);
    }
    for (const id of [PHASE3_INVOICE_ID, PHASE4_INVOICE_ID, PHASE5_INVOICE_ID]) {
      const inv = after.invoices.find((i) => Number(i.invoice_id) === id);
      if (String(inv?.status) !== 'Paid') {
        throw new Error(`INV-${id} status ${inv?.status}, expected Paid`);
      }
    }
    if (afterEnroll.some((e) => Number(e.phase_number) === 2)) {
      throw new Error('Phase 2 enrollment still present');
    }
    const p6En = afterEnroll.find((e) => Number(e.phase_number) === 6);
    if (!p6En || p6En.status !== 're_enrolled') {
      throw new Error('Phase 6 enrollment not re_enrolled');
    }

    const payNow = simulatePayNow(after.invoices, afterEnroll);
    const afterP2Paid = simulatePayNow(
      after.invoices.map((i) =>
        Number(i.invoice_id) === PHASE2_INVOICE_ID ? { ...i, status: 'Paid', amount: 0 } : i
      ),
      afterEnroll
    );

    console.log('\nPay Now simulation now:', payNow);
    console.log('Pay Now after Phase 2 paid:', afterP2Paid);

    if (payNow?.phase !== 2 || Number(payNow?.invoice_id) !== PHASE2_INVOICE_ID) {
      throw new Error(`Expected Pay Now on Phase 2, got ${JSON.stringify(payNow)}`);
    }
    if (afterP2Paid?.phase !== 7 || Number(afterP2Paid?.invoice_id) !== PHASE7_INVOICE_ID) {
      throw new Error(`Expected Pay Now on Phase 7 after P2 paid, got ${JSON.stringify(afterP2Paid)}`);
    }

    console.log('\nExpected UI:');
    console.log('  Phase 1  new           Paid');
    console.log('  Phase 2  —             Unpaid ₱5,146  Pay Now (no penalty)');
    console.log('  Phase 3–6 re enrolled  Paid');
    console.log(`  Phase 7  —             ${p7?.status}  Pay Now after Phase 2 is paid`);

    if (!isApply) {
      await client.query('ROLLBACK');
      console.log('\nDry run only — rolled back. Re-run with --apply to commit.');
      return;
    }

    await client.query('COMMIT');
    console.log('\nCommitted. Refresh Student History → Invoices.');
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
