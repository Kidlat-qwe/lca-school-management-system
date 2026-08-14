/**
 * Lucretius Theodore B Manuel — advance partial Phase 5 due + ungenerate Phase 6.
 *
 * Student email: krisstinamanuel729@gmail.com
 * Class: VMM_Pre-Kinder_MWF 1PM (Malolos Pre-Kindergarten)
 *
 * Issues (Student History / Invoice logs / August Active miscount):
 *   1. Phase 5 advance partial (INV-1959 → balance INV-1960) due Nov 5;
 *      cadence due must be Aug 5 (issue stays Jul 9).
 *   2. Phase 6 auto-generated Jul 25 while Phase 5 still open partial —
 *      cancel Phase 6; queue next_generation_date → Aug 25.
 *   3. Phase 5 classstudent re_enrolled from partial advance inflated August
 *      Active on Month Re-enrollment / Monthly Operational / Student Status —
 *      remove Phase 5 enrollment until the balance chain is Paid.
 *
 * Run:
 *   node backend/scripts/repairLucretiusManuelPhase5DueUngenerate6.js --production
 *   node backend/scripts/repairLucretiusManuelPhase5DueUngenerate6.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_EMAIL = 'krisstinamanuel729@gmail.com';
const PHASE5_PARENT_INVOICE_ID = 1959;
const PHASE5_BALANCE_INVOICE_ID = 1960;
const PHASE6_INVOICE_ID = 2261;
const PHASE5_DUE = '2026-08-05';
const NEXT_GEN = '2026-08-25';
const NEXT_MONTH = '2026-09-01';
const EXPECTED_GENERATED_COUNT = 5;

const REPAIR_NOTE =
  'Ops repair 2026-08-14 — Lucretius Manuel Phase 5 due Nov→Aug 5; cancel Phase 6; blank Phase 5 enrollment until paid; queue Aug 25';

const isApply = process.argv.includes('--apply');

async function previewMatrix(queryFn, studentId, classId, branchId) {
  const matrix = await loadStudentMonthEnrollmentMatrix(queryFn, {
    year: 2026,
    branchId: branchId || undefined,
    classId: classId || undefined,
  });
  const track = (matrix.students || []).find(
    (s) => Number(s.student_id) === Number(studentId) && Number(s.class_id) === Number(classId)
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

async function main() {
  console.log(
    `\nLucretius Manuel — Phase 5 due + ungenerate Phase 6` +
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
        `SELECT user_id, full_name, email, branch_id
         FROM userstbl
         WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))
           AND user_type = 'Student'`,
        [STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student) throw new Error(`Student not found: ${STUDENT_EMAIL}`);
    const studentId = Number(student.user_id);
    console.log('Student:', student.full_name, student.email, `id=${studentId}`);

    const parent = (
      await client.query(
        `SELECT invoice_id, status, remarks, installmentinvoiceprofiles_id, balance_invoice_id,
                TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue,
                TO_CHAR(due_date, 'YYYY-MM-DD') AS due
         FROM invoicestbl WHERE invoice_id = $1`,
        [PHASE5_PARENT_INVOICE_ID]
      )
    ).rows[0];
    if (!parent) throw new Error(`INV-${PHASE5_PARENT_INVOICE_ID} not found`);

    const profileId = Number(parent.installmentinvoiceprofiles_id);
    if (!profileId) throw new Error('Phase 5 parent has no installment profile');

    const linked = (
      await client.query(
        `SELECT 1 FROM invoicestudentstbl WHERE invoice_id = $1 AND student_id = $2`,
        [PHASE5_PARENT_INVOICE_ID, studentId]
      )
    ).rows[0];
    if (!linked) throw new Error(`INV-${PHASE5_PARENT_INVOICE_ID} not linked to student ${studentId}`);

    if (!String(parent.remarks || '').includes('TARGET_PHASE:5')) {
      throw new Error(`INV-${PHASE5_PARENT_INVOICE_ID} missing TARGET_PHASE:5`);
    }
    if (Number(parent.balance_invoice_id) !== PHASE5_BALANCE_INVOICE_ID) {
      console.warn(
        `⚠ Expected balance_invoice_id=${PHASE5_BALANCE_INVOICE_ID}, got ${parent.balance_invoice_id}`
      );
    }

    const balance = (
      await client.query(
        `SELECT invoice_id, status, remarks, parent_invoice_id,
                TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue,
                TO_CHAR(due_date, 'YYYY-MM-DD') AS due
         FROM invoicestbl WHERE invoice_id = $1`,
        [PHASE5_BALANCE_INVOICE_ID]
      )
    ).rows[0];
    if (!balance) throw new Error(`INV-${PHASE5_BALANCE_INVOICE_ID} not found`);

    const phase6 = (
      await client.query(
        `SELECT invoice_id, status, remarks, installmentinvoiceprofiles_id, amount,
                TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue,
                TO_CHAR(due_date, 'YYYY-MM-DD') AS due
         FROM invoicestbl WHERE invoice_id = $1`,
        [PHASE6_INVOICE_ID]
      )
    ).rows[0];
    if (!phase6) throw new Error(`INV-${PHASE6_INVOICE_ID} not found`);
    if (Number(phase6.installmentinvoiceprofiles_id) !== profileId) {
      throw new Error(`INV-${PHASE6_INVOICE_ID} not on profile ${profileId}`);
    }
    if (!String(phase6.remarks || '').includes('TARGET_PHASE:6')) {
      throw new Error(`INV-${PHASE6_INVOICE_ID} missing TARGET_PHASE:6`);
    }
    const phase6Paid = (
      await client.query(
        `SELECT COUNT(*)::int AS n FROM paymenttbl
         WHERE invoice_id = $1
           AND status = 'Completed'
           AND COALESCE(approval_status, 'Pending') <> 'Rejected'`,
        [PHASE6_INVOICE_ID]
      )
    ).rows[0]?.n;
    if (Number(phase6Paid) > 0) {
      throw new Error(`INV-${PHASE6_INVOICE_ID} has completed payments — refuse cancel`);
    }

    const profile = (
      await client.query(
        `SELECT ip.installmentinvoiceprofiles_id, ip.student_id, ip.class_id, ip.branch_id,
                ip.generated_count, ip.is_active, ip.phase_start, ip.total_phases,
                ii.installmentinvoicedtl_id,
                TO_CHAR(ii.next_generation_date, 'YYYY-MM-DD') AS next_gen,
                TO_CHAR(ii.next_invoice_month, 'YYYY-MM-DD') AS next_month,
                c.class_name
         FROM installmentinvoiceprofilestbl ip
         LEFT JOIN installmentinvoicestbl ii
           ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
         LEFT JOIN classestbl c ON c.class_id = ip.class_id
         WHERE ip.installmentinvoiceprofiles_id = $1
           AND ip.student_id = $2
         ORDER BY ii.installmentinvoicedtl_id DESC
         LIMIT 1`,
        [profileId, studentId]
      )
    ).rows[0];
    if (!profile) throw new Error(`Profile ${profileId} not found for student`);
    const classId = Number(profile.class_id);
    const branchId = Number(profile.branch_id || student.branch_id);

    const phase5Enrollments = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status AS status,
                TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD') AS enrolled,
                TO_CHAR(TIMEZONE('Asia/Manila', removed_at), 'YYYY-MM-DD') AS removed
         FROM classstudentstbl
         WHERE student_id = $1 AND class_id = $2 AND phase_number = 5
         ORDER BY classstudent_id`,
        [studentId, classId]
      )
    ).rows;

    console.log('\nBEFORE invoices:');
    console.table([
      { inv: parent.invoice_id, status: parent.status, issue: parent.issue, due: parent.due },
      { inv: balance.invoice_id, status: balance.status, issue: balance.issue, due: balance.due },
      { inv: phase6.invoice_id, status: phase6.status, issue: phase6.issue, due: phase6.due },
    ]);
    console.log('BEFORE profile/queue:');
    console.table([
      {
        profile_id: profileId,
        class: profile.class_name,
        generated_count: profile.generated_count,
        next_gen: profile.next_gen,
        next_month: profile.next_month,
        is_active: profile.is_active,
      },
    ]);
    console.log('BEFORE Phase 5 enrollments:');
    console.table(phase5Enrollments.length ? phase5Enrollments : [{ note: '(none)' }]);
    console.log('BEFORE matrix:');
    console.table(await previewMatrix(query, studentId, classId, branchId));

    console.log('\nPlanned:');
    console.log(
      `  • INV-${PHASE5_PARENT_INVOICE_ID} / INV-${PHASE5_BALANCE_INVOICE_ID} due → ${PHASE5_DUE}`
    );
    console.log(`  • Cancel + detach Phase 6 INV-${PHASE6_INVOICE_ID}`);
    console.log(`  • generated_count → ${EXPECTED_GENERATED_COUNT}; queue → ${NEXT_GEN} / ${NEXT_MONTH}`);
    console.log('  • Soft-remove Phase 5 classstudent row(s) until balance is Paid');

    const appendNote = (remarks) => {
      const text = String(remarks || '');
      return text.includes(REPAIR_NOTE) ? text : [text, REPAIR_NOTE].filter(Boolean).join(';');
    };

    for (const invId of [PHASE5_PARENT_INVOICE_ID, PHASE5_BALANCE_INVOICE_ID]) {
      const row = invId === PHASE5_PARENT_INVOICE_ID ? parent : balance;
      if (row.due === PHASE5_DUE) {
        console.log(`  · INV-${invId} due already ${PHASE5_DUE}`);
        continue;
      }
      await client.query(
        `UPDATE invoicestbl
         SET due_date = $1::date, remarks = $2
         WHERE invoice_id = $3`,
        [PHASE5_DUE, appendNote(row.remarks), invId]
      );
      try {
        await syncProgramPaymentStatusForInvoice(client, invId);
      } catch (e) {
        console.warn(`⚠ syncProgramPaymentStatus INV-${invId}:`, e.message);
      }
      console.log(`✅ INV-${invId} due → ${PHASE5_DUE}`);
    }

    const phase6Cancelled = /^cancell?ed$/i.test(String(phase6.status || ''));
    if (!phase6Cancelled) {
      await client.query(
        `UPDATE invoicestbl
         SET status = 'Cancelled',
             installmentinvoiceprofiles_id = NULL,
             remarks = $1
         WHERE invoice_id = $2
           AND installmentinvoiceprofiles_id = $3`,
        [appendNote(phase6.remarks), PHASE6_INVOICE_ID, profileId]
      );
      await client.query(`DELETE FROM program_payment_statustbl WHERE invoice_id = $1`, [
        PHASE6_INVOICE_ID,
      ]);
      console.log(`✅ Cancelled + detached INV-${PHASE6_INVOICE_ID}`);
    } else {
      console.log(`  · INV-${PHASE6_INVOICE_ID} already cancelled`);
    }

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET generated_count = $1
       WHERE installmentinvoiceprofiles_id = $2
         AND student_id = $3`,
      [EXPECTED_GENERATED_COUNT, profileId, studentId]
    );

    if (!profile.installmentinvoicedtl_id) {
      throw new Error('No installment queue row for profile');
    }
    await client.query(
      `UPDATE installmentinvoicestbl
       SET next_generation_date = $1::date,
           next_invoice_month = $2::date,
           scheduled_date = $1::date
       WHERE installmentinvoicedtl_id = $3
         AND installmentinvoiceprofiles_id = $4`,
      [NEXT_GEN, NEXT_MONTH, profile.installmentinvoicedtl_id, profileId]
    );
    console.log('✅ Queue + generated_count updated');

    for (const enr of phase5Enrollments) {
      if (enr.removed) {
        console.log(`  · classstudent ${enr.classstudent_id} already removed`);
        continue;
      }
      await client.query(
        `UPDATE classstudentstbl
         SET removed_at = CURRENT_TIMESTAMP,
             removed_reason = $1,
             removed_by = 'System (Ops repair)'
         WHERE classstudent_id = $2
           AND student_id = $3
           AND class_id = $4`,
        [REPAIR_NOTE, enr.classstudent_id, studentId, classId]
      );
      console.log(`✅ Soft-removed Phase 5 classstudent ${enr.classstudent_id}`);
    }

    console.log('\nAFTER matrix:');
    console.table(await previewMatrix(client.query.bind(client), studentId, classId, branchId));

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
