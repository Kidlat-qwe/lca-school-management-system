/**
 * Diagnostic: Find full-payment students and show their phase rows.
 *
 * Full-payment students are identified by having classstudentstbl rows
 * for a given class but NO installmentinvoiceprofilestbl record for that
 * same student-class combination.
 *
 * Output for each student-class:
 *   - Student name, class name, branch
 *   - All phase rows (phase_number, program_enrollment_status, enrolled_at, removed_at)
 *   - Computed billing months (base_month + offset) — what the monthly matrix will show
 *
 * Usage:
 *   node backend/scripts/findFullPaymentStudents.js
 *
 * Optional filters (edit the constants below):
 *   FILTER_BRANCH_ID   — limit to one branch  (null = all)
 *   FILTER_CLASS_ID    — limit to one class    (null = all)
 *   FILTER_STUDENT_ID  — limit to one student  (null = all)
 *   LIMIT_ROWS         — max student-class groups to print
 */

import '../config/loadEnv.js';
import { query } from '../config/database.js';

// ── Optional filters ────────────────────────────────────────────────────────
const FILTER_BRANCH_ID  = null;   // e.g. 2
const FILTER_CLASS_ID   = null;   // e.g. 15
const FILTER_STUDENT_ID = null;   // e.g. 301
const LIMIT_ROWS        = 50;     // max student-class groups printed
// ────────────────────────────────────────────────────────────────────────────

const pad  = (str, n) => String(str ?? '').padEnd(n);
const rpad = (str, n) => String(str ?? '').padStart(n);
const fmt  = (date) => date ? new Date(date).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }) : '—';

const addMonths = (ymDate, n) => {
  const d = new Date(ymDate);
  d.setUTCMonth(d.getUTCMonth() + n);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

async function main() {
  console.log('='.repeat(80));
  console.log('FULL-PAYMENT STUDENT DIAGNOSTIC');
  console.log('Criteria: classstudentstbl rows exist BUT no installmentinvoiceprofilestbl record');
  console.log('='.repeat(80));

  // ── 1. Fetch all full-payment student-class combinations ──────────────────
  const filterClauses = [];
  const params = [];
  let idx = 1;

  if (FILTER_BRANCH_ID) {
    filterClauses.push(`c.branch_id = $${idx}`);
    params.push(FILTER_BRANCH_ID);
    idx++;
  }
  if (FILTER_CLASS_ID) {
    filterClauses.push(`cs.class_id = $${idx}`);
    params.push(FILTER_CLASS_ID);
    idx++;
  }
  if (FILTER_STUDENT_ID) {
    filterClauses.push(`cs.student_id = $${idx}`);
    params.push(FILTER_STUDENT_ID);
    idx++;
  }

  const whereStr = filterClauses.length ? `AND ${filterClauses.join(' AND ')}` : '';

  const groupsResult = await query(
    `
      SELECT
        cs.student_id,
        cs.class_id,
        u.full_name                                       AS student_name,
        c.class_name,
        COALESCE(b.branch_nickname, b.branch_name, '—')  AS branch_name,
        MIN(cs.phase_number)                              AS base_phase,
        COUNT(*)                                          AS phase_row_count,
        ARRAY_AGG(
          cs.phase_number ORDER BY cs.phase_number
        )                                                 AS phase_numbers,
        MIN(cs.enrolled_at)                               AS first_enrolled_at,
        c.start_date                                      AS class_start_date
      FROM classstudentstbl cs
      INNER JOIN classestbl   c ON c.class_id   = cs.class_id
      INNER JOIN userstbl     u ON u.user_id    = cs.student_id AND u.user_type = 'Student'
      LEFT  JOIN branchestbl  b ON b.branch_id  = c.branch_id
      WHERE cs.enrolled_at IS NOT NULL
        AND COALESCE(cs.enrolled_by, '') NOT ILIKE '%Rejoin gap marker%'
        AND NOT EXISTS (
          SELECT 1
          FROM installmentinvoiceprofilestbl ip
          WHERE ip.student_id = cs.student_id
            AND ip.class_id   = cs.class_id
        )
        ${whereStr}
      GROUP BY cs.student_id, cs.class_id, u.full_name, c.class_name, b.branch_nickname, b.branch_name, c.start_date
      ORDER BY u.full_name ASC, cs.student_id ASC, cs.class_id ASC
      LIMIT $${idx}
    `,
    [...params, LIMIT_ROWS]
  );

  const groups = groupsResult.rows;

  if (groups.length === 0) {
    console.log('\n✅ No full-payment student-class combinations found (with current filters).');
    process.exit(0);
  }

  console.log(`\nFound ${groups.length} student-class group(s) (limit ${LIMIT_ROWS}).\n`);

  // ── 2. For each group, fetch individual phase rows and print detail ────────
  for (const group of groups) {
    const {
      student_id,
      class_id,
      student_name,
      class_name,
      branch_name,
      base_phase,
      phase_row_count,
      first_enrolled_at,
      class_start_date,
    } = group;

    const anchorDate = class_start_date || first_enrolled_at;
    const anchorMonth = anchorDate
      ? new Date(anchorDate)
          .toLocaleString('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit' })
          .slice(0, 7)
      : '—';

    console.log('─'.repeat(80));
    console.log(`Student : ${student_name}  (ID ${student_id})`);
    console.log(`Class   : ${class_name}  (ID ${class_id})   Branch: ${branch_name}`);
    console.log(
      `Phases  : ${phase_row_count} row(s)   Class start: ${fmt(class_start_date)}   ` +
        `Billing anchor (start month): ${anchorMonth}`
    );
    console.log();

    // Fetch individual rows
    const rowsResult = await query(
      `SELECT
         cs.classstudent_id,
         cs.phase_number,
         cs.program_enrollment_status,
         cs.enrolled_at,
         cs.removed_at,
         cs.enrolled_by
       FROM classstudentstbl cs
       WHERE cs.student_id = $1
         AND cs.class_id   = $2
         AND COALESCE(cs.enrolled_by, '') NOT ILIKE '%Rejoin gap marker%'
       ORDER BY cs.phase_number ASC, cs.enrolled_at ASC`,
      [student_id, class_id]
    );

    // Print header
    console.log(
      `  ${pad('Phase', 7)}${pad('Status', 22)}${pad('enrolled_at', 14)}` +
      `${pad('removed_at', 14)}  ${pad('Billing month (matrix)', 22)}`
    );
    console.log(`  ${'-'.repeat(78)}`);

    for (const row of rowsResult.rows) {
      const phaseOffset = row.phase_number - 1;
      const billingMonth = anchorMonth !== '—' ? addMonths(`${anchorMonth}-01`, phaseOffset) : '—';
      const isActive =
        ['new', 're_enrolled', 'upsell', 'rejoin', 'completed'].includes(row.program_enrollment_status) &&
        !row.removed_at;

      const statusIcon = isActive ? '✅' : (row.removed_at ? '🚫' : '⚠️');

      console.log(
        `  ${statusIcon} ${pad(row.phase_number, 5)}` +
        `${pad(row.program_enrollment_status, 22)}` +
        `${pad(fmt(row.enrolled_at), 14)}` +
        `${pad(fmt(row.removed_at), 14)}  ` +
        `${billingMonth}`
      );
    }
    console.log();
  }

  console.log('='.repeat(80));
  console.log('Legend:');
  console.log('  ✅  Active/completed phase — will show  1  in the monthly matrix for that billing month');
  console.log('  🚫  Dropped/removed phase — will show  -  in the monthly matrix');
  console.log('  ⚠️   Other / edge case');
  console.log();
  console.log('Billing month = class start month + (phase_number − 1) months (full-payment model)');
  console.log('Payment date (enrolled_at) is shown for reference only — matrix uses class start_date.');
  console.log('='.repeat(80));

  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Script error:', err.message || err);
  process.exit(1);
});
