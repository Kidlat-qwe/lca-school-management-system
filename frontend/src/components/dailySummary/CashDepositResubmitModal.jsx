import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../config/api';
import { formatDateManila } from '../../utils/dateUtils';
import { uploadInvoicePaymentImage } from '../../utils/uploadInvoicePaymentImage';
import { appAlert } from '../../utils/appAlert';
import { parseCashDepositPaymentsResponse } from '../../utils/dailySummaryPaymentsParse';
import { getPaymentLogTableTotalAmountColumn } from '../../utils/paymentLogTableAmounts';
import { canEditCashDepositPayments } from '../../utils/cashDepositPaymentEdit';
import {
  getCashDepositAttachmentUrls,
  serializeCashDepositAttachments,
} from '../../utils/cashDepositAttachments';
import PaymentAttachmentViewerModal from '../paymentLogs/PaymentAttachmentViewerModal';
import CashDepositPaymentEditModal from './CashDepositPaymentEditModal';
import CashDepositPaymentsTable from './CashDepositPaymentsTable';
import CashDepositProofImagesField from './CashDepositProofImagesField';

const CASH_DEPOSIT_WARNING_THRESHOLD = 100000;

const formatCurrency = (amount) =>
  `₱${(Number(amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function SectionTitle({ children, hint }) {
  return (
    <div className="mb-3">
      <h4 className="text-sm font-semibold text-gray-900">{children}</h4>
      {hint ? <p className="mt-0.5 text-xs text-gray-500">{hint}</p> : null}
    </div>
  );
}

function ReadinessChip({ ok, label }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
        ok ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200' : 'bg-gray-100 text-gray-600 ring-1 ring-gray-200'
      }`}
    >
      {ok ? (
        <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden>
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
        </svg>
      ) : (
        <span className="h-1.5 w-1.5 rounded-full bg-gray-400" aria-hidden />
      )}
      {label}
    </span>
  );
}

/**
 * Resubmit a returned cash deposit — structured review → update → confirm flow.
 */
export default function CashDepositResubmitModal({ open, record, branchName, userType, onClose, onResubmitted }) {
  const [cashRef, setCashRef] = useState('');
  const [cashAttachments, setCashAttachments] = useState([]);
  const [submissionRemarks, setSubmissionRemarks] = useState('');
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
    setCashAttachments(getCashDepositAttachmentUrls(record));
    setSubmissionRemarks(String(record.submission_remarks || '').trim());
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

  const hasReference = Boolean(String(cashRef || '').trim());
  const hasProof = cashAttachments.length > 0;
  const canSubmit = hasReference && hasProof && !cashResubmitLoading && !cashUploading && !cashDetailLoading && Boolean(cashTotals);

  const uploadDepositProof = async (file) => {
    setCashUploading(true);
    try {
      return await uploadInvoicePaymentImage(file);
    } catch (err) {
      appAlert(err?.message || 'Upload failed');
      return null;
    } finally {
      setCashUploading(false);
    }
  };

  const submitResubmit = async () => {
    if (!summaryId) return;
    const refTrim = String(cashRef || '').trim();
    const serialized = serializeCashDepositAttachments(cashAttachments);
    if (!refTrim) {
      appAlert('Reference number is required.');
      return;
    }
    if (!serialized.deposit_attachment_url) {
      appAlert('Please upload at least one deposit proof image.');
      return;
    }
    setCashResubmitLoading(true);
    try {
      await apiRequest(`/cash-deposit-summaries/${summaryId}/resubmit`, {
        method: 'PUT',
        body: JSON.stringify({
          reference_number: refTrim,
          deposit_attachment_url: serialized.deposit_attachment_url,
          deposit_attachment_url_2: serialized.deposit_attachment_url_2,
          submission_remarks: String(submissionRemarks || '').trim() || null,
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
        className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
        onClick={() => !cashResubmitLoading && onClose?.()}
      >
        <div
          className="flex max-h-[min(94dvh,920px)] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="cash-deposit-resubmit-title"
        >
          {/* Header */}
          <div className="shrink-0 border-b border-gray-200 bg-gradient-to-r from-sky-50 via-white to-white px-4 py-4 sm:px-6">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 id="cash-deposit-resubmit-title" className="text-lg font-semibold text-gray-900">
                    Resubmit Cash Deposit
                  </h3>
                  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-900">
                    Returned
                  </span>
                </div>
                <p className="mt-1 text-sm text-gray-600">
                  <span className="font-medium text-gray-800">{branchName || 'Your branch'}</span>
                  {' · '}
                  Cash payments by payment date · {periodLabel}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={cashResubmitLoading}
                className="shrink-0 rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                aria-label="Close"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {!cashDetailLoading && cashTotals ? (
              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div className="rounded-xl border border-sky-200 bg-white px-3 py-2.5 shadow-sm">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-700">Total to deposit</p>
                  <p className="mt-0.5 text-lg font-bold text-sky-900">{formatCurrency(depositTotalFromRows)}</p>
                  <p className="text-[11px] text-sky-700">{cashTotals.completed_cash_count ?? 0} completed</p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 shadow-sm">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">All cash in range</p>
                  <p className="mt-0.5 text-lg font-bold text-gray-900">{formatCurrency(cashTotals.total_cash_amount)}</p>
                  <p className="text-[11px] text-gray-600">{cashTotals.payment_count ?? 0} row(s)</p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 shadow-sm">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Fixed period</p>
                  <p className="mt-1 text-sm font-semibold leading-snug text-gray-900">{periodLabel}</p>
                </div>
              </div>
            ) : null}
          </div>

          {/* Scrollable body */}
          <div
            className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6"
            style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}
          >
            {/* 1. Finance feedback */}
            {record.remarks ? (
              <section className="mb-5">
                <SectionTitle hint="Read-only feedback from Finance">What needs attention</SectionTitle>
                <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86l-8.5 14.74A1 1 0 002.62 21h18.76a1 1 0 00.86-1.5l-8.5-14.74a1 1 0 00-1.72 0z" />
                    </svg>
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-900">Finance notes</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-amber-950">{record.remarks}</p>
                  </div>
                </div>
              </section>
            ) : null}

            {/* 2. Update submission */}
            <section className="mb-5 rounded-xl border border-gray-200 bg-gray-50/60 p-4">
              <SectionTitle hint="Update reference, proof images, and optional notes before resubmitting">
                Your resubmission details
              </SectionTitle>

              <div className="space-y-4">
                <div>
                  <label htmlFor="cash-deposit-reference" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">
                    Reference number <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="cash-deposit-reference"
                    type="text"
                    value={cashRef}
                    onChange={(e) => setCashRef(e.target.value)}
                    placeholder="Deposit slip or bank transaction number"
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                    disabled={cashResubmitLoading}
                  />
                </div>

                <CashDepositProofImagesField
                  variant="grid"
                  attachments={cashAttachments}
                  onChange={setCashAttachments}
                  uploading={cashUploading}
                  disabled={cashResubmitLoading}
                  onView={setAttachmentViewerUrl}
                  onUploadFile={uploadDepositProof}
                  helperText="JPEG or PNG. First image is required; second is optional."
                />

                <div className="rounded-xl border border-gray-200 bg-white p-3">
                  <label htmlFor="cash-deposit-submission-remarks" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">
                    Notes / remarks
                    <span className="ml-1 font-normal normal-case tracking-normal text-gray-400">(optional)</span>
                  </label>
                  <textarea
                    id="cash-deposit-submission-remarks"
                    value={submissionRemarks}
                    onChange={(e) => setSubmissionRemarks(e.target.value)}
                    rows={3}
                    placeholder="Explain what you corrected (e.g. updated reference, replaced proof, fixed payment lines)…"
                    disabled={cashResubmitLoading}
                    className="w-full resize-y rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 min-h-[5rem]"
                  />
                </div>
              </div>
            </section>

            {/* 3. Payment lines */}
            <section>
              <SectionTitle
                hint={
                  cashDepositPaymentsEditable
                    ? 'Click an invoice to edit a payment line. Totals refresh after you save.'
                    : 'Completed cash payments included in this deposit.'
                }
              >
                Cash payment lines
              </SectionTitle>

              {cashDetailLoading ? (
                <div className="flex justify-center py-12">
                  <div className="h-10 w-10 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
                </div>
              ) : cashTotals ? (
                <>
                  {depositTotalFromRows >= CASH_DEPOSIT_WARNING_THRESHOLD ? (
                    <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                      <p className="text-sm font-semibold text-red-800">High deposit amount</p>
                      <p className="mt-1 text-xs text-red-700">
                        Total {formatCurrency(depositTotalFromRows)} exceeds ₱
                        {CASH_DEPOSIT_WARNING_THRESHOLD.toLocaleString('en-US')}. Double-check all lines before
                        resubmitting.
                      </p>
                    </div>
                  ) : null}

                  {totalsDrift ? (
                    <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-950">
                      <span className="font-semibold">Amounts changed since last submit.</span> Was{' '}
                      {formatCurrency(submittedSnapshot.total_deposit_amount)} deposit /{' '}
                      {formatCurrency(submittedSnapshot.total_cash_amount)} all cash — now{' '}
                      {formatCurrency(cashTotals.total_deposit_amount)} / {formatCurrency(cashTotals.total_cash_amount)}.
                    </div>
                  ) : null}

                  <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                    <CashDepositPaymentsTable
                      payments={cashModalRows}
                      canEditInvoices={cashDepositPaymentsEditable}
                      onEditPayment={setCashPaymentEdit}
                      emptyMessage="No cash payment lines found for this period."
                    />
                  </div>
                </>
              ) : (
                <p className="rounded-xl border border-dashed border-gray-300 bg-gray-50 py-8 text-center text-sm text-gray-500">
                  Unable to load payment lines. Close and try again.
                </p>
              )}
            </section>
          </div>

          {/* Footer */}
          <div className="shrink-0 border-t border-gray-200 bg-gray-50 px-4 py-3 sm:px-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2">
                <ReadinessChip ok={hasReference} label="Reference" />
                <ReadinessChip ok={hasProof} label="Proof image" />
                <ReadinessChip ok={Boolean(cashTotals)} label="Lines loaded" />
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={cashResubmitLoading}
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={submitResubmit}
                  disabled={!canSubmit}
                  className="rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {cashResubmitLoading ? 'Resubmitting…' : 'Resubmit for verification'}
                </button>
              </div>
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
