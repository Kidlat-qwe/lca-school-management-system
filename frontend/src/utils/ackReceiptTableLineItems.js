/**
 * Acknowledgement receipt preview table rows (matches backend ackReceiptTableLineItems.js).
 */
import {
  PAYMENT_DISCOUNT_ADJUSTMENT_LABEL,
  PAYMENT_TIP_ADJUSTMENT_LABEL,
} from '../constants/paymentFormLabels';
import { buildReceiptTableRowsFromInvoiceItems } from './invoiceReceiptLineItems';

export const ACK_RECEIPT_PARTIAL_PAYMENT_SUFFIX = ' (Partial payment)';

function formatBalanceInvoiceLabel(balanceInvoiceId) {
  const id = Number(balanceInvoiceId);
  return Number.isFinite(id) && id > 0 ? `INV-${id}` : null;
}

const roundCurrency = (value) =>
  Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

function buildArReceiptLineRows(items, options = {}) {
  const rows = buildReceiptTableRowsFromInvoiceItems(items).map((row) => ({
    description: row.description,
    netAmount: row.amount,
  }));
  if (rows.length > 0) return rows;
  const fallbackAmount = roundCurrency(options.fallbackAmount || 0);
  if (fallbackAmount !== 0 || options.fallbackDescription) {
    return [
      {
        description: options.fallbackDescription || 'Payment',
        netAmount: fallbackAmount,
      },
    ];
  }
  return [];
}

export function sumInvoicePaymentSettled(payments = []) {
  return roundCurrency(
    (payments || []).reduce(
      (s, p) => s + (Number(p.payable_amount) || 0) + (Number(p.discount_amount) || 0),
      0,
    ),
  );
}

/** Invoice-linked AR preview — matches backend buildInvoiceLinkedArTableRows. */
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
      description: PAYMENT_DISCOUNT_ADJUSTMENT_LABEL,
      rate: -paymentDiscount,
      amount: -paymentDiscount,
    });
  }
  if (paymentTip > 0) {
    rows.push({
      description: PAYMENT_TIP_ADJUSTMENT_LABEL,
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

export function resolveArGrossPayable(ar, { selectedPackage } = {}) {
  const paymentAmount = parseFloat(ar?.payment_amount || 0) || 0;
  const isMerchandise = String(ar?.ar_type || '').toLowerCase() === 'merchandise';

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

  const pkg = selectedPackage || null;
  const downpayment =
    parseFloat(pkg?.downpayment_amount ?? ar?.pkg_join_downpayment ?? 0) || 0;
  const monthly =
    parseFloat(pkg?.package_price ?? ar?.pkg_join_monthly ?? ar?.package_amount_snapshot ?? 0) ||
    0;
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
 * @param {object} ar
 * @param {{ selectedPackage?: object }} [options]
 */
export function buildAckReceiptTableRows(ar, options = {}) {
  const paymentAmount = parseFloat(ar?.payment_amount || 0) || 0;
  const tipAmount = parseFloat(ar?.tip_amount || 0) || 0;
  const isMerchandise = String(ar?.ar_type || '').toLowerCase() === 'merchandise';
  const rows = [];

  if (isMerchandise) {
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
    const gross = resolveArGrossPayable(ar, options);
    rows.push({
      description: (ar?.package_name_snapshot || 'Package').trim() || 'Package',
      rate: gross,
      amount: gross,
    });
  }

  const grossBeforeDiscount = isMerchandise
    ? roundCurrency(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0))
    : resolveArGrossPayable(ar, options);
  const inferredDiscount = roundCurrency(Math.max(0, grossBeforeDiscount - paymentAmount));

  if (inferredDiscount > 0) {
    rows.push({
      description: PAYMENT_DISCOUNT_ADJUSTMENT_LABEL,
      rate: -inferredDiscount,
      amount: -inferredDiscount,
    });
  }
  if (tipAmount > 0) {
    rows.push({
      description: PAYMENT_TIP_ADJUSTMENT_LABEL,
      rate: tipAmount,
      amount: tipAmount,
    });
  }

  return {
    rows,
    total: roundCurrency(paymentAmount + tipAmount),
  };
}
