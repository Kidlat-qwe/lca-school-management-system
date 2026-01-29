import { getClient } from '../config/database.js';
import { formatYmdLocal, parseYmdToLocalNoon } from './dateUtils.js';
import { getEffectiveSettings, SETTINGS_DEFINITIONS } from './settingsService.js';

const getDefaultBillingSettings = () => ({
  installment_penalty_rate: { value: SETTINGS_DEFINITIONS.installment_penalty_rate.defaultValue, scope: 'default' },
  installment_penalty_grace_days: {
    value: SETTINGS_DEFINITIONS.installment_penalty_grace_days.defaultValue,
    scope: 'default',
  },
  installment_final_dropoff_days: {
    value: SETTINGS_DEFINITIONS.installment_final_dropoff_days.defaultValue,
    scope: 'default',
  },
});

const round2 = (n) => {
  const x = Number(n) || 0;
  return Math.round(x * 100) / 100;
};

const addDaysLocalNoon = (dateObj, days) => {
  const baseYmd = formatYmdLocal(dateObj);
  const base = parseYmdToLocalNoon(baseYmd);
  if (!base) return null;
  const d = new Date(base);
  d.setDate(d.getDate() + (Number(days) || 0));
  return d;
};

const isAfterDate = (a, b) => {
  const ay = a ? formatYmdLocal(a) : null;
  const by = b ? formatYmdLocal(b) : null;
  if (!ay || !by) return false;
  return ay > by;
};

const isOnOrAfterDate = (a, b) => {
  const ay = a ? formatYmdLocal(a) : null;
  const by = b ? formatYmdLocal(b) : null;
  if (!ay || !by) return false;
  return ay >= by;
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
 * - Apply one-time penalty after due_date + grace_days (based on remaining balance)
 * - Remove student from class if overdue by >= final_dropoff_days
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
    const settingsCache = new Map(); // branchId (or 'global') -> effective settings

    // Find installment-linked invoices that are overdue and not paid/cancelled
    const candidates = await client.query(
      `SELECT
        i.invoice_id,
        i.status,
        i.due_date,
        i.installmentinvoiceprofiles_id,
        i.late_penalty_applied_for_due_date,
        ip.student_id,
        ip.class_id,
        COALESCE(ip.branch_id, i.branch_id) as branch_id
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
        const today = new Date();

        const { remainingBalance } = await computeInvoiceTotals(client, invoiceId);

        // Nothing to do if already fully settled
        if (remainingBalance <= 0) {
          await client.query('ROLLBACK');
          continue;
        }

        // Get effective billing settings for this branch (with safe fallback if settings table doesn't exist yet)
        const branchId = row.branch_id !== undefined && row.branch_id !== null ? Number(row.branch_id) : null;
        const cacheKey = branchId === null ? 'global' : String(branchId);
        let effective = settingsCache.get(cacheKey);
        if (!effective) {
          try {
            effective = await getEffectiveSettings(
              client,
              ['installment_penalty_rate', 'installment_penalty_grace_days', 'installment_final_dropoff_days'],
              branchId
            );
          } catch {
            effective = getDefaultBillingSettings();
          }
          settingsCache.set(cacheKey, effective);
        }

        const penaltyRate = Number(effective.installment_penalty_rate?.value);
        const graceDays = Number(effective.installment_penalty_grace_days?.value);
        const finalDropoffDays = Number(effective.installment_final_dropoff_days?.value);

        // Penalty applies when CURRENT_DATE > due_date + graceDays
        const graceThreshold = addDaysLocalNoon(dueDate, graceDays);
        const isPenaltyEligible = graceThreshold ? isAfterDate(today, graceThreshold) : true;

        // Removal applies when CURRENT_DATE >= due_date + finalDropoffDays
        const dropoffThreshold = addDaysLocalNoon(dueDate, finalDropoffDays);
        const isRemovalEligible = dropoffThreshold ? isOnOrAfterDate(today, dropoffThreshold) : false;

        // 1) One-time penalty (guarded by due_date)
        const alreadyAppliedForDueDate =
          invoice.late_penalty_applied_for_due_date &&
          formatYmdLocal(invoice.late_penalty_applied_for_due_date) === formatYmdLocal(dueDate);

        if (!alreadyAppliedForDueDate && isPenaltyEligible) {
          const safeRate = Number.isFinite(penaltyRate)
            ? penaltyRate
            : SETTINGS_DEFINITIONS.installment_penalty_rate.defaultValue;
          const penalty = round2(remainingBalance * safeRate);
          const penaltyPctLabel = Math.round(safeRate * 100);

          if (penalty > 0) {
            await client.query(
              `INSERT INTO invoiceitemstbl
                (invoice_id, description, amount, discount_amount, penalty_amount, tax_item, tax_percentage)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [
                invoiceId,
                `Late Payment Penalty (${penaltyPctLabel}%)`,
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

        // 2) Auto removal when overdue by >= final_dropoff_days
        if (isRemovalEligible && row.class_id && row.student_id) {
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
                `Installment delinquency (>= ${
                  Number.isFinite(finalDropoffDays)
                    ? finalDropoffDays
                    : SETTINGS_DEFINITIONS.installment_final_dropoff_days.defaultValue
                } days overdue)`,
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

