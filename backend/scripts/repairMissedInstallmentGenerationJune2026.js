/**
 * Bulk repair — students who missed installment auto-generation on June 25, 2026.
 *
 * 1. Finds eligible class-linked profiles due in 2026-06 with no phase invoice that month.
 * 2. Resets installmentinvoicestbl queue dates to match buildPhaseInstallmentSchedule
 *    (same fields as Installment Invoice Logs: next_generation_date, next_invoice_month).
 * 3. Optionally generates the missed phase invoice (--generate).
 * 4. After generation, verifies/syncs queue to the next cycle (e.g. Jul 25 / Aug 01)
 *    so the Installment Invoice Logs page matches the scheduler.
 *
 * Queue semantics (class-linked / recurring):
 *   - Before missed invoice: next_generation_date = current_generation_date (e.g. 2026-06-25)
 *   - After missed invoice:  next_generation_date = current_generation_date at new count (e.g. 2026-07-25)
 *                           next_invoice_month   = current_invoice_month (e.g. 2026-08-01)
 *
 * Usage:
 *   node backend/scripts/repairMissedInstallmentGenerationJune2026.js
 *   node backend/scripts/repairMissedInstallmentGenerationJune2026.js --apply
 *   node backend/scripts/repairMissedInstallmentGenerationJune2026.js --apply --generate
 *   node backend/scripts/repairMissedInstallmentGenerationJune2026.js --apply --generate --skip-profile-ids 142
 *   node backend/scripts/repairMissedInstallmentGenerationJune2026.js --limit 5
 */

import '../config/loadEnv.js';
import { writeFileSync } from 'fs';
import { getClient } from '../config/database.js';
import {
  buildPhaseInstallmentSchedule,
  isPhaseInstallmentProfile,
} from '../utils/phaseInstallmentUtils.js';
import { formatYmdLocal } from '../utils/dateUtils.js';
import { generateInvoiceFromInstallment } from '../utils/installmentInvoiceGenerator.js';

const TARGET_MONTH = '2026-06';
const TARGET_GENERATION_DATE = '2026-06-25';
const MONTH_START = '2026-06-01';
const MONTH_END_EXCLUSIVE = '2026-07-01';
const REPAIR_NOTE = 'Ops bulk repair — missed June 25, 2026 installment generation';

function parseArgs() {
  const argv = process.argv.slice(2);
  let apply = false;
  let generate = false;
  let limit = null;
  let csvPath = null;
  let skipProfileIds = new Set();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') {
      apply = true;
    } else if (arg === '--generate') {
      generate = true;
    } else if (arg === '--limit' && argv[i + 1]) {
      limit = Number(argv[++i]);
    } else if (arg === '--skip-profile-ids' && argv[i + 1]) {
      skipProfileIds = new Set(
        String(argv[++i])
          .split(',')
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isFinite(n))
      );
    } else if (arg === '--csv' && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      csvPath = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Bulk repair missed June 25, 2026 installment generation.

  --apply                  Write queue fixes (default: dry-run)
  --generate               After repair, create missed phase invoices (requires --apply)
  --limit N                Process only first N missed profiles
  --skip-profile-ids 1,2   Skip profile IDs (e.g. already repaired pilot)
  --csv path               Export repair plan / results to CSV

Examples:
  node backend/scripts/repairMissedInstallmentGenerationJune2026.js
  node backend/scripts/repairMissedInstallmentGenerationJune2026.js --apply
  node backend/scripts/repairMissedInstallmentGenerationJune2026.js --apply --generate
  node backend/scripts/repairMissedInstallmentGenerationJune2026.js --apply --generate --skip-profile-ids 142
`);
      process.exit(0);
    }
  }

  if (generate && !apply) {
    throw new Error('--generate requires --apply');
  }

  return { apply, generate, limit, skipProfileIds, csvPath };
}

const ymd = (value) => {
  if (!value) return null;
  return formatYmdLocal(value).slice(0, 10);
};

const inTargetMonth = (dateYmd, monthYm) =>
  Boolean(dateYmd && String(dateYmd).slice(0, 7) === monthYm);

function classifyMissReason(row, sched, invoiceInMonth) {
  if (!row.is_active) return 'profile_inactive';
  if (row.downpayment_invoice_id && !row.downpayment_paid) return 'downpayment_unpaid';
  const total = row.total_phases != null ? parseInt(row.total_phases, 10) : null;
  const generated = parseInt(row.generated_count || 0, 10);
  if (total != null && generated >= total) return 'all_phases_generated';
  if (!sched) return 'not_class_linked';
  if (sched.is_last_phase) return 'schedule_last_phase';
  const schedGen = sched.current_generation_date;
  const schedIssue = sched.current_issue_date;
  if (!inTargetMonth(schedGen, TARGET_MONTH) && !inTargetMonth(schedIssue, TARGET_MONTH)) {
    return 'not_due_this_month';
  }
  if (row.ii_status === 'Generated') return 'queue_status_generated_blocks_scheduler';
  const storedGen = ymd(row.next_generation_date);
  if (storedGen && schedGen && storedGen > schedGen) {
    return `next_generation_date_in_future (${storedGen})`;
  }
  if (invoiceInMonth) return 'invoice_exists_in_month_review_phase';
  if (!row.installmentinvoicedtl_id) return 'missing_installmentinvoicestbl_row';
  return 'invoice_not_generated';
}

async function fetchProfiles(client) {
  const res = await client.query(
    `SELECT
       ip.installmentinvoiceprofiles_id,
       ip.student_id,
       ip.class_id,
       ip.branch_id,
       ip.phase_start,
       ip.total_phases,
       ip.generated_count,
       ip.is_active,
       ip.downpayment_paid,
       ip.downpayment_invoice_id,
       ip.amount,
       ip.frequency,
       ip.description,
       ii.installmentinvoicedtl_id,
       ii.next_generation_date,
       ii.next_invoice_month,
       ii.status AS ii_status,
       ii.frequency AS ii_frequency,
       ii.total_amount_including_tax,
       ii.total_amount_excluding_tax,
       u.full_name AS student_name,
       u.email AS student_email,
       c.class_name,
       COALESCE(b.branch_nickname, b.branch_name) AS branch_name
     FROM installmentinvoiceprofilestbl ip
     LEFT JOIN installmentinvoicestbl ii
       ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
     LEFT JOIN userstbl u ON u.user_id = ip.student_id
     LEFT JOIN classestbl c ON c.class_id = ip.class_id
     LEFT JOIN branchestbl b ON b.branch_id = ip.branch_id
     WHERE ip.class_id IS NOT NULL
     ORDER BY u.full_name NULLS LAST, ip.installmentinvoiceprofiles_id`
  );
  return res.rows;
}

async function loadPhaseInvoicesInMonthBatch(client) {
  const res = await client.query(
    `SELECT DISTINCT ON (i.installmentinvoiceprofiles_id)
       i.installmentinvoiceprofiles_id AS profile_id,
       i.invoice_id,
       i.status,
       TO_CHAR(TIMEZONE('Asia/Manila', i.issue_date), 'YYYY-MM-DD') AS issue_ymd
     FROM invoicestbl i
     INNER JOIN installmentinvoiceprofilestbl ip
       ON ip.installmentinvoiceprofiles_id = i.installmentinvoiceprofiles_id
     WHERE TIMEZONE('Asia/Manila', i.issue_date)::date >= $1::date
       AND TIMEZONE('Asia/Manila', i.issue_date)::date < $2::date
       AND (
         ip.downpayment_invoice_id IS NULL
         OR COALESCE(i.invoice_chain_root_id, i.invoice_id) <> ip.downpayment_invoice_id::integer
       )
     ORDER BY i.installmentinvoiceprofiles_id, i.invoice_id DESC`,
    [MONTH_START, MONTH_END_EXCLUSIVE]
  );
  const map = new Map();
  for (const row of res.rows || []) {
    map.set(Number(row.profile_id), row);
  }
  return map;
}

async function loadProfileRow(client, profileId) {
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
     LEFT JOIN userstbl u ON u.user_id = ip.student_id
     LEFT JOIN classestbl c ON c.class_id = ip.class_id
     WHERE ip.installmentinvoiceprofiles_id = $1`,
    [profileId]
  );
  return res.rows[0] || null;
}

/** Profile for canonical billing schedule (ignores stored queue — use for missed-invoice detection). */
function profileForCanonicalSchedule(row) {
  return {
    installmentinvoiceprofiles_id: row.installmentinvoiceprofiles_id,
    class_id: row.class_id,
    phase_start: row.phase_start,
    total_phases: row.total_phases,
    generated_count: row.generated_count,
  };
}

/** Profile including stored queue row (use only after queue is known correct). */
function profileForSchedule(row) {
  return {
    ...profileForCanonicalSchedule(row),
    next_generation_date: row.next_generation_date,
    next_invoice_month: row.next_invoice_month,
  };
}

async function buildCanonicalSchedule(client, row, generatedCountOverride) {
  const count =
    generatedCountOverride != null
      ? generatedCountOverride
      : parseInt(row.generated_count || 0, 10);
  return buildPhaseInstallmentSchedule({
    db: client,
    profile: profileForCanonicalSchedule(row),
    generatedCountOverride: count,
  });
}

async function buildQueueSchedule(client, row, generatedCountOverride) {
  return buildPhaseInstallmentSchedule({
    db: client,
    profile: profileForSchedule(row),
    generatedCountOverride:
      generatedCountOverride != null
        ? generatedCountOverride
        : parseInt(row.generated_count || 0, 10),
  });
}

/** Values written to installmentinvoicestbl / shown on Installment Invoice Logs. */
function queueDatesFromSchedule(sched) {
  return {
    next_generation_date: sched?.current_generation_date || null,
    next_invoice_month: sched?.current_invoice_month || null,
  };
}

async function applyQueueDates(client, installmentinvoicedtl_id, nextGen, nextMonth) {
  if (!nextGen || !nextMonth) {
    throw new Error('Cannot update queue without next_generation_date and next_invoice_month');
  }
  await client.query(
    `UPDATE installmentinvoicestbl
     SET status = NULL, next_generation_date = $1, next_invoice_month = $2
     WHERE installmentinvoicedtl_id = $3`,
    [nextGen, nextMonth, installmentinvoicedtl_id]
  );
}

function assessQueueRepair(row, sched) {
  const storedGen = ymd(row.next_generation_date);
  const storedMonth = ymd(row.next_invoice_month);
  const { next_generation_date: expectedGen, next_invoice_month: expectedMonth } =
    queueDatesFromSchedule(sched);
  const generatedCount = parseInt(row.generated_count || 0, 10);
  const totalPhases =
    row.total_phases != null ? parseInt(row.total_phases, 10) : null;
  const needsStatusFix =
    totalPhases != null && generatedCount < totalPhases && row.ii_status === 'Generated';
  const needsGenFix = Boolean(expectedGen && storedGen !== expectedGen);
  const needsMonthFix = Boolean(expectedMonth && storedMonth !== expectedMonth);
  const needsRepair = needsStatusFix || needsGenFix || needsMonthFix;

  return {
    storedGen,
    storedMonth,
    expectedGen,
    expectedMonth,
    needsStatusFix,
    needsGenFix,
    needsMonthFix,
    needsRepair,
  };
}

async function findMissedProfiles(client) {
  const rows = await fetchProfiles(client);
  const invoicesInMonth = await loadPhaseInvoicesInMonthBatch(client);
  const missed = [];

  for (const row of rows) {
    if (!isPhaseInstallmentProfile(profileForCanonicalSchedule(row))) continue;

    let sched;
    try {
      // Canonical schedule (no stored queue anchor) — same rules as
      // listMissedInstallmentInvoicesForMonth.js. Using stored next_generation_date
      // here would hide students whose queue is 2026-07-25 but June invoice is missing.
      sched = await buildCanonicalSchedule(client, row);
    } catch (err) {
      missed.push({
        row,
        sched: null,
        scheduleError: err.message,
        invoiceInMonth: null,
        eligible: false,
      });
      continue;
    }

    const schedGen = sched?.current_generation_date || null;
    const schedIssue = sched?.current_issue_date || null;
    const dueThisMonth =
      inTargetMonth(schedGen, TARGET_MONTH) || inTargetMonth(schedIssue, TARGET_MONTH);
    if (!dueThisMonth) continue;

    const invoiceInMonth =
      invoicesInMonth.get(Number(row.installmentinvoiceprofiles_id)) || null;

    const eligible =
      row.is_active &&
      (!row.downpayment_invoice_id || row.downpayment_paid) &&
      (row.total_phases == null ||
        parseInt(row.generated_count || 0, 10) < parseInt(row.total_phases, 10)) &&
      !sched.is_last_phase &&
      !invoiceInMonth;

    if (!eligible) continue;

    const repair = assessQueueRepair(row, sched);
    const postGenerateSched = await buildCanonicalSchedule(
      client,
      row,
      parseInt(row.generated_count || 0, 10) + 1
    );
    const postGenerateQueue = queueDatesFromSchedule(postGenerateSched);
    missed.push({
      row,
      sched,
      postGenerateQueue,
      scheduleError: null,
      invoiceInMonth,
      eligible: true,
      miss_reason: classifyMissReason(row, sched, invoiceInMonth),
      repair,
    });
  }

  return missed;
}

async function applyQueueRepair(client, row, repair) {
  if (!repair.needsRepair) return { repaired: false };
  await applyQueueDates(
    client,
    row.installmentinvoicedtl_id,
    repair.expectedGen,
    repair.expectedMonth
  );
  return { repaired: true };
}

async function syncQueueAfterGeneration(client, profileId) {
  const fresh = await loadProfileRow(client, profileId);
  if (!fresh) throw new Error(`Profile ${profileId} not found after generation`);

  const sched = await buildCanonicalSchedule(client, fresh);
  const { next_generation_date: expectedGen, next_invoice_month: expectedMonth } =
    queueDatesFromSchedule(sched);
  const storedGen = ymd(fresh.next_generation_date);
  const storedMonth = ymd(fresh.next_invoice_month);
  const needsSync =
    Boolean(expectedGen && expectedMonth) &&
    (storedGen !== expectedGen || storedMonth !== expectedMonth);

  if (needsSync) {
    await client.query('BEGIN');
    try {
      await applyQueueDates(
        client,
        fresh.installmentinvoicedtl_id,
        expectedGen,
        expectedMonth
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }
  }

  return {
    synced: needsSync,
    final_next_generation_date: expectedGen,
    final_next_invoice_month: expectedMonth,
    stored_before_sync: { next_generation_date: storedGen, next_invoice_month: storedMonth },
  };
}

async function generateMissedInvoice(profileId) {
  const readClient = await getClient();
  let fresh;
  try {
    fresh = await loadProfileRow(readClient, profileId);
  } finally {
    readClient.release();
  }
  if (!fresh) throw new Error(`Profile ${profileId} not found after repair`);

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

  return generateInvoiceFromInstallment(installmentInvoice, profilePayload);
}

function writeResultsCsv(path, results) {
  const header = [
    'profile_id',
    'student_name',
    'student_email',
    'class_name',
    'next_phase',
    'generated_count',
    'total_phases',
    'miss_reason',
    'stored_next_gen',
    'expected_next_gen',
    'expected_next_month',
    'queue_repaired',
    'invoice_generated',
    'invoice_id',
    'issue_date',
    'due_date',
    'final_next_generation_date',
    'final_next_invoice_month',
    'queue_synced_after_generate',
    'error',
  ];
  const lines = [
    header.join(','),
    ...results.map((r) =>
      header
        .map((h) => {
          const v = r[h] ?? '';
          const s = String(v).replace(/"/g, '""');
          return s.includes(',') ? `"${s}"` : s;
        })
        .join(',')
    ),
  ];
  writeFileSync(path, lines.join('\n'), 'utf8');
}

async function main() {
  const { apply, generate, limit, skipProfileIds, csvPath } = parseArgs();
  const mode = apply ? (generate ? 'APPLY + GENERATE' : 'APPLY') : 'DRY RUN';

  console.log(`\nMissed installment generation repair — ${TARGET_GENERATION_DATE} [${mode}]\n`);

  const client = await getClient();
  const startedAt = Date.now();

  try {
    console.log('Scanning for missed June 2026 profiles...');
    let missed = await findMissedProfiles(client);

    if (skipProfileIds.size) {
      const before = missed.length;
      missed = missed.filter(
        (m) => !skipProfileIds.has(Number(m.row.installmentinvoiceprofiles_id))
      );
      console.log(`Skipping ${before - missed.length} profile(s) via --skip-profile-ids`);
    }

    if (limit != null && limit > 0) {
      missed = missed.slice(0, limit);
    }

    const scheduleErrors = missed.filter((m) => m.scheduleError);
    const actionable = missed.filter((m) => m.eligible && !m.scheduleError);

    console.log(`Found ${actionable.length} missed profile(s) to repair.`);
    console.log(
      '(Uses canonical June schedule — should match listMissedInstallmentInvoicesForMonth.js count, minus already-repaired students e.g. Aadam 142.)'
    );
    if (scheduleErrors.length) {
      console.log(`Schedule errors: ${scheduleErrors.length} (will skip)`);
    }

    if (!actionable.length) {
      console.log('\nNothing to repair.\n');
      return;
    }

    console.log('\nRepair plan:\n');
    console.table(
      actionable.map((m) => ({
        profile_id: m.row.installmentinvoiceprofiles_id,
        student: m.row.student_name,
        email: m.row.student_email,
        class: m.row.class_name,
        phase: m.sched.current_phase_number,
        slots: `${m.row.generated_count}/${m.row.total_phases ?? '?'}`,
        stored_gen: m.repair.storedGen ?? '—',
        expected_gen: m.repair.expectedGen ?? '—',
        expected_month: m.repair.expectedMonth ?? '—',
        after_generate_gen: m.postGenerateQueue?.next_generation_date ?? '—',
        after_generate_month: m.postGenerateQueue?.next_invoice_month ?? '—',
        issue: m.sched.current_issue_date,
        due: m.sched.current_due_date,
        reason: m.miss_reason,
        needs_repair: m.repair.needsRepair ? 'yes' : 'no',
      }))
    );

    if (!apply) {
      console.log('\nRe-run with --apply to fix queue dates.');
      console.log('Add --generate to also create missed phase invoices.');
      if (skipProfileIds.size === 0) {
        console.log(
          'If Aadam (profile 142) was already fixed, use --skip-profile-ids 142 with bulk --generate.'
        );
      }
      return;
    }

    const results = [];
    let repairedCount = 0;
    let generatedCount = 0;
    let skippedRepair = 0;
    let errorCount = 0;

    for (let i = 0; i < actionable.length; i++) {
      const item = actionable[i];
      const profileId = item.row.installmentinvoiceprofiles_id;
      const label = `[${i + 1}/${actionable.length}] profile=${profileId} ${item.row.student_name}`;

      const resultRow = {
        profile_id: profileId,
        student_name: item.row.student_name,
        student_email: item.row.student_email,
        class_name: item.row.class_name,
        next_phase: item.sched.current_phase_number,
        generated_count: item.row.generated_count,
        total_phases: item.row.total_phases,
        miss_reason: item.miss_reason,
        stored_next_gen: item.repair.storedGen,
        expected_next_gen: item.repair.expectedGen,
        expected_next_month: item.repair.expectedMonth,
        queue_repaired: 'no',
        invoice_generated: 'no',
        invoice_id: '',
        issue_date: '',
        due_date: '',
        final_next_generation_date: item.postGenerateQueue?.next_generation_date ?? '',
        final_next_invoice_month: item.postGenerateQueue?.next_invoice_month ?? '',
        queue_synced_after_generate: 'no',
        error: '',
      };

      const studentClient = await getClient();
      try {
        // Short transaction for queue repair only — never hold BEGIN open during
        // generateInvoiceFromInstallment (separate connection + email); Neon idle-in-transaction timeout.
        if (item.repair.needsRepair) {
          await studentClient.query('BEGIN');
          try {
            await applyQueueRepair(studentClient, item.row, item.repair);
            await studentClient.query('COMMIT');
            resultRow.queue_repaired = 'yes';
            repairedCount += 1;
          } catch (repairErr) {
            await studentClient.query('ROLLBACK').catch(() => {});
            throw repairErr;
          }
        } else {
          skippedRepair += 1;
        }

        if (generate) {
          const inv = await generateMissedInvoice(profileId);
          const syncClient = await getClient();
          try {
            const queueSync = await syncQueueAfterGeneration(syncClient, profileId);
            resultRow.invoice_generated = 'yes';
            resultRow.invoice_id = inv.invoice_id;
            resultRow.issue_date = inv.issue_date;
            resultRow.due_date = inv.due_date;
            resultRow.final_next_generation_date = queueSync.final_next_generation_date;
            resultRow.final_next_invoice_month = queueSync.final_next_invoice_month;
            resultRow.queue_synced_after_generate = queueSync.synced ? 'yes' : 'no';
          } finally {
            syncClient.release();
          }
          generatedCount += 1;
          console.log(
            `${label} | repaired=${resultRow.queue_repaired} | invoice=${inv.invoice_id} | logs_next_gen=${resultRow.final_next_generation_date} | logs_next_month=${resultRow.final_next_invoice_month}${resultRow.queue_synced_after_generate === 'yes' ? ' (queue synced)' : ''}`
          );
        } else {
          console.log(
            `${label} | repaired=${resultRow.queue_repaired} | logs_next_gen=${item.repair.expectedGen} | logs_next_month=${item.repair.expectedMonth}`
          );
        }
      } catch (err) {
        errorCount += 1;
        resultRow.error = err.message;
        console.error(`${label} | FAILED: ${err.message}`);
      } finally {
        studentClient.release();
      }

      results.push(resultRow);
    }

    const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log('\n--- Summary ---');
    console.table({
      target_date: TARGET_GENERATION_DATE,
      processed: actionable.length,
      queue_repaired: repairedCount,
      queue_already_ok: skippedRepair,
      invoices_generated: generatedCount,
      errors: errorCount,
      elapsed_seconds: Number(elapsedSec),
      mode: apply ? (generate ? 'apply+generate' : 'apply') : 'dry-run',
    });

    const outCsv = csvPath || `repair-missed-installment-june-2026-${Date.now()}.csv`;
    writeResultsCsv(outCsv, results);
    console.log(`\nResults CSV: ${outCsv}`);
    console.log(`\n${REPAIR_NOTE}\n`);
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
