/**
 * Kendra Rafferty Dinoy (keel.arcee@gmail.com, user 536) —
 * Month Re-enrollment cells shifted +1 because profile phase_start is still 1.
 *
 * Class 92 · VMM_Playgroup_SS_11:00-12:00PM · Profile 325 · Malolos (1)
 *
 * Student History enrollment labels are already correct:
 *   P2 new · P3 re_enrolled · P4 dropped · P5 rejoin · P6 re_enrolled
 *
 * Month matrix today (wrong — billing anchored at hidden Phase 1):
 *   Jun new/re-enrolled · Jul re-enrolled · Aug rejoin · Sep rejoin · Oct re-enrolled
 *
 * Desired month matrix:
 *   May new · Jun re-enrolled · Jul dropped · Aug rejoin · Sep re-enrolled
 *
 * Fix:
 *   1. profile phase_start 1 → 2, total_phases 10 → 9 (absolute phases 2–10)
 *   2. downpayment INV-866 remarks PHASE_START:1 → PHASE_START:2
 *   3. (optional safety) normalize P2–P6 enrolled_at / P4 removed_at to month anchors
 *
 * Does NOT change invoice amounts, payment status, or enrollment status labels.
 *
 * Run (from backend/):
 *   node scripts/repairKendraDinoyMatrixMayNew.js --production
 *   node scripts/repairKendraDinoyMatrixMayNew.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';

const STUDENT_ID = 536;
const STUDENT_EMAIL = 'keel.arcee@gmail.com';
const CLASS_ID = 92;
const BRANCH_ID = 1;
const PROFILE_ID = 325;
const DOWNPAYMENT_INVOICE_ID = 866;

const NEW_PHASE_START = 2;
const NEW_TOTAL_PHASES = 9; // absolute phases 2–10

const PHASE_ROWS = [
  { classstudentId: 1168, phase: 2, status: 'new', enrolledAt: '2026-05-09 12:00:00' },
  { classstudentId: 2061, phase: 3, status: 're_enrolled', enrolledAt: '2026-06-06 12:00:00' },
  {
    classstudentId: 2062,
    phase: 4,
    status: 'dropped',
    enrolledAt: '2026-07-01 12:00:00',
    removedAt: '2026-07-01 12:00:00',
  },
  { classstudentId: 2063, phase: 5, status: 'rejoin', enrolledAt: '2026-08-02 12:00:00' },
  { classstudentId: 2444, phase: 6, status: 're_enrolled', enrolledAt: '2026-09-01 12:00:00' },
];

const REPAIR_NOTE =
  'Ops repair 2026-09-07 — Kendra Dinoy phase_start 1→2 so matrix May new / Jun re-enrolled / Jul dropped / Aug rejoin / Sep re-enrolled';

const EXPECTED_MATRIX = [
  ['2026-05', 'new'],
  ['2026-06', 're-enrolled'],
  ['2026-07', 'dropped'],
  ['2026-08', 'rejoin'],
  ['2026-09', 're-enrolled'],
];

const isApply = process.argv.includes('--apply');

function appendNote(existing, note, maxLen = 255) {
  const cur = String(existing || '').trim();
  const add = String(note || '').trim();
  if (!add) return cur || null;
  if (cur.toLowerCase().includes(add.toLowerCase())) return cur;
  if (!cur) return add.length <= maxLen ? add : add.slice(0, maxLen);
  const joined = `${cur} | ${add}`;
  if (joined.length <= maxLen) return joined;
  return cur.length <= maxLen ? cur : cur.slice(0, maxLen);
}

function rewritePhaseStartRemarks(remarks, phaseStart, phaseEnd = 10) {
  let text = String(remarks || '');
  if (/PHASE_START:\d+/i.test(text)) {
    text = text.replace(/PHASE_START:\d+/i, `PHASE_START:${phaseStart}`);
  } else {
    text = text ? `${text};PHASE_START:${phaseStart}` : `PHASE_START:${phaseStart}`;
  }
  if (/PHASE_END:\d+/i.test(text)) {
    text = text.replace(/PHASE_END:\d+/i, `PHASE_END:${phaseEnd}`);
  } else {
    text = `${text};PHASE_END:${phaseEnd}`;
  }
  return text;
}

async function previewMatrix(queryFn) {
  const matrix = await loadStudentMonthEnrollmentMatrix(queryFn, {
    year: 2026,
    branchId: BRANCH_ID,
    classId: CLASS_ID,
  });
  const track = (matrix.students || []).find(
    (s) => Number(s.student_id) === STUDENT_ID && Number(s.class_id) === CLASS_ID
  );
  if (!track) return [];
  const cells = [];
  for (const m of matrix.months || []) {
    const c = track.months?.[m.key];
    if (!c) continue;
    if (c.mark === '1' || c.mark === '✓' || c.mark === 'X' || c.label) {
      cells.push({
        month: m.key,
        label: c.label,
        status: c.status,
        phase: c.phase_number,
        mark: c.mark,
      });
    }
  }
  return cells;
}

function assertExpected(cells) {
  const byMonth = Object.fromEntries(cells.map((c) => [c.month, c]));
  const problems = [];
  for (const [month, label] of EXPECTED_MATRIX) {
    const cell = byMonth[month];
    const got = String(cell?.label || '').toLowerCase();
    const want = String(label).toLowerCase();
    if (!cell || got !== want) {
      problems.push(
        `${month}: expected ${label}, got ${cell ? `${cell.label} (phase ${cell.phase})` : 'missing'}`
      );
    }
  }
  return problems;
}

async function main() {
  console.log(
    `\nKendra Dinoy — matrix May new (phase_start→2)${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`DB: ${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV}`);
  console.log(`Note: ${REPAIR_NOTE}\n`);

  if (process.env.DB_NAME !== 'psms_production') {
    console.warn('⚠️ Expected psms_production. Pass --production.');
  }

  const client = await getClient();
  const txQuery = (text, params) => client.query(text, params);

  try {
    await client.query('BEGIN');

    const student = (
      await client.query(
        `SELECT user_id, full_name, email
         FROM userstbl
         WHERE user_id = $1
           AND LOWER(TRIM(email)) = LOWER(TRIM($2))
           AND user_type = 'Student'`,
        [STUDENT_ID, STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student) throw new Error('Student not found');
    console.log(`Student: ${student.full_name} (${student.email}) id=${student.user_id}`);

    const profile = (
      await client.query(
        `SELECT installmentinvoiceprofiles_id, class_id, phase_start, total_phases,
                generated_count, first_billing_month::text, is_active
         FROM installmentinvoiceprofilestbl
         WHERE installmentinvoiceprofiles_id = $1
           AND student_id = $2
           AND class_id = $3`,
        [PROFILE_ID, STUDENT_ID, CLASS_ID]
      )
    ).rows[0];
    if (!profile) throw new Error(`Profile ${PROFILE_ID} not found`);
    console.log('Profile before:', profile);

    const enrollments = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status AS status,
                TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD HH24:MI') AS enrolled,
                TO_CHAR(TIMEZONE('Asia/Manila', removed_at), 'YYYY-MM-DD HH24:MI') AS removed,
                removed_reason, enrolled_by
         FROM classstudentstbl
         WHERE student_id = $1 AND class_id = $2
         ORDER BY phase_number NULLS LAST, classstudent_id`,
        [STUDENT_ID, CLASS_ID]
      )
    ).rows;
    console.log('\nEnrollments before:');
    for (const row of enrollments) console.log(' ', row);

    console.log('\nMatrix BEFORE:');
    const beforeCells = await previewMatrix(txQuery);
    for (const c of beforeCells) console.log(' ', c);

    // 1) Profile late-start anchor
    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET phase_start = $1,
           total_phases = $2
       WHERE installmentinvoiceprofiles_id = $3`,
      [NEW_PHASE_START, NEW_TOTAL_PHASES, PROFILE_ID]
    );
    console.log(
      `\n→ profile ${PROFILE_ID}: phase_start=${NEW_PHASE_START}, total_phases=${NEW_TOTAL_PHASES}`
    );

    // 2) Downpayment remarks PHASE_START
    const dp = (
      await client.query(
        `SELECT invoice_id, remarks FROM invoicestbl WHERE invoice_id = $1`,
        [DOWNPAYMENT_INVOICE_ID]
      )
    ).rows[0];
    if (!dp) throw new Error(`Downpayment invoice ${DOWNPAYMENT_INVOICE_ID} missing`);
    const newDpRemarks = appendNote(
      rewritePhaseStartRemarks(dp.remarks, NEW_PHASE_START, 10),
      REPAIR_NOTE,
      500
    );
    await client.query(`UPDATE invoicestbl SET remarks = $1 WHERE invoice_id = $2`, [
      newDpRemarks,
      DOWNPAYMENT_INVOICE_ID,
    ]);
    console.log(`→ INV-${DOWNPAYMENT_INVOICE_ID} remarks PHASE_START→${NEW_PHASE_START}`);

    // 3) Normalize enrollment timestamps + keep statuses
    for (const row of PHASE_ROWS) {
      const current = enrollments.find((e) => Number(e.classstudent_id) === row.classstudentId);
      if (!current) throw new Error(`Missing classstudent ${row.classstudentId}`);
      if (String(current.status) !== row.status) {
        throw new Error(
          `CS ${row.classstudentId} status is ${current.status}, expected ${row.status}`
        );
      }

      if (row.status === 'dropped') {
        await client.query(
          `UPDATE classstudentstbl
           SET enrolled_at = $1::timestamp,
               removed_at = $2::timestamp,
               removed_reason = $3
           WHERE classstudent_id = $4
             AND student_id = $5
             AND class_id = $6`,
          [
            row.enrolledAt,
            row.removedAt,
            appendNote(current.removed_reason, REPAIR_NOTE, 255),
            row.classstudentId,
            STUDENT_ID,
            CLASS_ID,
          ]
        );
      } else {
        await client.query(
          `UPDATE classstudentstbl
           SET enrolled_at = $1::timestamp,
               enrolled_by = $2
           WHERE classstudent_id = $3
             AND student_id = $4
             AND class_id = $5`,
          [
            row.enrolledAt,
            appendNote(current.enrolled_by, REPAIR_NOTE, 255),
            row.classstudentId,
            STUDENT_ID,
            CLASS_ID,
          ]
        );
      }
      console.log(
        `→ CS ${row.classstudentId} P${row.phase} ${row.status} enrolled_at=${row.enrolledAt}`
      );
    }

    console.log('\nMatrix AFTER (in transaction):');
    const afterCells = await previewMatrix(txQuery);
    for (const c of afterCells) console.log(' ', c);

    const problems = assertExpected(afterCells);
    if (problems.length) {
      console.error('\n❌ Matrix did not match expected:');
      for (const p of problems) console.error('  -', p);
      await client.query('ROLLBACK');
      process.exitCode = 1;
      return;
    }
    console.log('\n✅ Matrix matches May→Sep target.');

    if (isApply) {
      await client.query('COMMIT');
      console.log('\nCommitted.');
    } else {
      await client.query('ROLLBACK');
      console.log('\nDry run — rolled back. Re-run with --apply to commit.');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\nFailed:', err.message || err);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main();
