/**
 * Andrea Claire Salurio — remove from inactive VMP_Pre-Kindergarten_MWF_4PM
 * (class 66, phase 10 only). Keep Active VMP_Pre-Kindergarten_MWF 4PM
 * (class 162, phases 1–9).
 *
 * Context (production after prior move script):
 *   user_id 640 · deegurrolajanine123@gmail.com
 *   KEEP   class 162 Active  — phases 1–9 (classstudent 1454–1462)
 *   REMOVE class 66  Inactive — phase 10 completed (classstudent 1463)
 *   Soft-removed dup on class 65 (1532) left unchanged
 *   INV-1837 / INV-1853 remarks CLASS_ID:66 → CLASS_ID:162
 *
 * Usage (from backend/):
 *   node scripts/removeAndreaSalurioInactiveVmp4pmPhase10.js
 *   node scripts/removeAndreaSalurioInactiveVmp4pmPhase10.js --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';

const STUDENT_ID = 640;
const STUDENT_EMAIL = 'deegurrolajanine123@gmail.com';

const KEEP_CLASS_ID = 162;
const KEEP_CLASS_NAME = 'VMP_Pre-Kindergarten_MWF 4PM';

const REMOVE_CLASS_ID = 66;
const REMOVE_CLASS_NAME = 'VMP_Pre-Kindergarten_MWF_4PM';
const REMOVE_ENROLLMENT_ID = 1463;
const REMOVE_PHASE = 10;

const INVOICE_IDS = [1837, 1853];

const REPAIR_NOTE =
  'Ops repair — Andrea Salurio: remove inactive VMP 4PM (66) phase 10; keep Active VMP 4PM (162) phases 1–9';

const isApply = process.argv.includes('--apply');

async function loadSnapshot(queryFn = query) {
  const student = (
    await queryFn(
      `SELECT user_id, full_name, email FROM userstbl WHERE user_id = $1`,
      [STUDENT_ID]
    )
  ).rows[0];

  const keepClass = (
    await queryFn(
      `SELECT class_id, class_name, status,
              TO_CHAR(start_date, 'YYYY-MM-DD') AS start_ymd,
              TO_CHAR(end_date, 'YYYY-MM-DD') AS end_ymd
       FROM classestbl WHERE class_id = $1`,
      [KEEP_CLASS_ID]
    )
  ).rows[0];

  const removeClass = (
    await queryFn(
      `SELECT class_id, class_name, status,
              TO_CHAR(start_date, 'YYYY-MM-DD') AS start_ymd,
              TO_CHAR(end_date, 'YYYY-MM-DD') AS end_ymd
       FROM classestbl WHERE class_id = $1`,
      [REMOVE_CLASS_ID]
    )
  ).rows[0];

  const keepEnrollments = (
    await queryFn(
      `SELECT classstudent_id, phase_number, program_enrollment_status,
              TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD') AS enrolled,
              TO_CHAR(TIMEZONE('Asia/Manila', removed_at), 'YYYY-MM-DD') AS removed
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2
       ORDER BY phase_number, classstudent_id`,
      [STUDENT_ID, KEEP_CLASS_ID]
    )
  ).rows;

  const removeEnrollments = (
    await queryFn(
      `SELECT classstudent_id, phase_number, program_enrollment_status,
              TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD') AS enrolled,
              TO_CHAR(TIMEZONE('Asia/Manila', removed_at), 'YYYY-MM-DD') AS removed,
              removed_reason
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2
       ORDER BY phase_number, classstudent_id`,
      [STUDENT_ID, REMOVE_CLASS_ID]
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

  return {
    student,
    keepClass,
    removeClass,
    keepEnrollments,
    removeEnrollments,
    invoices,
  };
}

async function main() {
  console.log(
    `\nAndrea Salurio — remove inactive VMP 4PM phase 10${
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
  if (!before.keepClass || before.keepClass.class_name !== KEEP_CLASS_NAME) {
    throw new Error(
      `Keep class ${KEEP_CLASS_ID} name mismatch: ${before.keepClass?.class_name}`
    );
  }
  if (!before.removeClass || before.removeClass.class_name !== REMOVE_CLASS_NAME) {
    throw new Error(
      `Remove class ${REMOVE_CLASS_ID} name mismatch: ${before.removeClass?.class_name}`
    );
  }
  if (String(before.removeClass.status).toLowerCase() === 'active') {
    throw new Error(
      `Refuse to remove from class ${REMOVE_CLASS_ID}: expected Inactive, got ${before.removeClass.status}`
    );
  }

  const targetRow = before.removeEnrollments.find(
    (r) => Number(r.classstudent_id) === REMOVE_ENROLLMENT_ID
  );
  if (!targetRow) {
    throw new Error(
      `Enrollment ${REMOVE_ENROLLMENT_ID} not found on class ${REMOVE_CLASS_ID}`
    );
  }
  if (Number(targetRow.phase_number) !== REMOVE_PHASE) {
    throw new Error(
      `Enrollment ${REMOVE_ENROLLMENT_ID} phase=${targetRow.phase_number}, expected ${REMOVE_PHASE}`
    );
  }
  if (targetRow.removed) {
    console.log(
      `Enrollment ${REMOVE_ENROLLMENT_ID} already soft-removed at ${targetRow.removed}`
    );
  }

  console.log('Student:', before.student.full_name, before.student.email);
  console.log('\nKEEP class:', before.keepClass);
  console.table(before.keepEnrollments);
  console.log('\nREMOVE class (inactive):', before.removeClass);
  console.table(before.removeEnrollments);
  console.log('\nInvoices:');
  console.table(before.invoices);

  console.log('\nPlanned changes:');
  console.table([
    {
      step: '1_soft_remove_phase10',
      detail: `classstudent ${REMOVE_ENROLLMENT_ID} on class ${REMOVE_CLASS_ID} (${REMOVE_CLASS_NAME}) → set removed_at`,
    },
    {
      step: '2_retag_invoices',
      detail: `INV ${INVOICE_IDS.join(', ')} remarks CLASS_ID:${REMOVE_CLASS_ID} → CLASS_ID:${KEEP_CLASS_ID}`,
    },
    {
      step: '3_keep_untouched',
      detail: `class ${KEEP_CLASS_ID} phases 1–9 (${before.keepEnrollments.length} rows) unchanged`,
    },
  ]);

  if (!isApply) {
    console.log('\nDry run complete. Re-run with --apply to write changes.');
    return;
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    if (!targetRow.removed) {
      const rem = await client.query(
        `UPDATE classstudentstbl
         SET removed_at = TIMEZONE('Asia/Manila', NOW()),
             removed_reason = $1
         WHERE classstudent_id = $2
           AND student_id = $3
           AND class_id = $4
           AND phase_number = $5
           AND removed_at IS NULL
         RETURNING classstudent_id, class_id, phase_number, program_enrollment_status,
                   TO_CHAR(TIMEZONE('Asia/Manila', removed_at), 'YYYY-MM-DD HH24:MI') AS removed`,
        [
          REPAIR_NOTE,
          REMOVE_ENROLLMENT_ID,
          STUDENT_ID,
          REMOVE_CLASS_ID,
          REMOVE_PHASE,
        ]
      );
      if (!rem.rows.length) {
        throw new Error(`Failed to soft-remove enrollment ${REMOVE_ENROLLMENT_ID}`);
      }
      console.log('✅ Soft-removed:', rem.rows[0]);
    } else {
      console.log(`• Enrollment ${REMOVE_ENROLLMENT_ID} already removed — skip`);
    }

    for (const invoiceId of INVOICE_IDS) {
      const upd = await client.query(
        `UPDATE invoicestbl
         SET remarks = REPLACE(COALESCE(remarks, ''), $1, $2)
         WHERE invoice_id = $3
           AND COALESCE(remarks, '') LIKE $4
         RETURNING invoice_id, remarks`,
        [
          `CLASS_ID:${REMOVE_CLASS_ID}`,
          `CLASS_ID:${KEEP_CLASS_ID}`,
          invoiceId,
          `%CLASS_ID:${REMOVE_CLASS_ID}%`,
        ]
      );
      if (upd.rows[0]) {
        console.log(`✅ Retagged INV-${invoiceId}:`, upd.rows[0].remarks);
      } else {
        console.log(
          `• INV-${invoiceId}: no CLASS_ID:${REMOVE_CLASS_ID} in remarks (skipped)`
        );
      }
    }

    await client.query('COMMIT');

    const after = await loadSnapshot();
    console.log('\nAfter — KEEP enrollments:');
    console.table(after.keepEnrollments);
    console.log('After — REMOVE class enrollments:');
    console.table(after.removeEnrollments);
    console.log('After — invoices:');
    console.table(after.invoices);
    console.log('\nDone. Refresh Student history → Enrolled class.');
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
