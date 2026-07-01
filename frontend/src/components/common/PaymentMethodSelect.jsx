import {
  PAYMENT_METHOD_PLACEHOLDER,
  resolvePaymentMethodOptions,
} from '../../constants/paymentFormLabels';

/**
 * Required payment-method dropdown for Record Payment and related modals.
 * Defaults to empty (placeholder) — user must choose a method explicitly.
 */
const PaymentMethodSelect = ({
  name = 'payment_method',
  value,
  onChange,
  error = '',
  disabled = false,
  required = true,
  className = 'input-field text-sm',
  id,
}) => {
  const options = resolvePaymentMethodOptions(value);
  const errorClass = error ? 'border-red-500' : '';

  return (
    <select
      id={id}
      name={name}
      value={value ?? ''}
      onChange={onChange}
      disabled={disabled}
      required={required}
      className={`${className} ${errorClass}`.trim()}
    >
      <option value="">{PAYMENT_METHOD_PLACEHOLDER}</option>
      {options.map((method) => (
        <option key={method} value={method}>
          {method}
        </option>
      ))}
    </select>
  );
};

export default PaymentMethodSelect;
