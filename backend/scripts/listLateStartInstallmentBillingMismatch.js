/**
 * Find active class-linked installment profiles with Kirsten-like billing drift:
 *   - Late enrollment (first class phase > 1 and/or first TARGET_PHASE > default phase_start)
 *   - Scheduler phase (getCurrentInstallmentPhaseNumber) lags the next invoice absolute phase
 *   - No invoice yet for that next absolute phase
 *
 * These students are invisible to standard "missed June 25" scans because
 * buildPhaseInstallmentSchedule still points at the last paid cycle.
 *
 * Usage:
 *   node backend/scripts/listLateStartInstallmentBillingMismatch.js
 *   node backend/scripts/listLateStartInstallmentBillingMismatch.js --json
 *   node backend/scripts/listLateStartInstallmentBillingMismatch.js --csv
 */

import '../config/loadEnv.js';
import { writeFileSync } from 'fs';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import {
  buildPhaseInstallmentSchedule,
  getCurrentInstallmentPhaseNumber,
  isPhaseInstallmentProfile,
  resolveProfilePhaseStart,
} from '../utils/phaseInstallmentUtils.js';
import {
  loadActiveEnrollmentAbsolutePhases,
  resolvePhaseChainByLocalSlot,
} from '../utils/installmentPhaseBillingSync.js';
import { isCancelledInvoiceChain } from '../utils/installmentPhaseRowMapping.js';
import { loadInstallmentProfilePhaseChains } from '../lib/installmentPaymentEligibility.js';
import { coerceToManilaYmd, formatYmdLocal, todayYmdManila } from '../utils/dateUtils.js';

function parseArgs() {
  const argv = process.argv.slice(2);
  let asJson = false;
  let csvPath = null;

  for (const a of argv) {
    if (a === '--json') asJson = true;
    else if (a === '--csv') {
      const i = argv.indexOf(a);
      const next = argv[i + 1];
      csvPath =
        next && !next.startsWith('--')
          ? next
          : `late-start-installment-billing-mismatch-${Date.now()}.csv`;
    } else if (a === '--help' || a === '-h') {
      console.log(`
List Kirsten-like late-start installment billing mismatches.

  --json       JSON output
  --csv [path] Export CSV
`);
      process.exit(0);
    }
  }

  return { asJson, csvPath };
}

const ymd = (value) => {
  if (!value) return null;
  return coerceToManilaYmd(value) || formatYmdLocal(value).slice(0, 10);
};

async function loadProfiles(client) {
  const res = await client.query(
    `SELECT
       ip.*,
       ii.next_generation_date,
       ii.next_invoice_month,
       ii.status AS ii_status,
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
       AND ip.is_active = true
     ORDER BY u.full_name NULLS LAST, ip.installmentinvoiceprofiles_id`
  );
  return res.rows;
}

async function firstEnrolledClassPhase(client, studentId, classId) {
  const res = await client.query(
    `SELECT MIN(phase_number)::integer AS first_phase
     FROM classstudentstbl
     WHERE student_id = $1
       AND class_id = $2
       AND phase_number IS NOT NULL
       AND removed_at IS NULL`,
    [studentId, classId]
  );
  const n = res.rows[0]?.first_phase;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function maxAbsolutePhaseFromChains(chains, downpaymentInvoiceId) {
  let max = null;
  for (const chain of chains || []) {
    if (isCancelledInvoiceChain(chain)) continue;
    const rep = chain.representative;
    if (!rep) continue;
    if (
      downpaymentInvoiceId &&
      Number(rep.invoice_id) === Number(downpaymentInvoiceId)
    ) {
      continue;
    }
    const phase =
      parseTargetPhase(rep.remarks) ??
      (String(rep.remarks || '').match(/Advance payment\s*[—\-]\s*Phase\s*(\d+)/i)?.[1]
        ? parseInt(
            String(rep.remarks).match(/Advance payment\s*[—\-]\s*Phase\s*(\d+)/i)[1],
            10
          )
        : null);
    if (!Number.isFinite(phase)) continue;
    max = max == null ? phase : Math.max(max, phase);
  }
  return max;
}

function minAbsolutePhaseFromChains(chains, downpaymentInvoiceId) {
  let min = null;
  for (const chain of chains || []) {
    if (isCancelledInvoiceChain(chain)) continue;
    const rep = chain.representative;
    if (!rep) continue;
    if (
      downpaymentInvoiceId &&
      Number(rep.invoice_id) === Number(downpaymentInvoiceId)
    ) {
      continue;
    }
    const phase = parseTargetPhase(rep.remarks);
    if (!Number.isFinite(phase)) continue;
    min = min == null ? phase : Math.min(min, phase);
  }
  return min;
}

function hasInvoiceForAbsolutePhase(chains, absolutePhase, downpaymentInvoiceId) {
  for (const chain of chains || []) {
    if (isCancelledInvoiceChain(chain)) continue;
    const rep = chain.representative;
    if (!rep) continue;
    if (
      downpaymentInvoiceId &&
      Number(rep.invoice_id) === Number(downpaymentInvoiceId)
    ) {
      continue;
    }
    if (parseTargetPhase(rep.remarks) === absolutePhase) return true;
  }
  return false;
}

async function analyzeProfile(client, row) {
  const profile = {
    installmentinvoiceprofiles_id: row.installmentinvoiceprofiles_id,
    class_id: row.class_id,
    student_id: row.student_id,
    phase_start: row.phase_start,
    total_phases: row.total_phases,
    generated_count: row.generated_count,
    downpayment_invoice_id: row.downpayment_invoice_id,
  };

  if (!isPhaseInstallmentProfile(profile)) return null;
  if (row.downpayment_invoice_id && !row.downpayment_paid) return null;

  const generatedCount = parseInt(row.generated_count || 0, 10);
  const totalPhases = row.total_phases != null ? parseInt(row.total_phases, 10) : null;
  if (totalPhases != null && generatedCount >= totalPhases) return null;

  const defaultPhaseStart = resolveProfilePhaseStart(profile);
  const billingPhaseNext = getCurrentInstallmentPhaseNumber(profile);
  const firstEnrolled = await firstEnrolledClassPhase(client, row.student_id, row.class_id);

  const { phaseChains: chains } = await loadInstallmentProfilePhaseChains(
    client,
    profile.installmentinvoiceprofiles_id
  );
  const activeEnrollment = await loadActiveEnrollmentAbsolutePhases(
    client,
    row.student_id,
    row.class_id
  );
  const { chainByLocalPhase } = resolvePhaseChainByLocalSlot(chains, profile, {
    activeEnrollmentAbsolutePhases: activeEnrollment,
  });

  const maxInvoicePhase = maxAbsolutePhaseFromChains(chains, row.downpayment_invoice_id);
  const minInvoicePhase = minAbsolutePhaseFromChains(chains, row.downpayment_invoice_id);

  if (maxInvoicePhase == null || generatedCount === 0) return null;

  const expectedNextAbsolute = maxInvoicePhase + 1;
  const billingLags = billingPhaseNext < expectedNextAbsolute;
  if (!billingLags) return null;

  const lateStartByEnrollment =
    firstEnrolled != null && firstEnrolled > defaultPhaseStart;
  const lateStartByInvoice =
    minInvoicePhase != null && minInvoicePhase > defaultPhaseStart;
  const phaseStartNull = row.phase_start == null;

  const isLateStartPattern =
    lateStartByEnrollment || lateStartByInvoice || (phaseStartNull && lateStartByEnrollment);

  if (!isLateStartPattern) return null;

  const missingNextInvoice = !hasInvoiceForAbsolutePhase(
    chains,
    expectedNextAbsolute,
    row.downpayment_invoice_id
  );
  if (!missingNextInvoice) return null;

  let sched;
  try {
    sched = await buildPhaseInstallmentSchedule({
      db: client,
      profile,
      generatedCountOverride: generatedCount,
    });
  } catch {
    sched = null;
  }

  const today = todayYmdManila();
  const storedNextGen = ymd(row.next_generation_date);
  const schedCurrentGen = sched?.current_generation_date || null;
  const schedNextGen = sched?.next_generation_date || null;

  // Kirsten-exact: next phase invoice never created, but scheduler still on the
  // previous cycle (generation date in the past) and/or queue jumped forward.
  const scheduleStuckOnPastCycle =
    Boolean(schedCurrentGen && schedCurrentGen < today) &&
    billingPhaseNext <= maxInvoicePhase;

  const queueAheadOfSchedule =
    Boolean(storedNextGen && schedCurrentGen && storedNextGen > schedCurrentGen) ||
    Boolean(storedNextGen && schedNextGen && storedNextGen >= schedNextGen);

  const overdueMissedGeneration = scheduleStuckOnPastCycle || queueAheadOfSchedule;
  if (!overdueMissedGeneration) return null;


  let firstEmptyLocal = null;
  const total = totalPhases || 10;
  for (let local = 1; local <= total; local += 1) {
    if (!chainByLocalPhase.has(local)) {
      firstEmptyLocal = local;
      break;
    }
  }

  return {
    profile_id: row.installmentinvoiceprofiles_id,
    student_id: row.student_id,
    student_name: row.student_name,
    student_email: row.student_email,
    branch_name: row.branch_name,
    class_name: row.class_name,
    phase_start_db: row.phase_start,
    default_phase_start: defaultPhaseStart,
    first_enrolled_class_phase: firstEnrolled,
    generated_count: generatedCount,
    total_phases: totalPhases,
    min_invoice_absolute_phase: minInvoicePhase,
    max_invoice_absolute_phase: maxInvoicePhase,
    billing_phase_next: billingPhaseNext,
    expected_next_absolute_phase: expectedNextAbsolute,
    phase_lag: expectedNextAbsolute - billingPhaseNext,
    missing_next_invoice: missingNextInvoice,
    stored_next_generation_date: storedNextGen,
    stored_next_invoice_month: ymd(row.next_invoice_month),
    schedule_current_generation_date: schedCurrentGen,
    schedule_next_generation_date: schedNextGen,
    schedule_stuck_on_past_cycle: scheduleStuckOnPastCycle,
    queue_ahead_of_schedule: queueAheadOfSchedule,
    first_empty_local_slot: firstEmptyLocal,
    queue_status: row.ii_status,
  };
}

function writeCsv(path, rows) {
  if (!rows.length) return;
  const header = Object.keys(rows[0]);
  const lines = [
    header.join(','),
    ...rows.map((r) =>
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
  const { asJson, csvPath } = parseArgs();
  const startedAt = Date.now();
  const client = await getClient();

  try {
    const profiles = await loadProfiles(client);
    const matches = [];
    let scanned = 0;

    for (const row of profiles) {
      scanned += 1;
      const hit = await analyzeProfile(client, row);
      if (hit) matches.push(hit);
      if (scanned % 50 === 0) {
        process.stdout.write(`  … ${scanned}/${profiles.length} profiles checked\n`);
      }
    }

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

    if (asJson) {
      console.log(JSON.stringify({ scanned, matches, elapsed_seconds: Number(elapsed) }, null, 2));
      return;
    }

    console.log(`\nLate-start installment billing mismatch scan (${elapsed}s)\n`);
    console.log(`Active class-linked profiles scanned: ${scanned}`);
    console.log(`Kirsten-like mismatches found: ${matches.length}\n`);

    if (matches.length) {
      console.table(
        matches.map((m) => ({
          profile_id: m.profile_id,
          student: m.student_name,
          email: m.student_email,
          class: m.class_name,
          enrolled_from: m.first_enrolled_class_phase,
          invoices: `${m.min_invoice_absolute_phase}–${m.max_invoice_absolute_phase}`,
          billing_next: m.billing_phase_next,
          should_bill: m.expected_next_absolute_phase,
          lag: m.phase_lag,
          stored_next_gen: m.stored_next_generation_date,
          sched_current_gen: m.schedule_current_generation_date,
          stuck_past: m.schedule_stuck_on_past_cycle,
          queue_ahead: m.queue_ahead_of_schedule,
        }))
      );

      if (csvPath) {
        writeCsv(csvPath, matches);
        console.log(`\nCSV: ${csvPath}`);
      }
    } else {
      console.log('No other Kirsten-like profiles found.');
    }
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
