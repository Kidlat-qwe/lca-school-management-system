/**
 * CHLOE SOFIA M. EVANGELISTA — settle Phase 7 balance chain (INV-1538 → INV-1539).
 *
 * Student: 270 · jhec292000@yahoo.com
 * Profile: 448 · class 53 VMP_NURSERY_TThS_11:00 AM
 *
 * Current production state (2026-09-02):
 *   INV-1538 (root) — Partially Paid · PAY-1268 ₱348 · ref 000334
 *   INV-1539 (leaf) — Partially Paid · no payment · balance ₱3,888
 *   Chain total obligation ₱4,236; only ₱348 settled.
 *
 * Ref 000334 batch is fully allocated (1180 + 4236 + 4236 + 348 = 10000).
 * This repair records the missing ₱3,888 balance on INV-1539 and marks the
 * chain Paid (same pattern as Phase 4 INV-1534/1535 + PAY-1265).
 *
 * Run:
 *   node backend/scripts/repairChloeEvangelistaPhase7BalancePaid.js --production
 *   node backend/scripts/repairChloeEvangelistaPhase7BalancePaid.js --production --apply
 *
 * Optional:
 *   --reference=000334
 *   --issue-date=2026-06-02
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { getChainFinancialSummary, parseTargetPhase } from '../utils/balanceInvoice.js';
import { deriveInvoiceStatusForInvoice } from '../utils/invoicePaymentStatus.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';
import { syncInstallmentEnrollmentForPaidInvoice } from '../utils/installmentEnrollmentSync.js';

const STUDENT_ID = 270;
const STUDENT_EMAIL = 'jhec292000@yahoo.com';
const PROFILE_ID = 448;
const CLASS_ID = 53;
const PHASE7_ROOT_ID = 1538;
const PHASE7_LEAF_ID = 1539;
const EXISTING_PARTIAL_PAYMENT_ID = 1268;
const PHASE_FEE = 4236;
const PARTIAL_PAID = 348;
const BALANCE_AMOUNT = 3888;
const TEMPLATE_PAYMENT_ID = 1265;

const REPAIR_NOTE =
  'Ops repair 2026-09-02 — Chloe Evangelista Phase 7 balance ₱3888 on INV-1539; settle chain Paid';

const isApply = process.argv.includes('--apply');
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function readArg(prefix) {
  const hit = process.argv.find((a) => a.startsWith(`${prefix}=`));
  return hit ? hit.slice(prefix.length + 1).trim() : null;
}

const PAYMENT_REFERENCE = readArg('--reference') || '000334';
const PAYMENT_ISSUE_DATE = readArg('--issue-date') || '2026-06-02';

async function loadInvoice(client, invoiceId) {
  const r = await client.query(
    `SELECT invoice_id, status, amount, invoice_ar_number, branch_id,
            parent_invoice_id, balance_invoice_id, invoice_chain_root_id,
            installmentinvoiceprofiles_id AS profile_id, remarks
     FROM invoicestbl WHERE invoice_id = $1`,
    [invoiceId]
  );
  const row = r.rows[0] || null;
  if (row) row.phase = parseTargetPhase(row.remarks);
  return row;
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

async function sumChainSettlement(client, rootId) {
  const summary = await getChainFinancialSummary(client, rootId);
  return summary;
}

async function loadTemplatePayment(client) {
  const r = await client.query(
    `SELECT payment_method, payment_type, created_by, approval_status, approved_by, branch_id
     FROM paymenttbl WHERE payment_id = $1`,
    [TEMPLATE_PAYMENT_ID]
  );
  return r.rows[0] || null;
}

async function settlePaidChain(client, rootId, leafId) {
  await client.query(
    `UPDATE invoicestbl
     SET status = 'Partially Paid', amount = 0, balance_invoice_id = $1
     WHERE invoice_id = $2`,
    [leafId, rootId]
  );
  await client.query(
    `UPDATE invoicestbl
     SET status = 'Paid', amount = 0,
         parent_invoice_id = COALESCE(parent_invoice_id, $1),
         invoice_chain_root_id = COALESCE(invoice_chain_root_id, $1)
     WHERE invoice_id = $2`,
    [rootId, leafId]
  );
}

async function main() {
  console.log(
    `\nChloe Evangelista — Phase 7 balance settle (INV-${PHASE7_ROOT_ID} → INV-${PHASE7_LEAF_ID})` +
      `${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`Note: ${REPAIR_NOTE}`);
  console.log(`DB: ${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV}`);
  if (process.env.DB_NAME !== 'psms_production') {
    console.warn('⚠️ Expected psms_production. Pass --production.');
  }
  console.log(`Payment template: PAY-${TEMPLATE_PAYMENT_ID}`);
  console.log(`Planned balance payment: ₱${BALANCE_AMOUNT} · ref ${PAYMENT_REFERENCE} · ${PAYMENT_ISSUE_DATE}`);

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
    if (!student) throw new Error('Student not found or email mismatch');
    console.log('Student:', student.full_name, `(id ${student.user_id})`);

    const root = await loadInvoice(client, PHASE7_ROOT_ID);
    const leaf = await loadInvoice(client, PHASE7_LEAF_ID);
    if (!root || !leaf) throw new Error('Phase 7 invoices missing');
    if (Number(root.profile_id) !== PROFILE_ID || Number(leaf.profile_id) !== PROFILE_ID) {
      throw new Error('Invoices not on profile 448');
    }
    if (Number(root.phase) !== 7 || Number(leaf.phase) !== 7) {
      throw new Error(`Expected TARGET_PHASE:7 (got ${root.phase}/${leaf.phase})`);
    }
    if (Number(root.balance_invoice_id) !== PHASE7_LEAF_ID) {
      throw new Error(`INV-${PHASE7_ROOT_ID} balance_invoice_id ≠ ${PHASE7_LEAF_ID}`);
    }

    const partialPay = (
      await client.query(
        `SELECT payment_id, invoice_id, payable_amount, status, reference_number
         FROM paymenttbl WHERE payment_id = $1`,
        [EXISTING_PARTIAL_PAYMENT_ID]
      )
    ).rows[0];
    if (!partialPay || Number(partialPay.invoice_id) !== PHASE7_ROOT_ID) {
      throw new Error(`PAY-${EXISTING_PARTIAL_PAYMENT_ID} missing or not on INV-${PHASE7_ROOT_ID}`);
    }
    if (round2(partialPay.payable_amount) !== PARTIAL_PAID) {
      throw new Error(`PAY-${EXISTING_PARTIAL_PAYMENT_ID} amount ${partialPay.payable_amount} ≠ ${PARTIAL_PAID}`);
    }

    const leafPays = (
      await client.query(`SELECT payment_id FROM paymenttbl WHERE invoice_id = $1`, [PHASE7_LEAF_ID])
    ).rows;
    if (leafPays.length > 0) {
      throw new Error(
        `INV-${PHASE7_LEAF_ID} already has payment(s): ${leafPays.map((p) => p.payment_id).join(', ')}`
      );
    }

    const beforeChain = await sumChainSettlement(client, PHASE7_ROOT_ID);
    console.log('\nBEFORE chain:', beforeChain);
    console.log('BEFORE root:', root);
    console.log('BEFORE leaf:', leaf);

    if (beforeChain.total_paid_in_chain >= PHASE_FEE - 0.01) {
      throw new Error('Phase 7 chain already fully settled — nothing to repair');
    }
    if (Math.abs(beforeChain.remaining_on_leaf - BALANCE_AMOUNT) > 0.05) {
      throw new Error(
        `Leaf remaining ${beforeChain.remaining_on_leaf} ≠ expected ${BALANCE_AMOUNT}`
      );
    }

    const template = await loadTemplatePayment(client);
    if (!template) throw new Error(`Template PAY-${TEMPLATE_PAYMENT_ID} not found`);

    console.log('\nPlanned:');
    console.log(`  1. INSERT payment ₱${BALANCE_AMOUNT} on INV-${PHASE7_LEAF_ID}`);
    console.log(`  2. Settle chain → root Partially Paid (₱0), leaf Paid (₱0)`);
    console.log('  3. syncProgramPaymentStatus + installment enrollment sync');
    console.log(`  4. UI Phase 7 → Paid (₱${PHASE_FEE} / balance ₱0)`);

    let newPaymentId = null;
    if (isApply) {
      const insert = await client.query(
        `INSERT INTO paymenttbl (
           invoice_id, student_id, branch_id, payment_method, payment_type,
           payable_amount, discount_amount, tip_amount, issue_date, status, reference_number,
           remarks, created_by, approval_status, approved_by, approved_at
         ) VALUES (
           $1, $2, $3, $4, $5,
           $6, 0, 0, $7::date, 'Completed', $8,
           $9, $10, $11, $12, CURRENT_TIMESTAMP
         )
         RETURNING payment_id`,
        [
          PHASE7_LEAF_ID,
          STUDENT_ID,
          leaf.branch_id ?? template.branch_id,
          template.payment_method || 'Cash',
          'Full Payment',
          BALANCE_AMOUNT,
          PAYMENT_ISSUE_DATE,
          PAYMENT_REFERENCE,
          REPAIR_NOTE,
          template.created_by,
          template.approval_status || 'Approved',
          template.approved_by,
        ]
      );
      newPaymentId = insert.rows[0]?.payment_id;
      console.log(`✅ INSERT PAY-${newPaymentId} ₱${BALANCE_AMOUNT} on INV-${PHASE7_LEAF_ID}`);
    } else {
      console.log(`  (dry-run) would INSERT payment ₱${BALANCE_AMOUNT} on INV-${PHASE7_LEAF_ID}`);
    }

    if (isApply) {
      await settlePaidChain(client, PHASE7_ROOT_ID, PHASE7_LEAF_ID);
      console.log('✅ Chain statuses updated (root partial / leaf paid)');

      for (const invoiceId of [PHASE7_ROOT_ID, PHASE7_LEAF_ID]) {
        try {
          await syncProgramPaymentStatusForInvoice(client, invoiceId);
        } catch (e) {
          console.warn(`⚠ syncProgramPaymentStatus INV-${invoiceId}:`, e.message);
        }
      }

      const paidInvoice = await loadInvoice(client, PHASE7_LEAF_ID);
      try {
        await syncInstallmentEnrollmentForPaidInvoice({
          client,
          profileId: PROFILE_ID,
          invoice: paidInvoice,
        });
      } catch (e) {
        console.warn('⚠ syncInstallmentEnrollmentForPaidInvoice:', e.message);
      }
    }

    const afterChain = isApply
      ? await sumChainSettlement(client, PHASE7_ROOT_ID)
      : {
          total_paid_in_chain: PARTIAL_PAID + BALANCE_AMOUNT,
          remaining_on_leaf: 0,
          total_obligation: PHASE_FEE,
        };

    const afterRoot = isApply ? await loadInvoice(client, PHASE7_ROOT_ID) : { ...root, status: 'Partially Paid', amount: '0.00' };
    const afterLeaf = isApply ? await loadInvoice(client, PHASE7_LEAF_ID) : { ...leaf, status: 'Paid', amount: '0.00' };

    console.log('\nAFTER chain:', afterChain);
    console.log('AFTER root:', { invoice_id: afterRoot.invoice_id, status: afterRoot.status, amount: afterRoot.amount });
    console.log('AFTER leaf:', { invoice_id: afterLeaf.invoice_id, status: afterLeaf.status, amount: afterLeaf.amount });

    if (isApply) {
      if (afterChain.remaining_on_leaf > 0.05) {
        throw new Error(`Chain still has remaining ${afterChain.remaining_on_leaf}`);
      }
      if (afterLeaf.status !== 'Paid') {
        throw new Error(`INV-${PHASE7_LEAF_ID} status ${afterLeaf.status}, expected Paid`);
      }
    }

    console.log('\nExpected UI:');
    console.log(`  Phase 7 — Paid · Amount ₱${PHASE_FEE.toLocaleString()} · Paid ₱${PHASE_FEE.toLocaleString()} · Balance ₱0`);
    console.log('  Partial-payment warning cleared');
    console.log('  Phase 8 — Not Generated (until scheduler / manual generation)');

    if (!isApply) {
      await client.query('ROLLBACK');
      console.log('\nDry run only — rolled back. Re-run with --apply to commit.');
      return;
    }

    await client.query('COMMIT');
    console.log('\nCommitted. Refresh Student History → Installment and Invoice list.');
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
