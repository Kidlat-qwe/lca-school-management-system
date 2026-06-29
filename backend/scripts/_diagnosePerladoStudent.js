import '../config/loadEnv.js';
import pkg from 'pg';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { loadInstallmentProfilePhaseChains } from '../lib/installmentPaymentEligibility.js';
import { mapPhaseChainsToLocalSlots } from '../utils/installmentPhaseRowMapping.js';
import { resolveProfilePhaseStart } from '../utils/phaseInstallmentUtils.js';

const { Pool } = pkg;
const useProduction = process.argv.includes('--production');

const pool = new Pool({
  host: useProduction
    ? process.env.DB_HOST_PRODUCTION || process.env.DB_HOST
    : process.env.DB_HOST,
  port: parseInt(
    (useProduction ? process.env.DB_PORT_PRODUCTION : process.env.DB_PORT) || '5432'
  ),
  database: useProduction
    ? process.env.DB_NAME_PRODUCTION || 'psms_production'
    : process.env.DB_NAME || 'psms_db',
  user: useProduction
    ? process.env.DB_USER_PRODUCTION || process.env.DB_USER
    : process.env.DB_USER,
  password: useProduction
    ? process.env.DB_PASSWORD_PRODUCTION || process.env.DB_PASSWORD
    : process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

const query = (text, params) => pool.query(text, params);

const EMAIL = 'cherriemae.perlado@gmail.com';
const NAME_LIKE = '%Perlado%';

async function main() {
  console.log('DB:', useProduction ? 'production' : 'development');

  const students = await query(
    `SELECT user_id, full_name, email, branch_id, level_tag
     FROM userstbl
     WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))
        OR full_name ILIKE $2`,
    [EMAIL, NAME_LIKE]
  );
  console.log('Students:', students.rows);

  for (const s of students.rows) {
    const sid = s.user_id;

    const profiles = await query(
      `SELECT ip.*, c.class_name
       FROM installmentinvoiceprofilestbl ip
       LEFT JOIN classestbl c ON c.class_id = ip.class_id
       WHERE ip.student_id = $1
       ORDER BY ip.installmentinvoiceprofiles_id`,
      [sid]
    );
    console.log('\nProfiles for', s.full_name, ':', profiles.rows);

    const enrollments = await query(
      `SELECT cs.classstudent_id, cs.class_id, cs.phase_number, cs.program_enrollment_status,
              cs.removed_at, c.class_name
       FROM classstudentstbl cs
       JOIN classestbl c ON c.class_id = cs.class_id
       WHERE cs.student_id = $1
       ORDER BY cs.class_id, cs.phase_number, cs.classstudent_id`,
      [sid]
    );
    console.log('\nEnrollments:', enrollments.rows);

    for (const p of profiles.rows) {
      const pid = p.installmentinvoiceprofiles_id;

      const invoices = await query(
        `SELECT invoice_id, status, invoice_ar_number,
                TO_CHAR(TIMEZONE('Asia/Manila', issue_date), 'YYYY-MM-DD') AS issue_ymd,
                TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due_ymd,
                amount, remarks, package_id
         FROM invoicestbl
         WHERE installmentinvoiceprofiles_id = $1
            OR invoice_id = COALESCE($2::int, 0)
         ORDER BY invoice_id`,
        [pid, p.downpayment_invoice_id]
      );
      console.log(`\nInvoices for profile ${pid}:`, invoices.rows);

      const queue = await query(
        `SELECT installmentinvoicedtl_id, scheduled_date, status, next_generation_date,
                next_invoice_month, frequency
         FROM installmentinvoicestbl WHERE installmentinvoiceprofiles_id = $1`,
        [pid]
      );
      console.log(`Queue for profile ${pid}:`, queue.rows);

      const payments = await query(
        `SELECT p.payment_id, p.invoice_id, p.amount, p.status,
                TO_CHAR(TIMEZONE('Asia/Manila', p.payment_date), 'YYYY-MM-DD') AS pay_ymd,
                i.invoice_ar_number, i.remarks, i.status AS invoice_status
         FROM paymenttbl p
         JOIN invoicestbl i ON i.invoice_id = p.invoice_id
         WHERE i.installmentinvoiceprofiles_id = $1
            OR i.invoice_id = COALESCE($2::int, 0)
         ORDER BY p.payment_id`,
        [pid, p.downpayment_invoice_id]
      );
      console.log(`Payments for profile ${pid}:`, payments.rows);

      const ars = await query(
        `SELECT ack_receipt_id, ack_receipt_number, status, payment_amount,
                TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue_ymd,
                invoice_id, installment_option, ar_type, paired_ack_receipt_id
         FROM acknowledgement_receiptstbl
         WHERE student_id = $1
         ORDER BY ack_receipt_id`,
        [sid]
      );
      console.log(`ARs for student ${sid}:`, ars.rows);

      const client = await pool.connect();
      try {
        const { phaseChains } = await loadInstallmentProfilePhaseChains(client, pid);
        const mapped = mapPhaseChainsToLocalSlots(phaseChains, p);
        const phaseStart = resolveProfilePhaseStart(p);
        const rows = [];
        for (const [local, chain] of [...mapped.entries()].sort((a, b) => a[0] - b[0])) {
          const rep = chain.representative;
          rows.push({
            local,
            display: local + phaseStart - 1,
            invoice_id: rep.invoice_id,
            status: rep.status,
            ar: rep.invoice_ar_number,
            target: parseTargetPhase(rep.remarks),
            issue: rep.issue_date,
            due: rep.due_date,
            paid: rep.paid_amount,
          });
        }
        console.log(`Phase mapping profile ${pid}:`, rows);
      } finally {
        client.release();
      }
    }
  }

  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
