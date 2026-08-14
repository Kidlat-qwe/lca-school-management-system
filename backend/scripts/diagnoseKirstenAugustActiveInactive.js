/**
 * Diagnose Kirsten Mahinay August Active vs Inactive mismatch.
 *   node backend/scripts/diagnoseKirstenAugustActiveInactive.js --production
 */

import '../config/loadEnv.js';
import { query } from '../config/database.js';
import {
  isMonthMatrixCellActiveForOperationalDashboard,
  loadStudentMonthEnrollmentMatrix,
} from '../lib/enrollmentRateMetrics.js';
import { loadStudentStatusReportPage } from '../lib/studentStatusReport/studentStatusReport.js';

const EMAIL = 'cherryjaodmd@gmail.com';
const MONTH = '2026-08';

async function main() {
  const student = (
    await query(
      `SELECT user_id, full_name, email, branch_id FROM userstbl
       WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))`,
      [EMAIL]
    )
  ).rows[0];
  console.log('Student:', student);
  const sid = Number(student.user_id);

  const enrollments = (
    await query(
      `SELECT cs.classstudent_id, cs.class_id, c.class_name, cs.phase_number,
              cs.program_enrollment_status,
              TO_CHAR(TIMEZONE('Asia/Manila', cs.enrolled_at), 'YYYY-MM-DD') AS enrolled,
              TO_CHAR(TIMEZONE('Asia/Manila', c.start_date), 'YYYY-MM-DD') AS class_start
       FROM classstudentstbl cs
       JOIN classestbl c ON c.class_id = cs.class_id
       WHERE cs.student_id = $1
       ORDER BY cs.class_id, cs.phase_number`,
      [sid]
    )
  ).rows;
  console.log('\nEnrollments:');
  console.table(enrollments);

  const invoices = (
    await query(
      `SELECT i.invoice_id, i.status, i.installmentinvoiceprofiles_id AS profile_id,
              TO_CHAR(i.issue_date, 'YYYY-MM-DD') AS issue,
              TO_CHAR(i.due_date, 'YYYY-MM-DD') AS due,
              LEFT(COALESCE(i.remarks, ''), 120) AS remarks
       FROM invoicestbl i
       JOIN invoicestudentstbl ist ON ist.invoice_id = i.invoice_id
       WHERE ist.student_id = $1
       ORDER BY i.invoice_id`,
      [sid]
    )
  ).rows;
  console.log('\nInvoices:');
  console.table(invoices);

  const ss = (
    await query(
      `SELECT status, updated_at, updated_reason
       FROM student_statustbl WHERE student_id = $1`,
      [sid]
    )
  ).rows[0];
  console.log('\nstudent_statustbl:', ss);

  const profile = (
    await query(
      `SELECT ip.installmentinvoiceprofiles_id, ip.phase_start, ip.total_phases,
              ip.generated_count, ip.is_active, ip.downpayment_paid,
              TO_CHAR(ii.next_generation_date, 'YYYY-MM-DD') AS next_gen,
              TO_CHAR(ii.next_invoice_month, 'YYYY-MM-DD') AS next_month
       FROM installmentinvoiceprofilestbl ip
       LEFT JOIN installmentinvoicestbl ii
         ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
       WHERE ip.student_id = $1
       ORDER BY ii.installmentinvoicedtl_id DESC
       LIMIT 1`,
      [sid]
    )
  ).rows[0];
  console.log('\nProfile/queue:', profile);

  const matrix = await loadStudentMonthEnrollmentMatrix(query, {
    year: 2026,
    branchId: student.branch_id,
  });
  const tracks = (matrix.students || []).filter((s) => Number(s.student_id) === sid);
  console.log(`\nMatrix tracks: ${tracks.length}`);
  for (const track of tracks) {
    console.log(
      `class ${track.class_id} ${track.class_name} pkgComplete=${track.installment_package_complete}`
    );
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
          lifecycle: Boolean(c.payment_lifecycle),
          report_active: isMonthMatrixCellActiveForOperationalDashboard(c, track, m.key),
        });
      }
    }
    console.table(cells);
  }

  const report = await loadStudentStatusReportPage(query, {
    branchId: student.branch_id,
    summaryMonth: MONTH,
    status: 'all',
    search: 'kirsten',
    page: 1,
    limit: 20,
  });
  console.log('\nReport meta:', report.meta);
  console.table(
    (report.rows || []).map((r) => ({
      name: r.full_name,
      status: r.status,
      labels: r.matrix_labels,
      class_name: r.class_name,
      class_id: r.class_id,
    }))
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
