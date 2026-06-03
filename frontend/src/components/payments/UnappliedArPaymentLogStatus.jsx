/**
 * Status cell for unapplied package AR rows in Payment Logs (finance-unified).
 * Finance approval mirrors AR verification (verified_by on acknowledgement receipt).
 */
export default function UnappliedArPaymentLogStatus({ payment }) {
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

  return (
    <span className="inline-flex max-w-full px-2 py-1 rounded-md text-xs font-medium bg-amber-100 text-amber-800">
      <span className="truncate">Pending Approval</span>
    </span>
  );
}
