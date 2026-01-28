import { getClient } from '../config/database.js';
import { processInstallmentDelinquencies } from '../utils/installmentDelinquencyService.js';

const ymd = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function main() {
  const client = await getClient();
  const created = {};

  try {
    // Safety check: don’t run global processor if there are already overdue installment invoices.
    const pre = await client.query(
      `SELECT COUNT(*)::int AS cnt
       FROM invoicestbl i
       WHERE i.installmentinvoiceprofiles_id IS NOT NULL
         AND i.status NOT IN ('Paid', 'Cancelled')
         AND i.due_date IS NOT NULL
         AND i.due_date < CURRENT_DATE`
    );
    const preCnt = pre.rows?.[0]?.cnt ?? 0;
    console.log('[Test] preExistingOverdueInstallmentInvoices =', preCnt);
    if (preCnt > 0) {
      console.log(
        '[Test] ABORT: There are already overdue installment invoices; running the global processor could affect real data.'
      );
      process.exitCode = 2;
      return;
    }

    // Find a safe (class, student) pair where student is not currently enrolled in the class.
    const pair = await client.query(
      `SELECT c.class_id, c.branch_id, u.user_id AS student_id
       FROM classestbl c
       JOIN userstbl u
         ON u.user_type = 'Student'
        AND u.branch_id = c.branch_id
       WHERE c.branch_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM classstudentstbl cs
           WHERE cs.class_id = c.class_id AND cs.student_id = u.user_id
         )
       LIMIT 1`
    );
    if (pair.rows.length === 0) {
      throw new Error('No (class,student) pair found for test');
    }
    const { class_id: classId, branch_id: branchId, student_id: studentId } = pair.rows[0];
    console.log('[Test] using', { classId, branchId, studentId });

    // due_date exactly 1 month ago (same day-of-month) so removal condition triggers today.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(today);
    due.setMonth(due.getMonth() - 1);
    const issue = new Date(due);
    issue.setDate(issue.getDate() - 7);

    // Create enrollment (Active) so the processor can mark it Removed.
    const csRes = await client.query(
      `INSERT INTO classstudentstbl (student_id, class_id, enrolled_by, phase_number, enrollment_status)
       VALUES ($1, $2, $3, $4, 'Active')
       RETURNING classstudent_id`,
      [studentId, classId, 'Test Delinquency', 1]
    );
    created.classstudent_id = csRes.rows[0].classstudent_id;

    // Create installment profile.
    const profRes = await client.query(
      `INSERT INTO installmentinvoiceprofilestbl
         (student_id, branch_id, class_id, amount, frequency, description, is_active, downpayment_paid)
       VALUES ($1, $2, $3, $4, $5, $6, true, true)
       RETURNING installmentinvoiceprofiles_id`,
      [studentId, branchId, classId, 1000, '1 month(s)', 'Delinquency Test Profile']
    );
    created.profile_id = profRes.rows[0].installmentinvoiceprofiles_id;

    // Create overdue invoice linked to installment profile.
    const invRes = await client.query(
      `INSERT INTO invoicestbl
         (invoice_description, branch_id, amount, status, remarks, issue_date, due_date, created_by, installmentinvoiceprofiles_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING invoice_id`,
      [
        'TEST-DELINQ',
        branchId,
        1000,
        'Unpaid',
        'Delinquency test invoice',
        ymd(issue),
        ymd(due),
        null,
        created.profile_id,
      ]
    );
    created.invoice_id = invRes.rows[0].invoice_id;
    await client.query('UPDATE invoicestbl SET invoice_description = $1 WHERE invoice_id = $2', [
      `INV-TEST-${created.invoice_id}`,
      created.invoice_id,
    ]);

    // Base invoice item.
    await client.query(
      `INSERT INTO invoiceitemstbl
        (invoice_id, description, amount, discount_amount, penalty_amount, tax_item, tax_percentage)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [created.invoice_id, 'Installment Test Item', 1000, 0, 0, null, null]
    );

    // Link student to invoice.
    await client.query('INSERT INTO invoicestudentstbl (invoice_id, student_id) VALUES ($1, $2)', [
      created.invoice_id,
      studentId,
    ]);

    // Run processor (should only affect this test invoice).
    const run = await processInstallmentDelinquencies();
    console.log('[Test] processorResult', run);

    // Verify penalty + removal
    const items = await client.query(
      `SELECT description, amount, discount_amount, penalty_amount
       FROM invoiceitemstbl
       WHERE invoice_id = $1
       ORDER BY invoice_item_id`,
      [created.invoice_id]
    );
    console.log('[Test] invoiceItems', items.rows);

    const invoiceRow = await client.query(
      `SELECT invoice_id, invoice_description, amount, due_date, late_penalty_applied_for_due_date, status
       FROM invoicestbl
       WHERE invoice_id = $1`,
      [created.invoice_id]
    );
    console.log('[Test] invoiceRow', invoiceRow.rows[0]);

    const csRow = await client.query(
      `SELECT classstudent_id, enrollment_status, removed_at, removed_reason, removed_by
       FROM classstudentstbl
       WHERE classstudent_id = $1`,
      [created.classstudent_id]
    );
    console.log('[Test] classStudentRow', csRow.rows[0]);

    const activeCount = await client.query(
      `SELECT COUNT(*)::int AS cnt
       FROM classstudentstbl
       WHERE class_id = $1
         AND student_id = $2
         AND COALESCE(enrollment_status, 'Active') = 'Active'`,
      [classId, studentId]
    );
    console.log('[Test] activeEnrollmentCountAfter', activeCount.rows[0].cnt);

    // Basic assertions
    const penaltyLine = items.rows.find((r) => r.description === 'Late Payment Penalty (10%)');
    if (!penaltyLine || round2(penaltyLine.penalty_amount) !== 100) {
      throw new Error('Penalty line missing or incorrect (expected penalty_amount=100)');
    }
    if (csRow.rows[0]?.enrollment_status !== 'Removed') {
      throw new Error('Enrollment was not marked Removed');
    }
    if (activeCount.rows[0]?.cnt !== 0) {
      throw new Error('Removed enrollment is still counted as Active');
    }

    console.log('[Test] ✅ PASS: penalty applied + enrollment removed + removed not counted');
  } finally {
    // Cleanup test data
    try {
      if (created.invoice_id) {
        await client.query('DELETE FROM invoiceitemstbl WHERE invoice_id = $1', [created.invoice_id]);
        await client.query('DELETE FROM invoicestudentstbl WHERE invoice_id = $1', [created.invoice_id]);
        await client.query('DELETE FROM invoicestbl WHERE invoice_id = $1', [created.invoice_id]);
      }
      if (created.profile_id) {
        await client.query('DELETE FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1', [
          created.profile_id,
        ]);
      }
      if (created.classstudent_id) {
        await client.query('DELETE FROM classstudentstbl WHERE classstudent_id = $1', [created.classstudent_id]);
      }
      console.log('[Test] cleanupDone', created);
    } catch (cleanupError) {
      console.error('[Test] CLEANUP_FAILED', cleanupError, created);
    }
    client.release();
  }
}

main().catch((e) => {
  console.error('[Test] FAILED', e);
  process.exitCode = 1;
});

