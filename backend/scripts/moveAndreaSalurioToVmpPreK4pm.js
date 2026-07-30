/**
 * Move Andrea Claire Salurio from VMP_Pre-Kindergarten_MWF_2:30PM →
 * VMP_Pre-Kindergarten_MWF_4PM (phase 10 completed enrollments).
 *
 * Why a script: POST /classes/move-student only moves active statuses
 * (new / re_enrolled / upsell / rejoin) — not `completed`.
 *
 * Context (production):
 *   Student user_id 640 · deegurrolajanine123@gmail.com
 *   Source class 65  VMP_Pre-Kindergarten_MWF_2:30PM — phase 10 completed
 *     (duplicate rows classstudent_id 1463 + 1532)
 *   Target class 66  VMP_Pre-Kindergarten_MWF_4PM — currently Inactive / ended
 *   Phases 1–9 already on class 162 NC_Pre-Kindergarten_MWF 4PM (unchanged)
 *   INV-1837 / INV-1853 remarks CLASS_ID:65 → CLASS_ID:66
 *   No attendance rows on source class
 *
 * WARNING: Target class 66 is Inactive (end_date 2026-07-17). Confirm with ops
 * before --apply. If the intent was Active NC_Pre-Kindergarten_MWF 4PM (162),
 * do not use this script — ask for a revised target.
 *
 * Usage (from backend/):
 *   node scripts/moveAndreaSalurioToVmpPreK4pm.js
 *   node scripts/moveAndreaSalurioToVmpPreK4pm.js --apply
 *   node scripts/moveAndreaSalurioToVmpPreK4pm.js --apply --reactivate-target
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';

const STUDENT_ID = 640;
const STUDENT_EMAIL = 'deegurrolajanine123@gmail.com';
const SOURCE_CLASS_ID = 65;
const SOURCE_CLASS_NAME = 'VMP_Pre-Kindergarten_MWF_2:30PM';
const TARGET_CLASS_ID = 66;
const TARGET_CLASS_NAME = 'VMP_Pre-Kindergarten_MWF_4PM';

/** Keep earliest phase-10 row; soft-remove the duplicate. */
const KEEP_ENROLLMENT_ID = 1463;
const DUPLICATE_ENROLLMENT_ID = 1532;
const INVOICE_IDS = [1837, 1853];

const isApply = process.argv.includes('--apply');
const reactivateTarget = process.argv.includes('--reactivate-target');

const REPAIR_NOTE =
  'Ops repair — Andrea Salurio: move completed phase 10 from VMP 2:30PM (65) → VMP 4PM (66)';

async function loadSnapshot(queryFn = query) {
  const student = (
    await queryFn(
      `SELECT user_id, full_name, email, branch_id
       FROM userstbl WHERE user_id = $1`,
      [STUDENT_ID]
    )
  ).rows[0];

  const source = (
    await queryFn(
      `SELECT class_id, class_name, status, branch_id, program_id, max_students,
              TO_CHAR(start_date, 'YYYY-MM-DD') AS start_ymd,
              TO_CHAR(end_date, 'YYYY-MM-DD') AS end_ymd
       FROM classestbl WHERE class_id = $1`,
      [SOURCE_CLASS_ID]
    )
  ).rows[0];

  const target = (
    await queryFn(
      `SELECT class_id, class_name, status, branch_id, program_id, max_students,
              TO_CHAR(start_date, 'YYYY-MM-DD') AS start_ymd,
              TO_CHAR(end_date, 'YYYY-MM-DD') AS end_ymd
       FROM classestbl WHERE class_id = $1`,
      [TARGET_CLASS_ID]
    )
  ).rows[0];

  const sourceEnrollments = (
    await queryFn(
      `SELECT classstudent_id, class_id, phase_number, program_enrollment_status,
              removed_at,
              TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD HH24:MI') AS enrolled
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2
       ORDER BY classstudent_id`,
      [STUDENT_ID, SOURCE_CLASS_ID]
    )
  ).rows;

  const targetEnrollments = (
    await queryFn(
      `SELECT classstudent_id, phase_number, program_enrollment_status, removed_at
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2
       ORDER BY classstudent_id`,
      [STUDENT_ID, TARGET_CLASS_ID]
    )
  ).rows;

  const ncEnrollments = (
    await queryFn(
      `SELECT classstudent_id, phase_number, program_enrollment_status
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = 162 AND removed_at IS NULL
       ORDER BY phase_number`,
      [STUDENT_ID]
    )
  ).rows;

  const invoices = (
    await queryFn(
      `SELECT i.invoice_id, i.status, i.invoice_ar_number, i.remarks
       FROM invoicestbl i
       JOIN invoicestudentstbl ist ON ist.invoice_id = i.invoice_id
       WHERE ist.student_id = $1 AND i.invoice_id = ANY($2::int[])
       ORDER BY i.invoice_id`,
      [STUDENT_ID, INVOICE_IDS]
    )
  ).rows;

  const attendanceCount = (
    await queryFn(
      `SELECT COUNT(*)::int AS n
       FROM attendancetbl a
       JOIN classsessionstbl cs ON cs.classsession_id = a.classsession_id
       WHERE a.student_id = $1 AND cs.class_id = $2`,
      [STUDENT_ID, SOURCE_CLASS_ID]
    )
  ).rows[0]?.n;

  const profiles = (
    await queryFn(
      `SELECT installmentinvoiceprofiles_id, class_id, is_active
       FROM installmentinvoiceprofilestbl
       WHERE student_id = $1 AND class_id = ANY($2::int[])`,
      [STUDENT_ID, [SOURCE_CLASS_ID, TARGET_CLASS_ID]]
    )
  ).rows;

  return {
    student,
    source,
    target,
    sourceEnrollments,
    targetEnrollments,
    ncEnrollments,
    invoices,
    attendanceCount,
    profiles,
  };
}

async function main() {
  console.log(
    `\nAndrea Salurio — move to ${TARGET_CLASS_NAME}${
      isApply ? ' (APPLY)' : ' (DRY RUN)'
    }\n`
  );
  console.log(`Note: ${REPAIR_NOTE}\n`);

  const before = await loadSnapshot();

  if (!before.student || Number(before.student.user_id) !== STUDENT_ID) {
    throw new Error(`Student ${STUDENT_ID} not found`);
  }
  if (
    String(before.student.email || '').toLowerCase() !== STUDENT_EMAIL.toLowerCase()
  ) {
    throw new Error(
      `Email mismatch: expected ${STUDENT_EMAIL}, got ${before.student.email}`
    );
  }
  if (!before.source || before.source.class_name !== SOURCE_CLASS_NAME) {
    throw new Error(
      `Source class ${SOURCE_CLASS_ID} name mismatch: ${before.source?.class_name}`
    );
  }
  if (!before.target || before.target.class_name !== TARGET_CLASS_NAME) {
    throw new Error(
      `Target class ${TARGET_CLASS_ID} name mismatch: ${before.target?.class_name}`
    );
  }
  if (before.source.program_id !== before.target.program_id) {
    throw new Error('Source and target must share program_id');
  }
  if (before.source.branch_id !== before.target.branch_id) {
    throw new Error('Source and target must share branch_id');
  }

  const keepRow = before.sourceEnrollments.find(
    (r) => Number(r.classstudent_id) === KEEP_ENROLLMENT_ID
  );
  const dupRow = before.sourceEnrollments.find(
    (r) => Number(r.classstudent_id) === DUPLICATE_ENROLLMENT_ID
  );
  if (!keepRow || Number(keepRow.phase_number) !== 10) {
    throw new Error(
      `Keep enrollment ${KEEP_ENROLLMENT_ID} not found on source as phase 10`
    );
  }
  if (before.targetEnrollments.some((r) => !r.removed_at)) {
    throw new Error(
      `Student already has active enrollment on target class ${TARGET_CLASS_ID}`
    );
  }

  console.log('Student:', before.student.full_name, before.student.email);
  console.log('Source:', before.source);
  console.log('Target:', before.target);
  if (String(before.target.status).toLowerCase() !== 'active') {
    console.log(
      `\n⚠ Target class is ${before.target.status} (end ${before.target.end_ymd}).` +
        ` Pass --reactivate-target with --apply to set status=Active if ops confirms.\n`
    );
  }
  console.log('\nSource enrollments (class 65):');
  console.table(before.sourceEnrollments);
  console.log('Unchanged NC 4PM enrollments (class 162 phases 1–9):');
  console.table(before.ncEnrollments);
  console.log('Invoices:');
  console.table(before.invoices);
  console.log(`Attendance on source: ${before.attendanceCount}`);
  console.log('Installment profiles on 65/66:', before.profiles);

  const planned = [
    {
      step: '1_soft_remove_duplicate',
      detail: `classstudent ${DUPLICATE_ENROLLMENT_ID} → set removed_at (dup phase 10)`,
    },
    {
      step: '2_move_phase10',
      detail: `classstudent ${KEEP_ENROLLMENT_ID} (${keepRow.program_enrollment_status} P10) ${SOURCE_CLASS_ID} → ${TARGET_CLASS_ID}`,
    },
    {
      step: '3_retag_invoices',
      detail: `INV ${INVOICE_IDS.join(', ')} remarks CLASS_ID:${SOURCE_CLASS_ID} → CLASS_ID:${TARGET_CLASS_ID}`,
    },
  ];
  if (reactivateTarget) {
    planned.push({
      step: '4_reactivate_target',
      detail: `class ${TARGET_CLASS_ID} status → Active`,
    });
  }
  console.log('\nPlanned changes:');
  console.table(planned);
  if (dupRow) {
    console.log(
      `Duplicate row present: classstudent_id=${DUPLICATE_ENROLLMENT_ID} status=${dupRow.program_enrollment_status}`
    );
  } else {
    console.log(
      `Duplicate row ${DUPLICATE_ENROLLMENT_ID} already absent — soft-remove will no-op if missing.`
    );
  }

  if (!isApply) {
    console.log('\nDry run complete. Re-run with --apply to write changes.');
    return;
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    if (reactivateTarget) {
      const re = await client.query(
        `UPDATE classestbl SET status = 'Active' WHERE class_id = $1
         RETURNING class_id, class_name, status`,
        [TARGET_CLASS_ID]
      );
      console.log('✅ Reactivated target:', re.rows[0]);
    }

    if (dupRow && !dupRow.removed_at) {
      await client.query(
        `UPDATE classstudentstbl
         SET removed_at = TIMEZONE('Asia/Manila', NOW()),
             removed_reason = $1
         WHERE classstudent_id = $2`,
        [`${REPAIR_NOTE} — duplicate phase 10`, DUPLICATE_ENROLLMENT_ID]
      );
      console.log(`✅ Soft-removed duplicate enrollment ${DUPLICATE_ENROLLMENT_ID}`);
    }

    const moved = await client.query(
      `UPDATE classstudentstbl
       SET class_id = $1
       WHERE classstudent_id = $2 AND student_id = $3 AND class_id = $4
       RETURNING classstudent_id, class_id, phase_number, program_enrollment_status`,
      [TARGET_CLASS_ID, KEEP_ENROLLMENT_ID, STUDENT_ID, SOURCE_CLASS_ID]
    );
    if (!moved.rows.length) {
      throw new Error(`Failed to move enrollment ${KEEP_ENROLLMENT_ID}`);
    }
    console.log('✅ Moved enrollment:', moved.rows[0]);

    for (const invoiceId of INVOICE_IDS) {
      const upd = await client.query(
        `UPDATE invoicestbl
         SET remarks = REPLACE(COALESCE(remarks, ''), $1, $2)
         WHERE invoice_id = $3
           AND COALESCE(remarks, '') LIKE $4
         RETURNING invoice_id, remarks`,
        [
          `CLASS_ID:${SOURCE_CLASS_ID}`,
          `CLASS_ID:${TARGET_CLASS_ID}`,
          invoiceId,
          `%CLASS_ID:${SOURCE_CLASS_ID}%`,
        ]
      );
      if (upd.rows[0]) {
        console.log(`✅ Retagged INV-${invoiceId}:`, upd.rows[0].remarks);
      } else {
        console.log(`• INV-${invoiceId}: no CLASS_ID:${SOURCE_CLASS_ID} in remarks (skipped)`);
      }
    }

    // No installment profiles on these classes for this student — skip.
    await client.query('COMMIT');

    const after = await loadSnapshot();
    console.log('\nAfter — source enrollments:');
    console.table(after.sourceEnrollments);
    console.log('After — target enrollments:');
    console.table(after.targetEnrollments);
    console.log('After — invoices:');
    console.table(after.invoices);
    console.log('\nDone. Refresh Classes → VMP_Pre-Kindergarten_MWF_4PM students list.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
