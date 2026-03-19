/**
 * One-off script: Remove penalty from all invoices for given students (by email or full name).
 * - Finds students by email (STUDENT_EMAILS) or full_name (STUDENT_NAMES) in userstbl (user_type = 'Student')
 * - Finds all invoices linked to those students (invoicestudentstbl + installment profile invoices)
 * - For each invoice: zeros penalty_amount and amount on penalty line items, recomputes invoice amount, clears late_penalty_applied_for_due_date
 *
 * Run from project root: node backend/scripts/removePenaltyForStudentsByEmail.js
 * Or from backend: node scripts/removePenaltyForStudentsByEmail.js (with dotenv path adjusted)
 */

// Use same env/DB mapping as server (NODE_ENV + DB_*_PRODUCTION / DB_*_DEVELOPMENT)
import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

const STUDENT_EMAILS = [
  // Target by email (leave empty to use STUDENT_NAMES)
  'judyannferrer928@gmail.com',
  'prescellianogorre@gmail.com',
];

const STUDENT_NAMES = [
  // No name-based targeting for this run
];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function main() {
  const client = await getClient();

  try {
    // 1) Resolve emails or names to student user_ids
    let students = [];
    if (STUDENT_EMAILS.length > 0) {
      const r = await client.query(
        `SELECT user_id, email, full_name FROM userstbl WHERE user_type = 'Student' AND email = ANY($1::text[])`,
        [STUDENT_EMAILS]
      );
      students = r.rows;
    }
    if (STUDENT_NAMES.length > 0) {
      const r = await client.query(
        `SELECT user_id, email, full_name FROM userstbl WHERE user_type = 'Student' AND full_name = ANY($1::text[])`,
        [STUDENT_NAMES]
      );
      const byId = new Map(students.map((s) => [s.user_id, s]));
      r.rows.forEach((s) => byId.set(s.user_id, s));
      students = Array.from(byId.values());
    }
    const studentIds = students.map((s) => s.user_id);

    if (studentIds.length === 0) {
      console.log('No students found for the given emails/names.');
      return;
    }
    console.log(`Found ${studentIds.length} student(s):`, students.map((s) => `${s.email} (${s.full_name})`).join(', '));

    // 2) Collect all invoice_ids for these students
    // a) Invoices linked via invoicestudentstbl
    const invStudentResult = await client.query(
      `SELECT DISTINCT invoice_id FROM invoicestudentstbl WHERE student_id = ANY($1::int[])`,
      [studentIds]
    );
    // b) Invoices linked via installment profile (installmentinvoiceprofilestbl.student_id)
    const invProfileResult = await client.query(
      `SELECT DISTINCT i.invoice_id
       FROM invoicestbl i
       INNER JOIN installmentinvoiceprofilestbl ip ON i.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
       WHERE ip.student_id = ANY($1::int[])`,
      [studentIds]
    );

    const allInvoiceIds = [
      ...new Set([
        ...invStudentResult.rows.map((r) => r.invoice_id),
        ...invProfileResult.rows.map((r) => r.invoice_id),
      ]),
    ].filter(Boolean);

    if (allInvoiceIds.length === 0) {
      console.log('No invoices found for these students.');
      return;
    }
    console.log(`Found ${allInvoiceIds.length} invoice(s) to process.`);

    let invoicesUpdated = 0;
    let itemsZeroed = 0;

    for (const invoiceId of allInvoiceIds) {
      await client.query('BEGIN');

      try {
        // 3) Find line items that have penalty (penalty_amount > 0)
        const itemsResult = await client.query(
          `SELECT invoice_item_id, description, amount, discount_amount, penalty_amount, tax_percentage
           FROM invoiceitemstbl WHERE invoice_id = $1 AND (COALESCE(penalty_amount, 0) > 0)`,
          [invoiceId]
        );

        if (itemsResult.rows.length === 0) {
          await client.query('ROLLBACK');
          continue;
        }

        // 4) Zero out penalty on those items (amount and penalty_amount)
        for (const item of itemsResult.rows) {
          await client.query(
            `UPDATE invoiceitemstbl SET amount = 0, penalty_amount = 0 WHERE invoice_item_id = $1`,
            [item.invoice_item_id]
          );
          itemsZeroed += 1;
        }

        // 5) Recompute invoice total from items (same formula as computeInvoiceTotals)
        const sumResult = await client.query(
          `SELECT
             COALESCE(SUM(amount), 0) as item_amount,
             COALESCE(SUM(discount_amount), 0) as total_discount,
             COALESCE(SUM(penalty_amount), 0) as total_penalty,
             COALESCE(SUM(amount * COALESCE(tax_percentage, 0) / 100), 0) as total_tax
           FROM invoiceitemstbl WHERE invoice_id = $1`,
          [invoiceId]
        );
        const row = sumResult.rows[0];
        const itemAmount = parseFloat(row?.item_amount) || 0;
        const totalDiscount = parseFloat(row?.total_discount) || 0;
        const totalPenalty = parseFloat(row?.total_penalty) || 0;
        const totalTax = parseFloat(row?.total_tax) || 0;
        const newAmount = round2(itemAmount - totalDiscount + totalPenalty + totalTax);

        // 6) Update invoicestbl: set amount and clear late_penalty_applied_for_due_date
        await client.query(
          `UPDATE invoicestbl
           SET amount = $1, late_penalty_applied_for_due_date = NULL
           WHERE invoice_id = $2`,
          [newAmount, invoiceId]
        );

        invoicesUpdated += 1;
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`Error processing invoice ${invoiceId}:`, err.message);
      }
    }

    console.log(`Done. Invoices updated: ${invoicesUpdated}. Penalty line items zeroed: ${itemsZeroed}.`);
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
