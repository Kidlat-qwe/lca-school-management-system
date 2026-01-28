import { getClient } from '../config/database.js';

const PENALTY_RATE = 0.10;

const round2 = (n) => {
  const x = Number(n) || 0;
  return Math.round(x * 100) / 100;
};

const computeInvoiceTotals = async (client, invoiceId) => {
  // Mirror the existing payments route calculation for consistency.
  const invoiceItemsResult = await client.query(
    `SELECT 
      COALESCE(SUM(amount), 0) as item_amount,
      COALESCE(SUM(discount_amount), 0) as total_discount,
      COALESCE(SUM(penalty_amount), 0) as total_penalty,
      COALESCE(SUM(amount * COALESCE(tax_percentage, 0) / 100), 0) as total_tax
     FROM invoiceitemstbl
     WHERE invoice_id = $1`,
    [invoiceId]
  );

  const itemAmount = parseFloat(invoiceItemsResult.rows[0]?.item_amount) || 0;
  const totalDiscount = parseFloat(invoiceItemsResult.rows[0]?.total_discount) || 0;
  const totalPenalty = parseFloat(invoiceItemsResult.rows[0]?.total_penalty) || 0;
  const totalTax = parseFloat(invoiceItemsResult.rows[0]?.total_tax) || 0;

  const originalInvoiceAmount = itemAmount - totalDiscount + totalPenalty + totalTax;

  const totalPaymentsResult = await client.query(
    `SELECT COALESCE(SUM(payable_amount), 0) as total_paid
     FROM paymenttbl
     WHERE invoice_id = $1 AND status = $2`,
    [invoiceId, 'Completed']
  );
  const totalPaid = parseFloat(totalPaymentsResult.rows[0]?.total_paid) || 0;

  const remainingBalance = Math.max(0, originalInvoiceAmount - totalPaid);

  return { originalInvoiceAmount, totalPaid, remainingBalance };
};

/**
 * Process delinquent installment invoices:
 * - Apply one-time 10% penalty after due_date (based on remaining balance)
 * - Remove student from class if overdue by >= 1 month (same day-of-month next month)
 */
export const processInstallmentDelinquencies = async () => {
  const client = await getClient();

  const result = {
    scanned: 0,
    penaltiesApplied: 0,
    removalsApplied: 0,
    errors: 0,
  };

  try {
    // Find installment-linked invoices that are overdue and not paid/cancelled
    const candidates = await client.query(
      `SELECT
        i.invoice_id,
        i.status,
        i.due_date,
        i.installmentinvoiceprofiles_id,
        i.late_penalty_applied_for_due_date,
        ip.student_id,
        ip.class_id
       FROM invoicestbl i
       INNER JOIN installmentinvoiceprofilestbl ip
         ON i.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
       WHERE i.installmentinvoiceprofiles_id IS NOT NULL
         AND i.status NOT IN ('Paid', 'Cancelled')
         AND i.due_date IS NOT NULL
         AND i.due_date < CURRENT_DATE`
    );

    result.scanned = candidates.rows.length;

    for (const row of candidates.rows) {
      const invoiceId = row.invoice_id;

      try {
        await client.query('BEGIN');

        // Lock invoice row so we don't double-apply penalty if job overlaps
        const invoiceLock = await client.query(
          `SELECT invoice_id, status, due_date, late_penalty_applied_for_due_date
           FROM invoicestbl
           WHERE invoice_id = $1
           FOR UPDATE`,
          [invoiceId]
        );
        if (invoiceLock.rows.length === 0) {
          await client.query('ROLLBACK');
          continue;
        }

        const invoice = invoiceLock.rows[0];
        const dueDate = invoice.due_date; // Date object (pg)

        const { remainingBalance } = await computeInvoiceTotals(client, invoiceId);

        // Nothing to do if already fully settled
        if (remainingBalance <= 0) {
          await client.query('ROLLBACK');
          continue;
        }

        // 1) One-time penalty (guarded by due_date)
        const alreadyAppliedForDueDate =
          invoice.late_penalty_applied_for_due_date &&
          String(invoice.late_penalty_applied_for_due_date) === String(dueDate);

        if (!alreadyAppliedForDueDate) {
          const penalty = round2(remainingBalance * PENALTY_RATE);

          if (penalty > 0) {
            await client.query(
              `INSERT INTO invoiceitemstbl
                (invoice_id, description, amount, discount_amount, penalty_amount, tax_item, tax_percentage)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [
                invoiceId,
                'Late Payment Penalty (10%)',
                0,
                0,
                penalty,
                null,
                null,
              ]
            );

            // Update remaining amount shown on invoice list views
            await client.query(
              `UPDATE invoicestbl
               SET amount = $1,
                   late_penalty_applied_for_due_date = due_date
               WHERE invoice_id = $2`,
              [round2(remainingBalance + penalty), invoiceId]
            );

            // Update status to reflect payments (Unpaid vs Partially Paid)
            const totalsAfterPenalty = await computeInvoiceTotals(client, invoiceId);
            const newStatus =
              totalsAfterPenalty.totalPaid >= (totalsAfterPenalty.originalInvoiceAmount || 0)
                ? 'Paid'
                : totalsAfterPenalty.totalPaid > 0
                  ? 'Partially Paid'
                  : 'Unpaid';

            if (newStatus !== row.status) {
              await client.query('UPDATE invoicestbl SET status = $1 WHERE invoice_id = $2', [
                newStatus,
                invoiceId,
              ]);
            }

            result.penaltiesApplied += 1;
          } else {
            // Still mark guard to avoid re-check if remaining is tiny/0 after rounding
            await client.query(
              `UPDATE invoicestbl
               SET late_penalty_applied_for_due_date = due_date
               WHERE invoice_id = $1`,
              [invoiceId]
            );
          }
        }

        // 2) Auto removal when overdue by >= 1 month (same day-of-month logic via interval '1 month')
        const overdueMonthCheck = await client.query(
          `SELECT 1
           FROM invoicestbl
           WHERE invoice_id = $1
             AND due_date IS NOT NULL
             AND (due_date + INTERVAL '1 month') <= CURRENT_DATE`,
          [invoiceId]
        );

        if (overdueMonthCheck.rows.length > 0 && row.class_id && row.student_id) {
          // Recompute after any penalty insertion to ensure remaining > 0
          const totalsForRemoval = await computeInvoiceTotals(client, invoiceId);
          if (totalsForRemoval.remainingBalance > 0) {
            const updateRes = await client.query(
              `UPDATE classstudentstbl
               SET enrollment_status = 'Removed',
                   removed_at = CURRENT_TIMESTAMP,
                   removed_reason = $1,
                   removed_by = $2
               WHERE class_id = $3
                 AND student_id = $4
                 AND COALESCE(enrollment_status, 'Active') = 'Active'`,
              [
                'Installment delinquency (>= 1 month overdue)',
                'System',
                row.class_id,
                row.student_id,
              ]
            );

            if ((updateRes.rowCount || 0) > 0) {
              result.removalsApplied += 1;
            }
          }
        }

        await client.query('COMMIT');
      } catch (e) {
        result.errors += 1;
        try {
          await client.query('ROLLBACK');
        } catch {
          // ignore
        }
        console.error('[Delinquency] Error processing invoice', invoiceId, e);
      }
    }

    return result;
  } finally {
    client.release();
  }
};

