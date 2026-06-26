/**
 * Jaliyah Callie Almendras — align installment invoice TARGET_PHASE slots so
 * display Phase 4 = paid (INV-1043) and Phase 5 = overdue / Pay Now (INV-1525).
 *
 * Root cause: INV-1525 (rejected payment) had TARGET_PHASE:4 while INV-1043
 * (paid) had no TARGET_PHASE, so 1525 occupied plan slot 3 (display Phase 4)
 * and 1043 fell to slot 4 (display Phase 5).
 *
 * Fix (--apply):
 *   - INV-1043 remarks → TARGET_PHASE:4 (absolute class phase 4)
 *   - INV-1525 remarks → TARGET_PHASE:5 (absolute class phase 5)
 *
 * Run:
 *   node backend/scripts/repairJaliyahAlmendrasInstallmentInvoiceSlots.js
 *   node backend/scripts/repairJaliyahAlmendrasInstallmentInvoiceSlots.js --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { loadInstallmentProfilePhaseChains } from '../lib/installmentPaymentEligibility.js';
import {
  mapPhaseChainsToLocalSlots,
} from '../utils/installmentPhaseRowMapping.js';
import { rewriteTargetPhaseInRemarks } from '../utils/installmentPhaseBillingSync.js';
import { resolveProfilePhaseStart } from '../utils/phaseInstallmentUtils.js';

const STUDENT_EMAIL = 'rinadeleon713@gmail.com';
const STUDENT_ID = 353;
const CLASS_ID = 47;
const PROFILE_ID = 150;

const PAID_PHASE4_INVOICE_ID = 1043;
const OVERDUE_PHASE5_INVOICE_ID = 1525;

/** Absolute class phases (profile phase_start = 2 → display phase = absolute). */
const TARGET_ABSOLUTE_PHASE = {
  [PAID_PHASE4_INVOICE_ID]: 4,
  [OVERDUE_PHASE5_INVOICE_ID]: 5,
};

const isApply = process.argv.includes('--apply');

async function loadPlanMapping(client, profile) {
  const { phaseChains } = await loadInstallmentProfilePhaseChains(client, PROFILE_ID);
  const mapped = mapPhaseChainsToLocalSlots(phaseChains, profile);
  const phaseStart = resolveProfilePhaseStart(profile);
  const rows = [];
  for (const [local, chain] of [...mapped.entries()].sort((a, b) => a[0] - b[0])) {
    const rep = chain.representative;
    rows.push({
      local_slot: local,
      display_phase: local + phaseStart - 1,
      invoice_id: rep.invoice_id,
      status: rep.status,
      ar: rep.invoice_ar_number,
      target_phase: parseTargetPhase(rep.remarks),
      issue: rep.issue_date,
      due: rep.due_date,
    });
  }
  return rows;
}

async function main() {
  console.log(
    `\nJaliyah Almendras — repair installment invoice phase slots${
      isApply ? ' (APPLY)' : ' (DRY RUN)'
    }\n`
  );

  const client = await getClient();
  const changes = [];

  try {
    const student = (
      await client.query(
        `SELECT user_id, full_name, email FROM userstbl
         WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))`,
        [STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student || Number(student.user_id) !== STUDENT_ID) {
      throw new Error(`Student ${STUDENT_EMAIL} not found`);
    }
    console.log('Student:', student.full_name, student.email);

    const profile = (
      await client.query(`SELECT * FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1`, [
        PROFILE_ID,
      ])
    ).rows[0];
    if (!profile || Number(profile.student_id) !== STUDENT_ID) {
      throw new Error(`Profile ${PROFILE_ID} not found`);
    }
    if (Number(profile.class_id) !== CLASS_ID) {
      throw new Error(`Expected class_id ${CLASS_ID}, got ${profile.class_id}`);
    }

    console.log('\nProfile phase_start:', profile.phase_start, '| generated_count:', profile.generated_count);

    console.log('\nBefore mapping:');
    console.table(await loadPlanMapping(client, profile));

    for (const [invoiceId, absolutePhase] of Object.entries(TARGET_ABSOLUTE_PHASE)) {
      const inv = (
        await client.query(
          `SELECT invoice_id, status, remarks, installmentinvoiceprofiles_id
           FROM invoicestbl WHERE invoice_id = $1`,
          [invoiceId]
        )
      ).rows[0];
      if (!inv) throw new Error(`Invoice ${invoiceId} not found`);
      if (Number(inv.installmentinvoiceprofiles_id) !== PROFILE_ID) {
        throw new Error(
          `Invoice ${invoiceId} is not on profile ${PROFILE_ID} (linked: ${inv.installmentinvoiceprofiles_id})`
        );
      }

      const current = parseTargetPhase(inv.remarks);
      if (current !== absolutePhase) {
        changes.push(
          `INV-${invoiceId}: TARGET_PHASE ${current ?? '—'} → ${absolutePhase} (${inv.status})`
        );
      }
    }

    if (changes.length === 0) {
      console.log('\nNo remark changes needed.');
    } else {
      console.log('\nPlanned changes:');
      changes.forEach((c) => console.log(`  • ${c}`));
    }

    if (isApply && changes.length > 0) {
      await client.query('BEGIN');
      for (const [invoiceId, absolutePhase] of Object.entries(TARGET_ABSOLUTE_PHASE)) {
        const inv = (
          await client.query(`SELECT invoice_id, remarks FROM invoicestbl WHERE invoice_id = $1`, [
            invoiceId,
          ])
        ).rows[0];
        const current = parseTargetPhase(inv?.remarks);
        if (current !== absolutePhase) {
          const nextRemarks = rewriteTargetPhaseInRemarks(inv.remarks, absolutePhase);
          await client.query(`UPDATE invoicestbl SET remarks = $1 WHERE invoice_id = $2`, [
            nextRemarks,
            invoiceId,
          ]);
        }
      }
      await client.query('COMMIT');

      const profileAfter = (
        await client.query(`SELECT * FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1`, [
          PROFILE_ID,
        ])
      ).rows[0];
      console.log('\nAfter mapping:');
      console.table(await loadPlanMapping(client, profileAfter));
      console.log('\n✅ Done. Refresh Student History → Invoices.');
    } else if (!isApply && changes.length > 0) {
      console.log('\nExpected after apply:');
      console.log('  • Display Phase 4 → INV-1043 Paid');
      console.log('  • Display Phase 5 → INV-1525 Overdue (Pay Now)');
      console.log('\nRe-run with --apply to write TARGET_PHASE remarks.');
    }

    console.log('\nExpected UI:');
    console.log('  • Phase 4 — Paid (INV-1043)');
    console.log('  • Phase 5 — Overdue + Pay Now (INV-1525)');
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
