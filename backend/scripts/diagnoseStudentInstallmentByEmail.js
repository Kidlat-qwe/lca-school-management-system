/**
 * Read-only: installment snapshot for one student by email.
 * Usage: node backend/scripts/diagnoseStudentInstallmentByEmail.js --production xamarguelle@gmail.com
 */
import '../config/loadEnv.js';
import { query } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';

const email = process.argv.find((a) => a.includes('@')) || process.argv[2];
if (!email) {
  console.error('Usage: node diagnoseStudentInstallmentByEmail.js [--production] email@example.com');
  process.exit(1);
}

const student = (
  await query(
    `SELECT user_id, full_name, email FROM userstbl WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))`,
    [email]
  )
).rows[0];
if (!student) throw new Error(`Student not found: ${email}`);

const profiles = (
  await query(
    `SELECT ip.installmentinvoiceprofiles_id, ip.class_id, c.class_name, ip.generated_count,
            ip.is_active, ip.phase_start,
            TO_CHAR(TIMEZONE('Asia/Manila', ii.next_generation_date), 'YYYY-MM-DD') AS next_gen,
            TO_CHAR(TIMEZONE('Asia/Manila', ii.next_invoice_month), 'YYYY-MM-DD') AS next_month,
            TO_CHAR(TIMEZONE('Asia/Manila', ii.scheduled_date), 'YYYY-MM-DD') AS scheduled
     FROM installmentinvoiceprofilestbl ip
     LEFT JOIN classestbl c ON c.class_id = ip.class_id
     LEFT JOIN installmentinvoicestbl ii
       ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
      AND COALESCE(ii.status, '') != 'Generated'
     WHERE ip.student_id = $1
     ORDER BY ip.installmentinvoiceprofiles_id`,
    [student.user_id]
  )
).rows;

const invoices = (
  await query(
    `SELECT i.invoice_id, i.invoice_ar_number, i.status, i.amount,
            i.installmentinvoiceprofiles_id AS profile_id,
            i.parent_invoice_id, i.balance_invoice_id,
            TO_CHAR(TIMEZONE('Asia/Manila', i.issue_date), 'YYYY-MM-DD') AS issue,
            TO_CHAR(TIMEZONE('Asia/Manila', i.due_date), 'YYYY-MM-DD') AS due,
            SUBSTRING(i.remarks FROM 'TARGET_PHASE:([0-9]+)') AS phase
     FROM invoicestbl i
     WHERE i.installmentinvoiceprofiles_id IN (
       SELECT installmentinvoiceprofiles_id FROM installmentinvoiceprofilestbl WHERE student_id = $1
     )
       AND COALESCE(i.status, '') NOT IN ('Cancelled', 'Canceled')
     ORDER BY i.invoice_id`,
    [student.user_id]
  )
).rows.map((r) => ({ ...r, parsed_phase: parseTargetPhase(r.remarks) }));

console.log('Student:', student);
console.log('Profiles:', profiles);
console.log('Invoices:', invoices);
