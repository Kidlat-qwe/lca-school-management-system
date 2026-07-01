/**
 * List students whose installment plan should have generated a phase invoice
 * in a calendar month (Asia/Manila) but did not.
 *
 * Typical use: June recurring run (25th) — profiles with expected generation in
 * 2026-06 but no phase invoice issued that month.
 *
 * Usage:
 *   node backend/scripts/listMissedInstallmentInvoicesForMonth.js --month 2026-06
 *   node backend/scripts/listMissedInstallmentInvoicesForMonth.js --month 2026-06 --csv
 *   node backend/scripts/listMissedInstallmentInvoicesForMonth.js --month 2026-06 --json
 */

import '../config/loadEnv.js';
import { writeFileSync } from 'fs';
import { getClient } from '../config/database.js';
import {
  buildPhaseInstallmentSchedule,
  isPhaseInstallmentProfile,
} from '../utils/phaseInstallmentUtils.js';
import { formatYmdLocal } from '../utils/dateUtils.js';

function parseArgs() {
  const argv = process.argv.slice(2);
  let monthYm = '2026-06';
  let csvPath = null;
  let asJson = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--month' && argv[i + 1]) {
      monthYm = String(argv[++i]).slice(0, 7);
    } else if (a === '--csv') {
      csvPath = argv[i + 1] && !argv[i + 1].startsWith('--')
        ? argv[++i]
        : `missed-installment-invoices-${monthYm}.csv`;
    } else if (a === '--json') {
      asJson = true;
    } else if (a === '--help' || a === '-h') {
      console.log(`
List students who missed installment invoice generation for a calendar month.

  --month YYYY-MM   Target month (default: 2026-06)
  --csv [path]      Export missed rows to CSV
  --json            JSON output

Examples:
  node backend/scripts/listMissedInstallmentInvoicesForMonth.js --month 2026-06
  node backend/scripts/listMissedInstallmentInvoicesForMonth.js --month 2026-06 --csv
`);
      process.exit(0);
    }
  }

  if (!/^\d{4}-\d{2}$/.test(monthYm)) {
    throw new Error('--month must be YYYY-MM');
  }

  const [y, m] = monthYm.split('-').map(Number);
  const monthStart = `${monthYm}-01`;
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;

  return { monthYm, monthStart, nextMonthExclusive: nextMonth, csvPath, asJson };
}

const ymd = (value) => {
  if (!value) return null;
  return formatYmdLocal(value).slice(0, 10);
};

const inTargetMonth = (dateYmd, monthYm) =>
  Boolean(dateYmd && String(dateYmd).slice(0, 7) === monthYm);

function classifyMissReason(row, sched, invoiceInMonth, monthYm) {
  if (!row.is_active) return 'profile_inactive';
  if (row.downpayment_invoice_id && !row.downpayment_paid) return 'downpayment_unpaid';
  const total = row.total_phases != null ? parseInt(row.total_phases, 10) : null;
  const generated = parseInt(row.generated_count || 0, 10);
  if (total != null && generated >= total) return 'all_phases_generated';
  if (!sched) return 'not_class_linked';
  if (sched.is_last_phase) return 'schedule_last_phase';
  const schedGen = sched.current_generation_date;
  const schedIssue = sched.current_issue_date;
  if (!inTargetMonth(schedGen, monthYm) && !inTargetMonth(schedIssue, monthYm)) {
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
       ip.phase_start,
       ip.total_phases,
       ip.generated_count,
       ip.is_active,
       ip.downpayment_paid,
       ip.downpayment_invoice_id,
       ip.description,
       ii.installmentinvoicedtl_id,
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
     ORDER BY u.full_name NULLS LAST, ip.installmentinvoiceprofiles_id`
  );
  return res.rows;
}

async function loadPhaseInvoicesInMonthBatch(client, monthStart, nextMonthExclusive) {
  const res = await client.query(
    `SELECT DISTINCT ON (i.installmentinvoiceprofiles_id)
       i.installmentinvoiceprofiles_id AS profile_id,
       i.invoice_id,
       i.status,
       TO_CHAR(TIMEZONE('Asia/Manila', i.issue_date), 'YYYY-MM-DD') AS issue_ymd,
       i.remarks
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
    [monthStart, nextMonthExclusive]
  );
  const map = new Map();
  for (const row of res.rows || []) {
    map.set(Number(row.profile_id), row);
  }
  return map;
}

function logProgress(message) {
  process.stdout.write(`${message}\n`);
}

function writeCsv(path, rows) {
  const header = [
    'profile_id',
    'student_id',
    'student_name',
    'student_email',
    'branch_name',
    'class_name',
    'next_phase',
    'generated_count',
    'total_phases',
    'expected_generation_date',
    'expected_issue_date',
    'expected_due_date',
    'stored_next_generation_date',
    'queue_status',
    'miss_reason',
  ];
  const lines = [
    header.join(','),
    ...rows.map((m) =>
      header
        .map((h) => {
          const v = m[h] ?? '';
          const s = String(v).replace(/"/g, '""');
          return s.includes(',') ? `"${s}"` : s;
        })
        .join(',')
    ),
  ];
  writeFileSync(path, lines.join('\n'), 'utf8');
}

async function main() {
  const startedAt = Date.now();
  const { monthYm, monthStart, nextMonthExclusive, csvPath, asJson } = parseArgs();

  logProgress(`\nScanning missed installment invoices for ${monthYm} (Asia/Manila)...`);
  logProgress('This may take 30–90 seconds. Loading profiles...');

  const client = await getClient();

  try {
    const rows = await fetchProfiles(client);
    const classLinked = rows.filter((r) => r.class_id != null);
    logProgress(`Loaded ${rows.length} profile(s) (${classLinked.length} class-linked). Building schedules...`);

    const invoicesInMonth = await loadPhaseInvoicesInMonthBatch(
      client,
      monthStart,
      nextMonthExclusive
    );
    logProgress(
      `Found ${invoicesInMonth.size} phase invoice(s) already issued in ${monthYm}. Analyzing...`
    );

    const missed = [];
    const generated = [];
    const skipped = [];
    const errors = [];
    let scanned = 0;
    const progressEvery = 25;

    for (const row of rows) {
      const profile = {
        installmentinvoiceprofiles_id: row.installmentinvoiceprofiles_id,
        class_id: row.class_id,
        phase_start: row.phase_start,
        total_phases: row.total_phases,
        generated_count: row.generated_count,
      };

      if (!isPhaseInstallmentProfile(profile)) continue;

      scanned += 1;
      if (scanned % progressEvery === 0) {
        logProgress(`  … ${scanned} class-linked profile(s) checked`);
      }

      let sched;
      try {
        sched = await buildPhaseInstallmentSchedule({
          db: client,
          profile,
          generatedCountOverride: parseInt(row.generated_count || 0, 10),
        });
      } catch (err) {
        errors.push({
          profile_id: row.installmentinvoiceprofiles_id,
          student_name: row.student_name,
          student_email: row.student_email,
          class_name: row.class_name,
          error: err.message,
        });
        continue;
      }

      const schedGen = sched?.current_generation_date || null;
      const schedIssue = sched?.current_issue_date || null;
      const dueThisMonth =
        inTargetMonth(schedGen, monthYm) || inTargetMonth(schedIssue, monthYm);

      if (!dueThisMonth) continue;

      const invoiceInMonth =
        invoicesInMonth.get(Number(row.installmentinvoiceprofiles_id)) || null;

      const entry = {
        profile_id: row.installmentinvoiceprofiles_id,
        student_id: row.student_id,
        student_name: row.student_name,
        student_email: row.student_email,
        branch_name: row.branch_name,
        class_id: row.class_id,
        class_name: row.class_name,
        generated_count: parseInt(row.generated_count || 0, 10),
        total_phases: row.total_phases != null ? parseInt(row.total_phases, 10) : null,
        next_phase: sched.current_phase_number,
        billing_mode: sched.billing_mode,
        queue_status: row.ii_status ?? null,
        stored_next_generation_date: ymd(row.next_generation_date),
        expected_generation_date: schedGen,
        expected_issue_date: schedIssue,
        expected_due_date: sched.current_due_date,
        invoice_in_month: invoiceInMonth
          ? {
              invoice_id: invoiceInMonth.invoice_id,
              status: invoiceInMonth.status,
              issue_ymd: invoiceInMonth.issue_ymd,
              target_phase:
                (invoiceInMonth.remarks || '').match(/TARGET_PHASE:(\d+)/)?.[1] || null,
            }
          : null,
      };

      const eligible =
        row.is_active &&
        (!row.downpayment_invoice_id || row.downpayment_paid) &&
        (row.total_phases == null ||
          parseInt(row.generated_count || 0, 10) < parseInt(row.total_phases, 10)) &&
        !sched.is_last_phase;

      if (eligible && invoiceInMonth) {
        generated.push(entry);
      } else if (eligible) {
        entry.miss_reason = classifyMissReason(row, sched, invoiceInMonth, monthYm);
        missed.push(entry);
      } else {
        entry.skip_reason = classifyMissReason(row, sched, invoiceInMonth, monthYm);
        skipped.push(entry);
      }
    }

    const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    logProgress(`Done in ${elapsedSec}s (${scanned} class-linked profile(s) scanned).`);

    const summary = {
      month: monthYm,
      month_range_manila: `${monthStart} .. ${nextMonthExclusive} (exclusive)`,
      total_due_this_month: missed.length + generated.length + skipped.length,
      generated_in_month: generated.length,
      missed_not_generated: missed.length,
      skipped_not_eligible: skipped.length,
      schedule_errors: errors.length,
      elapsed_seconds: Number(elapsedSec),
    };

    if (asJson) {
      console.log(JSON.stringify({ summary, missed, generated, skipped, errors }, null, 2));
      return;
    }

    console.log(`\nMissed installment invoices — ${monthYm} (Asia/Manila)\n`);
    console.table(summary);

    if (missed.length) {
      console.log(`\nStudents missing phase invoice for ${monthYm} (${missed.length}):\n`);
      console.table(
        missed.map((m) => ({
          profile_id: m.profile_id,
          student: m.student_name,
          email: m.student_email,
          class: m.class_name,
          phase: m.next_phase,
          slots: `${m.generated_count}/${m.total_phases ?? '?'}`,
          expected_gen: m.expected_generation_date,
          stored_next_gen: m.stored_next_generation_date ?? '—',
          reason: m.miss_reason,
        }))
      );

      const byReason = missed.reduce((acc, m) => {
        const key = m.miss_reason || 'unknown';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
      console.log('\nBy reason:');
      console.table(Object.entries(byReason).map(([reason, count]) => ({ reason, count })));
    } else {
      console.log('\nNo eligible missed students for this month.');
    }

    if (errors.length) {
      console.log(`\nSchedule errors (${errors.length}):`);
      console.table(errors);
    }

    const outCsv =
      csvPath || (missed.length ? `missed-installment-invoices-${monthYm}.csv` : null);
    if (outCsv && missed.length) {
      writeCsv(outCsv, missed);
      console.log(`\nCSV: ${outCsv} (${missed.length} rows)`);
    }

    console.log(
      '\nFix queue dates:  node scripts/repairInstallmentGenerationSchedule.js --apply\n' +
        'Generate invoices: daily scheduler or processDueInstallmentInvoices\n'
    );
  } finally {
    client.release();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nScript failed:', err?.message || err);
    if (err?.stack) console.error(err.stack);
    process.exit(1);
  });
