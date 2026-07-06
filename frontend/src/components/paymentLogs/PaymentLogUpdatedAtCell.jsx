import { getPaymentLogCreatedAtRaw, getPaymentLogCreatedAtDisplayParts } from '../../utils/paymentLogUpdatedAt';

/**
 * Two-line Created At cell — when the payment was encoded (Philippines date/time).
 * @param {{ payment: object }} props
 */
export function PaymentLogUpdatedAtCell({ payment }) {
  const parts = getPaymentLogCreatedAtDisplayParts(getPaymentLogCreatedAtRaw(payment));
  if (!parts) return <span>-</span>;

  return (
    <div className="flex flex-col leading-tight min-w-0 whitespace-nowrap">
      <span>{parts.dateLine}</span>
      <span>{parts.timeLine}</span>
    </div>
  );
}
