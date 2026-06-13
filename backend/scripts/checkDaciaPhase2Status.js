import '../config/loadEnv.js';
import { query } from '../config/database.js';
import { getCanonicalInstallmentPhaseCounts } from '../utils/balanceInvoice.js';

const rows = await query(
  `SELECT classstudent_id, phase_number, program_enrollment_status, enrolled_by,
          TO_CHAR(enrolled_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD HH24:MI') AS enrolled_manila
   FROM classstudentstbl WHERE student_id = 48 AND class_id = 33 ORDER BY phase_number`
);
console.log('=== Enrollment rows ===');
for (const r of rows.rows) console.log(r);

const counts = await getCanonicalInstallmentPhaseCounts(query, 9, 14);
console.log('\n=== Current paid phase count ===', counts);

// Simulate status at phase 2 payment: only INV-17 Paid
const sim = await query(
  `SELECT COUNT(DISTINCT CASE WHEN i.status = 'Paid' THEN COALESCE(i.invoice_chain_root_id, i.invoice_id) END) AS paid_phase_count
   FROM invoicestbl i
   WHERE i.installmentinvoiceprofiles_id = 9
     AND COALESCE(i.invoice_chain_root_id, i.invoice_id) != 14
     AND i.invoice_id IN (17, 182)`
);
console.log('\n=== If only INV-17 Paid (count before INV-182 update) ===', sim.rows[0]);

const sim2 = await query(
  `SELECT COUNT(DISTINCT CASE WHEN i.status = 'Paid' THEN COALESCE(i.invoice_chain_root_id, i.invoice_id) END) AS paid_phase_count
   FROM invoicestbl i
   WHERE i.installmentinvoiceprofiles_id = 9
     AND COALESCE(i.invoice_chain_root_id, i.invoice_id) != 14
     AND i.invoice_id IN (17, 182)
     AND i.status = 'Paid'`
);
console.log('=== Both INV-17 and INV-182 Paid ===', sim2.rows[0]);

process.exit(0);
