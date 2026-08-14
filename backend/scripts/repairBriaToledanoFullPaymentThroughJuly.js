/**
 * Bria Renesmee M. Toledano — full payment through Phase 7 (July), not October.
 *
 * Student: 356 · jennyrosewin@gmail.com
 * Class: 68 VMP_Playgroup_SS_9:30AM · Branch VMP (6)
 * Invoice: INV-350 Paid "Full Payment Old Rate" (payment 275 on 2025-09-10 kept)
 *
 * Auto-enroll used the full 10-phase class calendar (Jan–Oct), so Month
 * Re-enrollment showed October completed and August re-enrolled. Package ends
 * Phase 7 / July; August must be Inactive.
 *
 *   Phases 1–7 kept (1 new, 2–6 re_enrolled, 7 completed)
 *   Phases 8–10 classstudent rows deleted
 *   Invoice remarks PHASE_START:1 PHASE_END:7
 *   Payment dates unchanged
 *
 * Run:
 *   node backend/scripts/repairBriaToledanoFullPaymentThroughJuly.js --production
 *   node backend/scripts/repairBriaToledanoFullPaymentThroughJuly.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';

const STUDENT_ID = 356;
const STUDENT_EMAIL = 'jennyrosewin@gmail.com';
const CLASS_ID = 68;
const BRANCH_ID = 6;
const INVOICE_ID = 350;
const PAYMENT_ID = 275;
const PHASE_START = 1;
const PHASE_END = 7;
const REMOVE_PHASES = [8, 9, 10];

const REPAIR_NOTE =
  'Ops repair 2026-08-14 — Bria Toledano full payment through Phase 7 (July); remove phases 8–10';

const KEEP_PHASES = [
  { phase: 1, classstudentId: 329, status: 'new' },
  { phase: 2, classstudentId: 330, status: 're_enrolled' },
  { phase: 3, classstudentId: 331, status: 're_enrolled' },
  { phase: 4, classstudentId: 332, status: 're_enrolled' },
  { phase: 5, classstudentId: 333, status: 're_enrolled' },
  { phase: 6, classstudentId: 334, status: 're_enrolled' },
  { phase: 7, classstudentId: 335, status: 'completed' },
];

const EXPECTED_MATRIX = [
  ['2026-01', 'new'],
  ['2026-02', 're-enrolled'],
  ['2026-03', 're-enrolled'],
  ['2026-04', 're-enrolled'],
  ['2026-05', 're-enrolled'],
  ['2026-06', 're-enrolled'],
  ['2026-07', 'completed'],
  ['2026-08', 'Inactive'],
];

const isApply = process.argv.includes('--apply');

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
    const got = String(byMonth[month]?.label || '').trim().toLowerCase();
    const want = String(label).toLowerCase();
    if (got !== want) {
      problems.push(`${month}: expected ${label}, got ${byMonth[month]?.label || '—'}`);
    }
  }
  for (const month of ['2026-09', '2026-10']) {
    const cell = byMonth[month];
    if (cell && (cell.mark === '1' || String(cell.label).toLowerCase() === 'completed')) {
      problems.push(`${month}: should not stay enrolled/completed (got ${cell.label})`);
    }
  }
  return problems;
}

function appendNote(remarks) {
  const text = String(remarks || '');
  return text.includes(REPAIR_NOTE) ? text : [text, REPAIR_NOTE].filter(Boolean).join(';');
}

function ensurePhaseRangeRemarks(remarks) {
  let next = String(remarks || '');
  if (!/CLASS_ID:\d+/i.test(next)) {
    next = [next, `CLASS_ID:${CLASS_ID}`].filter(Boolean).join(';');
  }
  if (/PHASE_START:\d+/i.test(next)) {
    next = next.replace(/PHASE_START:\d+/i, `PHASE_START:${PHASE_START}`);
  } else {
    next = [next, `PHASE_START:${PHASE_START}`].filter(Boolean).join(';');
  }
  if (/PHASE_END:\d+/i.test(next)) {
    next = next.replace(/PHASE_END:\d+/i, `PHASE_END:${PHASE_END}`);
  } else {
    next = [next, `PHASE_END:${PHASE_END}`].filter(Boolean).join(';');
  }
  return appendNote(next);
}

async function main() {
  console.log(
    `\nBria Toledano — full payment through July` +
      `${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`Note: ${REPAIR_NOTE}`);
  console.log(`DB: ${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV}`);
  if (process.env.DB_NAME !== 'psms_production') {
    console.warn('⚠️ Expected psms_production. Pass --production.');
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const student = (
      await client.query(
        `SELECT user_id, full_name, email FROM userstbl
         WHERE user_id = $1 AND LOWER(TRIM(email)) = LOWER(TRIM($2))`,
        [STUDENT_ID, STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student) throw new Error('Student not found');
    console.log('Student:', student.full_name, student.email);

    const profiles = (
      await client.query(
        `SELECT installmentinvoiceprofiles_id FROM installmentinvoiceprofilestbl
         WHERE student_id = $1 AND class_id = $2`,
        [STUDENT_ID, CLASS_ID]
      )
    ).rows;
    if (profiles.length) {
      throw new Error('Unexpected installment profile — this student is full payment only');
    }

    const invoice = (
      await client.query(
        `SELECT i.invoice_id, i.status, i.invoice_description, i.remarks,
                TO_CHAR(i.issue_date, 'YYYY-MM-DD') AS issue
         FROM invoicestbl i
         INNER JOIN invoicestudentstbl ist ON ist.invoice_id = i.invoice_id
         WHERE i.invoice_id = $1 AND ist.student_id = $2`,
        [INVOICE_ID, STUDENT_ID]
      )
    ).rows[0];
    if (!invoice) throw new Error(`INV-${INVOICE_ID} not found for student`);
    if (String(invoice.status) !== 'Paid') {
      throw new Error(`INV-${INVOICE_ID} status ${invoice.status}, expected Paid`);
    }

    const payment = (
      await client.query(
        `SELECT payment_id, TO_CHAR(issue_date, 'YYYY-MM-DD') AS paid_on,
                payable_amount, status
         FROM paymenttbl WHERE payment_id = $1 AND invoice_id = $2`,
        [PAYMENT_ID, INVOICE_ID]
      )
    ).rows[0];
    if (!payment) throw new Error(`Payment ${PAYMENT_ID} not found`);
    console.log('Payment (must stay):', payment);

    const enrollments = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status AS status,
                TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD') AS enrolled
         FROM classstudentstbl
         WHERE student_id = $1 AND class_id = $2
         ORDER BY phase_number, classstudent_id`,
        [STUDENT_ID, CLASS_ID]
      )
    ).rows;
    console.log('\nBEFORE enrollments:');
    console.table(enrollments);
    console.log('\nBEFORE matrix:');
    console.table(await previewMatrix(query));

    console.log('\nPlanned:');
    console.log('  • Keep INV-350 Paid; payment 275 date/amount unchanged');
    console.log('  • Remarks PHASE_START:1 PHASE_END:7');
    for (const cfg of KEEP_PHASES) {
      console.log(`  • P${cfg.phase} CS ${cfg.classstudentId} → ${cfg.status}`);
    }
    console.log(`  • Delete phases ${REMOVE_PHASES.join(', ')}`);

    await client.query(
      `UPDATE invoicestbl SET remarks = $1 WHERE invoice_id = $2`,
      [ensurePhaseRangeRemarks(invoice.remarks), INVOICE_ID]
    );

    for (const cfg of KEEP_PHASES) {
      const existing = enrollments.find(
        (e) => Number(e.classstudent_id) === cfg.classstudentId
      );
      if (!existing) throw new Error(`CS ${cfg.classstudentId} not found`);
      if (Number(existing.phase_number) !== cfg.phase) {
        throw new Error(
          `CS ${cfg.classstudentId} is phase ${existing.phase_number}, expected ${cfg.phase}`
        );
      }
      await client.query(
        `UPDATE classstudentstbl
         SET program_enrollment_status = $1,
             enrolled_by = CASE
               WHEN enrolled_by IS NULL OR TRIM(enrolled_by) = '' THEN $2::text
               WHEN enrolled_by ILIKE '%' || $2::text || '%' THEN enrolled_by
               ELSE enrolled_by || ' | ' || $2::text
             END
         WHERE classstudent_id = $3
           AND student_id = $4
           AND class_id = $5
           AND phase_number = $6`,
        [cfg.status, REPAIR_NOTE, cfg.classstudentId, STUDENT_ID, CLASS_ID, cfg.phase]
      );
      console.log(`✅ P${cfg.phase} CS ${cfg.classstudentId} → ${cfg.status}`);
    }

    const extra = enrollments.filter((e) => REMOVE_PHASES.includes(Number(e.phase_number)));
    if (extra.length !== REMOVE_PHASES.length) {
      throw new Error(
        `Expected phases ${REMOVE_PHASES.join(', ')} to delete, found ${extra
          .map((e) => e.phase_number)
          .join(', ') || 'none'}`
      );
    }
    for (const row of extra) {
      await client.query(
        `DELETE FROM classstudentstbl
         WHERE classstudent_id = $1
           AND student_id = $2
           AND class_id = $3
           AND phase_number = $4`,
        [row.classstudent_id, STUDENT_ID, CLASS_ID, row.phase_number]
      );
      console.log(`✅ Deleted P${row.phase_number} CS ${row.classstudent_id}`);
    }

    const paidOnAfter = (
      await client.query(
        `SELECT TO_CHAR(issue_date, 'YYYY-MM-DD') AS paid_on FROM paymenttbl WHERE payment_id = $1`,
        [PAYMENT_ID]
      )
    ).rows[0]?.paid_on;
    if (paidOnAfter !== payment.paid_on) {
      throw new Error('Payment date changed — abort');
    }

    console.log('\nAFTER matrix:');
    const afterCells = await previewMatrix((text, params) => client.query(text, params));
    console.table(afterCells);
    const problems = assertExpected(afterCells);
    if (problems.length) {
      console.warn('Matrix not fully aligned:');
      problems.forEach((p) => console.warn('  -', p));
    } else {
      console.log('Matrix matches Jan–Jun enrolled, Jul completed, Aug Inactive.');
    }

    if (isApply) {
      await client.query('COMMIT');
      console.log('\n✅ Applied.');
    } else {
      await client.query('ROLLBACK');
      console.log('\nDry run only — re-run with --apply to commit.');
    }
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('\n❌', err.message || err);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main();
