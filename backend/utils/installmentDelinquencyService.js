import { getClient } from '../config/database.js';
import { formatYmdLocal, parseYmdToLocalNoon } from './dateUtils.js';
import { getEffectiveSettings, SETTINGS_DEFINITIONS } from './settingsService.js';
import {
  syncAllProgramPaymentStatuses,
  syncProgramPaymentStatusForInvoice,
} from './programPaymentStatusService.js';
import { isInstallmentPenaltyExemptInvoice } from './installmentPenaltyExempt.js';
import { getChainFinancialSummary } from './balanceInvoice.js';
import { applyDelinquencyDropForInvoiceChain } from './installmentDelinquencyDrop.js';

const EPSILON = 0.01;

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

const isOnOrAfterDate = (a, b) => {
  const ay = a ? formatYmdLocal(a) : null;
  const by = b ? formatYmdLocal(b) : null;
  if (!ay || !by) return false;
  return ay >= by;
};

const computeInvoiceTotals = async (client, invoiceId) => {
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
    programPaymentStatusesSynced: 0,
    errors: 0,
  };

  try {
    const settingsCache = new Map();
    const processedChains = new Set();

    const candidates = await client.query(
      `SELECT
        i.invoice_id,
        i.status,
        i.due_date,
        TO_CHAR(i.issue_date, 'YYYY-MM-DD') AS issue_date,
        i.installmentinvoiceprofiles_id,
        i.late_penalty_applied_for_due_date,
        COALESCE(i.invoice_chain_root_id, i.invoice_id) AS chain_root_id,
        ip.student_id,
        ip.class_id,
        COALESCE(ip.branch_id, i.branch_id) as branch_id
       FROM invoicestbl i
       INNER JOIN installmentinvoiceprofilestbl ip
         ON i.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
       WHERE i.installmentinvoiceprofiles_id IS NOT NULL
         AND i.status NOT IN ('Paid', 'Cancelled')
         AND i.due_date IS NOT NULL
         AND i.due_date < CURRENT_DATE
         AND (i.issue_date IS NULL OR i.due_date >= i.issue_date)`
    );

    result.scanned = candidates.rows.length;

    for (const row of candidates.rows) {
      const chainRootId = Number(row.chain_root_id);
      if (processedChains.has(chainRootId)) {
        continue;
      }
      processedChains.add(chainRootId);

      const invoiceId = row.invoice_id;

      try {
        await client.query('BEGIN');

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
        const dueDate = invoice.due_date;
        const today = new Date();

        const chainSummary = await getChainFinancialSummary(client, chainRootId);
        if (chainSummary.remaining_on_leaf <= EPSILON) {
          await client.query('ROLLBACK');
          continue;
        }

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

        const effectiveGraceDays = Number.isFinite(graceDays) ? graceDays : 0;
        const graceThreshold = addDaysLocalNoon(dueDate, effectiveGraceDays + 1);
        const isPenaltyEligible = graceThreshold ? isOnOrAfterDate(today, graceThreshold) : true;

        const penaltyExempt = await isInstallmentPenaltyExemptInvoice(client, {
          invoiceId: chainRootId,
          profileId: row.installmentinvoiceprofiles_id,
        });

        const payableInvoiceId = chainSummary.payable_invoice_id;
        const { remainingBalance } = await computeInvoiceTotals(client, payableInvoiceId);

        const alreadyAppliedForDueDate =
          invoice.late_penalty_applied_for_due_date &&
          formatYmdLocal(invoice.late_penalty_applied_for_due_date) === formatYmdLocal(dueDate);

        if (!penaltyExempt && !alreadyAppliedForDueDate && isPenaltyEligible && remainingBalance > EPSILON) {
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
                payableInvoiceId,
                `Late Payment Penalty (${penaltyPctLabel}%)`,
                0,
                0,
                penalty,
                null,
                null,
              ]
            );

            await client.query(
              `UPDATE invoicestbl
               SET amount = $1,
                   late_penalty_applied_for_due_date = due_date
               WHERE invoice_id = $2`,
              [round2(remainingBalance + penalty), payableInvoiceId]
            );

            const totalsAfterPenalty = await computeInvoiceTotals(client, payableInvoiceId);
            const newStatus =
              totalsAfterPenalty.totalPaid >= (totalsAfterPenalty.originalInvoiceAmount || 0)
                ? 'Paid'
                : totalsAfterPenalty.totalPaid > 0
                  ? 'Partially Paid'
                  : 'Unpaid';

            if (newStatus !== row.status) {
              await client.query('UPDATE invoicestbl SET status = $1 WHERE invoice_id = $2', [
                newStatus,
                payableInvoiceId,
              ]);
            }

            result.penaltiesApplied += 1;
          } else {
            await client.query(
              `UPDATE invoicestbl
               SET late_penalty_applied_for_due_date = due_date
               WHERE invoice_id = $1`,
              [payableInvoiceId]
            );
          }
        }

        if (row.class_id && row.student_id) {
          const dropResult = await applyDelinquencyDropForInvoiceChain(client, {
            invoiceId: chainRootId,
            profileId: row.installmentinvoiceprofiles_id,
            studentId: row.student_id,
            classId: row.class_id,
            branchId: row.branch_id,
            dueDate,
          });
          if (dropResult.applied) {
            result.removalsApplied += 1;
          }
        }

        const syncResult = await syncProgramPaymentStatusForInvoice(client, payableInvoiceId);
        result.programPaymentStatusesSynced += syncResult.synced || 0;

        await client.query('COMMIT');
      } catch (e) {
        result.errors += 1;
        try {
          await client.query('ROLLBACK');
        } catch {
          // ignore
        }
        console.error('[Delinquency] Error processing invoice chain', invoiceId, e);
      }
    }

    const allSyncResult = await syncAllProgramPaymentStatuses(client);
    result.programPaymentStatusesSynced += allSyncResult.synced || 0;

    return result;
  } finally {
    client.release();
  }
};
