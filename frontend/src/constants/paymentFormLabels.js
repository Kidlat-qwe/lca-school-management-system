/**
 * Shared labels for Record Payment and related payment modals.
 */
export const PAYMENT_METHOD_OPTIONS = ['Cash', 'Online Banking', 'Credit Card', 'E-wallets'];

export const PAYMENT_METHOD_PLACEHOLDER = 'Select payment method';

export const PAYMENT_METHOD_REQUIRED_MESSAGE = 'Payment method is required';

/** Options for select elements, including legacy values not in the standard list. */
export function resolvePaymentMethodOptions(currentValue) {
  const c = String(currentValue || '').trim();
  if (c && !PAYMENT_METHOD_OPTIONS.includes(c)) {
    return [c, ...PAYMENT_METHOD_OPTIONS];
  }
  return PAYMENT_METHOD_OPTIONS;
}

export function isPaymentMethodSelected(value) {
  return PAYMENT_METHOD_OPTIONS.includes(String(value || '').trim());
}

export function isCashPaymentMethod(paymentMethod) {
  return String(paymentMethod || '').trim() === 'Cash';
}

/** Standard Record Payment modals require a reference unless payment method is Cash. */
export function isPaymentReferenceNumberRequired(paymentMethod) {
  return !isCashPaymentMethod(paymentMethod);
}

export function hasPaymentReferenceNumber(referenceNumber) {
  return Boolean(String(referenceNumber || '').trim());
}

/** Show editable ref for non-Cash; for Cash only when a reference is already stored. */
export function shouldShowPaymentReferenceNumberField(paymentMethod, referenceNumber) {
  return (
    isPaymentReferenceNumberRequired(paymentMethod) ||
    (isCashPaymentMethod(paymentMethod) && hasPaymentReferenceNumber(referenceNumber))
  );
}

/** Cash payments with an on-file reference are display-only in standard modals. */
export function isPaymentReferenceNumberReadOnly(paymentMethod) {
  return isCashPaymentMethod(paymentMethod);
}

/** Normalize reference for API payloads (Cash may keep an existing stored value). */
export function normalizePaymentReferenceNumber(paymentMethod, referenceNumber) {
  const trimmed = String(referenceNumber || '').trim();
  if (!trimmed) return null;
  if (isCashPaymentMethod(paymentMethod)) return trimmed;
  return trimmed;
}

/**
 * Finance/Superfinance approval: Cash payments skip reference verification.
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function validateFinancePaymentApproval(paymentMethod, enteredRef, originalRef) {
  if (isCashPaymentMethod(paymentMethod)) {
    return { ok: true };
  }
  const entered = String(enteredRef || '').trim();
  const original = String(originalRef || '').trim();
  if (!entered) {
    return { ok: false, message: 'Please enter the reference number before approval.' };
  }
  if (!original) {
    return {
      ok: false,
      message:
        'This payment has no reference number on file. Use Return to branch and ask the encoder to fix it first.',
    };
  }
  if (entered !== original) {
    return {
      ok: false,
      message:
        'Reference number does not match the recorded reference. You cannot approve this payment.\n\nPlease use Return to branch.',
    };
  }
  return { ok: true };
}

/** Build PUT /acknowledgement-receipts/:id/verify body for non-cash Finance verification. */
export function buildArVerifyRequestBody(paymentMethod, enteredRef, extras = {}) {
  const body = { action: 'verify', ...extras };
  if (!isCashPaymentMethod(paymentMethod)) {
    const ref = String(enteredRef || '').trim();
    if (ref) body.finance_verified_reference_number = ref;
  }
  return body;
}

/** Build PUT /payments/:id/approve body; omits finance ref for Cash. */
export function buildPaymentApproveRequestBody(paymentMethod, enteredRef, extras = {}) {
  const body = { approve: true, ...extras };
  if (!isCashPaymentMethod(paymentMethod)) {
    const ref = String(enteredRef || '').trim();
    if (ref) body.finance_verified_reference_number = ref;
  }
  return body;
}

export const PAYMENT_TIP_ADJUSTMENT_LABEL = 'Tip/Payment Adjustment';
export const PAYMENT_DISCOUNT_ADJUSTMENT_LABEL = 'Discount/Payment Adjustment';

export const PAYMENT_DISCOUNT_ADJUSTMENT_HINT =
  'When provided, this is deducted from what the student needs to pay (e.g. promo, early-bird, scholarship). The discount closes the invoice balance but is not counted as revenue.';

export const PAYMENT_DISCOUNT_ADJUSTMENT_HINT_PAYMENT_LOGS =
  'Deducted from what the student pays toward the invoice (same as Record Payment on Invoice). Must be less than payable amount.';

export const PAYMENT_DISCOUNT_ADJUSTMENT_HINT_AR =
  'When provided, this is deducted from the payment amount collected (e.g. promo, scholarship). The discount is not counted as revenue.';
