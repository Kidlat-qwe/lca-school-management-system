/**
 * Payment Logs "Issued By" display helpers.
 */

/** True when the payment method is FIUU (HPP, MIT channel labels, Online). */
export function isFiuuPaymentLogMethod(paymentMethod) {
  const m = String(paymentMethod || '').trim().toLowerCase();
  if (!m) return false;
  return m === 'fiuu' || m.startsWith('fiuu ') || m.startsWith('fiuu-') || m.includes('fiuu');
}

/**
 * Issued By column: FIUU gateway payments show plain "FIUU";
 * otherwise invoice issuer / payment recorder / fallbacks.
 */
export function formatPaymentLogIssuedBy(payment) {
  if (isFiuuPaymentLogMethod(payment?.payment_method)) {
    return 'FIUU';
  }

  const name = (payment?.invoice_issued_by_name || '').trim();
  const email = (payment?.invoice_issued_by_email || '').trim();
  if (name) return name;
  if (email) return email;

  const recorderName = (payment?.payment_created_by_name || '').trim();
  const recorderEmail = (payment?.payment_created_by_email || '').trim();
  if (recorderName) return recorderName;
  if (recorderEmail) return recorderEmail;

  if (payment?.created_by) return `User #${payment.created_by}`;
  if (!payment?.student_id) return 'Walk-in / Acknowledgement Receipt';
  return 'System';
}
