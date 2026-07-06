import { getPaymentLogUpdatedAtRaw, getPaymentLogUpdatedAtDisplayParts } from '../../utils/paymentLogUpdatedAt';

/**
 * Two-line Updated At cell (Philippines date/time).
 * @param {{ payment: object }} props
 */
export function PaymentLogUpdatedAtCell({ payment }) {
  const parts = getPaymentLogUpdatedAtDisplayParts(getPaymentLogUpdatedAtRaw(payment));
  if (!parts) return <span>-</span>;

  return (
    <div className="flex flex-col leading-tight min-w-0 whitespace-nowrap">
      <span>{parts.dateLine}</span>
      <span>{parts.timeLine}</span>
    </div>
  );
}
