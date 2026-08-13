/**
 * Jaylla Immaculata Tenedero — hide wrong Phase 5; enroll Phase 6–8 only.
 *
 * Student: 607 · mikaella@apprenticesync.com
 * Class:   57 NC_Playgroup_TTh_9:30-10:30PM · Branch 5
 * Profile: 424 (active)
 *
 * Today:
 *   Phase 5 CS 1237 new / INV-1394 Paid (wrong enrollment)
 *   Phase 6 CS 1405 dropped / INV-1398 Unpaid ₱5,660.60 (penalty)
 *   Phase 7 CS 1872 rejoin / INV-1622 Paid
 *   Phase 8 CS 2247 re_enrolled / INV-2166 Paid
 *   phase_start 5 · generated_count 4
 *
 * Target:
 *   1. Move Phase 5 completed payment(s) INV-1394 → INV-1398 (keep payment date)
 *   2. Clear Phase 6 penalty so ₱5,146 settles INV-1398 → Paid
 *   3. Cancel + detach INV-1394 (Phase 5 no longer on the plan)
 *   4. Delete Phase 5 enrollment CS 1237
 *   5. Phase 6 → new, Phase 7 → re_enrolled, Phase 8 → re_enrolled
 *   6. profile.phase_start 5 → 6 (grid starts at Phase 6)
 *   7. generated_count 4 → 3
 *   8. Downpayment remarks PHASE_START:5→6, PHASE_END:10→11
 *
 * Run:
 *   node backend/scripts/repairJayllaTenederoPhase678Enrollment.js --production
 *   node backend/scripts/repairJayllaTenederoPhase678Enrollment.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { rewriteTargetPhaseInRemarks } from '../utils/installmentPhaseBillingSync.js';
import { deriveInvoiceStatusForInvoice } from '../utils/invoicePaymentStatus.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_EMAIL = 'mikaella@apprenticesync.com';
const STUDENT_ID = 607;
const CLASS_ID = 57;
const BRANCH_ID = 5;
const PROFILE_ID = 424;
const CLASS_NAME = 'NC_Playgroup_TTh_9:30-10:30PM';
const DOWNPAYMENT_INVOICE_ID = 1393;
const PHASE5_INVOICE_ID = 1394;
const PHASE6_INVOICE_ID = 1398;
const PHASE5_CLASSSTUDENT_ID = 1237;
const PHASE6_CLASSSTUDENT_ID = 1405;
const PHASE7_CLASSSTUDENT_ID = 1872;
const PHASE8_CLASSSTUDENT_ID = 2247;
const BASE_AMOUNT = 5146;
const PHASE5_AR = '261060';
const PHASE6_GENERATED_AR = '261064';

const REPAIR_NOTE =
  'Ops repair 2026-08-13 — Jaylla hide Phase 5; move payment → Phase 6; enroll 6–8 new/re_enrolled/re_enrolled';

const isApply = process.argv.includes('--apply');
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function loadInvoice(client, invoiceId) {
  const r = await client.query(
    `SELECT invoice_id, status, amount, invoice_ar_number, remarks,
            installmentinvoiceprofiles_id AS profile_id,
            TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue,
            TO_CHAR(due_date, 'YYYY-MM-DD') AS due
     FROM invoicestbl WHERE invoice_id = $1`,
    [invoiceId]
  );
  const row = r.rows[0] || null;
  if (row) row.phase = parseTargetPhase(row.remarks);
  return row;
}

async function loadCompletedPayments(client, invoiceId) {
  const r = await client.query(
    `SELECT payment_id, invoice_id, payable_amount, discount_amount, status, approval_status,
            TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue,
            TO_CHAR(TIMEZONE('Asia/Manila', created_at), 'YYYY-MM-DD HH24:MI') AS created
     FROM paymenttbl
     WHERE invoice_id = $1
       AND status = 'Completed'
       AND COALESCE(approval_status, 'Pending') <> 'Rejected'
     ORDER BY payment_id`,
    [invoiceId]
  );
  return r.rows;
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

async function loadEnrollments(client) {
  const r = await client.query(
    `SELECT cs.classstudent_id, cs.phase_number,
            cs.program_enrollment_status AS status,
            TO_CHAR(TIMEZONE('Asia/Manila', cs.enrolled_at), 'YYYY-MM-DD HH24:MI') AS enrolled,
            TO_CHAR(TIMEZONE('Asia/Manila', cs.removed_at), 'YYYY-MM-DD HH24:MI') AS removed,
            LEFT(COALESCE(cs.removed_reason, ''), 80) AS reason
     FROM classstudentstbl cs
     WHERE cs.student_id = $1 AND cs.class_id = $2
     ORDER BY cs.phase_number, cs.classstudent_id`,
    [STUDENT_ID, CLASS_ID]
  );
  return r.rows;
}

async function loadProfile(client) {
  const r = await client.query(
    `SELECT installmentinvoiceprofiles_id AS profile_id, student_id, class_id,
            is_active, generated_count, phase_start, total_phases,
            downpayment_invoice_id
     FROM installmentinvoiceprofilestbl
     WHERE installmentinvoiceprofiles_id = $1`,
    [PROFILE_ID]
  );
  return r.rows[0] || null;
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

async function refreshInvoiceStatus(client, invoiceId, previousStatus, forceOriginalAmount = null) {
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
    previousStatus: previousStatus || inv.status,
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

async function main() {
  console.log(
    `\nJaylla Tenedero — hide Phase 5, move payment → Phase 6, enroll 6–8` +
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
    console.log('Student:', student.full_name, student.email, `(id ${student.user_id})`);

    const klass = (
      await client.query(
        `SELECT class_id, class_name, branch_id FROM classestbl WHERE class_id = $1`,
        [CLASS_ID]
      )
    ).rows[0];
    if (!klass || klass.class_name !== CLASS_NAME) {
      throw new Error(`Class ${CLASS_ID} name mismatch: ${klass?.class_name}`);
    }
    if (Number(klass.branch_id) !== BRANCH_ID) {
      throw new Error(`Class branch ${klass.branch_id} ≠ ${BRANCH_ID}`);
    }

    const profile = await loadProfile(client);
    if (!profile || Number(profile.student_id) !== STUDENT_ID) {
      throw new Error(`Profile ${PROFILE_ID} not found`);
    }
    if (Number(profile.class_id) !== CLASS_ID) {
      throw new Error(`Profile class_id ${profile.class_id} ≠ ${CLASS_ID}`);
    }
    const phaseStartAlready = Number(profile.phase_start) === 6;
    if (!phaseStartAlready && Number(profile.phase_start) !== 5) {
      throw new Error(`Profile phase_start=${profile.phase_start}, expected 5 or 6`);
    }
    console.log('Profile BEFORE:', profile);

    const inv5 = await loadInvoice(client, PHASE5_INVOICE_ID);
    const inv6 = await loadInvoice(client, PHASE6_INVOICE_ID);
    const dp = await loadInvoice(client, DOWNPAYMENT_INVOICE_ID);
    if (!inv5 || !inv6) throw new Error('Phase 5/6 invoice missing');
    if (Number(inv5.profile_id) !== PROFILE_ID) {
      throw new Error(`INV-${PHASE5_INVOICE_ID} not on profile ${PROFILE_ID}`);
    }
    if (Number(inv6.profile_id) !== PROFILE_ID) {
      throw new Error(`INV-${PHASE6_INVOICE_ID} not on profile ${PROFILE_ID}`);
    }
    if (inv5.phase !== 5) throw new Error(`INV-${PHASE5_INVOICE_ID} TARGET_PHASE:${inv5.phase}`);
    if (inv6.phase !== 6) throw new Error(`INV-${PHASE6_INVOICE_ID} TARGET_PHASE:${inv6.phase}`);

    const p5Pays = await loadCompletedPayments(client, PHASE5_INVOICE_ID);
    const p6Pays = await loadCompletedPayments(client, PHASE6_INVOICE_ID);
    if (!p5Pays.length) throw new Error(`No completed payment on INV-${PHASE5_INVOICE_ID}`);
    if (p6Pays.length) {
      throw new Error(`INV-${PHASE6_INVOICE_ID} already has completed payments`);
    }

    console.log('\nPhase 5 invoice BEFORE:', inv5);
    console.log('Phase 6 invoice BEFORE:', inv6);
    console.log('Downpayment BEFORE AR/remarks:', {
      invoice_id: dp?.invoice_id,
      ar: dp?.invoice_ar_number,
      remarks: String(dp?.remarks || '').slice(0, 120),
    });
    console.log('\nPhase 5 payments (move these):');
    console.table(p5Pays);
    console.log('Phase 6 payments BEFORE:');
    console.table(p6Pays.length ? p6Pays : [{ note: '(none)' }]);

    const beforeCs = await loadEnrollments(client);
    console.log('\nBEFORE enrollments:');
    console.table(beforeCs);

    const p5Row = beforeCs.find((r) => Number(r.classstudent_id) === PHASE5_CLASSSTUDENT_ID);
    if (!p5Row || Number(p5Row.phase_number) !== 5) {
      throw new Error(`Phase 5 CS ${PHASE5_CLASSSTUDENT_ID} not found`);
    }

    console.log('\nPlanned:');
    console.log(
      `  1. Move PAY ${p5Pays.map((p) => p.payment_id).join(', ')} INV-${PHASE5_INVOICE_ID} → INV-${PHASE6_INVOICE_ID} (keep dates)`
    );
    console.log('  2. Clear Phase 6 penalty; INV-1398 → Paid; AR 261060 follows payment');
    console.log('  3. Cancel + detach INV-1394 (Phase 5 not displayed)');
    console.log('  4. DELETE Phase 5 enrollment CS 1237');
    console.log('  5. Phase 6 new / Phase 7 re_enrolled / Phase 8 re_enrolled');
    console.log(
      phaseStartAlready
        ? '  6. phase_start already 6'
        : '  6. profile.phase_start 5 → 6; downpayment PHASE_START/END 5/10 → 6/11'
    );
    console.log(
      `  7. generated_count ${profile.generated_count} → ${Math.max(3, Number(profile.generated_count) - 1)}`
    );

    for (const pay of p5Pays) {
      await client.query(
        `UPDATE paymenttbl
         SET invoice_id = $1,
             remarks = CASE
               WHEN remarks IS NULL OR TRIM(remarks) = '' THEN $2
               ELSE remarks || ' | ' || $2
             END
         WHERE payment_id = $3 AND invoice_id = $4`,
        [PHASE6_INVOICE_ID, REPAIR_NOTE, pay.payment_id, PHASE5_INVOICE_ID]
      );
      await client.query(
        `UPDATE acknowledgement_receiptstbl
         SET invoice_id = $1
         WHERE payment_id = $2 AND (invoice_id IS NULL OR invoice_id = $3)`,
        [PHASE6_INVOICE_ID, pay.payment_id, PHASE5_INVOICE_ID]
      );
      console.log(
        `✅ Moved PAY-${pay.payment_id} (₱${pay.payable_amount}, date ${pay.issue || pay.created}) → INV-${PHASE6_INVOICE_ID}`
      );
    }

    const penaltyCleared = await clearInvoicePenalty(client, PHASE6_INVOICE_ID);
    const inv6Grand = await recalcInvoiceAmountFromItems(client, PHASE6_INVOICE_ID);
    console.log(
      `✅ Cleared ${penaltyCleared} Phase 6 penalty item(s); invoice amount → ₱${inv6Grand.toFixed(2)}`
    );

    await client.query(
      `UPDATE invoicestbl SET invoice_ar_number = NULL WHERE invoice_id = ANY($1::int[])`,
      [[PHASE5_INVOICE_ID, PHASE6_INVOICE_ID]]
    );
    await client.query(
      `UPDATE acknowledgement_receiptstbl
       SET invoice_id = $1
       WHERE ack_receipt_number = $2`,
      [PHASE6_INVOICE_ID, PHASE5_AR]
    );

    const inv6Remarks = rewriteTargetPhaseInRemarks(inv6.remarks || '', 6);
    const inv6RemarksNoted = inv6Remarks.includes(REPAIR_NOTE)
      ? inv6Remarks
      : `${inv6Remarks};${REPAIR_NOTE}`;
    await client.query(
      `UPDATE invoicestbl
       SET invoice_ar_number = $1,
           remarks = $2
       WHERE invoice_id = $3`,
      [PHASE5_AR, inv6RemarksNoted, PHASE6_INVOICE_ID]
    );

    const inv5Remarks = [inv5.remarks, REPAIR_NOTE, 'WRONG_PHASE5_ENROLLMENT'].filter(Boolean).join(';');
    await client.query(
      `UPDATE invoicestbl
       SET status = 'Cancelled',
           installmentinvoiceprofiles_id = NULL,
           invoice_ar_number = NULL,
           remarks = $1
       WHERE invoice_id = $2
         AND installmentinvoiceprofiles_id = $3`,
      [inv5Remarks, PHASE5_INVOICE_ID, PROFILE_ID]
    );
    console.log(`✅ INV-${PHASE5_INVOICE_ID} Cancelled + detached; INV-${PHASE6_INVOICE_ID} AR → ${PHASE5_AR}`);

    await refreshInvoiceStatus(client, PHASE6_INVOICE_ID, 'Unpaid', BASE_AMOUNT);

    const del5 = await client.query(
      `DELETE FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2 AND phase_number = 5
       RETURNING classstudent_id`,
      [STUDENT_ID, CLASS_ID]
    );
    console.log(`✅ Deleted Phase 5 enrollment: ${del5.rows.map((r) => r.classstudent_id).join(', ') || '(none)'}`);
    if (!del5.rows.some((r) => Number(r.classstudent_id) === PHASE5_CLASSSTUDENT_ID)) {
      throw new Error(`Did not delete CS ${PHASE5_CLASSSTUDENT_ID}`);
    }

    const enrollmentUpdates = [
      { id: PHASE6_CLASSSTUDENT_ID, phase: 6, status: 'new' },
      { id: PHASE7_CLASSSTUDENT_ID, phase: 7, status: 're_enrolled' },
      { id: PHASE8_CLASSSTUDENT_ID, phase: 8, status: 're_enrolled' },
    ];
    for (const row of enrollmentUpdates) {
      const upd = await client.query(
        `UPDATE classstudentstbl
         SET program_enrollment_status = $1,
             removed_at = NULL,
             removed_reason = NULL,
             removed_by = NULL
         WHERE classstudent_id = $2
           AND student_id = $3
           AND class_id = $4
           AND phase_number = $5
         RETURNING classstudent_id, phase_number, program_enrollment_status`,
        [row.status, row.id, STUDENT_ID, CLASS_ID, row.phase]
      );
      if (!upd.rows.length) throw new Error(`Failed to update CS ${row.id} phase ${row.phase}`);
      console.log(`✅ Phase ${row.phase} CS ${row.id} → ${row.status}`);
    }

    const nextGenerated = 3;
    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET phase_start = 6,
           generated_count = $1
       WHERE installmentinvoiceprofiles_id = $2
         AND student_id = $3`,
      [nextGenerated, PROFILE_ID, STUDENT_ID]
    );
    console.log(`✅ Profile phase_start → 6, generated_count → ${nextGenerated}`);

    if (dp) {
      const nextDpRemarks = String(dp.remarks || '')
        .replace(/PHASE_START:\d+/i, 'PHASE_START:6')
        .replace(/PHASE_END:\d+/i, 'PHASE_END:11');
      const dpNoted = nextDpRemarks.includes(REPAIR_NOTE)
        ? nextDpRemarks
        : `${nextDpRemarks};${REPAIR_NOTE}`;
      await client.query(`UPDATE invoicestbl SET remarks = $1 WHERE invoice_id = $2`, [
        dpNoted,
        DOWNPAYMENT_INVOICE_ID,
      ]);
      console.log('✅ Downpayment PHASE_START:6 PHASE_END:11');
    }

    const afterProfile = await loadProfile(client);
    const afterInv5 = await loadInvoice(client, PHASE5_INVOICE_ID);
    const afterInv6 = await loadInvoice(client, PHASE6_INVOICE_ID);
    const afterPays6 = await loadCompletedPayments(client, PHASE6_INVOICE_ID);
    const afterPays5 = await loadCompletedPayments(client, PHASE5_INVOICE_ID);
    const afterCs = await loadEnrollments(client);
    const remaining = (
      await client.query(
        `SELECT invoice_id, status, invoice_ar_number,
                SUBSTRING(remarks FROM 'TARGET_PHASE:([0-9]+)') AS phase
         FROM invoicestbl
         WHERE installmentinvoiceprofiles_id = $1
           AND COALESCE(status, '') NOT IN ('Cancelled', 'Canceled')
         ORDER BY invoice_id`,
        [PROFILE_ID]
      )
    ).rows;

    console.log('\nProfile AFTER:', afterProfile);
    console.log('INV-1394 AFTER:', {
      status: afterInv5?.status,
      profile_id: afterInv5?.profile_id,
      ar: afterInv5?.invoice_ar_number,
    });
    console.log('INV-1398 AFTER:', afterInv6);
    console.log('Payments still on INV-1394:');
    console.table(afterPays5.length ? afterPays5 : [{ note: '(none)' }]);
    console.log('Payments now on INV-1398:');
    console.table(afterPays6);
    console.log('\nAFTER enrollments:');
    console.table(afterCs);
    console.log('Remaining profile invoices:');
    console.table(remaining);

    if (Number(afterProfile.phase_start) !== 6) {
      throw new Error(`phase_start ${afterProfile.phase_start} ≠ 6`);
    }
    if (Number(afterProfile.generated_count) !== 3) {
      throw new Error(`generated_count ${afterProfile.generated_count} ≠ 3`);
    }
    if (afterInv5?.profile_id != null || String(afterInv5?.status) !== 'Cancelled') {
      throw new Error('INV-1394 not cancelled/detached');
    }
    if (String(afterInv6.status) !== 'Paid' || afterInv6.invoice_ar_number !== PHASE5_AR) {
      throw new Error(`INV-1398 status/AR ${afterInv6.status}/${afterInv6.invoice_ar_number}`);
    }
    if (afterPays5.length) throw new Error('Payment still on INV-1394');
    if (!afterPays6.length) throw new Error('No payment on INV-1398');
    if (afterCs.some((r) => Number(r.phase_number) === 5)) {
      throw new Error('Phase 5 enrollment still present');
    }
    const exp = [
      { phase: 6, status: 'new' },
      { phase: 7, status: 're_enrolled' },
      { phase: 8, status: 're_enrolled' },
    ];
    for (const e of exp) {
      const row = afterCs.find((r) => Number(r.phase_number) === e.phase);
      if (!row || String(row.status) !== e.status || row.removed != null) {
        throw new Error(`Phase ${e.phase} status=${row?.status} removed=${row?.removed}`);
      }
    }
    if (remaining.some((r) => Number(r.phase) === 5)) {
      throw new Error('Phase 5 invoice still on profile');
    }

    console.log('\nExpected UI:');
    console.log('  Plan starts at Phase 6 (Phase 5 not displayed)');
    console.log('  Phase 6: new + Paid (payment date from former Phase 5)');
    console.log('  Phase 7: re enrolled + Paid');
    console.log('  Phase 8: re enrolled + Paid');

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
