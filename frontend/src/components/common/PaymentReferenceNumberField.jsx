import {
  isPaymentReferenceNumberReadOnly,
  isPaymentReferenceNumberRequired,
  shouldShowPaymentReferenceNumberField,
} from '../../constants/paymentFormLabels';

/**
 * Reference number input for payment modals.
 * Non-Cash: required editable field. Cash: hidden unless a reference already exists (read-only).
 */
export default function PaymentReferenceNumberField({
  paymentMethod,
  name = 'reference_number',
  value = '',
  onChange,
  error,
  disabled = false,
  requiredMark = true,
  className = 'input-field text-sm',
  labelClassName = 'label-field text-xs',
  placeholder = 'Enter reference number (e.g. GCash ref, bank receipt no.)',
  id,
}) {
  if (!shouldShowPaymentReferenceNumberField(paymentMethod, value)) {
    return null;
  }

  const readOnly = isPaymentReferenceNumberReadOnly(paymentMethod);
  const required = isPaymentReferenceNumberRequired(paymentMethod);

  return (
    <div>
      <label className={labelClassName} htmlFor={id}>
        Reference Number{' '}
        {required && requiredMark ? <span className="text-red-500">*</span> : null}
      </label>
      <input
        id={id}
        type="text"
        name={name}
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        disabled={disabled || readOnly}
        required={required}
        className={`${className} ${error ? 'border-red-500' : ''} ${
          readOnly ? 'cursor-default bg-gray-50 text-gray-700' : ''
        }`}
        placeholder={readOnly ? undefined : placeholder}
      />
      {readOnly ? (
        <p className="mt-1 text-xs text-gray-500">
          Existing reference for this Cash payment (read-only).
        </p>
      ) : null}
      {error ? <p className="mt-1 text-xs text-red-500">{error}</p> : null}
    </div>
  );
}
