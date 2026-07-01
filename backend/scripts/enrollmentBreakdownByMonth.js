/**
 * Row-level operational enrollment breakdown for a calendar month.
 * Usage: node scripts/enrollmentBreakdownByMonth.js 2026-06 [status]
 * status optional: new | re_enrolled | completed | upsell | rejoin | reserved | all (default all)
 */
import '../config/loadEnv.js';
import { query } from '../config/database.js';
import {
  loadMonthlyOperationalEnrollmentFromPayments,
  loadOperationalEnrollmentDetailFromPayments,
} from '../lib/dailyOperationalEnrollmentFromPayments.js';

const summaryMonth = process.argv[2] || '2026-06';
const statusFilterArg = (process.argv[3] || 'all').toLowerCase();

if (!/^\d{4}-\d{2}$/.test(summaryMonth)) {
  console.error('summary_month must be YYYY-MM');
  process.exit(1);
}

const [year, month] = summaryMonth.split('-').map(Number);
const monthStart = `${summaryMonth}-01`;
const monthEndExclusive =
  month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;

const statusFilter = statusFilterArg === 'all' ? null : statusFilterArg;

const summary = await loadMonthlyOperationalEnrollmentFromPayments(query, {
  monthStart,
  monthEndExclusive,
  summaryMonth,
});

const { rows } = await loadOperationalEnrollmentDetailFromPayments(query, {
  monthStart,
  monthEndExclusive,
  statusFilter,
});

const totals = rows.reduce(
  (acc, row) => {
    acc[row.program_enrollment_status] = (acc[row.program_enrollment_status] || 0) + 1;
    return acc;
  },
  {}
);

console.log(`\n=== Operational enrollment breakdown: ${summaryMonth} ===`);
console.log('Window:', monthStart, 'to', monthEndExclusive, '(payment issue_date)');
console.log('Dashboard totals:', summary.totals);
if (statusFilter) console.log('Detail filter:', statusFilter);
console.log('Detail row counts:', totals);
console.log('Detail rows:', rows.length);
console.log('');

const table = rows.map((r) => ({
  issue_date: r.issue_date?.toISOString?.().slice(0, 10) ?? r.issue_date,
  student: r.student_name,
  phase: r.enrolled_phase_number,
  classified: r.program_enrollment_status,
  raw_status: r.raw_status,
  full_payment: r.is_full_payment,
  phase_range:
    r.phase_start && r.phase_end ? `${r.phase_start}-${r.phase_end}` : r.invoice_phase_number ?? '—',
  invoice_id: r.invoice_id,
  payment_id: r.payment_id,
  class: r.class_name,
  branch: r.branch_name,
  description: (r.invoice_description || '').slice(0, 45),
}));

console.table(table);
process.exit(0);
