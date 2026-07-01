/**
 * Diagnose installment billing schedule for Matthew R. Sabino.
 * Run: node backend/scripts/diagnoseMatthewSabinoInstallment.js
 */
import '../config/loadEnv.js';
import { query } from '../config/database.js';
import { buildPhaseInstallmentSchedule } from '../utils/phaseInstallmentUtils.js';

const EMAIL = 'eumarck.sabino@gmail.com';

async function main() {
  const studentRes = await query(
    `SELECT user_id, full_name, email FROM userstbl WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [EMAIL]
  );
  if (!studentRes.rows.length) {
    console.log('Student not found for', EMAIL);
    return;
  }
  const student = studentRes.rows[0];
  console.log('\nStudent:', student);

  const profiles = await query(
    `SELECT ip.*, ii.installmentinvoicedtl_id, ii.next_generation_date, ii.next_invoice_month, ii.status AS ii_status
     FROM installmentinvoiceprofilestbl ip
     LEFT JOIN installmentinvoicestbl ii ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
     WHERE ip.student_id = $1
     ORDER BY ip.installmentinvoiceprofiles_id`,
    [student.user_id]
  );
  console.log('\nProfiles:', profiles.rows);

  for (const profile of profiles.rows) {
    if (!profile.class_id) continue;

    const classRes = await query(
      `SELECT class_id, class_name, start_date, end_date FROM classestbl WHERE class_id = $1`,
      [profile.class_id]
    );
    console.log('\nClass:', classRes.rows[0]);

    const sessions = await query(
      `SELECT phase_number, MIN(scheduled_date)::text AS phase_start, COUNT(*)::int AS session_count
       FROM classsessionstbl
       WHERE class_id = $1
       GROUP BY phase_number
       ORDER BY phase_number
       LIMIT 5`,
      [profile.class_id]
    );
    console.log('\nPhase session starts (first 5):');
    for (const s of sessions.rows) console.log(s);

    const invoices = await query(
      `SELECT invoice_id, invoice_ar_number, issue_date::text, due_date::text, status, remarks
       FROM invoicestbl
       WHERE installmentinvoiceprofiles_id = $1
       ORDER BY issue_date, invoice_id`,
      [profile.installmentinvoiceprofiles_id]
    );
    console.log('\nInvoices:');
    for (const inv of invoices.rows) console.log(inv);

    for (const gc of [0, 1, 2]) {
      const sched = await buildPhaseInstallmentSchedule({
        db: { query },
        profile,
        generatedCountOverride: gc,
      });
      console.log(`\nbuildPhaseInstallmentSchedule(generated_count=${gc}):`, sched);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
