/**
 * Khal Guirnalda — move rejoin payment from duplicate Phase 6 slot back to INV-2587.
 *
 * Student: 562 · khal.guirnalda@gmail.com
 * Profile: 457 · class 89 VMM_Playgroup_TTh 9:30 AM
 *
 * Issue:
 *   Phase 5 dropped (INV-2154 unpaid) — correct
 *   Rejoin payment landed on INV-2845 (rejoin invoice) which mapped to Phase 7 slot
 *   INV-2587 (TARGET_PHASE:6) still Unpaid
 *   Phase 6 enrollment rejoin exists; Phase 7 shows Paid incorrectly
 *
 * Target:
 *   Move PAY-2276 INV-2845 → INV-2587 (Phase 6 Paid, rejoin enrollment)
 *   Cancel + detach INV-2845
 *   Phase 7 → Not Generated, no enrollment
 *   Queue Phase 7 generation: 2026-09-25 / invoice month 2026-10-01 (due Oct 5)
 *   generated_count stays 4
 *
 * Run:
 *   node backend/scripts/repairKhalGuirnaldaPhase6RejoinPayment.js --production
 *   node backend/scripts/repairKhalGuirnaldaPhase6RejoinPayment.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { deriveInvoiceStatusForInvoice } from '../utils/invoicePaymentStatus.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_ID = 562;
const STUDENT_EMAIL = 'khal.guirnalda@gmail.com';
const PROFILE_ID = 457;
const CLASS_ID = 89;
const CLASS_NAME = 'VMM_Playgroup_TTh 9:30 AM';

const PHASE5_INVOICE_ID = 2154;
const PHASE6_INVOICE_ID = 2587;
const REJOIN_INVOICE_ID = 2845;
const PHASE6_CLASSSTUDENT_ID = 2521;
const PAYMENT_ID = 2276;

const BASE_AMOUNT = 5146;
const PHASE6_AR = '262511';
const PHASE6_GENERATED_AR = '262253';

const QUEUE_NEXT_GEN = '2026-09-25';
const QUEUE_NEXT_MONTH = '2026-10-01';
const QUEUE_SCHEDULED = '2026-10-05';

const REPAIR_NOTE =
  'Ops repair 2026-09-02 — Khal Guirnalda move rejoin payment INV-2845 → INV-2587 Phase 6; P7 not generated queue Sep25/Oct5';

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
    `SELECT payment_id, invoice_id, payable_amount, status,
            TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue
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
    `SELECT classstudent_id, phase_number, program_enrollment_status,
            TO_CHAR(enrolled_at, 'YYYY-MM-DD') AS enrolled,
            TO_CHAR(removed_at, 'YYYY-MM-DD') AS removed
     FROM classstudentstbl
     WHERE student_id = $1 AND class_id = $2
     ORDER BY phase_number, classstudent_id`,
    [STUDENT_ID, CLASS_ID]
  );
  return r.rows;
}

async function loadProfile(client) {
  const r = await client.query(
    `SELECT ip.installmentinvoiceprofiles_id, ip.student_id, ip.class_id,
            ip.phase_start, ip.total_phases, ip.generated_count, ip.is_active,
            c.class_name,
            ii.installmentinvoicedtl_id,
            TO_CHAR(ii.next_generation_date, 'YYYY-MM-DD') AS next_gen,
            TO_CHAR(ii.next_invoice_month, 'YYYY-MM-DD') AS next_month,
            TO_CHAR(ii.scheduled_date, 'YYYY-MM-DD') AS scheduled
     FROM installmentinvoiceprofilestbl ip
     LEFT JOIN classestbl c ON c.class_id = ip.class_id
     LEFT JOIN installmentinvoicestbl ii
       ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
     WHERE ip.installmentinvoiceprofiles_id = $1 AND ip.student_id = $2`,
    [PROFILE_ID, STUDENT_ID]
  );
  return r.rows[0] || null;
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
    `\nKhal Guirnalda — move rejoin payment to Phase 6` +
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
    if (!student) throw new Error('Student not found or email mismatch');
    console.log('Student:', student.full_name, `(id ${student.user_id})`);

    const profile = await loadProfile(client);
    if (!profile) throw new Error(`Profile ${PROFILE_ID} not found`);
    if (Number(profile.class_id) !== CLASS_ID || profile.class_name !== CLASS_NAME) {
      throw new Error(`Class mismatch: ${profile.class_id} / ${profile.class_name}`);
    }

    const inv6 = await loadInvoice(client, PHASE6_INVOICE_ID);
    const rejoinInv = await loadInvoice(client, REJOIN_INVOICE_ID);
    const inv5 = await loadInvoice(client, PHASE5_INVOICE_ID);
    if (!inv6 || !rejoinInv) throw new Error('Phase 6 or rejoin invoice missing');
    if (Number(inv6.profile_id) !== PROFILE_ID) {
      throw new Error(`INV-${PHASE6_INVOICE_ID} not on profile ${PROFILE_ID}`);
    }
    if (Number(rejoinInv.profile_id) !== PROFILE_ID) {
      throw new Error(`INV-${REJOIN_INVOICE_ID} not on profile ${PROFILE_ID}`);
    }
    if (inv6.phase !== 6) throw new Error(`INV-${PHASE6_INVOICE_ID} phase ${inv6.phase} ≠ 6`);
    if (!/REJOIN_PHASE:6/.test(String(rejoinInv.remarks || ''))) {
      throw new Error(`INV-${REJOIN_INVOICE_ID} is not REJOIN_PHASE:6`);
    }

    const rejoinPays = await loadCompletedPayments(client, REJOIN_INVOICE_ID);
    const p6Pays = await loadCompletedPayments(client, PHASE6_INVOICE_ID);
    if (!rejoinPays.some((p) => Number(p.payment_id) === PAYMENT_ID)) {
      throw new Error(`PAY-${PAYMENT_ID} not found on INV-${REJOIN_INVOICE_ID}`);
    }
    if (p6Pays.length) {
      throw new Error(`INV-${PHASE6_INVOICE_ID} already has completed payments`);
    }
    if (String(rejoinInv.status) !== 'Paid') {
      throw new Error(`INV-${REJOIN_INVOICE_ID} status ${rejoinInv.status} ≠ Paid`);
    }
    if (String(inv6.status) === 'Paid') {
      throw new Error(`INV-${PHASE6_INVOICE_ID} already Paid`);
    }

    const enrollments = await loadEnrollments(client);
    const phase6Enroll = enrollments.find(
      (r) => Number(r.classstudent_id) === PHASE6_CLASSSTUDENT_ID && Number(r.phase_number) === 6
    );
    if (!phase6Enroll || String(phase6Enroll.program_enrollment_status) !== 'rejoin') {
      throw new Error(`Phase 6 CS ${PHASE6_CLASSSTUDENT_ID} not rejoin`);
    }
    if (enrollments.some((r) => Number(r.phase_number) === 7 && r.removed == null)) {
      throw new Error('Unexpected active Phase 7 enrollment');
    }

    console.log('\nProfile BEFORE:', {
      phase_start: profile.phase_start,
      total_phases: profile.total_phases,
      generated_count: profile.generated_count,
      is_active: profile.is_active,
      next_gen: profile.next_gen,
      next_month: profile.next_month,
      scheduled: profile.scheduled,
    });
    console.log('\nPhase 6 invoice BEFORE:', inv6);
    console.log('Rejoin invoice BEFORE:', rejoinInv);
    console.log('Phase 5 invoice (keep dropped):', {
      invoice_id: inv5?.invoice_id,
      status: inv5?.status,
      phase: inv5?.phase,
    });
    console.log('\nBEFORE enrollments:');
    console.table(enrollments);
    console.log('\nRejoin payments (move):');
    console.table(rejoinPays);

    console.log('\nPlanned:');
    console.log(`  • Move PAY-${PAYMENT_ID} INV-${REJOIN_INVOICE_ID} → INV-${PHASE6_INVOICE_ID}`);
    console.log(`  • INV-${PHASE6_INVOICE_ID} → Paid, AR ${PHASE6_AR}`);
    console.log(`  • Cancel + detach INV-${REJOIN_INVOICE_ID}`);
    console.log('  • Phase 6 enrollment stays rejoin');
    console.log('  • Phase 7 → Not Generated (no enrollment)');
    console.log(
      `  • Queue → next_gen ${QUEUE_NEXT_GEN}, next_month ${QUEUE_NEXT_MONTH}, scheduled ${QUEUE_SCHEDULED}`
    );
    console.log(`  • generated_count stays ${profile.generated_count}`);

    await client.query(
      `UPDATE paymenttbl
       SET invoice_id = $1,
           remarks = CASE
             WHEN remarks IS NULL OR TRIM(remarks) = '' THEN $2
             ELSE remarks || ' | ' || $2
           END
       WHERE payment_id = $3 AND invoice_id = $4`,
      [PHASE6_INVOICE_ID, REPAIR_NOTE, PAYMENT_ID, REJOIN_INVOICE_ID]
    );
    await client.query(
      `UPDATE acknowledgement_receiptstbl
       SET invoice_id = $1
       WHERE payment_id = $2 AND (invoice_id IS NULL OR invoice_id = $3)`,
      [PHASE6_INVOICE_ID, PAYMENT_ID, REJOIN_INVOICE_ID]
    );
    console.log(`✅ Moved PAY-${PAYMENT_ID} → INV-${PHASE6_INVOICE_ID}`);

    await client.query(
      `UPDATE invoicestbl SET invoice_ar_number = NULL WHERE invoice_id = ANY($1::int[])`,
      [[PHASE6_INVOICE_ID, REJOIN_INVOICE_ID]]
    );
    await client.query(
      `UPDATE acknowledgement_receiptstbl
       SET invoice_id = $1
       WHERE ack_receipt_number = $2`,
      [PHASE6_INVOICE_ID, PHASE6_AR]
    );
    const inv6Remarks = String(inv6.remarks || '').includes(REPAIR_NOTE)
      ? inv6.remarks
      : `${inv6.remarks};${REPAIR_NOTE}`;
    await client.query(
      `UPDATE invoicestbl
       SET invoice_ar_number = $1, remarks = $2
       WHERE invoice_id = $3`,
      [PHASE6_AR, inv6Remarks, PHASE6_INVOICE_ID]
    );
    console.log(`✅ INV-${PHASE6_INVOICE_ID} AR → ${PHASE6_AR}`);

    await refreshInvoiceStatus(client, PHASE6_INVOICE_ID, 'Unpaid', BASE_AMOUNT);

    const rejoinRemarks = [rejoinInv.remarks, REPAIR_NOTE, 'DUPLICATE_REJOIN_INVOICE'].filter(Boolean).join(';');
    await client.query(
      `UPDATE invoicestbl
       SET status = 'Cancelled',
           installmentinvoiceprofiles_id = NULL,
           invoice_ar_number = NULL,
           remarks = $1
       WHERE invoice_id = $2
         AND installmentinvoiceprofiles_id = $3`,
      [rejoinRemarks, REJOIN_INVOICE_ID, PROFILE_ID]
    );
    console.log(`✅ INV-${REJOIN_INVOICE_ID} Cancelled + detached`);

    if (!profile.installmentinvoicedtl_id) {
      throw new Error('Missing installmentinvoicestbl queue row');
    }
    await client.query(
      `UPDATE installmentinvoicestbl
       SET status = NULL,
           next_generation_date = $1::date,
           next_invoice_month = $2::date,
           scheduled_date = $3::date
       WHERE installmentinvoicedtl_id = $4
         AND installmentinvoiceprofiles_id = $5`,
      [
        QUEUE_NEXT_GEN,
        QUEUE_NEXT_MONTH,
        QUEUE_SCHEDULED,
        profile.installmentinvoicedtl_id,
        PROFILE_ID,
      ]
    );
    console.log(
      `✅ Queue → ${QUEUE_NEXT_GEN} / ${QUEUE_NEXT_MONTH} / scheduled ${QUEUE_SCHEDULED}`
    );

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET is_active = true,
           generated_count = $1
       WHERE installmentinvoiceprofiles_id = $2
         AND student_id = $3`,
      [Number(profile.generated_count), PROFILE_ID, STUDENT_ID]
    );
    console.log(`✅ Profile is_active=true, generated_count=${profile.generated_count}`);

    const afterProfile = await loadProfile(client);
    const afterInv6 = await loadInvoice(client, PHASE6_INVOICE_ID);
    const afterRejoin = await loadInvoice(client, REJOIN_INVOICE_ID);
    const afterP6Pays = await loadCompletedPayments(client, PHASE6_INVOICE_ID);
    const afterRejoinPays = await loadCompletedPayments(client, REJOIN_INVOICE_ID);
    const afterEnrollments = await loadEnrollments(client);
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

    console.log('\nProfile AFTER:', {
      generated_count: afterProfile.generated_count,
      is_active: afterProfile.is_active,
      next_gen: afterProfile.next_gen,
      next_month: afterProfile.next_month,
      scheduled: afterProfile.scheduled,
    });
    console.log('INV-2587 AFTER:', afterInv6);
    console.log('INV-2845 AFTER:', {
      status: afterRejoin?.status,
      profile_id: afterRejoin?.profile_id,
    });
    console.log('Payments on INV-2587:');
    console.table(afterP6Pays);
    console.log('Payments still on INV-2845:');
    console.table(afterRejoinPays.length ? afterRejoinPays : [{ note: '(none)' }]);
    console.log('\nAFTER enrollments:');
    console.table(afterEnrollments);
    console.log('Remaining profile invoices:');
    console.table(remaining);

    if (String(afterInv6.status) !== 'Paid' || afterInv6.invoice_ar_number !== PHASE6_AR) {
      throw new Error(`INV-2587 status/AR ${afterInv6.status}/${afterInv6.invoice_ar_number}`);
    }
    if (afterRejoin?.profile_id != null || String(afterRejoin?.status) !== 'Cancelled') {
      throw new Error('INV-2845 not cancelled/detached');
    }
    if (!afterP6Pays.some((p) => Number(p.payment_id) === PAYMENT_ID)) {
      throw new Error('Payment not on INV-2587');
    }
    if (afterRejoinPays.length) throw new Error('Payment still on INV-2845');
    const p6 = afterEnrollments.find((r) => Number(r.phase_number) === 6 && r.removed == null);
    if (!p6 || String(p6.program_enrollment_status) !== 'rejoin') {
      throw new Error('Phase 6 enrollment not rejoin');
    }
    if (afterEnrollments.some((r) => Number(r.phase_number) === 7 && r.removed == null)) {
      throw new Error('Phase 7 enrollment present');
    }
    if (remaining.some((r) => Number(r.phase) === 7)) {
      throw new Error('Phase 7 invoice still on profile');
    }
    if (afterProfile.next_gen !== QUEUE_NEXT_GEN || afterProfile.next_month !== QUEUE_NEXT_MONTH) {
      throw new Error(
        `Queue ${afterProfile.next_gen}/${afterProfile.next_month} ≠ ${QUEUE_NEXT_GEN}/${QUEUE_NEXT_MONTH}`
      );
    }

    console.log('\nExpected UI:');
    console.log('  Phase 5: dropped + Overdue (INV-2154 unchanged)');
    console.log('  Phase 6: rejoin + Paid (AR 262511, paid Aug 31)');
    console.log('  Phase 7: Not Generated, not enrolled');
    console.log('  Phase 8–10: Not Generated');
    console.log(`  Queue: generate Phase 7 on ${QUEUE_NEXT_GEN}, due ${QUEUE_SCHEDULED}`);

    if (!isApply) {
      await client.query('ROLLBACK');
      console.log('\nDry run only — rolled back. Re-run with --apply to commit.');
      return;
    }

    await client.query('COMMIT');
    console.log('\nCommitted. Refresh Student History → Installment.');
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
