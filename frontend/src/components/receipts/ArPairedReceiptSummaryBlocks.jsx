import {
  formatArLinkedInvoiceArNumber,
  getArListLineTotal,
  getArListPackagePrimaryLabel,
} from '../../utils/acknowledgementReceiptDisplay';

const formatMoney = (value) =>
  `₱${Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

function getArNumber(receipt) {
  return (
    receipt?.ack_receipt_number ||
    receipt?.receipt_ar_number ||
    formatArLinkedInvoiceArNumber(receipt) ||
    '—'
  );
}

function ReceiptLineBlock({ label, receipt, onLineClick }) {
  if (!receipt) return null;
  const arNumber = getArNumber(receipt);
  const canClick = Boolean(receipt?.ack_receipt_id && onLineClick);
  const content = (
    <>
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">{label}</p>
      <p
        className={`mt-1 text-sm font-medium ${
          canClick ? 'text-primary-600 underline decoration-primary-300 underline-offset-2' : 'text-gray-900'
        }`}
      >
        AR# {arNumber}
      </p>
      <p className="mt-0.5 text-sm text-gray-700">
        {receipt.package_name_snapshot || getArListPackagePrimaryLabel(receipt)}
      </p>
      <p className="mt-1 text-sm font-semibold text-gray-900">{formatMoney(getArListLineTotal(receipt))}</p>
      <p className="mt-1 text-xs text-gray-500">Status: {receipt.status || '—'}</p>
    </>
  );

  if (canClick) {
    return (
      <button
        type="button"
        onClick={() => onLineClick(receipt)}
        className="w-full rounded-lg border border-gray-200 bg-white p-3 text-left transition-colors hover:border-primary-400 hover:bg-primary-50/40 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1"
        title={`Highlight ${label} on the list`}
      >
        {content}
      </button>
    );
  }

  return <div className="rounded-lg border border-gray-200 bg-white p-3">{content}</div>;
}

/**
 * Downpayment + Phase 1 summary blocks (create confirmation / resubmit review).
 */
export default function ArPairedReceiptSummaryBlocks({
  leader,
  phase1,
  className = '',
  onLineClick,
  showListHint = false,
}) {
  if (!leader || !phase1) return null;
  const combined = getArListLineTotal(leader) + getArListLineTotal(phase1);

  return (
    <div className={`space-y-3 ${className}`.trim()}>
      <p className="text-sm font-medium text-blue-900">
        Downpayment + Phase 1 — two AR numbers issued as one payment. Fixing and resubmitting updates both
        receipts together.
      </p>
      {showListHint && onLineClick ? (
        <p className="text-sm font-medium text-red-600">
          To locate the downpayment or Phase 1 row on the list, click its card below.
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ReceiptLineBlock label="Downpayment" receipt={leader} onLineClick={onLineClick} />
        <ReceiptLineBlock label="Phase 1" receipt={phase1} onLineClick={onLineClick} />
      </div>
      <div className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-sm">
        <span className="font-medium text-primary-900">Combined line total: </span>
        <span className="font-semibold text-primary-900">{formatMoney(combined)}</span>
      </div>
    </div>
  );
}
