/**
 * JAMES MIKHAIL M. ARTIENDA (menalie_artienda28@yahoo.com, user 119)
 * — shift phase payments forward so Phase 2 is unpaid (Pay Now).
 *
 * Profile 82 · class 56 NC_Nursery_MWF · Branch Guiguinto
 *
 * Mapping (payment ownership moves to the higher phase):
 *   Phase 2 payment (INV-256 / PAY-227)  → Phase 3 (INV-579)
 *   Phase 3 payment (INV-579 / PAY-690)  → Phase 4 (INV-807; cancel empty INV-808)
 *   Phase 4 payments (INV-807/808 PAY-691+1047) → Phase 5 (INV-1241/1245)
 *   Phase 5 payments (INV-1241/1245 PAY-1011+1423) → Phase 6 (INV-1621)
 *
 * Expected after apply:
 *   Phase 1 Paid (unchanged)
 *   Phase 2 Unpaid + Pay Now (INV-256)
 *   Phases 3–6 Paid
 *   Phase 7 Unpaid (under grace) — Pay Now moves here after Phase 2 is paid
 *   Phase 6 enrollment stays dropped (paid dropped is not an unpaid-drop block)
 *
 * Run:
 *   node backend/scripts/repairJamesArtiendaShiftPhasePayments.js --production
 *   node backend/scripts/repairJamesArtiendaShiftPhasePayments.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { rewriteTargetPhaseInRemarks } from '../utils/installmentPhaseBillingSync.js';
import { deriveInvoiceStatusForInvoice } from '../utils/invoicePaymentStatus.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_ID = 119;
const STUDENT_EMAIL = 'menalie_artienda28@yahoo.com';
const CLASS_ID = 56;
const PROFILE_ID = 82;

const PHASE1_INVOICE_ID = 247;
const PHASE2_INVOICE_ID = 256;
const PHASE3_INVOICE_ID = 579;
const PHASE4_ROOT_ID = 807;
const PHASE4_LEAF_ID = 808;
const PHASE5_ROOT_ID = 1241;
const PHASE5_LEAF_ID = 1245;
const PHASE6_INVOICE_ID = 1621;
const PHASE7_INVOICE_ID = 2164;

const BASE_AMOUNT = 5146;

/** payment_id → destination invoice_id */
const PAYMENT_MOVES = [
  // highest phase first
  { payment_id: 1011, from_invoice_id: PHASE5_ROOT_ID, to_invoice_id: PHASE6_INVOICE_ID, amount: 854 },
  { payment_id: 1423, from_invoice_id: PHASE5_LEAF_ID, to_invoice_id: PHASE6_INVOICE_ID, amount: 4292 },
  { payment_id: 691, from_invoice_id: PHASE4_ROOT_ID, to_invoice_id: PHASE5_ROOT_ID, amount: 854 },
  { payment_id: 1047, from_invoice_id: PHASE4_LEAF_ID, to_invoice_id: PHASE5_LEAF_ID, amount: 4292 },
  { payment_id: 690, from_invoice_id: PHASE3_INVOICE_ID, to_invoice_id: PHASE4_ROOT_ID, amount: 5146 },
  { payment_id: 227, from_invoice_id: PHASE2_INVOICE_ID, to_invoice_id: PHASE3_INVOICE_ID, amount: 5146 },
];

const REPAIR_NOTE =
  'Ops repair 2026-08-08 — James Artienda shift payments P2→P3→P4→P5→P6; Phase 2 unpaid Pay Now';

const isApply = process.argv.includes('--apply');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function loadInvoice(client, invoiceId) {
  const r = await client.query(
    `SELECT invoice_id, status, amount, invoice_ar_number,
            parent_invoice_id, balance_invoice_id, invoice_chain_root_id,
            installmentinvoiceprofiles_id AS profile_id,
            TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue,
            TO_CHAR(due_date, 'YYYY-MM-DD') AS due,
            LEFT(COALESCE(remarks,''), 140) AS remarks
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
    `SELECT invoice_item_id, penalty_amount, amount
     FROM invoiceitemstbl
     WHERE invoice_id = $1 AND COALESCE(penalty_amount, 0) > 0`,
    [invoiceId]
  );
  for (const item of items.rows) {
    await client.query(
      `UPDATE invoiceitemstbl
       SET penalty_amount = 0
       WHERE invoice_item_id = $1`,
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

async function appendRepairNote(client, invoiceId) {
  await client.query(
    `UPDATE invoicestbl
     SET remarks = CASE
       WHEN remarks IS NULL OR TRIM(remarks) = '' THEN $1
       WHEN remarks ILIKE '%' || $1 || '%' THEN remarks
       ELSE remarks || ';' || $1
     END
     WHERE invoice_id = $2`,
    [REPAIR_NOTE, invoiceId]
  );
}

async function ensureTargetPhase(client, invoiceId, phase) {
  const inv = await loadInvoice(client, invoiceId);
  if (!inv) return;
  const next = rewriteTargetPhaseInRemarks(inv.remarks || '', phase);
  const noted = next.includes(REPAIR_NOTE) ? next : `${next};${REPAIR_NOTE}`;
  await client.query(`UPDATE invoicestbl SET remarks = $1 WHERE invoice_id = $2`, [
    noted,
    invoiceId,
  ]);
}

async function snapshotPhases(client) {
  const invoices = (
    await client.query(
      `SELECT i.invoice_id, i.status, i.amount, i.invoice_ar_number,
              i.parent_invoice_id, i.balance_invoice_id,
              TO_CHAR(i.issue_date, 'YYYY-MM-DD') AS issue,
              TO_CHAR(i.due_date, 'YYYY-MM-DD') AS due,
              LEFT(COALESCE(i.remarks,''), 100) AS remarks
       FROM invoicestbl i
       WHERE i.installmentinvoiceprofiles_id = $1
          OR i.invoice_id = ANY($2::int[])
       ORDER BY i.invoice_id`,
      [
        PROFILE_ID,
        [
          PHASE1_INVOICE_ID,
          PHASE2_INVOICE_ID,
          PHASE3_INVOICE_ID,
          PHASE4_ROOT_ID,
          PHASE4_LEAF_ID,
          PHASE5_ROOT_ID,
          PHASE5_LEAF_ID,
          PHASE6_INVOICE_ID,
          PHASE7_INVOICE_ID,
        ],
      ]
    )
  ).rows.map((r) => ({ ...r, phase: parseTargetPhase(r.remarks) }));

  const payments = (
    await client.query(
      `SELECT payment_id, invoice_id, payable_amount, status, approval_status
       FROM paymenttbl
       WHERE invoice_id = ANY($1::int[])
       ORDER BY invoice_id, payment_id`,
      [invoices.map((i) => i.invoice_id)]
    )
  ).rows;

  return { invoices, payments };
}

async function main() {
  console.log(
    `\nJames Artienda — shift phase payments P2→P6` +
      `${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`Note: ${REPAIR_NOTE}`);
  console.log(`DB: ${process.env.DB_NAME} | NODE_ENV=${process.env.NODE_ENV}\n`);

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

    console.log('\nBEFORE:');
    const before = await snapshotPhases(client);
    console.table(before.invoices);
    console.table(before.payments);

    // Guard expected payment locations
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
    if (!['Unpaid', 'Overdue', 'Under Grace Period', 'under grace period'].includes(p6.status) &&
        String(p6.status).toLowerCase() !== 'unpaid') {
      // Allow Unpaid only for destination that will become Paid
      if (String(p6.status).toLowerCase() === 'paid') {
        throw new Error('Phase 6 already Paid — refuse');
      }
    }

    console.log('\nPlanned:');
    console.log('  1. Move Phase 5 payments → INV-1621 (Phase 6); clear penalty; mark Paid');
    console.log('  2. Move Phase 4 payments → INV-1241/1245 (Phase 5); mark Paid');
    console.log('  3. Move Phase 3 payment → INV-807 (Phase 4); cancel empty INV-808');
    console.log('  4. Move Phase 2 payment → INV-579 (Phase 3); mark Paid');
    console.log('  5. Reset INV-256 (Phase 2) → Unpaid ₱5146 (Pay Now)');
    console.log('  6. Keep INV-2164 (Phase 7) unpaid; reactivate profile');
    console.log('  7. Phase 6 enrollment stays dropped');

    // --- Apply mutations (rolled back unless --apply) ---

    // 1) Phase 5 → Phase 6
    await movePayment(client, PAYMENT_MOVES[0]);
    await movePayment(client, PAYMENT_MOVES[1]);
    await clearInvoicePenalty(client, PHASE6_INVOICE_ID);
    await recalcInvoiceAmountFromItems(client, PHASE6_INVOICE_ID);
    await ensureTargetPhase(client, PHASE6_INVOICE_ID, 6);
    console.log('  Phase 6 refresh:', await refreshInvoiceStatus(client, PHASE6_INVOICE_ID, {
      forceOriginalAmount: BASE_AMOUNT,
    }));

    // 2) Phase 4 → Phase 5
    await movePayment(client, PAYMENT_MOVES[2]);
    await movePayment(client, PAYMENT_MOVES[3]);
    await clearInvoicePenalty(client, PHASE5_ROOT_ID);
    await ensureTargetPhase(client, PHASE5_ROOT_ID, 5);
    await ensureTargetPhase(client, PHASE5_LEAF_ID, 5);
    // Chain: root partial + leaf paid — refresh leaf first with its settlement,
    // then root with remaining semantics via derive on leaf amount portions.
    console.log(
      '  Phase 5 leaf refresh:',
      await refreshInvoiceStatus(client, PHASE5_LEAF_ID, { forceOriginalAmount: 4292 })
    );
    console.log(
      '  Phase 5 root refresh:',
      await refreshInvoiceStatus(client, PHASE5_ROOT_ID, { forceOriginalAmount: BASE_AMOUNT })
    );
    // If root shows Partially Paid with balance leaf paid, force Paid display amount 0 on root
    // when chain remaining is 0 (leaf settled + root partial payment covers first slice).
    const root5Settled = await sumCompletedSettlement(client, PHASE5_ROOT_ID);
    const leaf5Settled = await sumCompletedSettlement(client, PHASE5_LEAF_ID);
    if (round2(root5Settled + leaf5Settled) >= BASE_AMOUNT - 0.01) {
      await client.query(
        `UPDATE invoicestbl
         SET status = 'Partially Paid', amount = 0, balance_invoice_id = $1
         WHERE invoice_id = $2`,
        [PHASE5_LEAF_ID, PHASE5_ROOT_ID]
      );
      await client.query(
        `UPDATE invoicestbl
         SET status = 'Paid', amount = 0,
             parent_invoice_id = COALESCE(parent_invoice_id, $1),
             invoice_chain_root_id = COALESCE(invoice_chain_root_id, $1)
         WHERE invoice_id = $2`,
        [PHASE5_ROOT_ID, PHASE5_LEAF_ID]
      );
      console.log('  ✅ Phase 5 chain marked settled (Partially Paid → Paid leaf)');
    }

    // 3) Phase 3 → Phase 4 (consolidate onto 807; cancel 808)
    await movePayment(client, PAYMENT_MOVES[4]);
    await clearInvoicePenalty(client, PHASE4_ROOT_ID);
    await client.query(
      `UPDATE invoicestbl
       SET balance_invoice_id = NULL
       WHERE invoice_id = $1`,
      [PHASE4_ROOT_ID]
    );
    await ensureTargetPhase(client, PHASE4_ROOT_ID, 4);
    console.log(
      '  Phase 4 refresh:',
      await refreshInvoiceStatus(client, PHASE4_ROOT_ID, { forceOriginalAmount: BASE_AMOUNT })
    );

    // Cancel empty leaf 808
    const leaf4Pays = (
      await client.query(`SELECT payment_id FROM paymenttbl WHERE invoice_id = $1`, [
        PHASE4_LEAF_ID,
      ])
    ).rows;
    if (leaf4Pays.length) {
      throw new Error(`INV-${PHASE4_LEAF_ID} still has payments after move — abort`);
    }
    await client.query(
      `UPDATE invoicestbl
       SET status = 'Cancelled',
           installmentinvoiceprofiles_id = NULL,
           parent_invoice_id = NULL,
           balance_invoice_id = NULL,
           invoice_chain_root_id = NULL,
           invoice_ar_number = NULL,
           remarks = CASE
             WHEN remarks IS NULL OR TRIM(remarks) = '' THEN $1
             ELSE remarks || ';' || $1
           END
       WHERE invoice_id = $2`,
      [`${REPAIR_NOTE};ORPHAN_PHASE4_LEAF_AFTER_CONSOLIDATE`, PHASE4_LEAF_ID]
    );
    console.log(`✅ Cancelled + detached empty INV-${PHASE4_LEAF_ID}`);

    // 4) Phase 2 → Phase 3
    await movePayment(client, PAYMENT_MOVES[5]);
    await ensureTargetPhase(client, PHASE3_INVOICE_ID, 3);
    console.log(
      '  Phase 3 refresh:',
      await refreshInvoiceStatus(client, PHASE3_INVOICE_ID, { forceOriginalAmount: BASE_AMOUNT })
    );

    // 5) Reset Phase 2 unpaid
    await clearInvoicePenalty(client, PHASE2_INVOICE_ID);
    await recalcInvoiceAmountFromItems(client, PHASE2_INVOICE_ID);
    await ensureTargetPhase(client, PHASE2_INVOICE_ID, 2);
    const p2Settled = await sumCompletedSettlement(client, PHASE2_INVOICE_ID);
    if (p2Settled > 0.01) {
      throw new Error(`Phase 2 still has settlement ₱${p2Settled} — abort`);
    }
    await client.query(
      `UPDATE invoicestbl
       SET status = 'Unpaid',
           amount = $1::numeric,
           invoice_ar_number = NULL
       WHERE invoice_id = $2`,
      [BASE_AMOUNT, PHASE2_INVOICE_ID]
    );
    await appendRepairNote(client, PHASE2_INVOICE_ID);
    try {
      await syncProgramPaymentStatusForInvoice(client, PHASE2_INVOICE_ID);
    } catch (e) {
      console.warn(`⚠ sync Phase 2:`, e.message);
    }
    console.log(`✅ INV-${PHASE2_INVOICE_ID} → Unpaid ₱${BASE_AMOUNT} (Pay Now)`);

    // Phase 7 untouched except note
    await appendRepairNote(client, PHASE7_INVOICE_ID);

    // Reactivate profile so Pay Now / billing can proceed
    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET is_active = true
       WHERE installmentinvoiceprofiles_id = $1`,
      [PROFILE_ID]
    );
    console.log('✅ Profile reactivated (is_active=true)');

    // Refresh Phase 1 sync only (unchanged)
    await refreshInvoiceStatus(client, PHASE1_INVOICE_ID, { forceOriginalAmount: BASE_AMOUNT });

    console.log('\nAFTER:');
    const after = await snapshotPhases(client);
    console.table(after.invoices);
    console.table(after.payments);

    const afterProfile = (
      await client.query(
        `SELECT installmentinvoiceprofiles_id, is_active, generated_count
         FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      )
    ).rows[0];
    console.log('Profile AFTER:', afterProfile);

    const p2 = after.invoices.find((i) => Number(i.invoice_id) === PHASE2_INVOICE_ID);
    const p6After = after.invoices.find((i) => Number(i.invoice_id) === PHASE6_INVOICE_ID);
    const p7 = after.invoices.find((i) => Number(i.invoice_id) === PHASE7_INVOICE_ID);
    const p2Pays = after.payments.filter((p) => Number(p.invoice_id) === PHASE2_INVOICE_ID);
    const p6Pays = after.payments.filter((p) => Number(p.invoice_id) === PHASE6_INVOICE_ID);

    console.log('\nExpected UI:');
    console.log(`  • Phase 2 INV-${PHASE2_INVOICE_ID}: ${p2?.status} amount=${p2?.amount} payments=${p2Pays.length} → Pay Now`);
    console.log(`  • Phase 6 INV-${PHASE6_INVOICE_ID}: ${p6After?.status} payments=${p6Pays.length}`);
    console.log(`  • Phase 7 INV-${PHASE7_INVOICE_ID}: ${p7?.status} (Pay Now after Phase 2 paid)`);

    if (String(p2?.status) !== 'Unpaid' || p2Pays.length !== 0) {
      throw new Error('Phase 2 did not end Unpaid with zero payments');
    }
    if (String(p6After?.status) !== 'Paid') {
      throw new Error(`Phase 6 status ${p6After?.status}, expected Paid`);
    }

    if (!isApply) {
      await client.query('ROLLBACK');
      console.log('\nDry run only — rolled back. Re-run with --apply to commit.');
      return;
    }

    await client.query('COMMIT');
    console.log('\nCommitted.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('\nFAILED — rolled back:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main();
