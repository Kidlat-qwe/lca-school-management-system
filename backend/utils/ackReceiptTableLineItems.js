/**
 * Acknowledgement receipt PDF/preview table rows (package, merchandise, tip, discount).
 */
import { buildArReceiptLineRows, roundCurrency } from './invoiceReceiptLineItems.js';

export const ACK_RECEIPT_TIP_LINE_LABEL = 'Tip/Payment Adjustment';
export const ACK_RECEIPT_DISCOUNT_LINE_LABEL = 'Discount/Payment Adjustment';
export const ACK_RECEIPT_PARTIAL_PAYMENT_SUFFIX = ' (Partial payment)';

function formatBalanceInvoiceLabel(balanceInvoiceId) {
  const id = Number(balanceInvoiceId);
  return Number.isFinite(id) && id > 0 ? `INV-${id}` : null;
}

function parseMerchandiseSnapshot(ar) {
  if (!ar?.merchandise_items_snapshot) return [];
  try {
    const raw =
      typeof ar.merchandise_items_snapshot === 'string'
        ? JSON.parse(ar.merchandise_items_snapshot)
        : ar.merchandise_items_snapshot;
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

/**
 * Gross payable before payment adjustment discount (not installment downpayment vs monthly).
 */
export function resolveArGrossPayable(ar) {
  const paymentAmount = parseFloat(ar?.payment_amount || 0) || 0;
  const arType = String(ar?.ar_type || '').toLowerCase();
  const isMerchandise = arType === 'merchandise';
  const isEvent = arType === 'event';

  if (isEvent) {
    return parseFloat(ar?.package_amount_snapshot || paymentAmount || 0) || paymentAmount;
  }

  if (isMerchandise) {
    const items = parseMerchandiseSnapshot(ar);
    if (items.length === 0) return paymentAmount;
    return roundCurrency(
      items.reduce((sum, item) => {
        const qty = Math.max(1, parseInt(item.quantity, 10) || 1);
        const unit = parseFloat(item.price || 0) || 0;
        return sum + unit * qty;
      }, 0),
    );
  }

  const downpayment = parseFloat(ar?.pkg_join_downpayment ?? 0) || 0;
  const monthly = parseFloat(ar?.pkg_join_monthly ?? ar?.package_amount_snapshot ?? 0) || 0;
  const snapName = String(ar?.package_name_snapshot || '');
  const snapLower = snapName.toLowerCase();

  if (snapLower.includes('(phase 1)') || snapLower.includes('phase 1)')) {
    return monthly > 0 ? monthly : paymentAmount;
  }
  if (snapLower.includes('downpayment for')) {
    if (downpayment > 0) return downpayment;
    const snapAmt = parseFloat(ar?.package_amount_snapshot ?? 0) || 0;
    return snapAmt > 0 ? snapAmt : paymentAmount;
  }

  const installmentOpt = String(ar?.installment_option || '').toLowerCase();
  if (installmentOpt === 'downpayment_only' && downpayment > 0) {
    return downpayment;
  }

  return monthly > 0 ? monthly : paymentAmount;
}

/**
 * @param {object} ar - acknowledgement receipt row (with optional pkg_join_* from PDF select)
 * @returns {{ rows: { description: string, rate: number, amount: number }[], total: number }}
 */
export function buildAckReceiptTableRows(ar) {
  const paymentAmount = parseFloat(ar?.payment_amount || 0) || 0;
  const tipAmount = parseFloat(ar?.tip_amount || 0) || 0;
  const isMerchandise = String(ar?.ar_type || '').toLowerCase() === 'merchandise';
  const isEvent = String(ar?.ar_type || '').toLowerCase() === 'event';
  const rows = [];

  if (isEvent) {
    const gross = resolveArGrossPayable(ar);
    rows.push({
      description: (ar?.package_name_snapshot || 'Little Champions Got Talent event ticket').trim(),
      rate: gross,
      amount: gross,
    });
  } else if (isMerchandise) {
    const items = parseMerchandiseSnapshot(ar);
    if (items.length > 0) {
      for (const item of items) {
        const qty = Math.max(1, parseInt(item.quantity, 10) || 1);
        const unit = parseFloat(item.price || 0) || 0;
        const line = roundCurrency(unit * qty);
        const name = item.merchandise_name || 'Item';
        const size = item.size ? ` (${item.size})` : '';
        rows.push({
          description: `Merchandise: ${name}${size}`,
          rate: unit,
          amount: line,
        });
      }
    } else {
      rows.push({
        description: 'Merchandise',
        rate: paymentAmount,
        amount: paymentAmount,
      });
    }
  } else {
    const gross = resolveArGrossPayable(ar);
    rows.push({
      description: (ar?.package_name_snapshot || 'Package').trim() || 'Package',
      rate: gross,
      amount: gross,
    });
  }

  const merchandiseGross = isMerchandise
    ? roundCurrency(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0))
    : 0;
  const packageGross = isMerchandise || isEvent ? 0 : resolveArGrossPayable(ar);
  const eventGross = isEvent ? resolveArGrossPayable(ar) : 0;
  const grossBeforeDiscount = isMerchandise
    ? merchandiseGross
    : isEvent
      ? eventGross
      : packageGross;
  const inferredDiscount = roundCurrency(Math.max(0, grossBeforeDiscount - paymentAmount));

  if (inferredDiscount > 0) {
    rows.push({
      description: ACK_RECEIPT_DISCOUNT_LINE_LABEL,
      rate: -inferredDiscount,
      amount: -inferredDiscount,
    });
  }
  if (tipAmount > 0) {
    rows.push({
      description: ACK_RECEIPT_TIP_LINE_LABEL,
      rate: tipAmount,
      amount: tipAmount,
    });
  }

  const total = roundCurrency(paymentAmount + tipAmount);
  return { rows, total };
}

/** Sum payable + discount from completed invoice payments (settlement, not tip). */
export function sumInvoicePaymentSettled(payments = []) {
  return roundCurrency(
    (payments || []).reduce(
      (s, p) => s + (Number(p.payable_amount) || 0) + (Number(p.discount_amount) || 0),
      0,
    ),
  );
}

/**
 * Invoice-linked AR PDF (GET /invoices/:id/pdf?doc_type=ar): invoice lines plus
 * payment-level Discount/Payment Adjustment and Tip/Payment Adjustment from paymenttbl.
 *
 * When settlement is less than invoice line total (partial payment), the receipt
 * shows the amount actually paid — not the full invoice balance.
 *
 * @param {Array} items - invoiceitemstbl rows
 * @param {Array<{ payable_amount?: number, discount_amount?: number, tip_amount?: number }>} payments
 * @param {{ fallbackDescription?: string, fallbackAmount?: number, remainingBalance?: number, balanceInvoiceId?: number }} [options]
 */
export function buildInvoiceLinkedArTableRows(items, payments = [], options = {}) {
  const paymentDiscount = roundCurrency(
    (payments || []).reduce((s, p) => s + (Number(p.discount_amount) || 0), 0),
  );
  const paymentTip = roundCurrency(
    (payments || []).reduce((s, p) => s + (Number(p.tip_amount) || 0), 0),
  );
  const totalSettled = sumInvoicePaymentSettled(payments);

  const itemRows = buildArReceiptLineRows(items, {
    fallbackDescription: options.fallbackDescription,
    fallbackAmount: options.fallbackAmount,
  });
  const itemsGrandTotal = roundCurrency(
    itemRows.reduce((s, r) => s + (Number(r.netAmount) || 0), 0),
  );

  const isPartialReceipt =
    totalSettled > 0.009 &&
    itemsGrandTotal > 0.009 &&
    totalSettled + 0.009 < itemsGrandTotal;

  const remainingBalance = isPartialReceipt
    ? roundCurrency(
        options.remainingBalance != null && !Number.isNaN(Number(options.remainingBalance))
          ? Number(options.remainingBalance)
          : Math.max(0, itemsGrandTotal - totalSettled),
      )
    : 0;

  let rows;
  if (isPartialReceipt) {
    const baseDescription =
      (options.fallbackDescription || itemRows[0]?.description || 'Payment').trim() ||
      'Payment';
    const description = `${baseDescription}${ACK_RECEIPT_PARTIAL_PAYMENT_SUFFIX}`;
    const lineAmount = roundCurrency(totalSettled);
    rows = [{ description, rate: lineAmount, amount: lineAmount }];
  } else if (itemRows.length > 0) {
    rows = itemRows.map((row) => ({
      description: row.description,
      rate: row.netAmount,
      amount: row.netAmount,
    }));
  } else {
    const fallback = roundCurrency(options.fallbackAmount || totalSettled);
    rows = [
      {
        description: options.fallbackDescription || 'Payment',
        rate: fallback,
        amount: fallback,
      },
    ];
  }

  if (isPartialReceipt && remainingBalance > 0.009) {
    const balanceLabel = formatBalanceInvoiceLabel(options.balanceInvoiceId);
    rows.push({
      description: balanceLabel
        ? `Remaining balance (${balanceLabel})`
        : 'Remaining balance',
      rate: remainingBalance,
      amount: remainingBalance,
      excludeFromTotal: true,
    });
  }

  if (!isPartialReceipt && paymentDiscount > 0) {
    rows.push({
      description: ACK_RECEIPT_DISCOUNT_LINE_LABEL,
      rate: -paymentDiscount,
      amount: -paymentDiscount,
    });
  }
  if (paymentTip > 0) {
    rows.push({
      description: ACK_RECEIPT_TIP_LINE_LABEL,
      rate: paymentTip,
      amount: paymentTip,
    });
  }

  const total = roundCurrency(
    rows.reduce(
      (s, r) => s + (r.excludeFromTotal ? 0 : Number(r.amount) || 0),
      0,
    ),
  );
  return { rows, total, isPartialPayment: isPartialReceipt, remainingBalance };
}

/** Sum payment-level discount/tip from completed invoice payments. */
export function sumInvoicePaymentAdjustments(payments = []) {
  const discount = roundCurrency(
    (payments || []).reduce((s, p) => s + (Number(p.discount_amount) || 0), 0),
  );
  const tip = roundCurrency(
    (payments || []).reduce((s, p) => s + (Number(p.tip_amount) || 0), 0),
  );
  return { discount, tip };
}

/** Invoice PDF total after payment Discount/Tip adjustment rows. */
export function computeInvoicePdfDisplayTotal(grandTotal, payments = []) {
  const { discount, tip } = sumInvoicePaymentAdjustments(payments);
  return roundCurrency((Number(grandTotal) || 0) - discount + tip);
}
