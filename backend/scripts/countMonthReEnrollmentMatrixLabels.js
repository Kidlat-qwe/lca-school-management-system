/**
 * Count labeled cells on the Month Re-enrollment dashboard matrix (same rules as the UI).
 *
 * Counts every visible matrix cell label for the selected year — including "new" and
 * "re-enrolled" — and verifies rate-header numerators match re-enrolled cell counts.
 *
 * Usage:
 *   node scripts/countMonthReEnrollmentMatrixLabels.js --year=2026
 *   node scripts/countMonthReEnrollmentMatrixLabels.js --year=2026 --branch-id=1
 *   node scripts/countMonthReEnrollmentMatrixLabels.js --year=2026 --program-id=2 --class-id=34
 *   node scripts/countMonthReEnrollmentMatrixLabels.js --year=2026 --verbose
 *   node scripts/countMonthReEnrollmentMatrixLabels.js --year=2026 --json
 */
import '../config/loadEnv.js';
import { query } from '../config/database.js';
import {
  aggregateMonthMatrixKpiTotals,
  countMonthMatrixRateHeaderDenominator,
  countMonthMatrixRateHeaderNumerator,
  countMonthMatrixStatusLabels,
  loadStudentMonthEnrollmentMatrix,
} from '../lib/enrollmentRateMetrics.js';

const LABELS_OF_INTEREST = new Set(['new', 're-enrolled']);

const parseArgs = () => {
  const options = {
    year: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }).slice(0, 4),
    branchId: null,
    programId: null,
    classId: null,
    verbose: false,
    json: false,
    help: false,
  };

  for (const arg of process.argv.slice(2)) {
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    const match = arg.match(/^--([\w-]+)=(.+)$/);
    if (!match) continue;
    const key = match[1].replace(/-/g, '_');
    const value = match[2].trim();
    if (key === 'year') options.year = value;
    if (key === 'branch_id') options.branchId = parseInt(value, 10);
    if (key === 'program_id') options.programId = parseInt(value, 10);
    if (key === 'class_id') options.classId = parseInt(value, 10);
  }

  return options;
};

const printHelp = () => {
  console.log(`
Count Month Re-enrollment matrix cell labels (dashboard table rules).

Options:
  --year=YYYY          Calendar year (default: current Manila year)
  --branch-id=N        Optional branch filter
  --program-id=N       Optional program filter
  --class-id=N         Optional class filter
  --verbose, -v        List each new / re-enrolled cell (student + month)
  --json               Machine-readable output
  --help, -h           Show this help

Examples:
  node scripts/countMonthReEnrollmentMatrixLabels.js --year=2026
  node scripts/countMonthReEnrollmentMatrixLabels.js --year=2026 --verbose
`);
};

const collectLabelCells = (students, months, labels) => {
  const rows = [];
  for (const student of students) {
    for (const month of months) {
      const cell = student.months?.[month.key];
      if (!cell?.label || !labels.has(cell.label)) continue;
      rows.push({
        month_key: month.key,
        month_label: month.label,
        label: cell.label,
        student_id: student.student_id,
        student_name: student.student_name || student.display_name || `Student ${student.student_id}`,
        class_name: student.class_name || null,
        enrollment_track_key: student.enrollment_track_key || null,
      });
    }
  }
  return rows;
};

const main = async () => {
  const opts = parseArgs();
  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  const year = parseInt(String(opts.year), 10);
  if (!Number.isFinite(year)) {
    console.error('Invalid --year');
    process.exit(1);
  }

  const matrix = await loadStudentMonthEnrollmentMatrix(query, {
    year,
    branchId: opts.branchId,
    programId: opts.programId,
    classId: opts.classId,
  });

  const students = matrix.students || [];
  const months = matrix.months || [];
  const kpiTotals = aggregateMonthMatrixKpiTotals(students, months);

  const perMonth = months.map((month, index) => {
    const counts = countMonthMatrixStatusLabels(students, month.key);
    const stat = (matrix.month_stats || []).find((row) => row.month_key === month.key) || {};
    const prevKey = index > 0 ? months[index - 1].key : null;
    const visibleRateNumerator = countMonthMatrixRateHeaderNumerator(students, month.key);
    const visibleRateDenominator =
      prevKey != null
        ? countMonthMatrixRateHeaderDenominator(students, prevKey, month.key, months)
        : 0;
    let visibleReEnrolled = 0;
    let visibleCompleted = 0;
    let priorNew = 0;
    let priorReEnrolled = 0;
    let priorRejoin = 0;
    let priorUpsell = 0;
    for (const student of students) {
      const cell = student.months?.[month.key];
      if (cell?.label && cell.mark === '1') {
        if (cell.label === 're-enrolled') visibleReEnrolled += 1;
        else if (cell.label === 'completed') visibleCompleted += 1;
      }
      if (prevKey) {
        const priorCell = student.months?.[prevKey];
        if (!priorCell?.label || priorCell.mark !== '1') continue;
        if (priorCell.label === 'new') priorNew += 1;
        else if (priorCell.label === 're-enrolled') priorReEnrolled += 1;
        else if (priorCell.label === 'rejoin') priorRejoin += 1;
        else if (priorCell.label === 'upsell') priorUpsell += 1;
      }
    }
    return {
      month_key: month.key,
      month_label: month.label,
      new_cells: counts.new_enrollees_count,
      re_enrolled_cells: counts.re_enrollment_count,
      new_plus_re_enrolled: counts.new_enrollees_count + counts.re_enrollment_count,
      upsell_cells: counts.upsell_count,
      reserved_cells: counts.reserved_count,
      dropped_cells: counts.dropped_unenrolled_count,
      rejoin_cells: counts.rejoin_count,
      visible_re_enrolled_cells: visibleReEnrolled,
      visible_completed_cells: visibleCompleted,
      prior_month_new: priorNew,
      prior_month_re_enrolled: priorReEnrolled,
      prior_month_rejoin: priorRejoin,
      prior_month_upsell: priorUpsell,
      prior_month_active_total: priorNew + priorReEnrolled + priorRejoin + priorUpsell,
      visible_rate_numerator: visibleRateNumerator,
      visible_rate_denominator: visibleRateDenominator,
      rate_numerator: stat.re_enrolled_count ?? 0,
      rate_denominator: stat.prior_month_enrolled_count ?? 0,
      rate_percent: stat.re_enrollment_rate,
    };
  });

  const sumRateNumerators = perMonth.reduce((sum, row) => sum + row.rate_numerator, 0);
  const sumRateDenominators = perMonth
    .filter((row) => row.rate_denominator > 0)
    .reduce((sum, row) => sum + row.rate_denominator, 0);

  const detailRows = opts.verbose
    ? collectLabelCells(students, months, LABELS_OF_INTEREST)
    : [];

  const payload = {
    scope: {
      year,
      branch_id: opts.branchId,
      program_id: opts.programId,
      class_id: opts.classId,
      cohort_students: matrix.cohort_size ?? students.length,
    },
    totals: {
      new_cells: kpiTotals.new_enrollees_count,
      re_enrolled_cells: kpiTotals.re_enrollment_count,
      new_plus_re_enrolled:
        kpiTotals.new_enrollees_count + kpiTotals.re_enrollment_count,
      upsell_cells: kpiTotals.upsell_count,
      reserved_cells: kpiTotals.reserved_count,
      dropped_cells: kpiTotals.dropped_count,
      rejoin_cells: kpiTotals.rejoin_count,
      rate_numerator_sum: matrix.total_re_enrolled_count ?? sumRateNumerators,
      rate_denominator_sum: matrix.total_prior_month_enrolled_count ?? sumRateDenominators,
      rate_percent: matrix.total_re_enrollment_rate ?? null,
    },
    per_month: perMonth,
    dashboard_mapping: {
      new_enrollees_kpi_card: kpiTotals.new_enrollees_count,
      re_enrollment_kpi_card: kpiTotals.re_enrollment_count,
      reserved_kpi_card: kpiTotals.reserved_count,
      upsell_kpi_card: kpiTotals.upsell_count,
      rate_numerator_sum_for_percent_card: matrix.total_re_enrolled_count ?? sumRateNumerators,
      note:
        'Rate denominator = prior-month new + re-enrolled + rejoin + upsell. Rate numerator = re-enrolled + completed in current month (upsell excluded).',
    },
    cells: detailRows,
  };

  if (opts.json) {
    console.log(JSON.stringify(payload, null, 2));
    process.exit(0);
  }

  console.log('Month Re-enrollment matrix label counts');
  console.log('═'.repeat(72));
  console.log(
    `Year: ${year}` +
      (opts.branchId ? ` | branch_id=${opts.branchId}` : '') +
      (opts.programId ? ` | program_id=${opts.programId}` : '') +
      (opts.classId ? ` | class_id=${opts.classId}` : '') +
      ` | cohort rows: ${payload.scope.cohort_students}`
  );
  console.log('');

  console.log('Per month (matrix cell labels vs rate fraction):');
  console.log(
    'Month'.padEnd(8) +
      'New'.padStart(6) +
      'Re-enr'.padStart(8) +
      'New+Re'.padStart(8) +
      'Rate#'.padStart(8) +
      'Rate/'.padStart(8) +
      '  %'
  );
  console.log('-'.repeat(72));
  for (const row of perMonth) {
    const frac =
      row.rate_denominator > 0
        ? `${row.rate_numerator}/${row.rate_denominator}`
        : '—';
    const pct =
      row.rate_percent != null ? `${Number(row.rate_percent).toFixed(0)}%` : '—';
    console.log(
      row.month_label.padEnd(8) +
        String(row.new_cells).padStart(6) +
        String(row.re_enrolled_cells).padStart(8) +
        String(row.new_plus_re_enrolled).padStart(8) +
        String(row.rate_numerator).padStart(8) +
        frac.padStart(8) +
        `  ${pct}`
    );
  }
  console.log('-'.repeat(72));
  console.log(
    'TOTAL'.padEnd(8) +
      String(payload.totals.new_cells).padStart(6) +
      String(payload.totals.re_enrolled_cells).padStart(8) +
      String(payload.totals.new_plus_re_enrolled).padStart(8) +
      String(payload.totals.rate_numerator_sum).padStart(8)
  );
  console.log('');

  console.log('Year totals (all labeled cells in matrix):');
  console.log(`  New enrollees cells:     ${payload.totals.new_cells}`);
  console.log(`  Re-enrolled cells:       ${payload.totals.re_enrolled_cells}`);
  console.log(`  New + Re-enrolled:       ${payload.totals.new_plus_re_enrolled}`);
  console.log(`  Upsell cells:            ${payload.totals.upsell_cells}`);
  console.log(`  Reserved cells:          ${payload.totals.reserved_cells}`);
  console.log(`  Dropped/unenrolled:      ${payload.totals.dropped_cells}`);
  console.log(`  Rejoin cells:            ${payload.totals.rejoin_cells}`);
  console.log('');
  console.log('Rate header row (month-to-month retention, re-enrolled only):');
  console.log(`  Sum of numerators:       ${payload.totals.rate_numerator_sum}`);
  console.log(`  Sum of denominators:     ${payload.totals.rate_denominator_sum}`);
  console.log(
    `  Total re-enrollment rate: ${
      payload.totals.rate_percent != null
        ? `${Number(payload.totals.rate_percent).toFixed(2)}%`
        : '—'
    }`
  );
  console.log('');
  console.log('Dashboard KPI mapping:');
  console.log(`  New enrollees card:      ${payload.dashboard_mapping.new_enrollees_kpi_card}`);
  console.log(`  Re-enrollment card:      ${payload.dashboard_mapping.re_enrollment_kpi_card}`);
  console.log(
    `  Rate % card (numerators): ${payload.dashboard_mapping.rate_numerator_sum_for_percent_card}`
  );

  if (opts.verbose && detailRows.length) {
    console.log('');
    console.log(`New + Re-enrolled cell listing (${detailRows.length} cells):`);
    for (const row of detailRows) {
      console.log(
        `  ${row.month_key} | ${row.label.padEnd(12)} | ${row.student_name}` +
          (row.class_name ? ` | ${row.class_name}` : '')
      );
    }
  }

  process.exit(0);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
