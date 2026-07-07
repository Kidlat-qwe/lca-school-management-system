import { getCashDepositAttachmentUrls } from '../../utils/cashDepositAttachments';

/**
 * Renders view links for up to two deposit proof images.
 */
export default function CashDepositProofLinks({ record, onView, className = '' }) {
  const urls = getCashDepositAttachmentUrls(record);

  if (urls.length === 0) {
    return <p className={`text-gray-900 font-medium ${className}`.trim()}>-</p>;
  }

  return (
    <div className={`flex flex-col gap-1 ${className}`.trim()}>
      {urls.map((url, index) => (
        <button
          key={`${url}-${index}`}
          type="button"
          onClick={() => onView?.(url)}
          className="inline-block text-sm text-primary-700 hover:text-primary-800 underline break-all text-left"
        >
          View image {urls.length > 1 ? index + 1 : ''}
        </button>
      ))}
    </div>
  );
}
