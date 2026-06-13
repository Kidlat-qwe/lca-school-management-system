/**
 * Diagnose Kayleigh Beatrix Jao enrollment rows for phases 1-4.
 */
import '../config/loadEnv.js';
import { query } from '../config/database.js';

const name = '%Kayleigh%Jao%';
const email = 'jomabellea@gmail.com';

const userRes = await query(
  `SELECT user_id, full_name, email FROM userstbl
   WHERE (full_name ILIKE $1 OR email ILIKE $2) AND user_type = 'Student' LIMIT 5`,
  [name, email]
);
console.log('=== Student ===');
for (const u of userRes.rows) console.log(u);
if (!userRes.rows.length) process.exit(0);

const studentId = userRes.rows[0].user_id;

const enroll = await query(
  `SELECT cs.classstudent_id, cs.class_id, cs.phase_number, cs.program_enrollment_status,
          cs.enrolled_by, cs.enrolled_at, cs.removed_at,
          TO_CHAR(cs.enrolled_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD HH24:MI') AS enrolled_manila,
          c.class_name
   FROM classstudentstbl cs
   INNER JOIN classestbl c ON c.class_id = cs.class_id
   WHERE cs.student_id = $1
   ORDER BY cs.class_id, cs.phase_number, cs.classstudent_id`,
  [studentId]
);
console.log('\n=== All enrollment rows ===');
for (const r of enroll.rows) console.log(r);

const ip = await query(
  `SELECT installmentinvoiceprofiles_id, class_id, generated_count, total_phases, phase_start, is_active
   FROM installmentinvoiceprofilestbl WHERE student_id = $1`,
  [studentId]
);
console.log('\n=== Installment profiles ===');
for (const r of ip.rows) console.log(r);

const classId = ip.rows[0]?.class_id || enroll.rows[0]?.class_id;
if (classId) {
  const inv = await query(
    `SELECT i.invoice_id, i.status, i.remarks, i.issue_date,
            TO_CHAR(i.issue_date, 'YYYY-MM-DD') AS issue_ymd
     FROM invoicestbl i
     JOIN invoicestudentstbl ist ON ist.invoice_id = i.invoice_id
     WHERE ist.student_id = $1 AND i.installmentinvoiceprofiles_id = $2
     ORDER BY i.issue_date, i.invoice_id`,
    [studentId, ip.rows[0]?.installmentinvoiceprofiles_id]
  );
  console.log('\n=== Invoices (profile) ===');
  for (const r of inv.rows) console.log(r);

  const pays = await query(
    `SELECT p.payment_id, p.invoice_id, p.payable_amount,
            TO_CHAR(p.created_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD HH24:MI') AS paid_manila,
            i.remarks
     FROM paymenttbl p
     JOIN invoicestbl i ON i.invoice_id = p.invoice_id
     WHERE p.student_id = $1
     ORDER BY p.created_at`,
    [studentId]
  );
  console.log('\n=== Payments ===');
  for (const r of pays.rows) console.log(r);
}

process.exit(0);
