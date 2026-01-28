import { getClient } from '../config/database.js';
import { processDueInstallmentInvoices } from '../utils/installmentInvoiceGenerator.js';

const ymd = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
};

async function main() {
  const client = await getClient();
  const created = {};

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = ymd(today);

    // Safety: abort if real due invoices exist (to avoid changing production data)
    const pre = await client.query(
      `SELECT COUNT(*)::int AS cnt
       FROM installmentinvoicestbl ii
       JOIN installmentinvoiceprofilestbl ip
         ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
       WHERE ii.next_generation_date <= $1
         AND (ii.status IS NULL OR ii.status = '' OR ii.status != 'Generated')
         AND ip.is_active = true
         AND (ip.total_phases IS NULL OR ip.generated_count < ip.total_phases)
         AND (ip.downpayment_invoice_id IS NULL OR ip.downpayment_paid = true)`,
      [todayStr]
    );

    const preCnt = pre.rows?.[0]?.cnt ?? 0;
    console.log('[AutoGenTest] dueCountBefore =', preCnt);
    if (preCnt > 0) {
      console.log(
        '[AutoGenTest] ABORT: There are already due installment invoices for today/past. Testing would process real records.'
      );
      process.exitCode = 2;
      return;
    }

    // Find a safe student + branch + class
    const pair = await client.query(
      `SELECT c.class_id, c.branch_id, u.user_id AS student_id
       FROM classestbl c
       JOIN userstbl u
         ON u.user_type = 'Student'
        AND u.branch_id = c.branch_id
       WHERE c.branch_id IS NOT NULL
       LIMIT 1`
    );

    if (pair.rows.length === 0) {
      throw new Error('No suitable (class, student) found for test');
    }

    const { class_id: classId, branch_id: branchId, student_id: studentId } = pair.rows[0];
    console.log('[AutoGenTest] using', { classId, branchId, studentId });

    // Create profile (downpayment already paid so auto-gen is allowed)
    const profileRes = await client.query(
      `INSERT INTO installmentinvoiceprofilestbl
        (student_id, branch_id, class_id, amount, frequency, description, is_active, total_phases, generated_count, downpayment_paid)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7, 0, true)
       RETURNING installmentinvoiceprofiles_id`,
      [studentId, branchId, classId, 1000, '1 month(s)', 'AutoGen Test Profile', 10]
    );
    created.profile_id = profileRes.rows[0].installmentinvoiceprofiles_id;

    // Create installment invoice record due today
    const iiRes = await client.query(
      `INSERT INTO installmentinvoicestbl
        (installmentinvoiceprofiles_id, scheduled_date, status, student_name,
         total_amount_including_tax, total_amount_excluding_tax, frequency,
         next_generation_date, next_invoice_month)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING installmentinvoicedtl_id`,
      [
        created.profile_id,
        todayStr,
        null,
        'AutoGen Test Student',
        1000,
        1000,
        '1 month(s)',
        todayStr,
        todayStr,
      ]
    );
    created.installmentinvoicedtl_id = iiRes.rows[0].installmentinvoicedtl_id;

    // Run processor
    const run = await processDueInstallmentInvoices();
    console.log('[AutoGenTest] processorResult', run);

    // Verify that an invoice was created linked to our profile
    const inv = await client.query(
      `SELECT invoice_id, invoice_description, issue_date, due_date, status, amount
       FROM invoicestbl
       WHERE installmentinvoiceprofiles_id = $1
       ORDER BY invoice_id DESC
       LIMIT 1`,
      [created.profile_id]
    );

    if (inv.rows.length === 0) {
      throw new Error('No invoice created for test profile');
    }

    const invoiceRow = inv.rows[0];
    created.invoice_id = invoiceRow.invoice_id;
    console.log('[AutoGenTest] createdInvoice', invoiceRow);

    // Verify issue_date equals next_generation_date (today) and due_date is +7 days
    const expectedDue = new Date(today);
    expectedDue.setDate(expectedDue.getDate() + 7);
    const expectedDueStr = ymd(expectedDue);

    const issueStr = ymd(new Date(invoiceRow.issue_date));
    const dueStr = ymd(new Date(invoiceRow.due_date));

    if (issueStr !== todayStr) {
      throw new Error(`Issue date mismatch: expected ${todayStr}, got ${issueStr}`);
    }
    if (dueStr !== expectedDueStr) {
      throw new Error(`Due date mismatch: expected ${expectedDueStr}, got ${dueStr}`);
    }

    // Verify installment record advanced
    const ii = await client.query(
      `SELECT installmentinvoicedtl_id, status, next_generation_date, next_invoice_month, scheduled_date
       FROM installmentinvoicestbl
       WHERE installmentinvoicedtl_id = $1`,
      [created.installmentinvoicedtl_id]
    );
    console.log('[AutoGenTest] installmentRowAfter', ii.rows[0]);

    console.log('[AutoGenTest] ✅ PASS: next_generation_date=today triggered auto invoice creation');
  } finally {
    // Cleanup test data (invoice items + students + invoice + installment row + profile)
    try {
      if (created.invoice_id) {
        await client.query('DELETE FROM invoiceitemstbl WHERE invoice_id = $1', [created.invoice_id]);
        await client.query('DELETE FROM invoicestudentstbl WHERE invoice_id = $1', [created.invoice_id]);
        await client.query('DELETE FROM invoicestbl WHERE invoice_id = $1', [created.invoice_id]);
      }
      if (created.installmentinvoicedtl_id) {
        await client.query('DELETE FROM installmentinvoicestbl WHERE installmentinvoicedtl_id = $1', [
          created.installmentinvoicedtl_id,
        ]);
      }
      if (created.profile_id) {
        await client.query('DELETE FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1', [
          created.profile_id,
        ]);
      }
      console.log('[AutoGenTest] cleanupDone', created);
    } catch (cleanupError) {
      console.error('[AutoGenTest] CLEANUP_FAILED', cleanupError, created);
    }
    client.release();
  }
}

main().catch((e) => {
  console.error('[AutoGenTest] FAILED', e);
  process.exitCode = 1;
});

