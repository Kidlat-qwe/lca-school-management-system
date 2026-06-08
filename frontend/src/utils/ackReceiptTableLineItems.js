/**
 * Acknowledgement receipt preview table rows (matches backend ackReceiptTableLineItems.js).
 */
import {
  PAYMENT_DISCOUNT_ADJUSTMENT_LABEL,
  PAYMENT_TIP_ADJUSTMENT_LABEL,
} from '../constants/paymentFormLabels';

const roundCurrency = (value) =>
  Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

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
