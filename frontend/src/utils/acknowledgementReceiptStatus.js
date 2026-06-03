/**
 * Acknowledgement Receipt status labels, legend items, and badge tones.
 * Single source for AR list pills, page legend, and row tooltips.
 */

export const AR_STATUS_LEGEND_ITEMS = [
  {
    key: 'Pending',
    label: 'Pending',
    tone: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200',
    description:
      'Initial state for newly created receipts that are still being processed (e.g. merchandise sale finishing up).',
  },
  {
    key: 'Submitted',
    label: 'Submitted',
    tone: 'bg-yellow-100 text-yellow-800',
    description:
      'Non-cash receipt awaiting Finance/Superfinance verification before it can be applied to enrollment.',
  },
  {
    key: 'Verified',
    label: 'Verified',
    tone: 'bg-green-100 text-green-800',
    description:
      'Approved by Finance/Superfinance (or auto-verified for cash). Ready to be applied to an invoice/enrollment.',
  },
  {
    key: 'Applied',
    label: 'Applied',
    tone: 'bg-emerald-100 text-emerald-800',
    description:
      'Already used: this receipt was applied to an invoice and the corresponding payment was recorded.',
  },
  {
    key: 'Paid',
    label: 'Paid',
    tone: 'bg-yellow-100 text-yellow-800',
    description:
      'Fully paid receipt — typically a merchandise sale that completes the payment in one step.',
  },
  {
    key: 'Enrolled',
    label: 'Enrolled',
    tone: 'bg-green-100 text-green-800',
    description:
      'Receipt was used for student enrollment; the student is now enrolled in the package/class.',
  },
  {
    key: 'Returned',
    label: 'Returned',
    tone: 'bg-red-100 text-red-800',
    description:
      'Sent back by Finance for correction. Update the details and resubmit so it can be re-verified.',
  },
  {
    key: 'Rejected',
    label: 'Rejected',
    tone: 'bg-rose-100 text-rose-800',
    description: 'Permanently rejected by Finance. Cannot be re-used for enrollment.',
  },
  {
    key: 'Cancelled',
    label: 'Cancelled',
    tone: 'bg-slate-100 text-slate-700',
    description: 'Manually cancelled. No longer active and cannot be applied to an invoice/enrollment.',
  },
];

const AR_STATUS_BY_KEY = Object.fromEntries(
  AR_STATUS_LEGEND_ITEMS.map((item) => [item.key, item])
);

export function getArStatusLegend(status) {
  const key = String(status || '').trim();
  return AR_STATUS_BY_KEY[key]?.description || 'No description available for this status.';
}

/** Badge classes for AR status pills in list rows (matches legend tones). */
export function getArStatusBadgeClass(status) {
  const key = String(status || '').trim();
  if (AR_STATUS_BY_KEY[key]) {
    return AR_STATUS_BY_KEY[key].tone;
  }
  if (key === 'Verified' || key === 'Applied' || key === 'Enrolled') {
    return 'bg-green-100 text-green-800';
  }
  if (key === 'Returned' || key === 'Rejected') {
    return 'bg-red-100 text-red-800';
  }
  if (key === 'Cancelled') {
    return 'bg-slate-100 text-slate-700';
  }
  return 'bg-yellow-100 text-yellow-800';
}
