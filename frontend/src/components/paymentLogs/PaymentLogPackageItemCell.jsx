import {
  getPaymentLogPackageItemContext,
  getPaymentLogPackageItemDisplayText,
} from '../../utils/paymentLogPackageItem';

const CONTEXT_CLASS = {
  partial: 'text-amber-700',
  'remaining-balance': 'text-sky-700',
  'completed-balance': 'text-emerald-700',
};

/**
 * Package/Item column for payment log tables.
 * Shows resolved plan description with a second line for partial-payment context when applicable.
 */
export function PaymentLogPackageItemCell({ payment, className = 'px-3 py-2.5' }) {
  const { main, context, contextVariant } = getPaymentLogPackageItemContext(payment);
  const title = getPaymentLogPackageItemDisplayText(payment);

  return (
    <td className={`${className} align-top text-sm text-gray-900 min-w-0`} title={title}>
      <div className="flex flex-col leading-snug min-w-0 space-y-0.5">
        <span className="block break-words">{main}</span>
        {context ? (
          <span className={`text-xs block break-words ${CONTEXT_CLASS[contextVariant] || 'text-gray-500'}`}>
            {context}
          </span>
        ) : null}
      </div>
    </td>
  );
}
