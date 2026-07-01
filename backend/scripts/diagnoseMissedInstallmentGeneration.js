/**
 * Find class-linked installment profiles that should have auto-generated an invoice
 * on a target generation date (default: 2026-06-25) but did not.
 *
 * Usage:
 *   node backend/scripts/diagnoseMissedInstallmentGeneration.js
 *   node backend/scripts/diagnoseMissedInstallmentGeneration.js --date 2026-06-25
 *   node backend/scripts/diagnoseMissedInstallmentGeneration.js --date 2026-06-25 --json
 *   node backend/scripts/diagnoseMissedInstallmentGeneration.js --date 2026-06-25 --csv missed.csv
 */

import '../config/loadEnv.js';
import { writeFileSync } from 'fs';
import { getClient } from '../config/database.js';
import {
  buildPhaseInstallmentSchedule,
  isPhaseInstallmentProfile,
} from '../utils/phaseInstallmentUtils.js';
import { formatYmdLocal } from '../utils/dateUtils.js';

const TARGET_DATE = (() => {
  const idx = process.argv.indexOf('--date');
  if (idx >= 0 && process.argv[idx + 1]) {
    return String(process.argv[idx + 1]).slice(0, 10);
  }
  return '2026-06-25';
})();

const AS_JSON = process.argv.includes('--json');
const CSV_PATH = (() => {
  const idx = process.argv.indexOf('--csv');
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : null;
})();

const ymd = (value) => {
  if (!value) return null;
  return formatYmdLocal(value).slice(0, 10);
};

function classifyMissReason(row, sched, invoiceOnDate) {
  if (!row.is_active) return 'profile_inactive';
  if (row.downpayment_invoice_id && !row.downpayment_paid) return 'downpayment_unpaid';
  const total = row.total_phases != null ? parseInt(row.total_phases, 10) : null;
  const generated = parseInt(row.generated_count || 0, 10);
  if (total != null && generated >= total) return 'all_phases_generated';
  if (!sched) return 'not_class_linked';
  if (sched.is_last_phase) return 'schedule_last_phase';
  if (!sched.current_generation_date) return 'no_generation_date_in_schedule';
  if (sched.current_generation_date !== TARGET_DATE) {
    return `generation_date_mismatch (expected ${sched.current_generation_date})`;
  }
  if (row.ii_status === 'Generated') return 'queue_status_generated_blocks_scheduler';
  const storedGen = ymd(row.next_generation_date);
  if (storedGen && storedGen > TARGET_DATE) return `next_generation_date_in_future (${storedGen})`;
  if (invoiceOnDate) return 'invoice_exists_on_date_review_phase';
  if (!row.installmentinvoicedtl_id) return 'missing_installmentinvoicestbl_row';
  return 'unknown_not_generated';
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
       ip.description,
       ii.installmentinvoicedtl_id,
       ii.next_generation_date,
       ii.next_invoice_month,
       ii.status AS ii_status,
       ii.scheduled_date AS ii_scheduled_date,
       u.full_name AS student_name,
       u.email AS student_email,
       c.class_name
     FROM installmentinvoiceprofilestbl ip
     LEFT JOIN installmentinvoicestbl ii
       ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
     LEFT JOIN userstbl u ON u.user_id = ip.student_id
     LEFT JOIN classestbl c ON c.class_id = ip.class_id
     WHERE ip.class_id IS NOT NULL
     ORDER BY u.full_name NULLS LAST, ip.installmentinvoiceprofiles_id`
  );
  return res.rows;
}

async function loadInvoiceOnTargetDate(client, profileId) {
  const res = await client.query(
    `SELECT i.invoice_id, i.status,
            TO_CHAR(TIMEZONE('Asia/Manila', i.issue_date), 'YYYY-MM-DD') AS issue_ymd,
            i.remarks
     FROM invoicestbl i
     INNER JOIN invoicestudentstbl ist ON ist.invoice_id = i.invoice_id
     INNER JOIN installmentinvoiceprofilestbl ip ON ip.installmentinvoiceprofiles_id = i.installmentinvoiceprofiles_id
     WHERE i.installmentinvoiceprofiles_id = $1
       AND TIMEZONE('Asia/Manila', i.issue_date)::date = $2::date
       AND (
         ip.downpayment_invoice_id IS NULL
         OR COALESCE(i.invoice_chain_root_id, i.invoice_id) <> ip.downpayment_invoice_id::integer
       )
     ORDER BY i.invoice_id DESC
     LIMIT 1`,
    [profileId, TARGET_DATE]
  );
  return res.rows[0] || null;
}

async function main() {
  const client = await getClient();
  const rows = await fetchProfiles(client);

  const expected = [];
  const generated = [];
  const missed = [];
  const skipped = [];
  const errors = [];

  for (const row of rows) {
    const profile = {
      installmentinvoiceprofiles_id: row.installmentinvoiceprofiles_id,
      class_id: row.class_id,
      phase_start: row.phase_start,
      total_phases: row.total_phases,
      generated_count: row.generated_count,
    };

    if (!isPhaseInstallmentProfile(profile)) {
      skipped.push({ profileId: row.installmentinvoiceprofiles_id, reason: 'not_class_linked' });
      continue;
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
        profileId: row.installmentinvoiceprofiles_id,
        student_name: row.student_name,
        student_email: row.student_email,
        class_name: row.class_name,
        error: err.message,
      });
      continue;
    }

    const invoiceOnDate = await loadInvoiceOnTargetDate(
      client,
      row.installmentinvoiceprofiles_id
    );

    const schedGen = sched?.current_generation_date || null;
    const dueForTarget = schedGen === TARGET_DATE;

    if (!dueForTarget) {
      continue;
    }

    const entry = {
      profile_id: row.installmentinvoiceprofiles_id,
      student_id: row.student_id,
      student_name: row.student_name,
      student_email: row.student_email,
      class_id: row.class_id,
      class_name: row.class_name,
      generated_count: parseInt(row.generated_count || 0, 10),
      total_phases: row.total_phases != null ? parseInt(row.total_phases, 10) : null,
      next_phase: sched.current_phase_number,
      billing_mode: sched.billing_mode,
      is_active: row.is_active,
      downpayment_paid: row.downpayment_paid,
      queue_status: row.ii_status,
      stored_next_generation_date: ymd(row.next_generation_date),
      expected_generation_date: schedGen,
      expected_issue_date: sched.current_issue_date,
      expected_due_date: sched.current_due_date,
      invoice_on_target_date: invoiceOnDate
        ? {
            invoice_id: invoiceOnDate.invoice_id,
            status: invoiceOnDate.status,
            issue_ymd: invoiceOnDate.issue_ymd,
            target_phase: (invoiceOnDate.remarks || '').match(/TARGET_PHASE:(\d+)/)?.[1] || null,
          }
        : null,
    };

    expected.push(entry);

    const eligible =
      row.is_active &&
      (!row.downpayment_invoice_id || row.downpayment_paid) &&
      (row.total_phases == null ||
        parseInt(row.generated_count || 0, 10) < parseInt(row.total_phases, 10)) &&
      !sched.is_last_phase;

    if (invoiceOnDate && eligible) {
      generated.push(entry);
    } else if (eligible) {
      entry.miss_reason = classifyMissReason(row, sched, invoiceOnDate);
      missed.push(entry);
    } else {
      entry.skip_reason = classifyMissReason(row, sched, invoiceOnDate);
      skipped.push(entry);
    }
  }

  client.release();

  const summary = {
    target_generation_date: TARGET_DATE,
    total_class_linked_profiles: rows.length,
    expected_on_date: expected.length,
    generated_on_date: generated.length,
    missed: missed.length,
    skipped_on_date: skipped.filter((s) => s.profile_id || s.expected_generation_date).length,
    schedule_errors: errors.length,
  };

  if (AS_JSON) {
    console.log(JSON.stringify({ summary, missed, generated, errors }, null, 2));
    return;
  }

  console.log(`\nInstallment auto-generation diagnostic — target date ${TARGET_DATE}\n`);
  console.log('Summary:');
  console.table(summary);

  if (errors.length) {
    console.log(`\nSchedule errors (${errors.length}):`);
    console.table(errors);
  }

  if (missed.length) {
    console.log(`\nMissed generation (${missed.length}) — should have run on ${TARGET_DATE}:`);
    console.table(
      missed.map((m) => ({
        profile_id: m.profile_id,
        student: m.student_name,
        email: m.student_email,
        class: m.class_name,
        phase: m.next_phase,
        generated: `${m.generated_count}/${m.total_phases ?? '?'}`,
        queue_status: m.queue_status ?? '—',
        stored_next_gen: m.stored_next_generation_date ?? '—',
        reason: m.miss_reason,
      }))
    );

    const byReason = missed.reduce((acc, m) => {
      const key = m.miss_reason || 'unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    console.log('\nMissed by reason:');
    console.table(
      Object.entries(byReason).map(([reason, count]) => ({ reason, count }))
    );
  } else {
    console.log(`\nNo eligible missed profiles for ${TARGET_DATE}.`);
  }

  if (CSV_PATH && missed.length) {
    const header = [
      'profile_id',
      'student_id',
      'student_name',
      'student_email',
      'class_name',
      'next_phase',
      'generated_count',
      'total_phases',
      'queue_status',
      'stored_next_generation_date',
      'miss_reason',
    ];
    const lines = [
      header.join(','),
      ...missed.map((m) =>
        header
          .map((h) => {
            const v = m[h] ?? '';
            const s = String(v).replace(/"/g, '""');
            return s.includes(',') ? `"${s}"` : s;
          })
          .join(',')
      ),
    ];
    writeFileSync(CSV_PATH, lines.join('\n'), 'utf8');
    console.log(`\nWrote ${missed.length} rows to ${CSV_PATH}`);
  }

  console.log(
    '\nNext steps:\n' +
      '  • queue_status_generated_blocks_scheduler → run repairInstallmentGenerationSchedule.js --dry-run\n' +
      '  • next_generation_date_in_future → run repairInstallmentGenerationSchedule.js --apply\n' +
      '  • After queue repair → processDueInstallmentInvoices (scheduler or manual trigger)\n'
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
