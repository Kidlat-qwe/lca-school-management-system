import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../config/api';
import { formatDateManila } from '../../utils/dateUtils';
import { uploadInvoicePaymentImage } from '../../utils/uploadInvoicePaymentImage';
import { appAlert } from '../../utils/appAlert';
import { parseCashDepositPaymentsResponse } from '../../utils/dailySummaryPaymentsParse';
import { getPaymentLogTableTotalAmountColumn } from '../../utils/paymentLogTableAmounts';
import { canEditCashDepositPayments } from '../../utils/cashDepositPaymentEdit';
import PaymentAttachmentViewerModal from '../paymentLogs/PaymentAttachmentViewerModal';
import CashDepositPaymentEditModal from './CashDepositPaymentEditModal';
import CashDepositPaymentsTable from './CashDepositPaymentsTable';

const CASH_DEPOSIT_WARNING_THRESHOLD = 100000;

const formatCurrency = (amount) =>
  `₱${(Number(amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Resubmit a returned cash deposit — layout matches Payment Logs → Deposit Cash submission modal.
 */
export default function CashDepositResubmitModal({ open, record, branchName, userType, onClose, onResubmitted }) {
  const [cashRef, setCashRef] = useState('');
  const [cashAttach, setCashAttach] = useState('');
  const [cashUploading, setCashUploading] = useState(false);
  const [cashResubmitLoading, setCashResubmitLoading] = useState(false);
  const [cashDetail, setCashDetail] = useState(null);
  const [cashDetailLoading, setCashDetailLoading] = useState(false);
  const [attachmentViewerUrl, setAttachmentViewerUrl] = useState(null);
  const [cashPaymentEdit, setCashPaymentEdit] = useState(null);

  const summaryId = record?.cash_deposit_summary_id;
  const startDate = record?.start_date || '';
  const endDate = record?.end_date || '';

  const reloadCashDetail = useCallback(async () => {
    if (!summaryId) return;
    setCashDetailLoading(true);
    try {
      const res = await apiRequest(`/cash-deposit-summaries/${summaryId}/payments`);
      setCashDetail(parseCashDepositPaymentsResponse(res));
    } catch (err) {
      appAlert(err.message || 'Failed to load deposit detail');
      setCashDetail(null);
    } finally {
      setCashDetailLoading(false);
    }
  }, [summaryId]);

  useEffect(() => {
    if (!open || !summaryId) {
      setCashDetail(null);
      setCashPaymentEdit(null);
      return;
    }
    setCashRef(String(record.reference_number || '').trim());
    setCashAttach(String(record.deposit_attachment_url || '').trim());
    void reloadCashDetail();
  }, [open, summaryId, record, reloadCashDetail]);

  const cashTotals = cashDetail?.totals;
  const submittedSnapshot = cashDetail?.submittedSnapshot;
  const cashModalRows = Array.isArray(cashDetail?.payments) ? cashDetail.payments : [];
  const depositTotalFromRows = cashModalRows.reduce(
    (sum, p) => sum + getPaymentLogTableTotalAmountColumn(p),
    0
  );

  const cashDepositPaymentsEditable = canEditCashDepositPayments({
    userType,
    depositStatus: record?.status,
  });

  const totalsDrift = useMemo(() => {
    if (!cashTotals || !submittedSnapshot) return false;
    return (
      Math.abs(Number(submittedSnapshot.total_deposit_amount ?? 0) - Number(cashTotals.total_deposit_amount ?? 0)) >
        0.01 ||
      Math.abs(Number(submittedSnapshot.total_cash_amount ?? 0) - Number(cashTotals.total_cash_amount ?? 0)) >
        0.01 ||
      Number(submittedSnapshot.payment_count ?? 0) !== Number(cashTotals.payment_count ?? 0) ||
      Number(submittedSnapshot.completed_cash_count ?? 0) !== Number(cashTotals.completed_cash_count ?? 0)
    );
  }, [cashTotals, submittedSnapshot]);

  const uploadDepositProof = async (file) => {
    setCashUploading(true);
    try {
      const url = await uploadInvoicePaymentImage(file);
      if (url) setCashAttach(url);
    } catch (err) {
      appAlert(err?.message || 'Upload failed');
    } finally {
      setCashUploading(false);
    }
  };

  const submitResubmit = async () => {
    if (!summaryId) return;
    const refTrim = String(cashRef || '').trim();
    const attTrim = String(cashAttach || '').trim();
    if (!refTrim) {
      appAlert('Reference number is required.');
      return;
    }
    if (!attTrim) {
      appAlert('Please upload or keep a deposit proof attachment.');
      return;
    }
    setCashResubmitLoading(true);
    try {
      await apiRequest(`/cash-deposit-summaries/${summaryId}/resubmit`, {
        method: 'PUT',
        body: JSON.stringify({
          reference_number: refTrim,
          deposit_attachment_url: attTrim,
        }),
      });
      appAlert('Cash deposit summary resubmitted for verification.');
      onResubmitted?.();
      onClose?.();
    } catch (err) {
      appAlert(err.message || 'Resubmit failed');
    } finally {
      setCashResubmitLoading(false);
    }
  };

  if (!open || !record || typeof document === 'undefined') return null;

  const periodLabel =
    startDate && endDate
      ? `${formatDateManila(startDate)} → ${formatDateManila(endDate)}`
      : '—';

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center backdrop-blur-sm bg-black/50 p-2 sm:p-4"
        onClick={() => !cashResubmitLoading && onClose?.()}
      >
        <div
          className="bg-white rounded-xl shadow-xl max-w-5xl w-full max-h-[min(92dvh,90vh)] flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-4 sm:px-5 py-4 border-b border-gray-200 shrink-0 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-lg font-semibold text-gray-900">Resubmit Cash Deposit</h3>
              <p className="mt-1 text-sm text-gray-600">
                Sum of <strong>Cash payments only</strong> by <strong>payment date</strong> for{' '}
                <span className="whitespace-nowrap">{branchName || 'your branch'}</span>. Finance returned this
                submission — review notes, fix payment lines if needed, then resubmit.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={cashResubmitLoading}
              className="text-gray-400 hover:text-gray-600 p-1 rounded-md self-start shrink-0"
              aria-label="Close"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="px-4 sm:px-5 py-4 border-b border-gray-100 shrink-0 space-y-3">
            {record.remarks ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <span className="font-semibold">Finance notes: </span>
                <span className="whitespace-pre-wrap">{record.remarks}</span>
              </div>
            ) : null}

            <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 sm:items-end">
              <div className="flex-1 min-w-[140px]">
                <label className="block text-xs font-medium text-gray-600 mb-1">From (payment date)</label>
                <input
                  type="date"
                  value={startDate}
                  readOnly
                  disabled
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-gray-50 text-gray-700 cursor-not-allowed"
                />
              </div>
              <div className="flex-1 min-w-[140px]">
                <label className="block text-xs font-medium text-gray-600 mb-1">To (payment date)</label>
                <input
                  type="date"
                  value={endDate}
                  readOnly
                  disabled
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-gray-50 text-gray-700 cursor-not-allowed"
                />
                <p className="mt-1 text-[11px] text-gray-500">
                  Period is fixed for this returned deposit. Payment lines are recalculated for this range.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Reference Number <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={cashRef}
                  onChange={(e) => setCashRef(e.target.value)}
                  placeholder="Enter deposit slip / transaction number"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  disabled={cashResubmitLoading}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Deposit Proof Image <span className="text-red-500">*</span>
                </label>
                <div className="flex items-center gap-2 flex-wrap">
                  <label
                    className={`px-3 py-2 text-xs sm:text-sm rounded-lg border border-gray-300 bg-white hover:bg-gray-50 cursor-pointer ${cashResubmitLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {cashUploading ? 'Uploading...' : cashAttach ? 'Replace Image' : 'Upload Image'}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={cashResubmitLoading || cashUploading}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (file) await uploadDepositProof(file);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  {cashAttach ? (
                    <button
                      type="button"
                      onClick={() => setAttachmentViewerUrl(cashAttach)}
                      className="px-3 py-2 text-xs sm:text-sm rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200"
                    >
                      View
                    </button>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Upload the deposit slip / bank proof image before resubmitting.
                </p>
                {cashAttach ? (
                  <div className="mt-2">
                    <img
                      src={cashAttach}
                      alt="Deposit proof preview"
                      className="h-24 w-24 object-cover rounded-lg border border-gray-200"
                    />
                  </div>
                ) : null}
              </div>
            </div>

            <p className="text-xs text-gray-500">
              <strong>Deposit amount</strong> uses <strong>Cash</strong> payments with status{' '}
              <strong>Completed</strong> only. Click an invoice in the table below to update a payment line; totals
              refresh automatically after you save.
            </p>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-5 py-4">
            {cashDetailLoading ? (
              <div className="flex justify-center py-12">
                <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
              </div>
            ) : cashTotals ? (
              <>
                {depositTotalFromRows >= CASH_DEPOSIT_WARNING_THRESHOLD ? (
                  <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                    <p className="text-sm font-semibold text-red-800">Deposit Threshold Alert</p>
                    <p className="text-xs text-red-700 mt-1">
                      This deposit total is {formatCurrency(depositTotalFromRows)} (threshold: ₱
                      {CASH_DEPOSIT_WARNING_THRESHOLD.toLocaleString('en-US')}). Please verify all payment lines
                      before resubmitting.
                    </p>
                  </div>
                ) : null}

                {totalsDrift ? (
                  <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    Submitted amounts: Cash to Deposit{' '}
                    <span className="font-semibold">{formatCurrency(submittedSnapshot.total_deposit_amount)}</span>,
                    All cash <span className="font-semibold">{formatCurrency(submittedSnapshot.total_cash_amount)}</span>{' '}
                    ({submittedSnapshot.completed_cash_count ?? 0} completed / {submittedSnapshot.payment_count ?? 0}{' '}
                    rows). Current recalculated: Cash to Deposit{' '}
                    <span className="font-semibold">{formatCurrency(cashTotals.total_deposit_amount)}</span>, All cash{' '}
                    <span className="font-semibold">{formatCurrency(cashTotals.total_cash_amount)}</span> (
                    {cashTotals.completed_cash_count ?? 0} completed / {cashTotals.payment_count ?? 0} rows).
                  </div>
                ) : null}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                  <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3">
                    <p className="text-xs font-medium text-sky-800 uppercase tracking-wide">Total to deposit</p>
                    <p className="text-xl font-bold text-sky-900 mt-1">{formatCurrency(depositTotalFromRows)}</p>
                    <p className="text-xs text-sky-700 mt-1">{cashTotals.completed_cash_count ?? 0} completed payment(s)</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                    <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">All Cash (in range)</p>
                    <p className="text-xl font-bold text-gray-900 mt-1">
                      {formatCurrency(cashTotals.total_cash_amount)}
                    </p>
                    <p className="text-xs text-gray-600 mt-1">{cashTotals.payment_count ?? 0} row(s)</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
                    <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">Period</p>
                    <p className="text-sm font-semibold text-gray-900 mt-2">{periodLabel}</p>
                  </div>
                </div>

                <p className="text-sm font-medium text-gray-800 mb-2">Cash payment lines (this deposit)</p>
                <CashDepositPaymentsTable
                  payments={cashModalRows}
                  canEditInvoices={cashDepositPaymentsEditable}
                  onEditPayment={setCashPaymentEdit}
                  emptyMessage="No cash payment lines found for this period."
                />
              </>
            ) : (
              <p className="text-sm text-gray-500 text-center py-8">Unable to load deposit payment lines.</p>
            )}
          </div>

          <div className="px-4 sm:px-5 py-3 border-t border-gray-200 shrink-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <p className="text-xs text-gray-500">
              After you confirm reference and proof, resubmit for Superfinance to verify the office cash deposit.
            </p>
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={cashResubmitLoading}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50"
              >
                Close
              </button>
              <button
                type="button"
                onClick={submitResubmit}
                disabled={cashResubmitLoading || cashUploading || cashDetailLoading || !cashTotals}
                className="px-4 py-2 text-sm font-medium text-white bg-sky-600 rounded-lg hover:bg-sky-700 disabled:opacity-50"
              >
                {cashResubmitLoading ? 'Resubmitting...' : 'Resubmit for Confirmation'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <PaymentAttachmentViewerModal
        open={Boolean(attachmentViewerUrl)}
        url={attachmentViewerUrl}
        onClose={() => setAttachmentViewerUrl(null)}
      />

      {cashPaymentEdit ? (
        <CashDepositPaymentEditModal
          payment={cashPaymentEdit}
          onClose={() => setCashPaymentEdit(null)}
          onSaved={reloadCashDetail}
        />
      ) : null}
    </>,
    document.body
  );
}
