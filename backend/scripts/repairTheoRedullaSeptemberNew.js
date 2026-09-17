/**
 * Theo Redulla (fbredulla@yahoo.com, user 694) —
 * Full payment late join: Month Re-enrollment "new" should be September, not April.
 *
 * Production · Class 94 VMM_Playgroup_TTh 1:00 PM · Branch 1 (Malolos)
 * INV-2904 Paid Full Payment_Rainy Day Discount (paid 2026-09-05)
 * No installment profile → matrix uses class-start billing (class start Apr 2026):
 *   P1 Apr new · P2–P9 May–Dec re_enrolled · P10 Jan completed
 *
 * Desired (joined/paid in September):
 *   Sep new · Oct–Dec re_enrolled · (Apr–Aug blank)
 *
 * Fix (same pattern as Bria full-payment phase trim):
 *   1. Delete Phase 1–5 classstudent rows (CS 2699–2703)
 *   2. Phase 6 (CS 2704) re_enrolled → new
 *   3. Keep P7–P9 re_enrolled, P10 completed
 *   4. Stamp INV-2904 remarks PHASE_START:6 PHASE_END:10
 *
 * Run (from backend/):
 *   node scripts/repairTheoRedullaSeptemberNew.js --production
 *   node scripts/repairTheoRedullaSeptemberNew.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';

const STUDENT_ID = 694;
const STUDENT_EMAIL = 'fbredulla@yahoo.com';
const CLASS_ID = 94;
const BRANCH_ID = 1;
const INVOICE_ID = 2904;

const PHASE_START = 6;
const PHASE_END = 10;
const REMOVE_PHASES = [1, 2, 3, 4, 5];

const KEEP_PHASES = [
  { phase: 6, classstudentId: 2704, status: 'new' },
  { phase: 7, classstudentId: 2705, status: 're_enrolled' },
  { phase: 8, classstudentId: 2706, status: 're_enrolled' },
  { phase: 9, classstudentId: 2707, status: 're_enrolled' },
  { phase: 10, classstudentId: 2708, status: 'completed' },
];

const REMOVE_CS_IDS = [2699, 2700, 2701, 2702, 2703];

const REPAIR_NOTE =
  'Ops repair 2026-09-16 — Theo Redulla full payment: matrix new Apr→Sep (trim P1–5; P6 new)';

const EXPECTED_MATRIX = [
  ['2026-09', 'new'],
  ['2026-10', 're-enrolled'],
  ['2026-11', 're-enrolled'],
  ['2026-12', 're-enrolled'],
];

const isApply = process.argv.includes('--apply');

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

async function loadEnrollments(client) {
  const res = await client.query(
    `SELECT classstudent_id, phase_number, program_enrollment_status AS status,
            TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD HH24:MI') AS enrolled
     FROM classstudentstbl
     WHERE student_id = $1 AND class_id = $2
     ORDER BY phase_number NULLS LAST, classstudent_id`,
    [STUDENT_ID, CLASS_ID]
  );
  return res.rows;
}

function assertExpected(cells) {
  const byMonth = Object.fromEntries(cells.map((c) => [c.month, c]));
  const problems = [];
  for (const [month, label] of EXPECTED_MATRIX) {
    const got = String(byMonth[month]?.label || '').trim().toLowerCase();
    if (got !== label.toLowerCase()) {
      problems.push(`${month}: expected ${label}, got ${byMonth[month]?.label || '—'}`);
    }
  }
  for (const month of ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08']) {
    const cell = byMonth[month];
    if (cell && (cell.mark === '1' || cell.mark === '✓' || cell.label === 'new')) {
      problems.push(`${month}: should be blank (got ${cell.label || cell.mark})`);
    }
  }
  return problems;
}

async function main() {
  console.log(
    `\nTheo Redulla — full payment matrix September new` +
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
        `SELECT user_id, full_name, email, branch_id FROM userstbl
         WHERE user_id = $1 AND LOWER(TRIM(email)) = LOWER(TRIM($2)) AND user_type = 'Student'`,
        [STUDENT_ID, STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student) throw new Error('Student not found');
    if (Number(student.branch_id) !== BRANCH_ID) {
      throw new Error(`Branch ${student.branch_id} ≠ ${BRANCH_ID}`);
    }
    console.log('Student:', student.full_name, student.email);

    const profiles = (
      await client.query(
        `SELECT installmentinvoiceprofiles_id FROM installmentinvoiceprofilestbl
         WHERE student_id = $1 AND class_id = $2`,
        [STUDENT_ID, CLASS_ID]
      )
    ).rows;
    if (profiles.length) {
      throw new Error('Unexpected installment profile — expected full payment only');
    }

    const invoice = (
      await client.query(
        `SELECT i.invoice_id, i.status, i.remarks,
                LEFT(i.invoice_description, 80) AS descr
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

    const beforeEnroll = await loadEnrollments(client);
    console.log('\nBEFORE enrollments:');
    console.table(beforeEnroll);
    console.log('BEFORE matrix:');
    console.table(await previewMatrix(query));

    for (const cfg of KEEP_PHASES) {
      const row = beforeEnroll.find((r) => Number(r.classstudent_id) === cfg.classstudentId);
      if (!row || Number(row.phase_number) !== cfg.phase) {
        throw new Error(
          `Expected CS ${cfg.classstudentId} phase ${cfg.phase}, got ${JSON.stringify(row)}`
        );
      }
    }
    for (const csId of REMOVE_CS_IDS) {
      const row = beforeEnroll.find((r) => Number(r.classstudent_id) === csId);
      if (!row || !REMOVE_PHASES.includes(Number(row.phase_number))) {
        throw new Error(`Expected remove CS ${csId} in phases ${REMOVE_PHASES}, got ${JSON.stringify(row)}`);
      }
    }

    console.log('\nPlanned:');
    console.log(`  1. DELETE classstudent phases ${REMOVE_PHASES.join(', ')} (CS ${REMOVE_CS_IDS.join(', ')})`);
    console.log(`  2. CS 2704 Phase 6: re_enrolled → new`);
    console.log(`  3. Keep P7–P9 re_enrolled, P10 completed`);
    console.log(`  4. INV-${INVOICE_ID} remarks PHASE_START:${PHASE_START} PHASE_END:${PHASE_END}`);
    console.log('  5. Expect matrix: Sep new · Oct–Dec re-enrolled · Apr–Aug blank');

    // Apply writes inside txn; dry-run rolls back after matrix preview
    await client.query(
      `DELETE FROM classstudentstbl
       WHERE student_id = $1
         AND class_id = $2
         AND classstudent_id = ANY($3::int[])
         AND phase_number = ANY($4::int[])`,
      [STUDENT_ID, CLASS_ID, REMOVE_CS_IDS, REMOVE_PHASES]
    );
    console.log(`→ Deleted Phase ${REMOVE_PHASES.join('-')} rows`);

    for (const cfg of KEEP_PHASES) {
      await client.query(
        `UPDATE classstudentstbl
         SET program_enrollment_status = $1,
             removed_at = NULL,
             removed_reason = NULL,
             removed_by = NULL,
             enrolled_by = CASE
               WHEN enrolled_by IS NULL OR BTRIM(enrolled_by) = '' THEN $2
               WHEN enrolled_by LIKE '%' || $2 || '%' THEN enrolled_by
               ELSE LEFT(enrolled_by || ' | ' || $2, 255)
             END
         WHERE classstudent_id = $3
           AND student_id = $4
           AND class_id = $5
           AND phase_number = $6`,
        [cfg.status, REPAIR_NOTE, cfg.classstudentId, STUDENT_ID, CLASS_ID, cfg.phase]
      );
      console.log(`→ CS ${cfg.classstudentId} P${cfg.phase} → ${cfg.status}`);
    }

    const nextRemarks = ensurePhaseRangeRemarks(invoice.remarks);
    await client.query(
      `UPDATE invoicestbl SET remarks = $1 WHERE invoice_id = $2`,
      [nextRemarks, INVOICE_ID]
    );
    console.log(`→ INV-${INVOICE_ID} remarks updated`);

    const afterEnroll = await loadEnrollments(client);
    console.log('\nAFTER enrollments (in txn):');
    console.table(afterEnroll);

    // Preview matrix inside the same transaction (sees uncommitted writes).
    const txQuery = (text, params) => client.query(text, params);
    const afterMatrix = await previewMatrix(txQuery);
    console.log('AFTER matrix (projected):');
    console.table(afterMatrix);

    const problems = assertExpected(afterMatrix);
    if (problems.length) {
      console.warn('⚠️ Matrix validation:');
      for (const p of problems) console.warn('  -', p);
      throw new Error('Matrix projection did not match expected September new');
    }
    console.log('Matrix OK: Sep new · Oct–Dec re-enrolled · Apr–Aug blank');

    if (isApply) {
      await client.query('COMMIT');
      console.log('\n✅ Applied.');
      console.log('AFTER matrix (committed):');
      console.table(await previewMatrix(query));
    } else {
      await client.query('ROLLBACK');
      console.log('\nDry run only (rolled back). Re-run with --production --apply to commit.');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\n❌ Failed:', err.message || err);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
