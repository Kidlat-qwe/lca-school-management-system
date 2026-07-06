import { splitPaymentLogBranchName } from '../../utils/paymentLogBranchName';

/**
 * Center-aligned branch column cell for payment log tables.
 * @param {{ branchName?: string|null }} props
 */
export function PaymentLogBranchCell({ branchName }) {
  const formatted = splitPaymentLogBranchName(branchName);
  if (!formatted) {
    return <span className="block w-full text-center text-gray-400">-</span>;
  }

  const fullText = formatted.location
    ? `${formatted.company} - ${formatted.location}`
    : formatted.company;

  if (!formatted.location) {
    return (
      <span className="block w-full text-center font-medium leading-snug" title={fullText}>
        {formatted.company}
      </span>
    );
  }

  return (
    <div className="w-full text-center leading-snug">
      <div className="font-medium" title={fullText}>
        {formatted.company}
      </div>
      <div className="text-xs text-gray-500" title={formatted.location}>
        {formatted.location}
      </div>
    </div>
  );
}
