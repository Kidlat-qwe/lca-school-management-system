const INV_DESCRIPTION_PATTERN = /^INV-\d+$/i;

/** Absolute class phase number from invoice remarks (TARGET_PHASE, REJOIN_PHASE, etc.). */
export function parseInvoiceTargetPhase(remarks) {
  const text = String(remarks || '');
  const targetMatch = text.match(/TARGET_PHASE:(\d+)/i);
  if (targetMatch) return parseInt(targetMatch[1], 10);

  const rejoinMatch = text.match(/REJOIN_PHASE:(\d+)/i);
  if (rejoinMatch) return parseInt(rejoinMatch[1], 10);

  const startMatch = text.match(/PHASE_START:(\d+)/i);
  const endMatch = text.match(/PHASE_END:(\d+)/i);
  if (startMatch) {
    const start = parseInt(startMatch[1], 10);
    const end = endMatch ? parseInt(endMatch[1], 10) : start;
    if (Number.isFinite(start) && Number.isFinite(end) && start === end) {
      return start;
    }
  }
  return null;
}

/** Resolve user-facing package/plan label (mirrors invoice list display_description). */
export function resolvePaymentLogBaseDescription(payment) {
  if (!payment) return '-';

  const raw = String(payment.invoice_description || '').trim();
  if (raw && raw !== 'TEMP' && !INV_DESCRIPTION_PATTERN.test(raw)) {
    return raw;
  }

  const profileDesc = String(payment.installment_profile_description || '').trim();
  if (!profileDesc && !payment.installmentinvoiceprofiles_id) {
    return raw || (payment.invoice_id ? `INV-${payment.invoice_id}` : '-');
  }

  const isDownpayment =
    Number(payment.installment_downpayment_invoice_id) === Number(payment.invoice_id);
  if (isDownpayment) {
    return profileDesc.toLowerCase().startsWith('downpayment')
      ? profileDesc
      : `Downpayment - ${profileDesc}`;
  }

  const phase = parseInvoiceTargetPhase(payment.invoice_remarks);
  if (phase) {
    return `Phase ${phase} - ${profileDesc}`;
  }

  return profileDesc || raw || (payment.invoice_id ? `INV-${payment.invoice_id}` : '-');
}

/**
 * @returns {{ main: string, context: string|null, contextVariant: string|null }}
 */
export function getPaymentLogPackageItemContext(payment) {
  const main = resolvePaymentLogBaseDescription(payment);
  const paymentType = String(payment?.payment_type || '').trim();

  if (paymentType === 'Partial Payment') {
    return {
      main,
      context: 'Partial payment',
      contextVariant: 'partial',
    };
  }

  if (payment?.parent_invoice_id) {
    const parentRef = `INV-${payment.parent_invoice_id}`;
    const invoiceStatus = String(payment?.invoice_status || '').trim();

    if (invoiceStatus === 'Paid') {
      return {
        main,
        context: `Completed balance from partial payment (${parentRef})`,
        contextVariant: 'completed-balance',
      };
    }

    return {
      main,
      context: `Remaining balance from partial payment (${parentRef})`,
      contextVariant: 'remaining-balance',
    };
  }

  return { main, context: null, contextVariant: null };
}

/** Single-line label for export, sort, and tooltips. */
export function getPaymentLogPackageItemDisplayText(payment) {
  const { main, context } = getPaymentLogPackageItemContext(payment);
  return context ? `${main} — ${context}` : main;
}
