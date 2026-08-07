/**
 * Read-only peek: Isaac Cade Guintu Playgroup plan + month matrix.
 * Run: node backend/scripts/_peekIsaacCadeGuintu.js --production
 */
import '../config/loadEnv.js';
import { query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';

const EMAIL = 'jershey_decenanuguid@yahoo.com';

async function main() {
  console.log(`DB: ${process.env.DB_NAME} | NODE_ENV=${process.env.NODE_ENV}\n`);

  const student = (
    await query(
      `SELECT user_id, full_name, email FROM userstbl
       WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))`,
      [EMAIL]
    )
  ).rows[0];
  if (!student) throw new Error(`Student not found: ${EMAIL}`);
  console.log('Student:', student);

  const profiles = (
    await query(
      `SELECT ip.installmentinvoiceprofiles_id, ip.class_id, ip.phase_start, ip.total_phases,
              ip.generated_count, ip.is_active, ip.amount,
              TO_CHAR(ip.first_billing_month, 'YYYY-MM-DD') AS first_billing_month,
              c.class_name, c.branch_id, b.branch_name,
              TO_CHAR(c.start_date, 'YYYY-MM-DD') AS class_start
       FROM installmentinvoiceprofilestbl ip
       LEFT JOIN classestbl c ON c.class_id = ip.class_id
       LEFT JOIN branchestbl b ON b.branch_id = c.branch_id
       WHERE ip.student_id = $1
       ORDER BY ip.installmentinvoiceprofiles_id`,
      [student.user_id]
    )
  ).rows;
  console.log('\nProfiles:');
  console.table(profiles);

  for (const p of profiles) {
    console.log(`\n=== Profile ${p.installmentinvoiceprofiles_id} class ${p.class_id} ===`);

    const invoices = (
      await query(
        `SELECT i.invoice_id, i.invoice_ar_number, i.status,
                LEFT(COALESCE(i.remarks, ''), 80) AS remarks,
                TO_CHAR(TIMEZONE('Asia/Manila', i.issue_date), 'YYYY-MM-DD') AS issue,
                TO_CHAR(TIMEZONE('Asia/Manila', i.due_date), 'YYYY-MM-DD') AS due
         FROM invoicestbl i
         WHERE i.installmentinvoiceprofiles_id = $1
         ORDER BY i.invoice_id`,
        [p.installmentinvoiceprofiles_id]
      )
    ).rows;
    console.log('Invoices:');
    console.table(invoices);

    const enrollments = (
      await query(
        `SELECT cs.classstudent_id, cs.phase_number, cs.program_enrollment_status,
                TO_CHAR(TIMEZONE('Asia/Manila', cs.enrolled_at), 'YYYY-MM-DD HH24:MI') AS enrolled,
                TO_CHAR(TIMEZONE('Asia/Manila', cs.removed_at), 'YYYY-MM-DD') AS removed,
                LEFT(COALESCE(cs.removed_reason, ''), 60) AS removed_reason
         FROM classstudentstbl cs
         WHERE cs.student_id = $1 AND cs.class_id = $2
         ORDER BY cs.phase_number, cs.classstudent_id`,
        [student.user_id, p.class_id]
      )
    ).rows;
    console.log('Enrollments:');
    console.table(enrollments);

    const queue = (
      await query(
        `SELECT installmentinvoicedtl_id, status,
                TO_CHAR(next_generation_date, 'YYYY-MM-DD') AS next_gen,
                TO_CHAR(next_invoice_month, 'YYYY-MM-DD') AS next_month,
                TO_CHAR(scheduled_date, 'YYYY-MM-DD') AS scheduled
         FROM installmentinvoicestbl
         WHERE installmentinvoiceprofiles_id = $1
         ORDER BY installmentinvoicedtl_id`,
        [p.installmentinvoiceprofiles_id]
      )
    ).rows;
    console.log('Queue:');
    console.table(queue);

    if (p.branch_id && p.class_id) {
      const matrix = await loadStudentMonthEnrollmentMatrix(query, {
        year: 2026,
        branchId: p.branch_id,
        classId: p.class_id,
      });
      const track = (matrix.students || []).find(
        (s) => s.student_id === student.user_id && s.class_id === p.class_id
      );
      const cells = [];
      for (const m of matrix.months || []) {
        const c = track?.months?.[m.key];
        if (!c) continue;
        if (c.mark === '1' || c.mark === '✓' || c.mark === 'X' || c.label) {
          cells.push({
            month: m.key,
            label: c.label,
            status: c.status,
            phase: c.phase_number,
            mark: c.mark,
            due: c.invoice_due_date || null,
          });
        }
      }
      console.log('Month matrix cells:');
      console.table(cells);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
