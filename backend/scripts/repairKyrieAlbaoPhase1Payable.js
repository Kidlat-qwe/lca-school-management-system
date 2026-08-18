/**
 * Kyrie Robles Albao — restore Pay Now on Phase 1 (INV-2007).
 *
 * Student: 623 · andee.albao@gmail.com
 * Profile: 491 · class 83 KG_1-3PM · Branch 5
 *
 * Today:
 *   Phase 1 INV-2007 Unpaid · CS 2200 dropped (delinquency after due 2026-07-05)
 *   Phase 2 INV-2443 Paid (rejoin) · CS 2256 rejoin
 *   UI offers Pay Now on Phase 3 (continued-after-drop rule skips unpaid dropped P1)
 *
 * Target:
 *   - Remove Phase 1 delinquency drop row (CS 2200)
 *   - Add DELINQUENCY_DROP_WAIVED on INV-2007 so auto-drop does not return
 *   - Convert Phase 2 enrollment rejoin → re_enrolled
 *   - Pay Now on Phase 1 (INV-2007)
 *   - After Phase 1 is paid → Pay Now moves to Phase 3 (Not Generated)
 *   - After Phase 1 payment: Phase 1 enrollment "new"; Phase 2 stays "re_enrolled"
 *
 * Issue/due/payment amounts unchanged.
 *
 * Run:
 *   node backend/scripts/repairKyrieAlbaoPhase1Payable.js --production
 *   node backend/scripts/repairKyrieAlbaoPhase1Payable.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { rewriteTargetPhaseInRemarks } from '../utils/installmentPhaseBillingSync.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';
import { syncInstallmentDelinquencyDropsForProfile } from '../utils/installmentDelinquencyDrop.js';
import { loadInstallmentProfilePhaseChains } from '../lib/installmentPaymentEligibility.js';
import { mapPhaseChainsToLocalSlots } from '../utils/installmentPhaseRowMapping.js';
import { resolveProfilePhaseStart } from '../utils/phaseInstallmentUtils.js';

const STUDENT_EMAIL = 'andee.albao@gmail.com';
const STUDENT_ID = 623;
const PROFILE_ID = 491;
const CLASS_ID = 83;
const CLASS_NAME = 'KG_1-3PM';

const PHASE_1_INVOICE_ID = 2007;
const PHASE_2_REJOIN_INVOICE_ID = 2443;
const ABSOLUTE_PHASE_1 = 1;

/** Delinquency drop row blocking Pay Now on Phase 1 */
const DROPPED_ENROLLMENT_ID = 2200;
/** Rejoin enrollment that should become re_enrolled */
const REJOIN_ENROLLMENT_ID = 2256;

const DROP_WAIVE_FLAG = 'DELINQUENCY_DROP_WAIVED';
const REPAIR_NOTE =
  'Ops repair 2026-08-15 — Kyrie Albao Phase 1 payable; delinquency drop waived; Phase 2 rejoin→re_enrolled';

const isApply = process.argv.includes('--apply');

function buildRemarks(currentRemarks, absolutePhase) {
  let remarks = String(currentRemarks || '').trim();
  if (parseTargetPhase(remarks) !== absolutePhase) {
    remarks = rewriteTargetPhaseInRemarks(remarks, absolutePhase);
  }
  if (!remarks.includes(DROP_WAIVE_FLAG)) {
    remarks = remarks ? `${remarks};${DROP_WAIVE_FLAG}` : DROP_WAIVE_FLAG;
  }
  if (!remarks.includes(REPAIR_NOTE)) {
    remarks = `${remarks};${REPAIR_NOTE}`;
  }
  return remarks;
}

async function loadEnrollments(client) {
  const res = await client.query(
    `SELECT classstudent_id, phase_number, program_enrollment_status, removed_at, removed_reason,
            TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD') AS enrolled
     FROM classstudentstbl
     WHERE student_id = $1 AND class_id = $2
     ORDER BY phase_number, classstudent_id`,
    [STUDENT_ID, CLASS_ID]
  );
  return res.rows;
}

async function loadPlanMapping(client, profile) {
  const { phaseChains } = await loadInstallmentProfilePhaseChains(client, PROFILE_ID);
  const mapped = mapPhaseChainsToLocalSlots(phaseChains, profile);
  const phaseStart = resolveProfilePhaseStart(profile);
  const rows = [];
  for (const [local, chain] of [...mapped.entries()].sort((a, b) => a[0] - b[0])) {
    const rep = chain.representative;
    const displayPhase = local + phaseStart - 1;
    rows.push({
      display_phase: displayPhase,
      local_slot: local,
      invoice_id: rep.invoice_id,
      status: rep.status,
      ar: rep.invoice_ar_number,
      issue: String(rep.issue_date || '').slice(0, 10),
      due: String(rep.due_date || '').slice(0, 10),
      amount: rep.amount,
      target_phase: parseTargetPhase(rep.remarks),
      is_rejoin: Boolean(rep.is_rejoin_invoice),
    });
  }
  return rows;
}

/**
 * Approximate Student History Pay Now picker:
 * unpaid dropped phases are skipped after a continue/rejoin.
 */
async function simulatePayNowPhase(client, profile) {
  const { phaseChains } = await loadInstallmentProfilePhaseChains(client, PROFILE_ID);
  const mapped = mapPhaseChainsToLocalSlots(phaseChains, profile);
  const phaseStart = resolveProfilePhaseStart(profile);
  const enrollments = await loadEnrollments(client);
  const droppedPhases = new Set(
    enrollments
      .filter((e) => String(e.program_enrollment_status).toLowerCase() === 'dropped')
      .map((e) => Number(e.phase_number))
  );
  const continuedPhases = new Set(
    enrollments
      .filter((e) =>
        ['new', 're_enrolled', 'rejoin', 'upsell', 'completed'].includes(
          String(e.program_enrollment_status || '').toLowerCase()
        )
      )
      .map((e) => Number(e.phase_number))
  );

  const slots = [];
  for (const [local, chain] of [...mapped.entries()].sort((a, b) => a[0] - b[0])) {
    const rep = chain.representative;
    const displayPhase = local + phaseStart - 1;
    const isDropped = droppedPhases.has(displayPhase);
    const isPaid = ['paid', 'paid all'].includes(String(rep.status || '').toLowerCase());
    const isCancelled = ['cancelled', 'canceled'].includes(
      String(rep.status || '').toLowerCase()
    );
    slots.push({
      display_phase: displayPhase,
      invoice_id: rep.invoice_id,
      status: rep.status,
      dropped: isDropped,
      payable: !isDropped && !isPaid && !isCancelled,
    });
  }

  const unpaidDrop = slots.find((s) => {
    if (!s.dropped) return false;
    return !['paid', 'paid all'].includes(String(s.status || '').toLowerCase());
  });
  const continuedAfterDrop =
    unpaidDrop != null &&
    slots.some(
      (s) =>
        s.display_phase > unpaidDrop.display_phase &&
        (continuedPhases.has(s.display_phase) ||
          ['paid', 'paid all'].includes(String(s.status || '').toLowerCase()))
    );

  let payNow = null;
  if (unpaidDrop && !continuedAfterDrop) {
    payNow = null;
  } else if (unpaidDrop && continuedAfterDrop) {
    // Current UI: skip unpaid dropped; first later payable or next Not Generated
    payNow = slots.find(
      (s) => s.display_phase > unpaidDrop.display_phase && s.payable
    );
  } else {
    payNow = slots.find((s) => s.payable);
  }

  return {
    slots,
    continuedAfterDrop,
    unpaidDropPhase: unpaidDrop?.display_phase ?? null,
    payNowPhase: payNow?.display_phase ?? null,
    payNowInvoice: payNow?.invoice_id ?? null,
  };
}

async function main() {
  console.log(
    `\nKyrie Albao — Phase 1 Pay Now repair${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`Note: ${REPAIR_NOTE}`);
  console.log(`DB: ${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV}`);

  if (process.env.DB_NAME !== 'psms_production') {
    console.warn('⚠️ Expected psms_production. Pass --production.');
  }

  const client = await getClient();
  try {
    const profile = (
      await client.query(
        `SELECT ip.*, u.full_name, u.email, c.class_name
         FROM installmentinvoiceprofilestbl ip
         INNER JOIN userstbl u ON u.user_id = ip.student_id
         LEFT JOIN classestbl c ON c.class_id = ip.class_id
         WHERE ip.installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      )
    ).rows[0];

    if (!profile || Number(profile.student_id) !== STUDENT_ID) {
      throw new Error(`Profile ${PROFILE_ID} not found for student ${STUDENT_ID}`);
    }
    if (String(profile.email).toLowerCase() !== STUDENT_EMAIL) {
      throw new Error(`Email mismatch: expected ${STUDENT_EMAIL}, got ${profile.email}`);
    }
    if (Number(profile.class_id) !== CLASS_ID || profile.class_name !== CLASS_NAME) {
      throw new Error(
        `Class mismatch: ${profile.class_id} ${profile.class_name}`
      );
    }

    const phase1Inv = (
      await client.query(
        `SELECT invoice_id, status, amount, remarks,
                installmentinvoiceprofiles_id AS profile_id,
                TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue_ymd,
                TO_CHAR(due_date, 'YYYY-MM-DD') AS due_ymd,
                invoice_ar_number
         FROM invoicestbl
         WHERE invoice_id = $1`,
        [PHASE_1_INVOICE_ID]
      )
    ).rows[0];
    if (!phase1Inv) throw new Error(`Invoice ${PHASE_1_INVOICE_ID} not found`);
    if (Number(phase1Inv.profile_id) !== PROFILE_ID) {
      throw new Error(`INV-${PHASE_1_INVOICE_ID} not on profile ${PROFILE_ID}`);
    }
    if (String(phase1Inv.status) !== 'Unpaid') {
      throw new Error(`INV-${PHASE_1_INVOICE_ID} status ${phase1Inv.status}, expected Unpaid`);
    }
    if (parseTargetPhase(phase1Inv.remarks) !== ABSOLUTE_PHASE_1) {
      throw new Error(`INV-${PHASE_1_INVOICE_ID} TARGET_PHASE ≠ 1`);
    }

    const phase2Inv = (
      await client.query(
        `SELECT invoice_id, status, remarks,
                TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue_ymd
         FROM invoicestbl WHERE invoice_id = $1`,
        [PHASE_2_REJOIN_INVOICE_ID]
      )
    ).rows[0];
    if (!phase2Inv || String(phase2Inv.status) !== 'Paid') {
      throw new Error(`INV-${PHASE_2_REJOIN_INVOICE_ID} must remain Paid (rejoin)`);
    }

    const droppedRow = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status, removed_reason
         FROM classstudentstbl
         WHERE classstudent_id = $1`,
        [DROPPED_ENROLLMENT_ID]
      )
    ).rows[0];
    const rejoinRow = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status
         FROM classstudentstbl
         WHERE classstudent_id = $1`,
        [REJOIN_ENROLLMENT_ID]
      )
    ).rows[0];

    const beforePay = await simulatePayNowPhase(client, profile);

    console.log('Student:', profile.full_name, `| Profile ${PROFILE_ID}`);
    console.log('\nBefore enrollments:');
    console.table(await loadEnrollments(client));
    console.log('\nBefore plan mapping:');
    console.table(await loadPlanMapping(client, profile));
    console.log('\nBefore Pay Now simulation:', beforePay);

    const nextRemarks = buildRemarks(phase1Inv.remarks, ABSOLUTE_PHASE_1);

    console.log('\nPhase 1 invoice (unchanged dates):');
    console.table([
      {
        invoice_id: PHASE_1_INVOICE_ID,
        ar: phase1Inv.invoice_ar_number,
        status: phase1Inv.status,
        amount: phase1Inv.amount,
        issue: phase1Inv.issue_ymd,
        due: phase1Inv.due_ymd,
        target_phase: parseTargetPhase(phase1Inv.remarks),
        next_remarks: nextRemarks.slice(0, 100) + (nextRemarks.length > 100 ? '…' : ''),
      },
    ]);

    console.log('\nPlanned changes:');
    console.log(
      `  • Remove dropped enrollment ${DROPPED_ENROLLMENT_ID} (phase ${droppedRow?.phase_number ?? 1})`
    );
    console.log(`  • INV-${PHASE_1_INVOICE_ID}: add ${DROP_WAIVE_FLAG} (dates unchanged)`);
    if (rejoinRow && String(rejoinRow.program_enrollment_status) === 'rejoin') {
      console.log(
        `  • CS ${REJOIN_ENROLLMENT_ID} phase ${rejoinRow.phase_number}: rejoin → re_enrolled`
      );
    } else {
      console.log(`  • CS ${REJOIN_ENROLLMENT_ID}: already ${rejoinRow?.program_enrollment_status}`);
    }
    console.log('  • Expected Pay Now → Phase 1 (INV-2007)');
    console.log('  • After Phase 1 paid → Pay Now on Phase 3; enrollments new + re_enrolled');

    if (!droppedRow) {
      console.log('ℹ️  Dropped enrollment already absent');
    } else if (
      Number(droppedRow.phase_number) !== 1 ||
      String(droppedRow.program_enrollment_status) !== 'dropped'
    ) {
      throw new Error(
        `CS ${DROPPED_ENROLLMENT_ID} unexpected: phase ${droppedRow.phase_number} ${droppedRow.program_enrollment_status}`
      );
    }

    if (!isApply) {
      console.log('\nDRY RUN — re-run with --apply to commit.');
      return;
    }

    await client.query('BEGIN');

    if (droppedRow) {
      await client.query(`DELETE FROM classstudentstbl WHERE classstudent_id = $1`, [
        DROPPED_ENROLLMENT_ID,
      ]);
      console.log(`✅ Removed dropped enrollment ${DROPPED_ENROLLMENT_ID}`);
    }

    await client.query(
      `UPDATE invoicestbl
       SET remarks = $1
       WHERE invoice_id = $2`,
      [nextRemarks, PHASE_1_INVOICE_ID]
    );
    console.log(`✅ INV-${PHASE_1_INVOICE_ID} remarks updated (${DROP_WAIVE_FLAG})`);

    if (rejoinRow && String(rejoinRow.program_enrollment_status) === 'rejoin') {
      await client.query(
        `UPDATE classstudentstbl
         SET program_enrollment_status = 're_enrolled'
         WHERE classstudent_id = $1
           AND student_id = $2
           AND class_id = $3`,
        [REJOIN_ENROLLMENT_ID, STUDENT_ID, CLASS_ID]
      );
      console.log(`✅ CS ${REJOIN_ENROLLMENT_ID} → re_enrolled`);
    }

    await syncProgramPaymentStatusForInvoice(client, PHASE_1_INVOICE_ID);

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET is_active = true
       WHERE installmentinvoiceprofiles_id = $1`,
      [PROFILE_ID]
    );

    await client.query('COMMIT');

    const dropSync = await syncInstallmentDelinquencyDropsForProfile(client, PROFILE_ID);
    console.log('Delinquency sync after waive:', dropSync);

    const profileAfter = (
      await client.query(
        `SELECT * FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      )
    ).rows[0];

    console.log('\nAfter enrollments:');
    console.table(await loadEnrollments(client));
    console.log('\nAfter Pay Now simulation:', await simulatePayNowPhase(client, profileAfter));

    const afterPay = await simulatePayNowPhase(client, profileAfter);
    if (Number(afterPay.payNowPhase) !== 1 || Number(afterPay.payNowInvoice) !== PHASE_1_INVOICE_ID) {
      throw new Error(
        `Expected Pay Now on Phase 1 INV-${PHASE_1_INVOICE_ID}, got phase ${afterPay.payNowPhase} INV-${afterPay.payNowInvoice}`
      );
    }

    const reDrop = (await loadEnrollments(client)).find(
      (e) =>
        Number(e.phase_number) === 1 &&
        String(e.program_enrollment_status).toLowerCase() === 'dropped'
    );
    if (reDrop) {
      throw new Error(`Phase 1 was re-dropped as CS ${reDrop.classstudent_id}`);
    }

    console.log('\n✅ APPLY complete. Refresh Student History → Installment.');
    console.log('   Expect Pay Now on Phase 1. After paying it → Pay Now on Phase 3.');
    console.log('   Phase 1 payment should create enrollment "new"; Phase 2 stays re_enrolled.');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('\nFailed:', err.message || err);
    process.exit(1);
  } finally {
    client.release();
  }
}

main().then(() => process.exit(0));
