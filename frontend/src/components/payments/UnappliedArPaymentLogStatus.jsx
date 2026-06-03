/**
 * Status cell for unapplied package AR rows in Payment Logs (finance-unified).
 * Pending rows can open the reference/verify modal when `onPendingClick` is provided.
 */
export default function UnappliedArPaymentLogStatus({
  payment,
  canApprove = false,
  onPendingClick = null,
  isLoading = false,
}) {
  const isApproved = (payment?.approval_status || 'Pending') === 'Approved';

  if (isApproved) {
    return (
      <div className="min-w-0 max-w-full">
        <span className="inline-flex max-w-full px-2 py-1 rounded-md text-xs font-medium bg-green-100 text-green-800">
          <span className="truncate">Approved</span>
        </span>
        {payment.approved_by_name ? (
          <div
            className="text-xs text-gray-500 mt-0.5 truncate"
            title={payment.approved_at ? `Approved at ${payment.approved_at}` : ''}
          >
            by{' '}
            <span
              className="truncate inline-block max-w-[100px] align-bottom"
              title={payment.approved_by_name}
            >
              {payment.approved_by_name}
            </span>
          </div>
        ) : null}
      </div>
    );
  }

  if (canApprove && typeof onPendingClick === 'function') {
    return (
      <div className="relative min-w-0 max-w-full">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (isLoading) return;
            onPendingClick(payment);
          }}
          disabled={isLoading}
          className="inline-flex items-center gap-1 max-w-full px-2 py-1 rounded-md text-xs font-medium cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-1 shrink-0 hover:ring-2 hover:ring-primary-300 bg-amber-100 text-amber-800 disabled:opacity-50"
          title="Click to verify acknowledgement receipt and approve on Payment Logs"
        >
          <span className="truncate">{isLoading ? 'Updating...' : 'Pending Approval'}</span>
          {!isLoading ? (
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          ) : null}
        </button>
      </div>
    );
  }

  return (
    <span className="inline-flex max-w-full px-2 py-1 rounded-md text-xs font-medium bg-amber-100 text-amber-800">
      <span className="truncate">Pending Approval</span>
    </span>
  );
}
