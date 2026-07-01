/**
 * Repair Kirsten Celesse J. Mahinay — missed phase 5 installment (June 25, 2026).
 *
 * Late-start profile (phase_start NULL, invoices on absolute phases 2–4). Scheduler
 * lagged at phase 4 (May cycle) while queue jumped to Jul 25 without creating phase 5.
 *
 * Steps:
 *  1. Sync generated_count to next unbilled local slot (3 → 4 so phase 5 bills)
 *  2. Reset queue to Jun 25 / Jul 01 from canonical schedule
 *  3. Optionally generate phase 5 invoice (--generate)
 *  4. Verify queue → Jul 25 / Aug 01 after generation
 *
 * Run:
 *   node backend/scripts/repairKirstenMahinayMissedPhase5Generation.js
 *   node backend/scripts/repairKirstenMahinayMissedPhase5Generation.js --apply
 *   node backend/scripts/repairKirstenMahinayMissedPhase5Generation.js --apply --generate
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
import { syncInstallmentGeneratedCountToNextUnbilled, loadActiveEnrollmentAbsolutePhases, findNextUnbilledLocalPhase, generatedCountForNextLocalPhase, resolveFirstBillableAbsolutePhase } from '../utils/installmentPhaseBillingSync.js';
import { loadInstallmentProfilePhaseChains } from '../lib/installmentPaymentEligibility.js';
import { mapPhaseChainsToLocalSlots } from '../utils/installmentPhaseRowMapping.js';

const STUDENT_EMAIL = 'cherryjaodmd@gmail.com';
const PROFILE_ID = 123;
const TARGET_ABSOLUTE_PHASE = 5;
const TARGET_GENERATION_DATE = '2026-06-25';
const TARGET_ISSUE_DATE = '2026-06-25';
const TARGET_DUE_DATE = '2026-07-05';
const REPAIR_NOTE = 'Ops repair — Kirsten Mahinay missed phase 5 (June 25, 2026)';

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

/** Restore generated_count from paid installment invoice chains when sync regressed it. */
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

function profileForSchedule(row) {
  return {
    installmentinvoiceprofiles_id: row.installmentinvoiceprofiles_id,
    class_id: row.class_id,
    phase_start: row.phase_start,
    total_phases: row.total_phases,
    generated_count: row.generated_count,
  };
}

function queueDatesFromSchedule(sched) {
  return {
    next_generation_date: sched?.current_generation_date || null,
    next_invoice_month: sched?.current_invoice_month || null,
  };
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
      expected_next_gen: sched?.current_generation_date ?? '—',
      expected_next_month: sched?.current_invoice_month ?? '—',
      expected_issue: sched?.current_issue_date ?? '—',
      expected_due: sched?.current_due_date ?? '—',
    },
  ]);
}

async function main() {
  console.log(
    `\nKirsten Mahinay — phase 5 repair${isApply ? ' (APPLY)' : ' (DRY RUN)'}${
      isGenerate ? ' + GENERATE' : ''
    }\n`
  );

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

    printState('BEFORE', row, await buildPhaseInstallmentSchedule({
      db: client,
      profile: profileForSchedule(row),
      generatedCountOverride: parseInt(row.generated_count || 0, 10),
    }));

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

    const sched = await buildPhaseInstallmentSchedule({
      db: client,
      profile: profileForSchedule({ ...row, generated_count: countAfterSync }),
      generatedCountOverride: countAfterSync,
    });

    if (Number(sched?.current_phase_number) !== TARGET_ABSOLUTE_PHASE) {
      throw new Error(
        `Schedule phase is ${sched?.current_phase_number}, expected ${TARGET_ABSOLUTE_PHASE}`
      );
    }

  const { next_generation_date: expectedGen, next_invoice_month: expectedMonth } =
      queueDatesFromSchedule(sched);

    console.log('\nTarget phase 5 billing (after count sync):');
    console.table([
      {
        phase: sched.current_phase_number,
        issue: sched.current_issue_date,
        due: sched.current_due_date,
        next_gen: expectedGen,
        next_month: expectedMonth,
      },
    ]);

    const storedGen = ymd(row.next_generation_date);
    const storedMonth = ymd(row.next_invoice_month);
    const needsStatusFix =
      parseInt(countAfterSync, 10) < parseInt(row.total_phases || 0, 10) &&
      row.ii_status === 'Generated';
    const needsGenFix = Boolean(expectedGen && storedGen !== expectedGen);
    const needsMonthFix = Boolean(expectedMonth && storedMonth !== expectedMonth);
    const needsCountFix = syncPreview.stored !== countAfterSync;
    const needsQueueRepair = needsStatusFix || needsGenFix || needsMonthFix;
    const needsRepair = needsQueueRepair || needsCountFix;

    console.log('\nPlanned repairs:');
    if (!needsRepair && phase5Before) {
      console.log('  • No changes needed.');
    } else {
      if (needsCountFix) {
        console.log(`  • generated_count: ${row.generated_count} → ${countAfterSync}`);
      }
      if (needsStatusFix) console.log(`  • status: ${row.ii_status} → NULL`);
      if (needsGenFix) console.log(`  • next_generation_date: ${storedGen} → ${expectedGen}`);
      if (needsMonthFix) console.log(`  • next_invoice_month: ${storedMonth} → ${expectedMonth}`);
      if (isGenerate && !phase5Before) {
        console.log(`  • Generate phase ${TARGET_ABSOLUTE_PHASE} invoice`);
        console.log(`    Issue ${TARGET_ISSUE_DATE} | Due ${TARGET_DUE_DATE}`);
      }
    }

    if (!isApply) {
      console.log('\nRe-run with --apply to write fixes.');
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

    const schedForQueue = await buildPhaseInstallmentSchedule({
      db: client,
      profile: profileForSchedule(workingRow),
      generatedCountOverride: parseInt(workingRow.generated_count || 0, 10),
    });
    const queueFix = queueDatesFromSchedule(schedForQueue);

    if (needsQueueRepair) {
      await client.query(
        `UPDATE installmentinvoicestbl
         SET status = NULL, next_generation_date = $1, next_invoice_month = $2
         WHERE installmentinvoicedtl_id = $3`,
        [queueFix.next_generation_date, queueFix.next_invoice_month, row.installmentinvoicedtl_id]
      );
      console.log('✅ Queue dates updated.');
    }

    let generated = null;
    if (isGenerate && !phase5Before) {
      await client.query('COMMIT');
      console.log('\n✅ Queue repair committed. Generating invoice...');

      const fresh = await loadProfileRow(client);
      const installmentInvoice = {
        installmentinvoicedtl_id: fresh.installmentinvoicedtl_id,
        installmentinvoiceprofiles_id: fresh.installmentinvoiceprofiles_id,
        next_generation_date: fresh.next_generation_date,
        next_invoice_month: fresh.next_invoice_month,
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
    } else {
      await client.query('COMMIT');
    }

    const rowAfter = await loadProfileRow(client);
    const schedAfter = await buildPhaseInstallmentSchedule({
      db: client,
      profile: profileForSchedule(rowAfter),
      generatedCountOverride: parseInt(rowAfter.generated_count || 0, 10),
    });
    printState('AFTER', rowAfter, schedAfter);

    const phase5After = await loadPhaseInvoice(client, TARGET_ABSOLUTE_PHASE);
    if (phase5After) {
      const tp = parseTargetPhase(phase5After.remarks);
      console.log('\nPhase 5 invoice:');
      console.table([{ ...phase5After, target_phase: tp }]);
    }

    const postQueue = queueDatesFromSchedule(schedAfter);
    console.log('\nInstallment Invoice Logs should show:');
    console.table([
      {
        next_generation_date: ymd(rowAfter.next_generation_date),
        next_invoice_month: ymd(rowAfter.next_invoice_month),
        schedule_says_next_gen: postQueue.next_generation_date,
        schedule_says_next_month: postQueue.next_invoice_month,
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
