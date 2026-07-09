/**
 * Aadam June Cawili — restore Pay Now on phase 4 (INV-1015).
 *
 * Problem:
 *   Phase 4 was auto-dropped for installment delinquency, so the UI treats the
 *   slot as addressed and skips it — Pay Now appears on phase 5 instead.
 *
 * Fix (issue/due dates unchanged):
 *   - Remove phase 4 delinquency drop enrollment row
 *   - Add DELINQUENCY_DROP_WAIVED on INV-1015 (TARGET_PHASE:4) to prevent re-drop
 *   - Keep profile active; generated_count stays 4
 *
 * Expected UI after repair:
 *   - Pay Now on phase 4 (INV-1015, Overdue)
 *   - After phase 4 is paid → Pay Now moves to phase 5 (INV-1777)
 *   - Phases 6+ remain Locked until prior slots are addressed
 *
 * Run:
 *   node backend/scripts/repairAadamCawiliPhase4Payable.js
 *   node backend/scripts/repairAadamCawiliPhase4Payable.js --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { rewriteTargetPhaseInRemarks } from '../utils/installmentPhaseBillingSync.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';
import { syncInstallmentDelinquencyDropsForProfile } from '../utils/installmentDelinquencyDrop.js';
import { loadInstallmentProfilePhaseChains } from '../lib/installmentPaymentEligibility.js';
import { mapPhaseChainsToLocalSlots } from '../utils/installmentPhaseRowMapping.js';
import { resolveProfilePhaseStart } from '../utils/phaseInstallmentUtils.js';

const STUDENT_EMAIL = 'may778848@gmail.com';
const STUDENT_ID = 293;
const PROFILE_ID = 142;
const CLASS_ID = 40;

/** Absolute class phase 4 — unpaid, overdue */
const PHASE_4_INVOICE_ID = 1015;
const ABSOLUTE_PHASE_4 = 4;

/** Delinquency drop row blocking Pay Now on phase 4 */
const DROPPED_ENROLLMENT_ID = 1752;

const DROP_WAIVE_FLAG = 'DELINQUENCY_DROP_WAIVED';
const REPAIR_NOTE = 'Ops repair — Aadam Cawili phase 4 payable; delinquency drop waived';

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
    });
  }
  return rows;
}

async function loadEnrollments(client) {
  const res = await client.query(
    `SELECT classstudent_id, phase_number, program_enrollment_status, removed_at, removed_reason
     FROM classstudentstbl
     WHERE student_id = $1 AND class_id = $2
     ORDER BY phase_number`,
    [STUDENT_ID, CLASS_ID]
  );
  return res.rows;
}

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

  const slots = [];
  for (const [local, chain] of [...mapped.entries()].sort((a, b) => a[0] - b[0])) {
    const rep = chain.representative;
    const displayPhase = local + phaseStart - 1;
    const isDropped = droppedPhases.has(displayPhase);
    const isPaid = String(rep.status || '').toLowerCase() === 'paid';
    slots.push({
      display_phase: displayPhase,
      invoice_id: rep.invoice_id,
      status: rep.status,
      dropped: isDropped,
      payable: !isDropped && !isPaid,
    });
  }

  const payNow = slots.find((s) => s.payable);
  return { slots, payNowPhase: payNow?.display_phase ?? null, payNowInvoice: payNow?.invoice_id ?? null };
}

async function main() {
  console.log(
    `\nAadam Cawili — phase 4 Pay Now repair${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );

  const client = await getClient();
  try {
    const profile = (
      await client.query(
        `SELECT ip.*, u.full_name, u.email
         FROM installmentinvoiceprofilestbl ip
         INNER JOIN userstbl u ON u.user_id = ip.student_id
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

    const phase4Inv = (
      await client.query(
        `SELECT invoice_id, status, amount, remarks,
                TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue_ymd,
                TO_CHAR(due_date, 'YYYY-MM-DD') AS due_ymd,
                invoice_ar_number
         FROM invoicestbl
         WHERE invoice_id = $1`,
        [PHASE_4_INVOICE_ID]
      )
    ).rows[0];

    if (!phase4Inv) {
      throw new Error(`Invoice ${PHASE_4_INVOICE_ID} not found`);
    }

    const droppedRow = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status, removed_reason
         FROM classstudentstbl
         WHERE classstudent_id = $1`,
        [DROPPED_ENROLLMENT_ID]
      )
    ).rows[0];

    const beforePay = await simulatePayNowPhase(client, profile);

    console.log('Student:', profile.full_name, `| Profile ${PROFILE_ID}`);
    console.log('\nBefore enrollments:');
    console.table(await loadEnrollments(client));
    console.log('\nBefore plan mapping:');
    console.table(await loadPlanMapping(client, profile));
    console.log('\nBefore Pay Now simulation:', beforePay);

    const nextRemarks = buildRemarks(phase4Inv.remarks, ABSOLUTE_PHASE_4);

    console.log('\nPhase 4 invoice (unchanged dates):');
    console.table([
      {
        invoice_id: PHASE_4_INVOICE_ID,
        ar: phase4Inv.invoice_ar_number,
        status: phase4Inv.status,
        amount: phase4Inv.amount,
        issue: phase4Inv.issue_ymd,
        due: phase4Inv.due_ymd,
        target_phase: parseTargetPhase(phase4Inv.remarks),
        next_remarks: nextRemarks.slice(0, 90) + (nextRemarks.length > 90 ? '…' : ''),
      },
    ]);

    console.log('\nPlanned changes:');
    console.log(`  • Remove dropped enrollment ${DROPPED_ENROLLMENT_ID} (phase ${droppedRow?.phase_number ?? 4})`);
    console.log(`  • INV-${PHASE_4_INVOICE_ID}: add ${DROP_WAIVE_FLAG} (dates unchanged)`);
    console.log('  • Expected Pay Now → phase 4 (INV-1015); phaseCtx paid → phase 5');

    if (!isApply) {
      console.log('\nRe-run with --apply to commit.');
      return;
    }

    await client.query('BEGIN');

    if (droppedRow) {
      await client.query(`DELETE FROM classstudentstbl WHERE classstudent_id = $1`, [
        DROPPED_ENROLLMENT_ID,
      ]);
      console.log(`✅ Removed dropped enrollment ${DROPPED_ENROLLMENT_ID}`);
    } else {
      console.log('ℹ️  Dropped enrollment row already absent — skipping delete');
    }

    await client.query(
      `UPDATE invoicestbl
       SET remarks = $1
       WHERE invoice_id = $2`,
      [nextRemarks, PHASE_4_INVOICE_ID]
    );
    console.log(`✅ INV-${PHASE_4_INVOICE_ID} remarks updated (${DROP_WAIVE_FLAG})`);

    await syncProgramPaymentStatusForInvoice(client, PHASE_4_INVOICE_ID);

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET is_active = true
       WHERE installmentinvoiceprofiles_id = $1`,
      [PROFILE_ID]
    );

    await client.query('COMMIT');

    const dropSync = await syncInstallmentDelinquencyDropsForProfile(client, PROFILE_ID);

    const profileAfter = (
      await client.query(
        `SELECT * FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      )
    ).rows[0];

    const afterPay = await simulatePayNowPhase(client, profileAfter);

    console.log('\n✅ Repair applied.');
    console.log('Delinquency sync:', dropSync);
    console.log('\nAfter enrollments:');
    console.table(await loadEnrollments(client));
    console.log('\nAfter plan mapping:');
    console.table(await loadPlanMapping(client, profileAfter));
    console.log('\nAfter Pay Now simulation:', afterPay);

    if (afterPay.payNowPhase !== ABSOLUTE_PHASE_4) {
      console.warn(
        `\n⚠️  Expected Pay Now on phase ${ABSOLUTE_PHASE_4}, got phase ${afterPay.payNowPhase}. Review manually.`
      );
    } else {
      console.log(`\n✅ Pay Now should appear on phase ${ABSOLUTE_PHASE_4} (INV-${PHASE_4_INVOICE_ID}).`);
    }
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
    console.error(err);
    process.exit(1);
  });
