/**
 * Repair Margarette Celine P. Endico — missed phase 5 installment (June 25, 2026).
 *
 * Profile #436 (phase_start=4, Playgroup installment on SOMO_Playgroup_TTh).
 * Phase 4 paid (INV-1439); queue jumped to Sep 25 / Oct 01 without creating
 * phase 5. Canonical schedule is poisoned by phase 4's Aug 26 issue date, so this
 * script FORCES the ops-correct cycle:
 *   - Phase 5 issue / generation: 2026-06-25, due 2026-07-05
 *   - Queue before generate: next_generation_date 2026-06-25, next_invoice_month 2026-07-01
 *   - After generate: next_generation_date 2026-07-25, next_invoice_month 2026-08-01
 *
 * Run (from backend/):
 *   node scripts/repairMargaretEndicoMissedPhase5Generation.js --production
 *   node scripts/repairMargaretEndicoMissedPhase5Generation.js --production --apply
 *   node scripts/repairMargaretEndicoMissedPhase5Generation.js --production --apply --generate
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import {
  buildPhaseInstallmentSchedule,
  isPhaseInstallmentProfile,
} from '../utils/phaseInstallmentUtils.js';
import { formatYmdLocal } from '../utils/dateUtils.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { generateInvoiceFromInstallment } from '../utils/installmentInvoiceGenerator.js';
import {
  syncInstallmentGeneratedCountToNextUnbilled,
  loadActiveEnrollmentAbsolutePhases,
  findNextUnbilledLocalPhase,
  generatedCountForNextLocalPhase,
  resolveFirstBillableAbsolutePhase,
} from '../utils/installmentPhaseBillingSync.js';
import { loadInstallmentProfilePhaseChains } from '../lib/installmentPaymentEligibility.js';
import { mapPhaseChainsToLocalSlots } from '../utils/installmentPhaseRowMapping.js';

const STUDENT_EMAIL = 'endico.kiel@yahoo.com';
const PROFILE_ID = 436;
const TARGET_ABSOLUTE_PHASE = 5;

/** Forced queue + invoice dates (ops correction; schedule alone would use Aug 25). */
const TARGET_GENERATION_DATE = '2026-06-25';
const TARGET_INVOICE_MONTH = '2026-07-01';
const TARGET_ISSUE_DATE = '2026-06-25';
const TARGET_DUE_DATE = '2026-07-05';
const AFTER_GENERATE_NEXT_GEN = '2026-07-25';
const AFTER_GENERATE_NEXT_MONTH = '2026-08-01';

const REPAIR_NOTE =
  'Ops repair — Margaret Endico missed phase 5 (June 25 / July 5); queue → Jul 25 / Aug 01';

const args = new Set(process.argv.slice(2));
const isApply = args.has('--apply');
const isGenerate = args.has('--generate');

const ymd = (value) => {
  if (!value) return null;
  return formatYmdLocal(value).slice(0, 10);
};

async function loadProfileRow(client) {
  const res = await client.query(
    `SELECT ip.installmentinvoiceprofiles_id, ip.student_id, ip.class_id, ip.branch_id,
            ip.phase_start, ip.total_phases, ip.generated_count, ip.is_active,
            ip.downpayment_paid, ip.downpayment_invoice_id, ip.amount, ip.frequency,
            ip.description,
            ii.installmentinvoicedtl_id, ii.next_generation_date, ii.next_invoice_month,
            ii.status AS ii_status, ii.frequency AS ii_frequency,
            ii.total_amount_including_tax, ii.total_amount_excluding_tax,
            u.full_name AS student_name, u.email AS student_email,
            c.class_name
     FROM installmentinvoiceprofilestbl ip
     INNER JOIN installmentinvoicestbl ii
       ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
     INNER JOIN userstbl u ON u.user_id = ip.student_id
     LEFT JOIN classestbl c ON c.class_id = ip.class_id
     WHERE ip.installmentinvoiceprofiles_id = $1`,
    [PROFILE_ID]
  );
  return res.rows[0] || null;
}

async function loadPhaseInvoice(client, absolutePhase) {
  const res = await client.query(
    `SELECT i.invoice_id, i.status,
            TO_CHAR(TIMEZONE('Asia/Manila', i.issue_date), 'YYYY-MM-DD') AS issue_ymd,
            TO_CHAR(TIMEZONE('Asia/Manila', i.due_date), 'YYYY-MM-DD') AS due_ymd,
            i.remarks
     FROM invoicestbl i
     WHERE i.installmentinvoiceprofiles_id = $1
       AND i.remarks ILIKE $2
     ORDER BY i.invoice_id DESC
     LIMIT 1`,
    [PROFILE_ID, `%TARGET_PHASE:${absolutePhase}%`]
  );
  return res.rows[0] || null;
}

function profileForSchedule(row) {
  return {
    installmentinvoiceprofiles_id: row.installmentinvoiceprofiles_id,
    class_id: row.class_id,
    phase_start: row.phase_start,
    total_phases: row.total_phases,
    generated_count: row.generated_count,
    next_generation_date: row.next_generation_date,
  };
}

async function previewSyncedCount(client, row) {
  const { phaseChains } = await loadInstallmentProfilePhaseChains(
    client,
    row.installmentinvoiceprofiles_id
  );
  const profile = profileForSchedule(row);
  const activeEnrollment = await loadActiveEnrollmentAbsolutePhases(
    client,
    row.student_id,
    row.class_id
  );
  const chainByLocal = mapPhaseChainsToLocalSlots(phaseChains, profile);
  const firstBillable = resolveFirstBillableAbsolutePhase(profile, activeEnrollment, phaseChains);
  const nextLocal = findNextUnbilledLocalPhase(
    chainByLocal,
    row.total_phases != null ? parseInt(row.total_phases, 10) : null,
    profile,
    activeEnrollment,
    firstBillable
  );
  const syncedCount =
    nextLocal != null
      ? generatedCountForNextLocalPhase(nextLocal)
      : parseInt(row.generated_count || 0, 10);
  return { syncedCount, nextLocal, stored: parseInt(row.generated_count || 0, 10) };
}

async function restoreGeneratedCountFromInvoices(client, row) {
  const { phaseChains } = await loadInstallmentProfilePhaseChains(
    client,
    row.installmentinvoiceprofiles_id
  );
  const active = (phaseChains || []).filter(
    (c) => c?.representative?.status !== 'Cancelled'
  );
  const installmentChains = active.filter(
    (c) =>
      Number(c.representative?.invoice_id) !== Number(row.downpayment_invoice_id)
  );
  const fromInvoices = installmentChains.length;
  const stored = parseInt(row.generated_count || 0, 10);
  if (fromInvoices > 0 && stored < fromInvoices) {
    await client.query(
      `UPDATE installmentinvoiceprofilestbl SET generated_count = $1 WHERE installmentinvoiceprofiles_id = $2`,
      [fromInvoices, row.installmentinvoiceprofiles_id]
    );
    return { restored: true, from: stored, to: fromInvoices };
  }
  return { restored: false, stored, fromInvoices };
}

function printState(label, row, sched) {
  console.log(`\n${label}:`);
  console.table([
    {
      profile_id: row.installmentinvoiceprofiles_id,
      student: row.student_name,
      email: row.student_email,
      class: row.class_name,
      phase_start: row.phase_start ?? 'NULL',
      generated_count: row.generated_count,
      total_phases: row.total_phases,
      queue_status: row.ii_status ?? '—',
      stored_next_gen: ymd(row.next_generation_date),
      stored_next_month: ymd(row.next_invoice_month),
      schedule_phase: sched?.current_phase_number ?? '—',
      schedule_issue: sched?.current_issue_date ?? '—',
      schedule_due: sched?.current_due_date ?? '—',
    },
  ]);
}

async function main() {
  console.log(
    `\nMargaret Endico — phase 5 repair${isApply ? ' (APPLY)' : ' (DRY RUN)'}${
      isGenerate ? ' + GENERATE' : ''
    }\n`
  );
  console.log(`Note: ${REPAIR_NOTE}\n`);

  const client = await getClient();

  try {
    const row = await loadProfileRow(client);
    if (!row) throw new Error(`Profile ${PROFILE_ID} not found`);
    if (row.student_email?.toLowerCase() !== STUDENT_EMAIL.toLowerCase()) {
      throw new Error(
        `Profile ${PROFILE_ID} email mismatch (expected ${STUDENT_EMAIL}, got ${row.student_email})`
      );
    }

    if (!isPhaseInstallmentProfile(profileForSchedule(row))) {
      throw new Error('Profile is not class-linked');
    }

    const phase5Before = await loadPhaseInvoice(client, TARGET_ABSOLUTE_PHASE);
    if (phase5Before) {
      console.log('\nPhase 5 invoice already exists:');
      console.table([phase5Before]);
      console.log('\nNothing to generate. Re-run with --apply only if queue dates need sync.');
    }

    const schedBefore = await buildPhaseInstallmentSchedule({
      db: client,
      profile: profileForSchedule(row),
      generatedCountOverride: parseInt(row.generated_count || 0, 10),
      ignoreStoredQueueAnchor: true,
    });
    printState('BEFORE', row, schedBefore);

    if (schedBefore?.current_issue_date && schedBefore.current_issue_date !== TARGET_ISSUE_DATE) {
      console.log(
        `\n⚠ Canonical schedule would bill phase ${schedBefore.current_phase_number} on ` +
          `${schedBefore.current_issue_date} / due ${schedBefore.current_due_date} ` +
          `(poisoned by earlier invoice anchors). Forcing ops dates instead.`
      );
    }

    const syncPreview = await previewSyncedCount(client, row);
    const countAfterSync = syncPreview.syncedCount;

    console.log('\nGenerated count sync (read-only preview):');
    console.table([
      {
        stored_generated_count: syncPreview.stored,
        synced_generated_count: countAfterSync,
        next_local_slot: syncPreview.nextLocal,
        will_change: syncPreview.stored !== countAfterSync ? 'yes' : 'no',
      },
    ]);

    const schedForced = await buildPhaseInstallmentSchedule({
      db: client,
      profile: profileForSchedule({
        ...row,
        generated_count: countAfterSync,
        next_generation_date: TARGET_GENERATION_DATE,
      }),
      generatedCountOverride: countAfterSync,
      generationAnchorYmd: TARGET_GENERATION_DATE,
      ignoreStoredQueueAnchor: true,
    });

    if (Number(schedForced?.current_phase_number) !== TARGET_ABSOLUTE_PHASE) {
      throw new Error(
        `Schedule phase is ${schedForced?.current_phase_number}, expected ${TARGET_ABSOLUTE_PHASE}`
      );
    }

    console.log('\nForced phase 5 billing (ops correction):');
    console.table([
      {
        phase: schedForced.current_phase_number,
        forced_next_gen: TARGET_GENERATION_DATE,
        forced_next_month: TARGET_INVOICE_MONTH,
        expected_issue: TARGET_ISSUE_DATE,
        expected_due: TARGET_DUE_DATE,
        schedule_with_forced_anchor_issue: schedForced.current_issue_date,
        schedule_with_forced_anchor_due: schedForced.current_due_date,
        after_generate_next_gen: AFTER_GENERATE_NEXT_GEN,
        after_generate_next_month: AFTER_GENERATE_NEXT_MONTH,
      },
    ]);

    const storedGen = ymd(row.next_generation_date);
    const storedMonth = ymd(row.next_invoice_month);
    const needsStatusFix =
      parseInt(countAfterSync, 10) < parseInt(row.total_phases || 0, 10) &&
      row.ii_status === 'Generated';
    const needsGenFix = storedGen !== TARGET_GENERATION_DATE;
    const needsMonthFix = storedMonth !== TARGET_INVOICE_MONTH;
    const needsCountFix = syncPreview.stored !== countAfterSync;
    const needsQueueRepair = needsStatusFix || needsGenFix || needsMonthFix;
    const needsRepair = needsQueueRepair || needsCountFix || (!phase5Before && isGenerate);

    console.log('\nPlanned repairs:');
    if (!needsRepair && phase5Before) {
      console.log('  • No changes needed.');
    } else {
      if (needsCountFix) {
        console.log(`  • generated_count: ${row.generated_count} → ${countAfterSync}`);
      }
      if (needsStatusFix) console.log(`  • status: ${row.ii_status} → NULL`);
      if (needsGenFix) {
        console.log(`  • next_generation_date: ${storedGen} → ${TARGET_GENERATION_DATE}`);
      }
      if (needsMonthFix) {
        console.log(`  • next_invoice_month: ${storedMonth} → ${TARGET_INVOICE_MONTH}`);
      }
      if (isGenerate && !phase5Before) {
        console.log(`  • Generate phase ${TARGET_ABSOLUTE_PHASE} invoice`);
        console.log(`    Issue ${TARGET_ISSUE_DATE} | Due ${TARGET_DUE_DATE}`);
        console.log(
          `    Then queue should advance to ${AFTER_GENERATE_NEXT_GEN} / ${AFTER_GENERATE_NEXT_MONTH}`
        );
      } else if (!phase5Before) {
        console.log('  • (Add --generate with --apply to create the missed phase 5 invoice)');
      }
    }

    if (!isApply) {
      console.log('\nDry run only. Re-run with --apply to write fixes.');
      if (!phase5Before) {
        console.log('Add --generate to create the missed phase 5 invoice.');
      }
      return;
    }

    await client.query('BEGIN');

    const restored = await restoreGeneratedCountFromInvoices(client, row);
    if (restored.restored) {
      console.log(
        `\n✅ Restored generated_count: ${restored.from} → ${restored.to} (from invoice chains)`
      );
    }

    let workingRow = await loadProfileRow(client);
    const syncResult = await syncInstallmentGeneratedCountToNextUnbilled(client, PROFILE_ID);
    if (syncResult?.changed) {
      console.log(
        `✅ generated_count synced: ${syncResult.previous_generated_count} → ${syncResult.generated_count}`
      );
      workingRow = await loadProfileRow(client);
    } else if (needsCountFix) {
      await client.query(
        `UPDATE installmentinvoiceprofilestbl SET generated_count = $1 WHERE installmentinvoiceprofiles_id = $2`,
        [countAfterSync, PROFILE_ID]
      );
      console.log(`\n✅ generated_count set to ${countAfterSync}.`);
      workingRow = await loadProfileRow(client);
    }

    // Always force ops queue dates before generate (do not trust poisoned schedule anchors).
    await client.query(
      `UPDATE installmentinvoicestbl
       SET status = NULL, next_generation_date = $1::date, next_invoice_month = $2::date
       WHERE installmentinvoicedtl_id = $3`,
      [TARGET_GENERATION_DATE, TARGET_INVOICE_MONTH, workingRow.installmentinvoicedtl_id]
    );
    console.log(
      `✅ Queue forced to ${TARGET_GENERATION_DATE} / ${TARGET_INVOICE_MONTH}.`
    );

    let generated = null;
    if (isGenerate && !phase5Before) {
      await client.query('COMMIT');
      console.log('\n✅ Queue repair committed. Generating invoice...');

      const fresh = await loadProfileRow(client);
      const installmentInvoice = {
        installmentinvoicedtl_id: fresh.installmentinvoicedtl_id,
        installmentinvoiceprofiles_id: fresh.installmentinvoiceprofiles_id,
        next_generation_date: TARGET_GENERATION_DATE,
        next_invoice_month: TARGET_INVOICE_MONTH,
        frequency: fresh.ii_frequency || fresh.frequency,
        total_amount_including_tax: fresh.total_amount_including_tax,
        total_amount_excluding_tax: fresh.total_amount_excluding_tax,
        status: fresh.ii_status,
      };
      const profilePayload = {
        student_id: fresh.student_id,
        branch_id: fresh.branch_id,
        package_id: null,
        amount: fresh.amount,
        frequency: fresh.frequency,
        description: fresh.description,
        generated_count: fresh.generated_count,
        class_id: fresh.class_id,
        total_phases: fresh.total_phases,
        phase_start: fresh.phase_start,
        next_generation_date: TARGET_GENERATION_DATE,
      };

      generated = await generateInvoiceFromInstallment(installmentInvoice, profilePayload);
      console.log('\n✅ Invoice generated:');
      console.table([
        {
          invoice_id: generated.invoice_id,
          phase: generated.phase_number,
          issue_date: generated.issue_date,
          due_date: generated.due_date,
          amount: generated.amount,
          next_generation_date: generated.next_generation_date,
        },
      ]);

      // Ensure post-generate queue matches ops expectation (generator should already do this).
      const afterRow = await loadProfileRow(client);
      const afterGen = ymd(afterRow.next_generation_date);
      const afterMonth = ymd(afterRow.next_invoice_month);
      if (afterGen !== AFTER_GENERATE_NEXT_GEN || afterMonth !== AFTER_GENERATE_NEXT_MONTH) {
        await client.query(
          `UPDATE installmentinvoicestbl
           SET status = NULL, next_generation_date = $1::date, next_invoice_month = $2::date
           WHERE installmentinvoicedtl_id = $3`,
          [AFTER_GENERATE_NEXT_GEN, AFTER_GENERATE_NEXT_MONTH, afterRow.installmentinvoicedtl_id]
        );
        console.log(
          `✅ Post-generate queue corrected to ${AFTER_GENERATE_NEXT_GEN} / ${AFTER_GENERATE_NEXT_MONTH} ` +
            `(was ${afterGen} / ${afterMonth}).`
        );
      }

      // If generator used wrong issue/due (unlikely with forced anchor), correct invoice dates.
      const phase5 = await loadPhaseInvoice(client, TARGET_ABSOLUTE_PHASE);
      if (
        phase5 &&
        (phase5.issue_ymd !== TARGET_ISSUE_DATE || phase5.due_ymd !== TARGET_DUE_DATE)
      ) {
        await client.query(
          `UPDATE invoicestbl
           SET issue_date = ($1::date + TIME '12:00'),
               due_date = ($2::date + TIME '12:00')
           WHERE invoice_id = $3`,
          [TARGET_ISSUE_DATE, TARGET_DUE_DATE, phase5.invoice_id]
        );
        console.log(
          `✅ Phase 5 invoice dates corrected to issue ${TARGET_ISSUE_DATE} / due ${TARGET_DUE_DATE} ` +
            `(was ${phase5.issue_ymd} / ${phase5.due_ymd}).`
        );
      }
    } else {
      await client.query('COMMIT');
    }

    const rowAfter = await loadProfileRow(client);
    const schedAfter = await buildPhaseInstallmentSchedule({
      db: client,
      profile: profileForSchedule(rowAfter),
      generatedCountOverride: parseInt(rowAfter.generated_count || 0, 10),
      generationAnchorYmd: ymd(rowAfter.next_generation_date),
      ignoreStoredQueueAnchor: true,
    });
    printState('AFTER', rowAfter, schedAfter);

    const phase5After = await loadPhaseInvoice(client, TARGET_ABSOLUTE_PHASE);
    if (phase5After) {
      const tp = parseTargetPhase(phase5After.remarks);
      console.log('\nPhase 5 invoice:');
      console.table([{ ...phase5After, target_phase: tp }]);
    }

    console.log('\nInstallment Invoice Logs should show:');
    console.table([
      {
        next_generation_date: ymd(rowAfter.next_generation_date),
        next_invoice_month: ymd(rowAfter.next_invoice_month),
        expected_next_gen: phase5After ? AFTER_GENERATE_NEXT_GEN : TARGET_GENERATION_DATE,
        expected_next_month: phase5After ? AFTER_GENERATE_NEXT_MONTH : TARGET_INVOICE_MONTH,
      },
    ]);

    console.log(`\n${REPAIR_NOTE}`);
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
