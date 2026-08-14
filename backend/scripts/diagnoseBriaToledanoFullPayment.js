/**
 * Diagnose Bria Renesmee M. Toledano — full-payment completed month (Oct vs Jul).
 *
 *   node backend/scripts/diagnoseBriaToledanoFullPayment.js --production
 */

import '../config/loadEnv.js';
import { query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';

async function main() {
  console.log(`DB: ${process.env.DB_NAME} | NODE_ENV=${process.env.NODE_ENV}`);

  const students = (
    await query(
      `SELECT user_id, full_name, email, branch_id, user_type
       FROM userstbl
       WHERE full_name ILIKE '%Toledano%'
          OR full_name ILIKE '%Bria%Renesmee%'
       ORDER BY user_id`
    )
  ).rows;
  console.log('\nStudents:');
  console.table(students);
  if (!students.length) {
    console.error('No student found');
    process.exitCode = 1;
    return;
  }

  for (const student of students) {
    const sid = Number(student.user_id);
    console.log(`\n========== ${student.full_name} id=${sid} ==========`);

    const classes = (
      await query(
        `SELECT DISTINCT c.class_id, c.class_name, c.branch_id, c.level_tag,
                cu.number_of_phase,
                TO_CHAR(TIMEZONE('Asia/Manila', c.start_date), 'YYYY-MM-DD') AS start_date,
                TO_CHAR(TIMEZONE('Asia/Manila', c.end_date), 'YYYY-MM-DD') AS end_date,
                c.status AS class_status,
                b.branch_nickname
         FROM classstudentstbl cs
         JOIN classestbl c ON c.class_id = cs.class_id
         LEFT JOIN programstbl p ON p.program_id = c.program_id
         LEFT JOIN curriculumstbl cu ON cu.curriculum_id = p.curriculum_id
         LEFT JOIN branchestbl b ON b.branch_id = c.branch_id
         WHERE cs.student_id = $1
         ORDER BY c.class_id`,
        [sid]
      )
    ).rows;
    console.log('Classes:');
    console.table(classes);

    const enrollments = (
      await query(
        `SELECT cs.classstudent_id, cs.class_id, c.class_name, cs.phase_number,
                cs.program_enrollment_status AS status,
                TO_CHAR(TIMEZONE('Asia/Manila', cs.enrolled_at), 'YYYY-MM-DD') AS enrolled,
                TO_CHAR(TIMEZONE('Asia/Manila', cs.removed_at), 'YYYY-MM-DD') AS removed,
                LEFT(COALESCE(cs.enrolled_by, ''), 80) AS enrolled_by
         FROM classstudentstbl cs
         JOIN classestbl c ON c.class_id = cs.class_id
         WHERE cs.student_id = $1
         ORDER BY cs.class_id, cs.phase_number, cs.classstudent_id`,
        [sid]
      )
    ).rows;
    console.log('Enrollments:');
    console.table(enrollments);

    const profiles = (
      await query(
        `SELECT ip.installmentinvoiceprofiles_id, ip.class_id, ip.phase_start,
                ip.total_phases, ip.generated_count, ip.is_active
         FROM installmentinvoiceprofilestbl ip
         WHERE ip.student_id = $1
         ORDER BY ip.installmentinvoiceprofiles_id`,
        [sid]
      )
    ).rows;
    console.log('Installment profiles:');
    console.table(profiles.length ? profiles : [{ note: '(none)' }]);

    const invoices = (
      await query(
        `SELECT i.invoice_id, i.status, i.invoice_description,
                i.installmentinvoiceprofiles_id AS profile_id,
                TO_CHAR(i.issue_date, 'YYYY-MM-DD') AS issue,
                TO_CHAR(i.due_date, 'YYYY-MM-DD') AS due,
                LEFT(COALESCE(i.remarks, ''), 160) AS remarks
         FROM invoicestbl i
         INNER JOIN invoicestudentstbl ist ON ist.invoice_id = i.invoice_id
         WHERE ist.student_id = $1
         ORDER BY i.invoice_id`,
        [sid]
      )
    ).rows;
    console.log('Invoices:');
    console.table(invoices);

    const payments = (
      await query(
        `SELECT p.payment_id, p.invoice_id, p.status, p.approval_status,
                p.payable_amount,
                TO_CHAR(p.issue_date, 'YYYY-MM-DD') AS paid_on
         FROM paymenttbl p
         WHERE p.invoice_id = ANY($1::int[])
         ORDER BY p.payment_id`,
        [invoices.map((i) => i.invoice_id)]
      )
    ).rows;
    console.log('Payments:');
    console.table(payments.length ? payments : [{ note: '(none)' }]);

    const billing = (
      await query(
        `
        WITH scoped AS (
          SELECT cs.*, c.start_date, c.class_name,
            NOT EXISTS (
              SELECT 1 FROM installmentinvoiceprofilestbl ip
              WHERE ip.student_id = cs.student_id AND ip.class_id = cs.class_id
            ) AS no_profile
          FROM classstudentstbl cs
          JOIN classestbl c ON c.class_id = cs.class_id
          WHERE cs.student_id = $1
        ),
        anchor AS (
          SELECT DISTINCT ON (student_id, class_id)
            student_id, class_id, phase_number AS base_phase,
            DATE_TRUNC('month', TIMEZONE('Asia/Manila', enrolled_at))::date AS base_month
          FROM scoped
          WHERE enrolled_at IS NOT NULL
          ORDER BY student_id, class_id, phase_number, enrolled_at
        )
        SELECT sr.class_id, sr.class_name, sr.phase_number,
               sr.program_enrollment_status AS status,
               sr.no_profile,
               TO_CHAR(TIMEZONE('Asia/Manila', sr.start_date), 'YYYY-MM-DD') AS class_start,
               CASE
                 WHEN sr.no_profile AND sr.start_date IS NOT NULL THEN
                   TO_CHAR(
                     (DATE_TRUNC('month', TIMEZONE('Asia/Manila', sr.start_date))
                       + ((sr.phase_number - 1) || ' month')::interval)::date,
                     'YYYY-MM'
                   )
                 WHEN a.base_month IS NOT NULL THEN
                   TO_CHAR(
                     (a.base_month + ((sr.phase_number - a.base_phase) || ' month')::interval)::date,
                     'YYYY-MM'
                   )
               END AS billing_month
        FROM scoped sr
        LEFT JOIN anchor a ON a.student_id = sr.student_id AND a.class_id = sr.class_id
        ORDER BY sr.class_id, sr.phase_number
        `,
        [sid]
      )
    ).rows;
    console.log('Computed billing months:');
    console.table(billing);

    const branchIds = [...new Set(classes.map((c) => Number(c.branch_id)).filter(Boolean))];
    const classIds = classes.map((c) => Number(c.class_id));
    for (const branchId of branchIds.length ? branchIds : [null]) {
      const matrix = await loadStudentMonthEnrollmentMatrix(query, {
        year: 2026,
        branchId: branchId || undefined,
      });
      const tracks = (matrix.students || []).filter((s) => Number(s.student_id) === sid);
      console.log(
        `\nMonth matrix 2026 (branch ${branchId || 'all'}) tracks=${tracks.length}`
      );
      for (const track of tracks) {
        console.log(
          `  class ${track.class_id} ${track.class_name} fullPayMonth=${track.last_full_pay_month_key} pkgComplete=${track.package_complete_month_key} phases=${track.class_number_of_phase}`
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
              fullPay: Boolean(c.is_full_payment),
            });
          }
        }
        console.table(cells);
      }
      if (!tracks.length && classIds.length) {
        for (const classId of classIds) {
          const m2 = await loadStudentMonthEnrollmentMatrix(query, {
            year: 2026,
            classId,
          });
          const track = (m2.students || []).find((s) => Number(s.student_id) === sid);
          if (!track) continue;
          console.log(`  (class filter ${classId}) ${track.class_name}`);
        }
      }
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
