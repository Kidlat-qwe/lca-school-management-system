import { createPortal } from 'react-dom';
import { formatDateManila } from '../../utils/dateUtils';
import { isCashPaymentMethod } from '../../constants/paymentFormLabels';
import {
  formatArLinkedInvoiceArNumber,
  getArListLineTotal,
  getArListPackagePrimaryLabel,
} from '../../utils/acknowledgementReceiptDisplay';

const formatCurrency = (value) =>
  `₱${Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const MODAL_TITLES = {
  verify: 'Verify Acknowledgement Receipt',
  return: 'Return Acknowledgement Receipt',
  reject: 'Reject Acknowledgement Receipt',
};

function isDownpaymentPlusPhase1Leader(receipt) {
  if (!receipt) return false;
  if (receipt.is_downpayment_plus_phase1_leader) return true;
  if (receipt.paired_ack_receipt_id) return true;
  return String(receipt.installment_option || '').toLowerCase() === 'downpayment_plus_phase1';
}

function resolveDownpaymentPhasePair(receipt, pairedReceipt) {
  if (!pairedReceipt) return { downpayment: receipt, phase1: null };
  if (isDownpaymentPlusPhase1Leader(receipt)) {
    return { downpayment: receipt, phase1: pairedReceipt };
  }
  if (isDownpaymentPlusPhase1Leader(pairedReceipt)) {
    return { downpayment: pairedReceipt, phase1: receipt };
  }
  return { downpayment: receipt, phase1: pairedReceipt };
}

function getReceiptArNumber(receipt) {
  return (
    receipt?.ack_receipt_number ||
    receipt?.receipt_ar_number ||
    formatArLinkedInvoiceArNumber(receipt) ||
    '—'
  );
}

function formatCreatorLabel(receipt) {
  const name = String(receipt?.prepared_by_name || '').trim();
  const dateRaw = receipt?.prepared_by_date_ymd || receipt?.created_at;
  const dateLabel = dateRaw ? formatDateManila(dateRaw) : '';
  if (name && dateLabel) return `${name} · ${dateLabel}`;
  if (name) return name;
  if (dateLabel) return dateLabel;
  return '—';
}

function DualArLineTable({ downpayment, phase1, onArNumberClick }) {
  const rows = [
    { key: 'downpayment', label: 'Downpayment', receipt: downpayment },
    { key: 'phase1', label: 'Phase 1', receipt: phase1 },
  ].filter((row) => row.receipt);

  return (
    <div
      className="overflow-x-auto rounded-lg border border-gray-200"
      style={{
        scrollbarWidth: 'thin',
        scrollbarColor: '#cbd5e0 #f7fafc',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      <table style={{ width: '100%', minWidth: '520px' }}>
        <thead className="bg-gray-50">
          <tr>
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
              Line
            </th>
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
              AR#
            </th>
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
              Description
            </th>
            <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">
              Amount
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row) => {
            const arNumber = getReceiptArNumber(row.receipt);
            const canJumpToRow = Boolean(row.receipt?.ack_receipt_id && onArNumberClick);
            return (
              <tr key={row.key}>
                <td className="px-3 py-2.5 text-sm font-medium text-amber-800">{row.label}</td>
                <td className="px-3 py-2.5 text-sm whitespace-nowrap">
                  {canJumpToRow ? (
                    <button
                      type="button"
                      onClick={() => onArNumberClick(row.receipt)}
                      className="font-semibold text-primary-600 underline decoration-primary-300 underline-offset-2 hover:text-primary-800 hover:decoration-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1 rounded"
                      title={`Highlight ${row.label} on the list`}
                    >
                      {arNumber}
                    </button>
                  ) : (
                    <span className="text-gray-900">{arNumber}</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-sm text-gray-700">
                  {row.receipt.package_name_snapshot || getArListPackagePrimaryLabel(row.receipt)}
                </td>
                <td className="px-3 py-2.5 text-sm font-semibold text-gray-900 text-right whitespace-nowrap">
                  {formatCurrency(getArListLineTotal(row.receipt))}
                </td>
              </tr>
            );
          })}
          <tr className="bg-primary-50/60">
            <td colSpan={3} className="px-3 py-2.5 text-sm font-semibold text-primary-900 text-right">
              Combined total
            </td>
            <td className="px-3 py-2.5 text-sm font-bold text-primary-900 text-right whitespace-nowrap">
              {formatCurrency(
                rows.reduce((sum, row) => sum + getArListLineTotal(row.receipt), 0)
              )}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/**
 * Finance / Superfinance AR review modal — verify, return, or reject with optional notes.
 */
export default function ArFinanceVerifyModal({
  open,
  mode = 'verify',
  receipt,
  pairedReceipt,
  loading,
  submitting,
  remarks = '',
  onRemarksChange,
  referenceNumber = '',
  onReferenceNumberChange,
  onClose,
  onConfirmVerify,
  onConfirmReturn,
  onConfirmReject,
  onModeChange,
  onViewAttachment,
  onArNumberClick,
}) {
  if (!open || !receipt) return null;

  const { downpayment, phase1 } = resolveDownpaymentPhasePair(receipt, pairedReceipt);
  const isDualAr = Boolean(phase1);
  const displayReceipt = downpayment || receipt;
  const studentName = displayReceipt.prospect_student_name || displayReceipt.student_name || 'N/A';
  const attachmentUrl = (displayReceipt.payment_attachment_url || phase1?.payment_attachment_url || '').trim();
  const recordedReferenceNumber = (displayReceipt.reference_number || phase1?.reference_number || '').trim();
  const creatorLabel = formatCreatorLabel(displayReceipt);
  const isCashPayment = isCashPaymentMethod(displayReceipt.payment_method);
  const isReturnMode = mode === 'return';
  const isRejectMode = mode === 'reject';
  const isVerifyMode = mode === 'verify';
  const remarksTrimmed = String(remarks || '').trim();
  const remarksRequired = isReturnMode || isRejectMode;
  const canSubmitReturnReject = remarksTrimmed.length > 0;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/5 p-3 sm:p-4 backdrop-blur-sm"
      onClick={() => !submitting && onClose()}
      role="presentation"
    >
      <div
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ar-finance-verify-title"
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 sm:px-6 sm:py-4">
          <div>
            <h2 id="ar-finance-verify-title" className="text-lg font-semibold text-gray-900">
              {MODAL_TITLES[mode] || MODAL_TITLES.verify}
            </h2>
            <p className="mt-0.5 text-sm text-gray-600">{studentName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {loading ? (
            <p className="text-sm text-gray-500">Loading receipt details…</p>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-5 lg:gap-6">
                <div className="space-y-4 lg:col-span-3">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
                    <div>
                      <span className="block text-xs font-medium uppercase tracking-wide text-gray-500">Branch</span>
                      <p className="mt-0.5 text-gray-900">{displayReceipt.branch_name || '—'}</p>
                    </div>
                    <div>
                      <span className="block text-xs font-medium uppercase tracking-wide text-gray-500">Level</span>
                      <p className="mt-0.5 text-gray-900">{displayReceipt.level_tag || '—'}</p>
                    </div>
                    <div>
                      <span className="block text-xs font-medium uppercase tracking-wide text-gray-500">Status</span>
                      <p className="mt-0.5 text-gray-900">{displayReceipt.status || '—'}</p>
                    </div>
                    <div>
                      <span className="block text-xs font-medium uppercase tracking-wide text-gray-500">
                        Payment method
                      </span>
                      <p className="mt-0.5 text-gray-900">{displayReceipt.payment_method || '—'}</p>
                    </div>
                    <div>
                      <span className="block text-xs font-medium uppercase tracking-wide text-gray-500">
                        Issue date
                      </span>
                      <p className="mt-0.5 text-gray-900">
                        {displayReceipt.issue_date ? formatDateManila(displayReceipt.issue_date) : '—'}
                      </p>
                    </div>
                    <div>
                      <span className="block text-xs font-medium uppercase tracking-wide text-gray-500">
                        Recorded reference#
                      </span>
                      <p className="mt-0.5 break-all text-gray-900">{recordedReferenceNumber || '—'}</p>
                    </div>
                    <div className="sm:col-span-2">
                      <span className="block text-xs font-medium uppercase tracking-wide text-gray-500">
                        Created by
                      </span>
                      <p className="mt-0.5 text-gray-900">{creatorLabel}</p>
                    </div>
                  </div>

                  {isDualAr ? (
                    <div className="space-y-2">
                      {isVerifyMode ? (
                        <>
                          <p className="text-sm font-medium text-amber-800">
                            Downpayment + Phase 1 — verifying will mark both AR rows as Verified.
                          </p>
                          <p className="text-sm font-medium text-red-600">
                            To locate the downpayment or Phase 1 row on the list, click its AR number below.
                          </p>
                        </>
                      ) : null}
                      <DualArLineTable
                        downpayment={downpayment}
                        phase1={phase1}
                        onArNumberClick={onArNumberClick}
                      />
                    </div>
                  ) : receipt.ar_type === 'Merchandise' ? (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Merchandise</div>
                      <div className="mt-1 text-sm text-gray-700">
                        {(() => {
                          const items =
                            typeof receipt.merchandise_items_snapshot === 'string'
                              ? (() => {
                                  try {
                                    return JSON.parse(receipt.merchandise_items_snapshot);
                                  } catch {
                                    return [];
                                  }
                                })()
                              : receipt.merchandise_items_snapshot;
                          return Array.isArray(items) && items.length > 0
                            ? items
                                .map(
                                  (i) =>
                                    `${i.merchandise_name || 'Item'}${i.size ? ` (${i.size})` : ''} × ${i.quantity || 1}`
                                )
                                .join(', ')
                            : 'Merchandise';
                        })()}
                      </div>
                      <div className="mt-1 text-sm font-semibold text-gray-900">
                        {formatCurrency(getArListLineTotal(displayReceipt))}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <div className="text-sm text-gray-700">{getArListPackagePrimaryLabel(displayReceipt)}</div>
                      <div className="mt-1 text-sm font-semibold text-gray-900">
                        {formatCurrency(getArListLineTotal(displayReceipt))}
                      </div>
                      <div className="mt-1 text-xs text-gray-500">AR# {getReceiptArNumber(displayReceipt)}</div>
                    </div>
                  )}
                </div>

                <div className="lg:col-span-2">
                  <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-gray-500">
                    Attached image
                  </span>
                  {attachmentUrl ? (
                    <button
                      type="button"
                      onClick={() => onViewAttachment?.(attachmentUrl)}
                      className="flex h-full min-h-[200px] w-full cursor-pointer items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-left hover:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1 lg:min-h-[280px]"
                    >
                      {/\.((png|jpe?g|webp|gif))(\?.*)?$/i.test(attachmentUrl) ? (
                        <img
                          src={attachmentUrl}
                          alt="Payment attachment"
                          className="max-h-72 w-full rounded-lg object-contain lg:max-h-80"
                        />
                      ) : (
                        <span className="px-3 py-4 text-sm text-primary-600">View attachment</span>
                      )}
                    </button>
                  ) : (
                    <div className="flex min-h-[200px] items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 lg:min-h-[280px]">
                      <p className="text-sm text-gray-500">No payment attachment on file.</p>
                    </div>
                  )}
                </div>
              </div>

              {isVerifyMode ? (
                <div className="space-y-4">
                  {isCashPayment ? (
                    <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                      Cash payment — no reference number is required for verification. Review the
                      attachment and amounts, then verify when ready.
                    </p>
                  ) : (
                    <div>
                      <label htmlFor="ar-finance-verify-reference" className="label-field text-xs">
                        Reference number <span className="text-red-600">*</span>
                      </label>
                      <input
                        id="ar-finance-verify-reference"
                        type="text"
                        value={referenceNumber}
                        onChange={(e) => onReferenceNumberChange?.(e.target.value)}
                        className="input-field mt-1 text-sm"
                        placeholder="Enter reference number from attachment"
                        disabled={submitting || loading}
                        autoComplete="off"
                      />
                      <p className="mt-1 text-xs text-gray-500">
                        Enter the reference number shown on the attachment. It must match the
                        reference recorded by the branch before you can verify.
                      </p>
                    </div>
                  )}
                </div>
              ) : null}

              {remarksRequired ? (
                <div
                  className={`rounded-lg border p-4 ${
                    isRejectMode ? 'border-red-200 bg-red-50/50' : 'border-amber-200 bg-amber-50/50'
                  }`}
                >
                  {isRejectMode ? (
                    <p className="mb-3 text-sm text-red-800">
                      Rejecting will permanently close this acknowledgement receipt. The branch admin must
                      create and submit a new acknowledgement receipt to continue.
                    </p>
                  ) : (
                    <p className="mb-3 text-sm text-amber-900">
                      Add a note for the acknowledgement receipt creator explaining why this receipt is being
                      returned.
                    </p>
                  )}
                  <label htmlFor="ar-finance-action-remarks" className="block text-sm font-medium text-gray-700">
                    {isRejectMode ? 'Rejection reason' : 'Return note'}{' '}
                    <span className="text-red-600">*</span>
                  </label>
                  <textarea
                    id="ar-finance-action-remarks"
                    rows={4}
                    value={remarks}
                    onChange={(e) => onRemarksChange?.(e.target.value)}
                    placeholder={
                      isRejectMode ? 'Reason for rejection...' : 'Reason for return...'
                    }
                    disabled={submitting}
                    className="mt-2 w-full resize-y rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-gray-100"
                  />
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-gray-200 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:px-6 sm:py-4">
          {isVerifyMode && (receipt.ar_type === 'Package' || receipt.ar_type === 'Merchandise') ? (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 sm:mr-auto"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => onModeChange?.('return')}
                disabled={submitting || loading}
                className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
              >
                Return
              </button>
              <button
                type="button"
                onClick={() => onModeChange?.('reject')}
                disabled={submitting || loading}
                className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm font-medium text-red-800 hover:bg-red-100 disabled:opacity-50"
              >
                Reject
              </button>
              <button
                type="button"
                onClick={onConfirmVerify}
                disabled={loading || submitting}
                className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? 'Verifying…' : isDualAr ? 'Verify downpayment & Phase 1' : 'Verify'}
              </button>
            </>
          ) : isReturnMode ? (
            <>
              <button
                type="button"
                onClick={() => onModeChange?.('verify')}
                disabled={submitting}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 sm:mr-auto"
              >
                Back
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirmReturn}
                disabled={loading || submitting || !canSubmitReturnReject}
                className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? 'Returning…' : 'Return to branch'}
              </button>
            </>
          ) : isRejectMode ? (
            <>
              <button
                type="button"
                onClick={() => onModeChange?.('verify')}
                disabled={submitting}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 sm:mr-auto"
              >
                Back
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirmReject}
                disabled={loading || submitting || !canSubmitReturnReject}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? 'Rejecting…' : 'Reject receipt'}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 sm:mr-auto"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirmVerify}
                disabled={loading || submitting}
                className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? 'Verifying…' : 'Verify'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
