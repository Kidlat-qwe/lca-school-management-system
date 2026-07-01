/**
 * Read-only audit for enrollment KPI data quality across ALL payment history
 * (not limited to a single month). Flags:
 *   1) Paid-invoice installment groups with multiple payments per chain + phase + status
 *   2) Bronny-like same-day cross-class / upsell classification patterns
 *   3) Lower-completed + higher-program upsell merge candidates
 *
 * Usage:
 *   node scripts/auditEnrollmentDataQuality.js
 *   node scripts/auditEnrollmentDataQuality.js --pattern=partial
 *   node scripts/auditEnrollmentDataQuality.js --from=2020-01-01 --to=2026-12-31
 *   node scripts/auditEnrollmentDataQuality.js --branch-id=1 --student-id=123 --limit=50
 *   node scripts/auditEnrollmentDataQuality.js --json
 */
import '../config/loadEnv.js';
import { query } from '../config/database.js';
import {
  auditBronnyLikePatterns,
  auditDedupeImpactSummary,
  auditPartialPaymentDoubleCount,
  auditUpsellMergeCandidates,
  loadPaymentIssueDateBounds,
} from '../lib/operationalEnrollmentAudit.js';

const HELP = `
auditEnrollmentDataQuality.js — read-only enrollment KPI anomaly scan

Options:
  --pattern=all|partial|bronny|upsell|dedupe   Sections to run (default: all)
  --from=YYYY-MM-DD                            Payment issue_date lower bound (optional)
  --to=YYYY-MM-DD                              Payment issue_date upper bound (optional)
  --branch-id=N                                Filter by branch (optional)
  --student-id=N                               Filter by student (optional)
  --limit=N                                    Max detail rows per section (default: 200)
  --json                                       JSON output
  --help                                       Show this help

Notes:
  - No writes. Safe for production when pointed at prod DB.
  - Default scope is ALL completed class payments (use --from/--to to narrow).
  - Partial audit targets installment payments only (not full-payment phase expansion).
`;

const parseArgs = (argv) => {
  const options = {
    pattern: 'all',
    from: null,
    to: null,
    branchId: null,
    studentId: null,
    limit: 200,
    json: false,
    help: false,
  };

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    const match = arg.match(/^--([^=]+)(?:=(.+))?$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    const value = rawValue ?? 'true';

    switch (key) {
      case 'pattern':
        options.pattern = String(value).toLowerCase();
        break;
      case 'from':
        options.from = value;
        break;
      case 'to':
        options.to = value;
        break;
      case 'branch-id':
        options.branchId = parseInt(value, 10) || null;
        break;
      case 'student-id':
        options.studentId = parseInt(value, 10) || null;
        break;
      case 'limit':
        options.limit = parseInt(value, 10) || 200;
        break;
      default:
        break;
    }
  }

  return options;
};

const validateDate = (label, value) => {
  if (!value) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be YYYY-MM-DD`);
  }
};

const printSection = (title, summary, rows, rowFormatter) => {
  console.log(`\n=== ${title} ===`);
  console.log('Summary:', summary);
  if (!rows?.length) {
    console.log('(no detail rows in limit)');
    return;
  }
  console.log(`Detail (up to ${rows.length} rows):`);
  for (const row of rows) {
    console.log(rowFormatter ? rowFormatter(row) : row);
  }
};

const cli = parseArgs(process.argv.slice(2));

if (cli.help) {
  console.log(HELP.trim());
  process.exit(0);
}

const validPatterns = new Set(['all', 'partial', 'bronny', 'upsell', 'dedupe']);
if (!validPatterns.has(cli.pattern)) {
  console.error(`Invalid --pattern=${cli.pattern}. Use: ${[...validPatterns].join(', ')}`);
  process.exit(1);
}

validateDate('--from', cli.from);
validateDate('--to', cli.to);

const filters = {
  from: cli.from,
  to: cli.to,
  branchId: cli.branchId,
  studentId: cli.studentId,
  limit: cli.limit,
};

const runPartial = cli.pattern === 'all' || cli.pattern === 'partial';
const runBronny = cli.pattern === 'all' || cli.pattern === 'bronny';
const runUpsell = cli.pattern === 'all' || cli.pattern === 'upsell';
const runDedupe = cli.pattern === 'all' || cli.pattern === 'dedupe';

console.log('Enrollment data quality audit (read-only)');
console.log('NODE_ENV:', process.env.NODE_ENV || '(unset)');
console.log('Pattern:', cli.pattern);
console.log('Filters:', {
  from: cli.from || '(all time)',
  to: cli.to || '(all time)',
  branchId: cli.branchId,
  studentId: cli.studentId,
  limit: cli.limit,
});

const bounds = await loadPaymentIssueDateBounds(query, filters);
console.log('Payment scope:', bounds);

const report = {
  scope: bounds,
  filters: cli,
  dedupe_impact: null,
  partial_payment_double_count: null,
  bronny_like: null,
  upsell_merge_candidates: null,
};

if (runDedupe) {
  report.dedupe_impact = await auditDedupeImpactSummary(query, filters);
}

if (runPartial) {
  report.partial_payment_double_count = await auditPartialPaymentDoubleCount(query, filters);
}

if (runBronny) {
  report.bronny_like = await auditBronnyLikePatterns(query, filters);
}

if (runUpsell) {
  report.upsell_merge_candidates = await auditUpsellMergeCandidates(query, filters);
}

if (cli.json) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

if (report.dedupe_impact) {
  printSection(
    'Dedupe impact (re_enrolled / upsell / completed events)',
    report.dedupe_impact,
    null,
    null
  );
}

if (report.partial_payment_double_count) {
  printSection(
    'Partial payment double-count groups (raw > 1 per chain+phase+status)',
    report.partial_payment_double_count.summary,
    report.partial_payment_double_count.rows,
    (row) =>
      `  ${row.issue_date || row.first_issue_date} | ${row.student_name} (${row.student_id}) | ` +
      `${row.class_name} ph${row.enrolled_phase_number} | status=${row.program_enrollment_status} | ` +
      `raw=${row.raw_event_count} | chain=${row.invoice_chain_key} | payments=${(row.payment_ids || []).join(',')}`
  );
}

if (report.bronny_like) {
  printSection(
    'Legacy cross-class flip (fixed: was re_enrolled, now new on lower ph1)',
    report.bronny_like.legacy_cross_class_flip.summary,
    report.bronny_like.legacy_cross_class_flip.rows,
    (row) =>
      `  ${row.issue_date} | ${row.student_name} | ${row.class_name} (${row.class_level_tag}) ph1 | ` +
      `pay=${row.payment_id} inv=${row.invoice_id}`
  );

  printSection(
    'Still misclassified: lower ph1 raw new → re_enrolled with same-day higher class',
    report.bronny_like.still_misclassified_same_day_upsell.summary,
    report.bronny_like.still_misclassified_same_day_upsell.rows,
    (row) =>
      `  ${row.issue_date} | ${row.student_name} | ${row.class_name} (${row.class_level_tag}) | ` +
      `pay=${row.payment_id}`
  );

  printSection(
    'Same-day lower + higher program enrollment pairs (matrix upsell review)',
    report.bronny_like.same_day_upsell_pairs.summary,
    report.bronny_like.same_day_upsell_pairs.rows,
    (row) =>
      `  ${row.enroll_day} | ${row.student_name} | ${row.lower_class_name} (${row.lower_level_tag}) → ` +
      `${row.higher_class_name} (${row.higher_level_tag})`
  );
}

if (report.upsell_merge_candidates) {
  printSection(
    'Upsell merge candidates (lower completed + higher active program)',
    report.upsell_merge_candidates.summary,
    report.upsell_merge_candidates.rows,
    (row) =>
      `  ${row.student_name} | ${row.lower_class_name} (${row.lower_level_tag}, ${row.lower_number_of_phase}ph) → ` +
      `${row.higher_class_name} (${row.higher_level_tag}, ${row.higher_number_of_phase}ph)`
  );
}

console.log('\nDone. Review flagged rows; use --student-id for spot checks.');
