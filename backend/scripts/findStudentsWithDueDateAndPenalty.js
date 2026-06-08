/**
 * Find students with an invoice due date in a target month (default: June 5, 2026)
 * who already have a late-payment penalty applied.
 *
 * Penalty detected when either:
 *   - invoicestbl.late_penalty_applied_for_due_date IS NOT NULL, or
 *   - any invoiceitemstbl line has penalty_amount > 0
 *
 * Usage (from repo root):
 *   node backend/scripts/findStudentsWithDueDateAndPenalty.js
 *   node backend/scripts/findStudentsWithDueDateAndPenalty.js --year=2026 --month=6 --day=5
 *   node backend/scripts/findStudentsWithDueDateAndPenalty.js --year=2026 --month=6
 *     (all due dates in June, any day)
 *   node backend/scripts/findStudentsWithDueDateAndPenalty.js --include-settled
 *     (include Paid/Cancelled invoices that still have penalty lines)
 *
 * Args:
 *   --year=YYYY          Calendar year (default: 2026)
 *   --month=M            Month 1–12 (default: 6 = June)
 *   --day=D              Optional day-of-month (default: 5). Use --day= or --whole-month for any day.
 *   --include-settled    Include Paid/Cancelled invoices (default: open invoices only)
 */

import '../config/loadEnv.js';
import { query } from '../config/database.js';

const parseArgs = () => {
  const out = {
    year: 2026,
    month: 6,
    day: 5,
    wholeMonth: false,
    includeSettled: false,
  };

  for (const raw of process.argv.slice(2)) {
    if (raw === '--include-settled') {
      out.includeSettled = true;
      continue;
    }
    if (raw === '--whole-month' || raw === '--day=') {
      out.wholeMonth = true;
      out.day = null;
      continue;
    }
    const match = raw.match(/^--(\w+)=(.*)$/);
    if (!match) continue;
    const [, key, val] = match;
    if (key === 'year') out.year = parseInt(val, 10);
    if (key === 'month') out.month = parseInt(val, 10);
    if (key === 'day') {
      if (val === '' || val === 'all') {
        out.wholeMonth = true;
        out.day = null;
      } else {
        out.day = parseInt(val, 10);
        out.wholeMonth = false;
      }
    }
  }

  if (!Number.isInteger(out.year) || out.year < 2000 || out.year > 2100) {
    throw new Error(`Invalid --year=${out.year}`);
  }
  if (!Number.isInteger(out.month) || out.month < 1 || out.month > 12) {
    throw new Error(`Invalid --month=${out.month}`);
  }
  if (out.day != null && (!Number.isInteger(out.day) || out.day < 1 || out.day > 31)) {
    throw new Error(`Invalid --day=${out.day}`);
  }

  return out;
};

const MONTH_NAMES = [
  '',
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const formatYmd = (value) => {
  if (!value) return '—';
  const text = String(value).slice(0, 10);
  return text || '—';
};

async function main() {
  const { year, month, day, wholeMonth, includeSettled } = parseArgs();
  const monthLabel = MONTH_NAMES[month] || String(month);
  const dueLabel = wholeMonth
    ? `${monthLabel} ${year} (any day)`
    : `${monthLabel} ${String(day).padStart(2, '0')}, ${year}`;

  console.log('='.repeat(88));
  console.log('STUDENTS WITH DUE DATE + PENALTY');
  console.log(`Target due date: ${dueLabel}`);
  console.log('='.repeat(88));

  const params = [year, month];
  let dayClause = '';
  if (!wholeMonth && day != null) {
    params.push(day);
    dayClause = `AND EXTRACT(DAY FROM i.due_date)::int = $3`;
  }

  const sql = `
    SELECT
      u.user_id,
      u.full_name AS student_name,
      u.email AS student_email,
      i.invoice_id,
      i.invoice_ar_number,
      i.status AS invoice_status,
      TO_CHAR(i.due_date, 'YYYY-MM-DD') AS due_date,
      i.late_penalty_applied_for_due_date,
      COALESCE(pen.penalty_total, 0)::numeric AS penalty_total,
      COALESCE(pen.penalty_line_count, 0)::int AS penalty_line_count,
      ip.installmentinvoiceprofiles_id AS profile_id,
      c.class_id,
      c.class_name,
      COALESCE(b.branch_nickname, b.branch_name) AS branch_name
    FROM invoicestbl i
    INNER JOIN invoicestudentstbl ist ON ist.invoice_id = i.invoice_id
    INNER JOIN userstbl u ON u.user_id = ist.student_id
    LEFT JOIN installmentinvoiceprofilestbl ip
      ON ip.installmentinvoiceprofiles_id = i.installmentinvoiceprofiles_id
    LEFT JOIN classestbl c ON c.class_id = ip.class_id
    LEFT JOIN branchestbl b ON b.branch_id = COALESCE(ip.branch_id, c.branch_id)
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(SUM(ii.penalty_amount), 0) AS penalty_total,
        COUNT(*) FILTER (WHERE COALESCE(ii.penalty_amount, 0) > 0) AS penalty_line_count
      FROM invoiceitemstbl ii
      WHERE ii.invoice_id = i.invoice_id
    ) pen ON TRUE
    WHERE COALESCE(u.user_type, '') = 'Student'
      AND i.due_date IS NOT NULL
      AND EXTRACT(YEAR FROM i.due_date)::int = $1
      AND EXTRACT(MONTH FROM i.due_date)::int = $2
      ${dayClause}
      ${includeSettled ? '' : "AND COALESCE(i.status, '') NOT IN ('Cancelled', 'Paid')"}
      AND (
        i.late_penalty_applied_for_due_date IS NOT NULL
        OR COALESCE(pen.penalty_total, 0) > 0
      )
    ORDER BY u.full_name, i.due_date, i.invoice_id;
  `;

  const { rows } = await query(sql, params);

  if (rows.length === 0) {
    console.log('\nNo matching students/invoices found.');
    console.log(
      '\nTip: use --whole-month or --day= to search all days in the month, or change --year/--month.'
    );
    process.exit(0);
  }

  const byStudent = new Map();
  for (const row of rows) {
    const key = row.user_id;
    if (!byStudent.has(key)) {
      byStudent.set(key, {
        user_id: row.user_id,
        student_name: row.student_name,
        student_email: row.student_email,
        invoices: [],
      });
    }
    byStudent.get(key).invoices.push(row);
  }

  console.log(`\nDistinct students: ${byStudent.size}`);
  console.log(`Matching invoice rows: ${rows.length}\n`);

  for (const student of byStudent.values()) {
    console.log('-'.repeat(88));
    console.log(
      `${student.student_name} (user_id=${student.user_id}, ${student.student_email || 'no email'})`
    );
    for (const inv of student.invoices) {
      console.log(
        [
          `  INV #${inv.invoice_id}`,
          inv.invoice_ar_number ? `AR ${inv.invoice_ar_number}` : null,
          `due ${formatYmd(inv.due_date)}`,
          `status ${inv.invoice_status || '—'}`,
          `penalty ₱${Number(inv.penalty_total || 0).toFixed(2)}`,
          inv.late_penalty_applied_for_due_date
            ? `late_penalty_flag ${formatYmd(inv.late_penalty_applied_for_due_date)}`
            : null,
          inv.class_name ? `class ${inv.class_name}` : null,
          inv.branch_name ? `branch ${inv.branch_name}` : null,
        ]
          .filter(Boolean)
          .join(' | ')
      );
    }
  }

  console.log('\n' + '='.repeat(88));
  console.log(
    JSON.stringify(
      {
        filter: { year, month, day: wholeMonth ? null : day, wholeMonth, includeSettled },
        distinctStudents: byStudent.size,
        invoiceCount: rows.length,
        rows,
      },
      null,
      2
    )
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
