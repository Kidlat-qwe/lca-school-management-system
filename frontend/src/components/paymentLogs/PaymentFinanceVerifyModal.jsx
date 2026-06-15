import { createPortal } from 'react-dom';
import { formatDateManila } from '../../utils/dateUtils';
import { getPaymentLogPackageItemDisplayText } from '../../utils/paymentLogPackageItem';
import {
  getPaymentLogTableAmountColumn,
  getPaymentLogTableTotalAmountColumn,
} from '../../utils/paymentLogTableAmounts';
import { isUnappliedArPaymentLogRow } from '../../utils/unappliedArPaymentLog';

const formatCurrency = (value) =>
  `₱${Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const MODAL_TITLES = {
  verify: 'Verify Payment',
  return: 'Return Payment to Branch',
  reject: 'Reject Payment',
};

function formatRecordedByLabel(payment) {
  const name = (
    payment?.payment_created_by_name ||
    payment?.invoice_issued_by_name ||
    ''
  ).trim();
  const dateRaw = payment?.issue_date || payment?.payment_date;
  const dateLabel = dateRaw ? formatDateManila(dateRaw) : '';
  if (name && dateLabel) return `${name} · ${dateLabel}`;
  if (name) return name;
  if (dateLabel) return dateLabel;
  if (payment?.created_by) return `User #${payment.created_by}`;
  return '—';
}

function getPaymentSubtitle(payment) {
  if (!payment) return '';
  if (isUnappliedArPaymentLogRow(payment)) {
    const arNumber =
      payment.invoice_ar_number ||
      payment.ack_receipt_number ||
      String(payment.payment_id || '').replace(/^AR-/, 'AR# ');
    return `${arNumber} · ${payment.student_name || 'N/A'}`;
  }
  return `Payment INV-${payment.invoice_id} · ${payment.student_name || 'N/A'}`;
}

/**
 * Finance / Superfinance payment review modal — verify, return, or reject (AR-page layout).
 */
export default function PaymentFinanceVerifyModal({
  open,
  mode = 'verify',
  payment,
  paymentDate = '',
  onPaymentDateChange,
  referenceNumber = '',
  onReferenceNumberChange,
  remarks = '',
  onRemarksChange,
  submitting = false,
  onClose,
  onConfirmVerify,
  onConfirmReturn,
  onConfirmReject,
  onModeChange,
  onViewAttachment,
}) {
  if (!open || !payment) return null;

  const isUnappliedAr = isUnappliedArPaymentLogRow(payment);
  const isReturnMode = mode === 'return';
  const isRejectMode = mode === 'reject';
  const isVerifyMode = mode === 'verify';
  const remarksTrimmed = String(remarks || '').trim();
  const remarksRequired = isReturnMode || isRejectMode;
  const canSubmitReturnReject = remarksTrimmed.length > 0;
  const attachmentUrl = (payment.payment_attachment_url || '').trim();
  const packageLabel = getPaymentLogPackageItemDisplayText(payment);
  const lineAmount = getPaymentLogTableAmountColumn(payment);
  const totalAmount = getPaymentLogTableTotalAmountColumn(payment);
  const approvalStatus = payment.approval_status || 'Pending';
  const verifyTitle = isUnappliedAr ? 'Verify Acknowledgement Receipt' : MODAL_TITLES.verify;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/5 p-3 sm:p-4 backdrop-blur-sm"
      onClick={() => !submitting && onClose?.()}
      role="presentation"
    >
      <div
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-finance-verify-title"
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 sm:px-6 sm:py-4">
          <div>
            <h2 id="payment-finance-verify-title" className="text-lg font-semibold text-gray-900">
              {isVerifyMode ? verifyTitle : MODAL_TITLES[mode] || MODAL_TITLES.verify}
            </h2>
            <p className="mt-0.5 text-sm text-gray-600">{getPaymentSubtitle(payment)}</p>
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
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-5 lg:gap-6">
              <div className="space-y-4 lg:col-span-3">
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
                  <div>
                    <span className="block text-xs font-medium uppercase tracking-wide text-gray-500">
                      Branch
                    </span>
                    <p className="mt-0.5 text-gray-900">{payment.branch_name || '—'}</p>
                  </div>
                  <div>
                    <span className="block text-xs font-medium uppercase tracking-wide text-gray-500">
                      Level
                    </span>
                    <p className="mt-0.5 text-gray-900">{payment.student_level_tag || '—'}</p>
                  </div>
                  <div>
                    <span className="block text-xs font-medium uppercase tracking-wide text-gray-500">
                      Approval
                    </span>
                    <p className="mt-0.5 text-gray-900">{approvalStatus}</p>
                  </div>
                  <div>
                    <span className="block text-xs font-medium uppercase tracking-wide text-gray-500">
                      Payment method
                    </span>
                    <p className="mt-0.5 text-gray-900">{payment.payment_method || '—'}</p>
                  </div>
                  <div>
                    <span className="block text-xs font-medium uppercase tracking-wide text-gray-500">
                      Issue date
                    </span>
                    <p className="mt-0.5 text-gray-900">
                      {payment.issue_date ? formatDateManila(payment.issue_date) : '—'}
                    </p>
                  </div>
                  <div>
                    <span className="block text-xs font-medium uppercase tracking-wide text-gray-500">
                      Payment status
                    </span>
                    <p className="mt-0.5 text-gray-900">{payment.status || '—'}</p>
                  </div>
                  <div className="sm:col-span-2">
                    <span className="block text-xs font-medium uppercase tracking-wide text-gray-500">
                      Recorded by
                    </span>
                    <p className="mt-0.5 text-gray-900">{formatRecordedByLabel(payment)}</p>
                  </div>
                </div>

                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {isUnappliedAr ? 'Package (Acknowledgement Receipt)' : 'Package / item'}
                  </div>
                  <div className="mt-1 text-sm text-gray-700">{packageLabel}</div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    <span className="text-gray-600">
                      Line amount:{' '}
                      <span className="font-semibold text-gray-900">{formatCurrency(lineAmount)}</span>
                    </span>
                    {Number(totalAmount) !== Number(lineAmount) ? (
                      <span className="text-gray-600">
                        Total:{' '}
                        <span className="font-semibold text-emerald-700">{formatCurrency(totalAmount)}</span>
                      </span>
                    ) : null}
                  </div>
                  {isUnappliedAr ? (
                    <div className="mt-1 text-xs text-gray-500">
                      AR# {payment.invoice_ar_number || payment.payment_id}
                    </div>
                  ) : payment.invoice_id ? (
                    <div className="mt-1 text-xs text-gray-500">INV-{payment.invoice_id}</div>
                  ) : null}
                </div>

                {isVerifyMode ? (
                  <div className="space-y-4">
                    <div>
                      <label htmlFor="payment-finance-verify-reference" className="label-field text-xs">
                        Reference number
                      </label>
                      <input
                        id="payment-finance-verify-reference"
                        type="text"
                        value={referenceNumber}
                        onChange={(e) => onReferenceNumberChange?.(e.target.value)}
                        className="input-field mt-1 text-sm"
                        placeholder="Enter reference number from attachment"
                        disabled={submitting}
                        autoComplete="off"
                      />
                      <p className="mt-1 text-xs text-gray-500">
                        Enter the reference number shown on the attachment. It must match the reference
                        recorded by the branch before you can approve.
                      </p>
                    </div>

                    {!isUnappliedAr ? (
                      <div>
                        <label htmlFor="payment-finance-verify-date" className="label-field text-xs">
                          Payment date
                        </label>
                        <input
                          id="payment-finance-verify-date"
                          type="date"
                          value={paymentDate}
                          onChange={(e) => onPaymentDateChange?.(e.target.value)}
                          className="input-field mt-1 max-w-xs text-sm"
                          disabled={submitting}
                        />
                        <p className="mt-1 text-xs text-gray-500">
                          Adjust the date if needed. Saving will update the payment date everywhere it is shown.
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : null}
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

            {remarksRequired ? (
              <div
                className={`rounded-lg border p-4 ${
                  isRejectMode ? 'border-red-200 bg-red-50/50' : 'border-amber-200 bg-amber-50/50'
                }`}
              >
                {isRejectMode ? (
                  <p className="mb-3 text-sm text-red-800">
                    Rejecting{' '}
                    {isUnappliedAr ? (
                      'this acknowledgement receipt'
                    ) : (
                      <>
                        <span className="font-medium">INV-{payment.invoice_id}</span>
                      </>
                    )}{' '}
                    is permanent. The branch must record a new payment to continue.
                  </p>
                ) : (
                  <p className="mb-3 text-sm text-amber-900">
                    Add a note so the branch knows what to fix before resubmitting this payment.
                  </p>
                )}
                <label htmlFor="payment-finance-action-remarks" className="block text-sm font-medium text-gray-700">
                  {isRejectMode ? 'Reject reason' : 'Return note'}{' '}
                  <span className="text-red-600">*</span>
                </label>
                <textarea
                  id="payment-finance-action-remarks"
                  rows={4}
                  value={remarks}
                  onChange={(e) => onRemarksChange?.(e.target.value)}
                  placeholder={isRejectMode ? 'Reason for rejection...' : 'Reason for return...'}
                  disabled={submitting}
                  className="mt-2 w-full resize-y rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-gray-100"
                />
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-gray-200 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:px-6 sm:py-4">
          {isVerifyMode ? (
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
                disabled={submitting}
                className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
              >
                Return
              </button>
              <button
                type="button"
                onClick={() => onModeChange?.('reject')}
                disabled={submitting}
                className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm font-medium text-red-800 hover:bg-red-100 disabled:opacity-50"
              >
                Reject
              </button>
              <button
                type="button"
                onClick={onConfirmVerify}
                disabled={submitting}
                className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting
                  ? 'Verifying…'
                  : isUnappliedAr
                    ? 'Verify acknowledgement receipt'
                    : 'Verify & approve'}
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
                disabled={submitting || !canSubmitReturnReject}
                className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? 'Returning…' : 'Return to branch'}
              </button>
            </>
          ) : (
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
                disabled={submitting || !canSubmitReturnReject}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? 'Rejecting…' : 'Reject payment'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
