import {
  PAYMENT_DISCOUNT_ADJUSTMENT_HINT,
  PAYMENT_DISCOUNT_ADJUSTMENT_HINT_AR,
  PAYMENT_DISCOUNT_ADJUSTMENT_HINT_PAYMENT_LOGS,
  PAYMENT_DISCOUNT_ADJUSTMENT_LABEL,
  PAYMENT_TIP_ADJUSTMENT_LABEL,
} from '../../constants/paymentFormLabels';

/**
 * Tip field — pair with Payable Amount in a 2-column grid (invoice payment modals).
 */
export const PaymentTipField = ({
  value = '',
  onChange,
  error = '',
  disabled = false,
  name = 'tip_amount',
}) => (
  <div>
    <label className="label-field text-xs">{PAYMENT_TIP_ADJUSTMENT_LABEL}</label>
    <input
      type="number"
      step="0.01"
      min="0"
      name={name}
      value={value}
      onChange={onChange}
      disabled={disabled}
      className={`input-field text-sm ${error ? 'border-red-500' : ''}`}
      placeholder="0.00"
    />
    {error ? <p className="text-xs text-red-500 mt-1">{error}</p> : null}
  </div>
);

/**
 * Discount/Payment Adjustment — full-width row below payable + tip (matches Invoice Record Payment).
 */
export const PaymentDiscountField = ({
  value = '',
  onChange,
  error = '',
  disabled = false,
  payableAmount = 0,
  name = 'discount_amount',
  hintVariant = 'invoice',
  className = '',
}) => {
  const hint =
    hintVariant === 'paymentLogs'
      ? PAYMENT_DISCOUNT_ADJUSTMENT_HINT_PAYMENT_LOGS
      : hintVariant === 'ar'
        ? PAYMENT_DISCOUNT_ADJUSTMENT_HINT_AR
        : PAYMENT_DISCOUNT_ADJUSTMENT_HINT;

  const maxDiscount =
    payableAmount > 0 ? Math.max(0, payableAmount - 0.01).toFixed(2) : undefined;

  return (
    <div className={className}>
      <label className="label-field text-xs">{PAYMENT_DISCOUNT_ADJUSTMENT_LABEL}</label>
      <input
        type="number"
        step="0.01"
        min="0"
        max={maxDiscount}
        name={name}
        value={value}
        onChange={onChange}
        disabled={disabled}
        className={`input-field text-sm ${error ? 'border-red-500' : ''}`}
        placeholder="0.00"
      />
      {error ? (
        <p className="text-xs text-red-500 mt-1">{error}</p>
      ) : (
        <p className="text-xs text-gray-500 mt-1">{hint}</p>
      )}
    </div>
  );
};
