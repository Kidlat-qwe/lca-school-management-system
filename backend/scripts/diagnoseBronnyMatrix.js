import '../config/loadEnv.js';
import { query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';

const sid = 35;

const cs = await query(
  'SELECT * FROM classstudentstbl WHERE student_id = $1 ORDER BY classstudent_id',
  [sid]
);
console.log('ALL CLASSSTUDENT:', JSON.stringify(cs.rows, null, 2));

const inv = await query(
  `SELECT i.invoice_id, i.status, i.issue_date, i.remarks, i.invoice_description
   FROM invoicestbl i
   JOIN invoicestudentstbl ist ON ist.invoice_id = i.invoice_id
   WHERE ist.student_id = $1`,
  [sid]
);
console.log('INVOICES:', inv.rows);

const cls = await query('SELECT class_id, class_name, start_date FROM classestbl WHERE class_id = 34');
console.log('CLASS:', cls.rows);

const matrix = await loadStudentMonthEnrollmentMatrix(query, { classId: 34, year: 2026 });
const bronny = matrix.students.find((s) => s.student_id === sid);
console.log('BRONNY MATRIX:', JSON.stringify(bronny, null, 2));

process.exit(0);
