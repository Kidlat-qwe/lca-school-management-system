import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { apiRequest } from '../../config/api';
import { formatDateManila } from '../../utils/dateUtils';
import PaymentAttachmentViewerModal from '../paymentLogs/PaymentAttachmentViewerModal';
import CashDepositPaymentEditModal from './CashDepositPaymentEditModal';
import CashDepositPaymentInvoiceCell from './CashDepositPaymentInvoiceCell';
import { canEditCashDepositPayments } from '../../utils/cashDepositPaymentEdit';
import {
  isFinanceReturnedSummaryStatus,
  parseCashDepositPaymentsResponse,
  parseDailySummaryPaymentsResponse,
} from '../../utils/dailySummaryPaymentsParse';

const PIE_COLORS = ['#16A34A', '#2563EB', '#F59E0B', '#A855F7', '#EF4444', '#14B8A6', '#6366F1', '#EC4899'];

const formatCurrency = (amount) =>
  `₱${(Number(amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const statusBadge = (status) => {
  const classes = {
    Submitted: 'bg-yellow-100 text-yellow-800',
    Approved: 'bg-green-100 text-green-800',
    Returned: 'bg-amber-100 text-amber-800',
    Rejected: 'bg-amber-100 text-amber-800',
  };
  const key = isFinanceReturnedSummaryStatus(status) ? 'Returned' : status;
  const label =
    status === 'Approved' ? 'Verified' : isFinanceReturnedSummaryStatus(status) ? 'Returned' : status;
  return (
    <span
      className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${classes[key] || classes[status] || 'bg-gray-100 text-gray-800'}`}
    >
      {label}
    </span>
  );
};

const summaryVerificationActorLabel = (record) => {
  if (!record) return '—';
  if (isFinanceReturnedSummaryStatus(record.status)) return '—';
  return record.approved_by_name || '—';
};

/**
 * Read-only details modal (Superadmin Daily Summary Sales details parity, without verify/reject).
 */
export default function AdminDailySummaryDetailsModal({
  open,
  record,
  isCashDeposit,
  fallbackBranchName,
  userType = '',
  onClose,
}) {
  const [detailData, setDetailData] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [attachmentPreviewUrl, setAttachmentPreviewUrl] = useState('');
  const [paymentAttachmentViewerUrl, setPaymentAttachmentViewerUrl] = useState(null);
  const [cashPaymentEdit, setCashPaymentEdit] = useState(null);

  const recordIdField = isCashDeposit ? 'cash_deposit_summary_id' : 'daily_summary_id';
  const cashDepositPaymentsEditable =
    isCashDeposit &&
    canEditCashDepositPayments({ userType, depositStatus: record?.status });

  const reloadDetailData = useCallback(async () => {
    if (!record?.[recordIdField]) return;
    setDetailLoading(true);
    try {
      const id = record[recordIdField];
      const data = isCashDeposit
        ? await apiRequest(`/cash-deposit-summaries/${id}/payments`).then(parseCashDepositPaymentsResponse)
        : await apiRequest(`/daily-summary-sales/${id}/payments`).then(parseDailySummaryPaymentsResponse);
      setDetailData(data);
    } catch {
      setDetailData(null);
    } finally {
      setDetailLoading(false);
    }
  }, [record, recordIdField, isCashDeposit]);

  const formatPeriod = (rec) => {
    if (!rec) return '-';
    if (isCashDeposit) {
      return `${formatDateManila(rec.start_date)} - ${formatDateManila(rec.end_date)}`;
    }
    return formatDateManila(rec.summary_date);
  };

  useEffect(() => {
    if (!open || !record?.[recordIdField]) {
      setDetailData(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    const id = record[recordIdField];
    const p = isCashDeposit
      ? apiRequest(`/cash-deposit-summaries/${id}/payments`).then(parseCashDepositPaymentsResponse)
      : apiRequest(`/daily-summary-sales/${id}/payments`).then(parseDailySummaryPaymentsResponse);
    p.then((data) => {
      if (!cancelled) setDetailData(data);
    })
      .catch(() => {
        if (!cancelled) setDetailData(null);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, record, recordIdField, isCashDeposit]);

  const livePayments = detailData?.payments || [];
  const detailArReceipts = detailData?.arReceipts || [];
  const detailTotals = detailData?.totals;
  const detailSubmittedSnapshot = detailData?.submittedSnapshot;
  const submittedSnapshotPayments = Array.isArray(detailSubmittedSnapshot?.payments)
    ? detailSubmittedSnapshot.payments
    : [];
  const detailPayments =
    isCashDeposit && livePayments.length === 0 && submittedSnapshotPayments.length > 0
      ? submittedSnapshotPayments
      : livePayments;
  const detailIsUsingSubmittedSnapshot =
    isCashDeposit && livePayments.length === 0 && submittedSnapshotPayments.length > 0;
  const cashDetailTotals = isCashDeposit ? detailData?.totals : null;

  const detailPieLines = useMemo(() => {
    if (isCashDeposit) return [];
    const fromPay = detailPayments.map((p) => ({
      payment_method: p.payment_method,
      program_level_tag: (p.program_level_tag || 'Unassigned').trim() || 'Unassigned',
      payable_amount: Number(p.payable_amount) || 0,
      tip_amount: Number(p.tip_amount) || 0,
    }));
    const fromAr = detailArReceipts.map((a) => ({
      payment_method: a.payment_method,
      program_level_tag: (a.program_level_tag || a.level_tag || 'Unassigned').trim() || 'Unassigned',
      payable_amount: Number(a.payment_amount) || 0,
      tip_amount: Number(a.tip_amount) || 0,
    }));
    return [...fromPay, ...fromAr];
  }, [detailPayments, detailArReceipts, isCashDeposit]);

  const detailMethodPieData = useMemo(() => {
    if (isCashDeposit || detailPieLines.length === 0) return [];
    const totals = detailPieLines.reduce((acc, payment) => {
      const key = (payment.payment_method || 'Unknown').trim() || 'Unknown';
      const line = (Number(payment.payable_amount) || 0) + (Number(payment.tip_amount) || 0);
      acc[key] = (acc[key] || 0) + line;
      return acc;
    }, {});
    return Object.entries(totals).map(([name, value]) => ({ name, value }));
  }, [detailPieLines, isCashDeposit]);

  const detailLevelPieData = useMemo(() => {
    if (isCashDeposit || detailPieLines.length === 0) return [];
    const totals = detailPieLines.reduce((acc, payment) => {
      const key = (payment.program_level_tag || 'Unassigned').trim() || 'Unassigned';
      const line = (Number(payment.payable_amount) || 0) + (Number(payment.tip_amount) || 0);
      acc[key] = (acc[key] || 0) + line;
      return acc;
    }, {});
    return Object.entries(totals).map(([name, value]) => ({ name, value }));
  }, [detailPieLines, isCashDeposit]);

  const detailPieSum = useMemo(
    () => detailMethodPieData.reduce((s, x) => s + (Number(x.value) || 0), 0),
    [detailMethodPieData]
  );

  const cashDepositTotalsDrift =
    isCashDeposit &&
    cashDetailTotals &&
    detailSubmittedSnapshot &&
    (Math.abs(
      Number(detailSubmittedSnapshot.total_deposit_amount ?? 0) - Number(cashDetailTotals.total_deposit_amount ?? 0)
    ) > 0.01 ||
      Math.abs(
        Number(detailSubmittedSnapshot.total_cash_amount ?? 0) - Number(cashDetailTotals.total_cash_amount ?? 0)
      ) > 0.01 ||
      Number(detailSubmittedSnapshot.payment_count ?? 0) !== Number(cashDetailTotals.payment_count ?? 0) ||
      Number(detailSubmittedSnapshot.completed_cash_count ?? 0) !== Number(cashDetailTotals.completed_cash_count ?? 0));

  const detailMetrics = isCashDeposit
    ? [
        { label: 'Period', value: formatPeriod(record) },
        {
          label: 'Cash to Deposit',
          value: formatCurrency(cashDetailTotals?.total_deposit_amount ?? record?.total_deposit_amount),
        },
        {
          label: 'All Cash in Range',
          value: formatCurrency(cashDetailTotals?.total_cash_amount ?? record?.total_cash_amount),
        },
        {
          label: 'Completed Cash Rows',
          value: cashDetailTotals?.completed_cash_count ?? record?.completed_cash_count ?? 0,
        },
        {
          label: 'Cash Rows',
          value: cashDetailTotals?.payment_count ?? record?.payment_count ?? 0,
        },
      ]
    : [
        { label: 'Date', value: formatPeriod(record) },
        {
          label: 'Total amount',
          value: formatCurrency(detailTotals?.grand_total ?? record?.total_amount),
        },
        {
          label: 'Records',
          value: detailTotals?.grand_count ?? record?.payment_count ?? 0,
        },
        ...(detailTotals && !detailLoading
          ? [
              {
                label: 'Completed payments',
                value: `${formatCurrency(detailTotals.completed_total)} · ${detailTotals.completed_count} row(s)`,
              },
              {
                label: 'Acknowledgement Receipt sales (standalone)',
                value: `${formatCurrency(detailTotals.ar_total)} · ${detailTotals.ar_count} receipt(s)`,
              },
            ]
          : []),
      ];

  if (!open || !record || typeof document === 'undefined') return null;

  const branchLabel = record.branch_name || fallbackBranchName || '-';

  return (
    <>
      {createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-stretch justify-center backdrop-blur-sm bg-black/5 p-2 sm:items-center sm:p-4"
          onClick={onClose}
        >
          <div
            className={`bg-white rounded-t-xl sm:rounded-xl shadow-xl w-full max-h-[min(92dvh,92vh)] flex flex-col overflow-hidden min-w-0 my-auto sm:my-0 ${
              isCashDeposit ? 'max-w-5xl' : 'max-w-[min(1440px,calc(100vw-2rem))]'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col gap-3 border-b border-gray-100 px-4 py-3 shrink-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:px-5 sm:py-4">
              <div className="min-w-0 order-2 sm:order-1">
                <h3 className="text-lg font-semibold text-gray-900">
                  {isCashDeposit ? 'Cash Deposit Summary Details' : 'Daily Summary Details'}
                </h3>
                <p className="mt-1 text-xs text-gray-500">
                  {isCashDeposit
                    ? 'Overview of the branch cash deposit submission and the payment log lines that support it.'
                    : 'Overview of this branch end-of-shift submission and payment records from payment logs.'}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="self-end text-gray-400 hover:text-gray-600 sm:self-auto order-1 sm:order-2"
                aria-label="Close details"
              >
                <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>

            <div className="px-4 py-3 overflow-y-auto min-h-0 sm:px-5 sm:py-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 text-sm">
                <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                  <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Branch</p>
                  <p className="mt-1 text-gray-900 font-medium truncate">{branchLabel}</p>
                </div>
                {detailMetrics.map((metric) => (
                  <div key={metric.label} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                    <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">{metric.label}</p>
                    <p className="mt-1 text-gray-900 font-semibold">{metric.value}</p>
                  </div>
                ))}
                <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                  <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Status</p>
                  <div className="mt-1">{statusBadge(record.status)}</div>
                </div>
                <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                  <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Submitted By</p>
                  <p className="mt-1 text-gray-900 font-medium truncate">{record.submitted_by_name || '-'}</p>
                </div>
                <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                  <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Submitted At</p>
                  <p className="mt-1 text-gray-900 font-medium">
                    {record.submitted_at ? formatDateManila(record.submitted_at) : '-'}
                  </p>
                </div>
                <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                  <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Verified By</p>
                  <p className="mt-1 text-gray-900 font-medium truncate">{summaryVerificationActorLabel(record)}</p>
                </div>
                <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                  <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Verified At</p>
                  <p className="mt-1 text-gray-900 font-medium">
                    {record.approved_at ? formatDateManila(record.approved_at) : '-'}
                  </p>
                </div>
                {isCashDeposit ? (
                  <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                    <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Reference Number</p>
                    <p className="mt-1 text-gray-900 font-medium break-all">{record.reference_number || '-'}</p>
                  </div>
                ) : null}
                {isCashDeposit ? (
                  <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                    <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Deposit Proof</p>
                    {record.deposit_attachment_url ? (
                      <button
                        type="button"
                        onClick={() => setAttachmentPreviewUrl(record.deposit_attachment_url)}
                        className="mt-1 inline-block text-sm text-primary-700 hover:text-primary-800 underline break-all text-left"
                      >
                        View attachment
                      </button>
                    ) : (
                      <p className="mt-1 text-gray-900 font-medium">-</p>
                    )}
                  </div>
                ) : null}
              </div>

              {isCashDeposit && !detailLoading && cashDepositTotalsDrift ? (
                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Submitted amounts: Cash to Deposit{' '}
                  <span className="font-semibold">{formatCurrency(detailSubmittedSnapshot.total_deposit_amount)}</span>,
                  All cash <span className="font-semibold">{formatCurrency(detailSubmittedSnapshot.total_cash_amount)}</span>{' '}
                  ({detailSubmittedSnapshot.completed_cash_count ?? 0} completed / {detailSubmittedSnapshot.payment_count ?? 0}{' '}
                  rows). Current recalculated for this period: Cash to Deposit{' '}
                  <span className="font-semibold">{formatCurrency(cashDetailTotals.total_deposit_amount)}</span>, All cash{' '}
                  <span className="font-semibold">{formatCurrency(cashDetailTotals.total_cash_amount)}</span> (
                  {cashDetailTotals.completed_cash_count ?? 0} completed / {cashDetailTotals.payment_count ?? 0} rows) —
                  payment lines may have changed after submission (includes payable + tip on cash rows).
                </div>
              ) : null}

              <div className="mt-4">
                {!isCashDeposit && (
                  <div className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="rounded-lg border border-gray-200 p-3">
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Sales by Payment Method</p>
                      {detailMethodPieData.length === 0 ? (
                        <p className="text-sm text-gray-500 py-8 text-center">No data available.</p>
                      ) : (
                        <>
                          <div className="h-36">
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                <Pie data={detailMethodPieData} dataKey="value" nameKey="name" outerRadius={64} innerRadius={32}>
                                  {detailMethodPieData.map((entry, idx) => (
                                    <Cell key={entry.name} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                                  ))}
                                </Pie>
                                <Tooltip formatter={(value) => formatCurrency(value)} />
                              </PieChart>
                            </ResponsiveContainer>
                          </div>
                          <div className="space-y-1 text-xs">
                            {detailMethodPieData.map((entry, idx) => (
                              <div key={entry.name} className="flex items-center justify-between">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span
                                    className="inline-block w-2.5 h-2.5 rounded-full"
                                    style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }}
                                  />
                                  <span className="truncate text-gray-700">{entry.name}</span>
                                </div>
                                <span className="font-medium text-gray-900">{formatCurrency(entry.value)}</span>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                    <div className="rounded-lg border border-gray-200 p-3">
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Sales by Program/Level Tag</p>
                      {detailLevelPieData.length === 0 ? (
                        <p className="text-sm text-gray-500 py-8 text-center">No data available.</p>
                      ) : (
                        <>
                          <div className="h-36">
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                <Pie data={detailLevelPieData} dataKey="value" nameKey="name" outerRadius={64} innerRadius={32}>
                                  {detailLevelPieData.map((entry, idx) => (
                                    <Cell key={entry.name} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                                  ))}
                                </Pie>
                                <Tooltip formatter={(value) => formatCurrency(value)} />
                              </PieChart>
                            </ResponsiveContainer>
                          </div>
                          <div className="space-y-1 text-xs">
                            {detailLevelPieData.map((entry, idx) => (
                              <div key={entry.name} className="flex items-center justify-between">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span
                                    className="inline-block w-2.5 h-2.5 rounded-full"
                                    style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }}
                                  />
                                  <span className="truncate text-gray-700">{entry.name}</span>
                                </div>
                                <span className="font-medium text-gray-900">{formatCurrency(entry.value)}</span>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}
                {!isCashDeposit && detailTotals && detailMethodPieData.length > 0 ? (
                  <p className="mb-4 text-[11px] text-gray-500">
                    Segment totals match <span className="font-medium text-gray-700">total amount</span> (
                    {formatCurrency(detailTotals.grand_total)}
                    {Math.abs(detailPieSum - Number(detailTotals.grand_total || 0)) > 0.02
                      ? ` · segment sum ${formatCurrency(detailPieSum)}`
                      : ''}
                    ) for this summary date (completed payments + standalone acknowledgement receipts).
                  </p>
                ) : null}
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                  {isCashDeposit ? 'Cash payment records (from payment logs)' : 'Completed payments (payment logs)'}
                </p>
                {isCashDeposit && cashDepositPaymentsEditable ? (
                  <p className="mb-2 text-[11px] text-primary-700">
                    Click an invoice to update payment details. Totals refresh automatically after you save.
                  </p>
                ) : null}
                {isCashDeposit && detailIsUsingSubmittedSnapshot ? (
                  <p className="mb-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
                    Showing the original submitted snapshot — the live recalc found no matching payment rows for this period
                    (rows may have been deleted after submission).
                  </p>
                ) : null}
                {detailLoading ? (
                  <p className="text-sm text-gray-500 py-4">Loading payment records...</p>
                ) : isCashDeposit ? (
                  <div
                    className="overflow-x-auto rounded-lg border border-gray-200 max-h-56"
                    style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}
                  >
                    <table className="text-sm" style={{ width: '100%', minWidth: '760px' }}>
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Invoice</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Student</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Program/Level Tag</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Issue Date</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Method</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Collected</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Reference</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 bg-white">
                        {detailPayments.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="px-3 py-4 text-center text-gray-500">
                              No payment records found for this submission.
                            </td>
                          </tr>
                        ) : (
                          detailPayments.map((payment) => {
                            const tip = Number(payment.tip_amount) || 0;
                            const payable = Number(payment.payable_amount) || 0;
                            const collected = payable + tip;
                            return (
                              <tr key={`cash-detail-${payment.payment_id}`} className="hover:bg-gray-50/80">
                                <td className="px-3 py-2 whitespace-nowrap">
                                  <CashDepositPaymentInvoiceCell
                                    payment={payment}
                                    canEdit={cashDepositPaymentsEditable}
                                    onEdit={setCashPaymentEdit}
                                  />
                                </td>
                                <td className="px-3 py-2 text-gray-700 min-w-0 max-w-[160px]">
                                  <span className="truncate block" title={payment.student_name || '-'}>
                                    {payment.student_name || '-'}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-gray-700 min-w-0 max-w-[150px]">
                                  <span className="truncate block" title={payment.program_level_tag || '-'}>
                                    {payment.program_level_tag || '-'}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                                  {formatDateManila(payment.issue_date)}
                                </td>
                                <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{payment.payment_method || '-'}</td>
                                <td className="px-3 py-2 text-right font-semibold text-green-600 whitespace-nowrap align-top">
                                  <div>{formatCurrency(collected)}</div>
                                  {tip > 0 ? (
                                    <div className="text-[10px] text-gray-500 font-normal mt-0.5">
                                      {formatCurrency(payable)} + tip {formatCurrency(tip)}
                                    </div>
                                  ) : null}
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap">{statusBadge(payment.status)}</td>
                                <td className="px-3 py-2 text-gray-500 min-w-0 max-w-[120px]">
                                  <span className="truncate block" title={payment.reference_number || '-'}>
                                    {payment.reference_number || '-'}
                                  </span>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <>
                    <div
                      className="rounded-lg border border-gray-200 max-h-56 overflow-y-auto min-w-0"
                      style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}
                    >
                      <div
                        className="overflow-x-auto rounded-lg"
                        style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}
                      >
                        <table className="border-collapse text-[11px] sm:text-xs" style={{ width: '100%', minWidth: '960px' }}>
                          <thead className="bg-gray-50 sticky top-0">
                            <tr>
                              <th className="w-[8%] py-2 ps-4 pe-2 text-left font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">
                                Invoice
                              </th>
                              <th className="w-[9%] py-2 px-2 text-left font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">
                                Pay date
                              </th>
                              <th className="w-[15%] py-2 px-2 text-left font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">
                                Student
                              </th>
                              <th className="w-[10%] py-2 px-2 text-left font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">
                                Level tag
                              </th>
                              <th className="w-[10%] py-2 px-2 text-left font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">
                                Payment method
                              </th>
                              <th className="w-[11%] py-2 px-2 text-right font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">
                                Inv total
                              </th>
                              <th className="w-[11%] py-2 px-2 text-right font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">
                                Collected
                              </th>
                              <th className="w-[10%] py-2 px-2 text-center font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">
                                Attached image
                              </th>
                              <th className="w-[16%] py-2 ps-2 pe-4 text-left font-medium text-gray-500 uppercase tracking-wide border-b border-gray-200">
                                Reference
                              </th>
                            </tr>
                          </thead>
                          <tbody className="bg-white">
                            {detailPayments.length === 0 ? (
                              <tr>
                                <td colSpan={9} className="px-3 py-4 text-center text-gray-500 border-b border-gray-100">
                                  No completed payment rows for this summary date (payments with status Completed).
                                </td>
                              </tr>
                            ) : (
                              detailPayments.map((payment) => {
                                const tip = Number(payment.tip_amount) || 0;
                                const payable = Number(payment.payable_amount) || 0;
                                const collected = payable + tip;
                                const invTotal = payment.invoice_document_total;
                                const attUrl = (payment.payment_attachment_url || '').trim();
                                return (
                                  <tr key={payment.payment_id} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50/80">
                                    <td className="py-2 ps-4 pe-2 font-medium text-gray-900 truncate align-top">
                                      {payment.invoice_id ? `INV-${payment.invoice_id}` : '-'}
                                    </td>
                                    <td className="py-2 px-2 text-gray-700 truncate align-top">
                                      {payment.issue_date ? formatDateManila(payment.issue_date) : '-'}
                                    </td>
                                    <td className="py-2 px-2 text-gray-700 min-w-0 align-top">
                                      <span className="truncate block" title={payment.student_name || '-'}>
                                        {payment.student_name || '-'}
                                      </span>
                                    </td>
                                    <td className="py-2 px-2 text-gray-700 min-w-0 align-top">
                                      <span className="truncate block" title={payment.program_level_tag || '-'}>
                                        {payment.program_level_tag || '-'}
                                      </span>
                                    </td>
                                    <td className="py-2 px-2 text-gray-700 truncate align-top">{payment.payment_method || '-'}</td>
                                    <td className="py-2 px-2 text-right font-medium text-gray-800 tabular-nums align-top truncate">
                                      {invTotal != null && invTotal !== '' ? formatCurrency(invTotal) : '—'}
                                    </td>
                                    <td className="py-2 px-2 text-right align-top min-w-0">
                                      <div className="font-semibold text-green-600 tabular-nums">{formatCurrency(collected)}</div>
                                      {tip > 0 ? (
                                        <div className="text-[10px] text-gray-500 mt-0.5 leading-tight">
                                          {formatCurrency(payable)} + tip {formatCurrency(tip)}
                                        </div>
                                      ) : null}
                                    </td>
                                    <td className="py-2 px-2 text-center align-top whitespace-nowrap">
                                      {attUrl ? (
                                        <button
                                          type="button"
                                          onClick={() => setPaymentAttachmentViewerUrl(attUrl)}
                                          className="text-xs font-medium text-primary-600 hover:text-primary-800 hover:underline"
                                        >
                                          View
                                        </button>
                                      ) : (
                                        <span className="text-gray-400">—</span>
                                      )}
                                    </td>
                                    <td className="py-2 ps-2 pe-4 text-gray-500 min-w-0 align-top">
                                      <span className="truncate block" title={payment.reference_number || '-'}>
                                        {payment.reference_number || '-'}
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2 mt-6">
                      Standalone Acknowledgement Receipts (included in total; not yet posted as invoice payments)
                    </p>
                    <div
                      className="rounded-lg border border-gray-200 max-h-48 overflow-y-auto min-w-0"
                      style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}
                    >
                      <div
                        className="overflow-x-auto rounded-lg"
                        style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}
                      >
                        <table className="border-collapse text-[11px] sm:text-xs" style={{ width: '100%', minWidth: '720px' }}>
                          <thead className="bg-gray-50 sticky top-0">
                            <tr>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                                Acknowledgement Receipt #
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Pay date</th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Prospect / student</th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Level</th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Method</th>
                              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Collected</th>
                              <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Image</th>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Reference</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {detailArReceipts.length === 0 ? (
                              <tr>
                                <td colSpan={8} className="px-3 py-4 text-center text-gray-500">
                                  No standalone acknowledgement receipts for this summary date.
                                </td>
                              </tr>
                            ) : (
                              detailArReceipts.map((ar) => {
                                const tip = Number(ar.tip_amount) || 0;
                                const pam = Number(ar.payment_amount) || 0;
                                const collected = pam + tip;
                                const attUrl = (ar.payment_attachment_url || '').trim();
                                return (
                                  <tr key={`ar-${ar.ack_receipt_id}`} className="hover:bg-gray-50/80">
                                    <td className="px-3 py-2 font-medium text-gray-900 whitespace-nowrap">
                                      {ar.ack_receipt_number || `#${ar.ack_receipt_id}`}
                                    </td>
                                    <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                                      {ar.issue_date ? formatDateManila(ar.issue_date) : '-'}
                                    </td>
                                    <td className="px-3 py-2 text-gray-700 min-w-0 max-w-[180px]">
                                      <span className="truncate block" title={ar.prospect_student_name || '-'}>
                                        {ar.prospect_student_name || '-'}
                                      </span>
                                    </td>
                                    <td className="px-3 py-2 text-gray-700 min-w-0 max-w-[120px]">
                                      <span className="truncate block" title={ar.program_level_tag || '-'}>
                                        {ar.program_level_tag || '-'}
                                      </span>
                                    </td>
                                    <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{ar.payment_method || '-'}</td>
                                    <td className="px-3 py-2 text-right font-semibold text-green-600 tabular-nums whitespace-nowrap">
                                      <div>{formatCurrency(collected)}</div>
                                      {tip > 0 ? (
                                        <div className="text-[10px] text-gray-500 mt-0.5">
                                          {formatCurrency(pam)} + tip {formatCurrency(tip)}
                                        </div>
                                      ) : null}
                                    </td>
                                    <td className="px-3 py-2 text-center whitespace-nowrap">
                                      {attUrl ? (
                                        <button
                                          type="button"
                                          onClick={() => setPaymentAttachmentViewerUrl(attUrl)}
                                          className="text-xs font-medium text-primary-600 hover:text-primary-800 hover:underline"
                                        >
                                          View
                                        </button>
                                      ) : (
                                        <span className="text-gray-400">—</span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-gray-500 min-w-0 max-w-[140px]">
                                      <span className="truncate block" title={ar.reference_number || '-'}>
                                        {ar.reference_number || '-'}
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="mt-4">
                <p className="text-xs font-medium text-gray-500">
                  {isFinanceReturnedSummaryStatus(record.status) ? 'Return reason' : 'Remarks'}
                </p>
                <p className="mt-1 text-sm text-gray-800 whitespace-pre-line">
                  {record.remarks && record.remarks.trim() ? record.remarks : 'No remarks.'}
                </p>
              </div>
            </div>

            <div className="px-4 py-3 border-t border-gray-100 flex flex-col-reverse gap-2 bg-white shrink-0 sm:px-5 sm:flex-row sm:items-center sm:justify-end">
              <button
                type="button"
                onClick={onClose}
                className="w-full px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 sm:w-auto"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      <PaymentAttachmentViewerModal
        open={Boolean(paymentAttachmentViewerUrl)}
        url={paymentAttachmentViewerUrl}
        onClose={() => setPaymentAttachmentViewerUrl(null)}
      />

      {cashPaymentEdit ? (
        <CashDepositPaymentEditModal
          payment={cashPaymentEdit}
          onClose={() => setCashPaymentEdit(null)}
          onSaved={reloadDetailData}
        />
      ) : null}

      {attachmentPreviewUrl &&
        createPortal(
          <div
            className="fixed inset-0 z-[10000] flex items-stretch justify-center backdrop-blur-sm bg-black/60 p-2 sm:items-center sm:p-4"
            onClick={() => setAttachmentPreviewUrl('')}
          >
            <div
              className="bg-white rounded-t-xl sm:rounded-xl shadow-xl max-w-4xl w-full max-h-[min(92dvh,90vh)] flex flex-col overflow-hidden my-auto sm:my-0"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between shrink-0">
                <h4 className="text-sm font-semibold text-gray-900">Deposit Attachment Preview</h4>
                <button
                  type="button"
                  onClick={() => setAttachmentPreviewUrl('')}
                  className="text-gray-400 hover:text-gray-600 p-1 rounded-md"
                  aria-label="Close attachment preview"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-auto bg-gray-50 flex items-center justify-center p-3">
                <img
                  src={attachmentPreviewUrl}
                  alt="Deposit attachment"
                  className="max-w-full max-h-[75vh] object-contain rounded border border-gray-200 bg-white"
                />
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
