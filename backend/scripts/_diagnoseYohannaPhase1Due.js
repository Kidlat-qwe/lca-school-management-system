/**
 * Diagnose Yohanna Aurelie D. Amorante Phase 1 due date (INV-1584).
 * Read-only. Usage: node backend/scripts/_diagnoseYohannaPhase1Due.js --production
 */
import '../config/loadEnv.js';
import { query } from '../config/database.js';
import { getPhaseDueDateYmd, getPhaseStartDate } from '../utils/phaseInstallmentUtils.js';

const EMAIL = 'lhianeee06@gmail.com';
const INVOICE_ID = 1584;

async function main() {
  const student = await query(
    `SELECT user_id, email,
            TRIM(CONCAT_WS(' ', first_name, middle_name, last_name)) AS full_name
     FROM userstbl WHERE LOWER(email) = LOWER($1)`,
    [EMAIL]
  );
  console.log('Student:', student.rows[0] || null);
  const sid = student.rows[0]?.user_id;
  if (!sid) process.exit(1);

  const inv = await query(
    `SELECT i.invoice_id, i.status,
            TO_CHAR(i.issue_date, 'YYYY-MM-DD') AS issue_ymd,
            TO_CHAR(i.due_date, 'YYYY-MM-DD') AS due_ymd,
            i.remarks, i.installmentinvoiceprofiles_id,
            i.ack_receipt_number
     FROM invoicestbl i
     WHERE i.invoice_id = $1`,
    [INVOICE_ID]
  );
  console.log('\nINV-1584:', inv.rows[0] || null);

  const profileId = inv.rows[0]?.installmentinvoiceprofiles_id;
  const profile = await query(
    `SELECT installmentinvoiceprofiles_id, class_id, phase_start, total_phases,
            generated_count, downpayment_paid, downpayment_invoice_id,
            TO_CHAR(bill_invoice_due_date, 'YYYY-MM-DD') AS bill_due,
            TO_CHAR(next_invoice_due_date, 'YYYY-MM-DD') AS next_due,
            description, is_active
     FROM installmentinvoiceprofilestbl
     WHERE installmentinvoiceprofiles_id = $1`,
    [profileId]
  );
  console.log('\nProfile:', profile.rows[0] || null);
  const classId = profile.rows[0]?.class_id;

  const cls = await query(
    `SELECT class_id, class_name, class_code,
            TO_CHAR(start_date, 'YYYY-MM-DD') AS start_ymd,
            TO_CHAR(end_date, 'YYYY-MM-DD') AS end_ymd
     FROM classtbl WHERE class_id = $1`,
    [classId]
  );
  console.log('\nClass:', cls.rows[0] || null);

  const phaseStart = await getPhaseStartDate(query, classId, 1);
  const expectedDue = await getPhaseDueDateYmd(query, classId, 1);
  console.log('\nCurrent Phase 1 MIN(session):', phaseStart ? phaseStart.toISOString?.() || phaseStart : null);
  console.log('Expected due (start-1 day) NOW:', expectedDue);

  const sessions = await query(
    `SELECT phase_number,
            TO_CHAR(MIN(scheduled_date), 'YYYY-MM-DD') AS phase_start,
            TO_CHAR(MAX(scheduled_date), 'YYYY-MM-DD') AS phase_end,
            COUNT(*)::int AS session_count
     FROM classsessionstbl
     WHERE class_id = $1
     GROUP BY phase_number
     ORDER BY phase_number
     LIMIT 5`,
    [classId]
  );
  console.log('\nPhase starts (current sessions):');
  console.table(sessions.rows);

  const adj = await query(
    `SELECT adjustment_id, class_id,
            TO_CHAR(old_start_date, 'YYYY-MM-DD') AS old_start,
            TO_CHAR(new_start_date, 'YYYY-MM-DD') AS new_start,
            reason, created_at
     FROM class_schedule_adjustmenttbl
     WHERE class_id = $1
     ORDER BY created_at DESC
     LIMIT 10`,
    [classId]
  ).catch((e) => ({ rows: [], error: e.message }));
  console.log('\nClass start adjustments:', adj.error || adj.rows);

  const classmates = await query(
    `SELECT i.invoice_id,
            TO_CHAR(i.issue_date, 'YYYY-MM-DD') AS issue_ymd,
            TO_CHAR(i.due_date, 'YYYY-MM-DD') AS due_ymd,
            i.status,
            u.email,
            TRIM(CONCAT_WS(' ', u.first_name, u.middle_name, u.last_name)) AS name
     FROM invoicestbl i
     JOIN installmentinvoiceprofilestbl p
       ON p.installmentinvoiceprofiles_id = i.installmentinvoiceprofiles_id
     JOIN userstbl u ON u.user_id = i.student_id
     WHERE p.class_id = $1
       AND i.remarks ILIKE '%TARGET_PHASE:1%'
     ORDER BY i.invoice_id`,
    [classId]
  );
  console.log('\nAll Phase 1 invoices on this class:');
  console.table(classmates.rows);

  const payments = await query(
    `SELECT payment_id, invoice_id, amount,
            TO_CHAR(payment_date, 'YYYY-MM-DD') AS pay_ymd,
            status, acknowledgement_receipt_number
     FROM paymenttbl
     WHERE invoice_id = $1 OR invoice_id = (
       SELECT downpayment_invoice_id FROM installmentinvoiceprofilestbl
       WHERE installmentinvoiceprofiles_id = $2
     )
     ORDER BY payment_id`,
    [INVOICE_ID, profileId]
  );
  console.log('\nRelated payments:');
  console.table(payments.rows);

  // Reconstruct what due would have been if Phase 1 started June 4
  console.log('\n--- Hypothesis check ---');
  console.log('If Phase 1 started 2026-06-04 → due = 2026-06-03 (matches INV)');
  console.log(`If Phase 1 starts ${expectedDue ? 'now ' + (await getPhaseStartDate(query, classId, 1)) : '?'} → due = ${expectedDue}`);
  console.log(
    `INV due ${inv.rows[0]?.due_ymd} vs expected now ${expectedDue}: ${
      inv.rows[0]?.due_ymd === expectedDue ? 'MATCH' : 'STALE / MISMATCH'
    }`
  );
  console.log(
    `Paid invoices are NOT realigned by classStartDateAdjustment (by design). Status=${inv.rows[0]?.status}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
