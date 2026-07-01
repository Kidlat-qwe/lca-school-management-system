/**
 * Acknowledgement Receipt status labels, legend items, badge tones, and filter helpers.
 * User-facing AR statuses: Unverified, Verified, Applied, Returned, Rejected.
 */

export const AR_STATUS = Object.freeze({
  PENDING: 'Pending',
  UNVERIFIED: 'Unverified',
  SUBMITTED: 'Submitted',
  PAID: 'Paid',
  VERIFIED: 'Verified',
  APPLIED: 'Applied',
  ENROLLED: 'Enrolled',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
  RETURNED: 'Returned',
});

/** Canonical statuses shown on the AR page (legend + row badges). */
export const AR_CANONICAL_STATUSES = Object.freeze([
  AR_STATUS.UNVERIFIED,
  AR_STATUS.VERIFIED,
  AR_STATUS.APPLIED,
  AR_STATUS.RETURNED,
  AR_STATUS.REJECTED,
]);

/** Values sent as the `status` query param on GET /acknowledgement-receipts. */
export const AR_STATUS_FILTER = Object.freeze({
  ALL: 'all',
  VERIFIED_APPLIED: 'Verified,Applied',
  UNVERIFIED: 'Unverified',
  REJECTED: 'Rejected',
  VERIFIED_ONLY: 'Verified',
  APPLIED: 'Applied',
  RETURNED: 'Returned',
});

/** Legacy DB values that mean “awaiting Finance verification” (filters / actions). */
export const AR_UNVERIFIED_STATUSES = Object.freeze([
  AR_STATUS.UNVERIFIED,
  AR_STATUS.SUBMITTED,
  AR_STATUS.PENDING,
]);

export const AR_STATUS_LEGEND_ITEMS = [
  {
    key: 'Unverified',
    label: 'Unverified',
    tone: 'bg-red-100 text-red-800 ring-1 ring-inset ring-red-300',
    description:
      'Awaiting Finance/Superfinance verification (non-cash package or merchandise, including after branch resubmit).',
  },
  {
    key: 'Verified',
    label: 'Verified',
    tone: 'bg-green-100 text-green-800 ring-1 ring-inset ring-green-300',
    description:
      'Approved by Finance/Superfinance, or cash AR auto-verified on issue/resubmit. Ready for enrollment or merchandise confirmation.',
  },
  {
    key: 'Applied',
    label: 'Applied',
    tone: 'bg-indigo-100 text-indigo-800 ring-1 ring-inset ring-indigo-300',
    description:
      'Package AR already applied to an invoice/enrollment and the payment was recorded.',
  },
  {
    key: 'Returned',
    label: 'Returned',
    tone: 'bg-orange-100 text-orange-800 ring-1 ring-inset ring-orange-300',
    description:
      'Finance returned the AR for branch correction. Use the Return tab; resubmit to send back to Finance as Unverified (non-cash) or Verified (cash).',
  },
  {
    key: 'Rejected',
    label: 'Rejected',
    tone: 'bg-rose-100 text-rose-800 ring-1 ring-inset ring-rose-300',
    description: 'Permanently rejected by Finance. Cannot be re-used; create a new AR if needed.',
  },
];

/** Statuses shown in the Acknowledgement Receipts page legend. */
export const AR_PAGE_LEGEND_ITEMS = AR_STATUS_LEGEND_ITEMS;

const AR_STATUS_BY_KEY = Object.fromEntries(
  AR_STATUS_LEGEND_ITEMS.map((item) => [item.key, item])
);

const RETURNED_MARKER = '[Returned]';
const RESUBMITTED_MARKER = '[Resubmitted]';

const normalizeStatus = (status) => String(status || '').trim();

const resolveReceiptInput = (receiptOrStatus) => {
  if (typeof receiptOrStatus === 'object' && receiptOrStatus !== null) {
    return {
      status: receiptOrStatus.status,
      notes: receiptOrStatus.prospect_student_notes,
      arType: receiptOrStatus.ar_type,
      paymentMethod: receiptOrStatus.payment_method,
    };
  }
  return { status: receiptOrStatus, notes: null, arType: null, paymentMethod: null };
};

const lastMarkerIsReturned = (notes) => {
  const text = String(notes || '');
  if (!text.includes(RETURNED_MARKER)) return false;
  if (!text.includes(RESUBMITTED_MARKER)) return true;

  const lastReturned = text.toLowerCase().lastIndexOf(RETURNED_MARKER.toLowerCase());
  const lastResubmitted = text.toLowerCase().lastIndexOf(RESUBMITTED_MARKER.toLowerCase());
  return lastResubmitted < lastReturned;
};

export function isArReturnedForCorrection(receiptOrStatus, prospectNotes) {
  const { status, notes } =
    typeof receiptOrStatus === 'object' && receiptOrStatus !== null
      ? resolveReceiptInput(receiptOrStatus)
      : { status: receiptOrStatus, notes: prospectNotes, arType: null };

  const normalized = normalizeStatus(status);
  if (normalized === AR_STATUS.RETURNED) return true;
  if (normalized === AR_STATUS.REJECTED || normalized === AR_STATUS.CANCELLED) return false;

  return lastMarkerIsReturned(notes);
}

export function isArCashPaymentMethod(paymentMethod) {
  return String(paymentMethod || '').trim().toLowerCase() === 'cash';
}

/**
 * Map DB / legacy status to one of the five canonical AR statuses.
 */
export function resolveArEffectiveStatus(receiptOrStatus) {
  const { status, paymentMethod } = resolveReceiptInput(receiptOrStatus);
  const normalized = normalizeStatus(status);

  if (normalized === AR_STATUS.PAID) {
    return isArCashPaymentMethod(paymentMethod) ? AR_STATUS.VERIFIED : AR_STATUS.UNVERIFIED;
  }
  if (normalized === AR_STATUS.SUBMITTED || normalized === AR_STATUS.PENDING) {
    return AR_STATUS.UNVERIFIED;
  }
  if (normalized === AR_STATUS.ENROLLED) {
    return AR_STATUS.APPLIED;
  }
  if (normalized === AR_STATUS.CANCELLED) {
    return AR_STATUS.REJECTED;
  }

  return normalized;
}

export function isArUnverifiedStatus(receiptOrStatus) {
  return resolveArEffectiveStatus(receiptOrStatus) === AR_STATUS.UNVERIFIED;
}

export function isArRejectedStatus(statusOrReceipt) {
  if (typeof statusOrReceipt === 'object' && statusOrReceipt !== null) {
    return resolveArEffectiveStatus(statusOrReceipt) === AR_STATUS.REJECTED;
  }
  const normalized = normalizeStatus(statusOrReceipt);
  return normalized === AR_STATUS.REJECTED || normalized === AR_STATUS.CANCELLED;
}

/** User-facing label for list rows — canonical statuses only. */
export function getArStatusDisplayLabel(receiptOrStatus) {
  if (isArReturnedForCorrection(receiptOrStatus)) {
    return AR_STATUS.RETURNED;
  }

  const effective = resolveArEffectiveStatus(receiptOrStatus);
  if (AR_CANONICAL_STATUSES.includes(effective)) {
    return effective;
  }

  return effective || 'Unknown';
}

export function getArStatusLegend(receiptOrStatus) {
  const label = getArStatusDisplayLabel(receiptOrStatus);
  return AR_STATUS_BY_KEY[label]?.description || 'No description available for this status.';
}

/** Badge classes for AR status pills in list rows (matches legend tones). */
export function getArStatusBadgeClass(receiptOrStatus) {
  const label = getArStatusDisplayLabel(receiptOrStatus);
  if (AR_STATUS_BY_KEY[label]) {
    return AR_STATUS_BY_KEY[label].tone;
  }
  return 'bg-slate-100 text-slate-700';
}
