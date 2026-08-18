import { useCallback, useEffect, useState } from 'react';
import API_BASE_URL, { apiRequest } from '../../config/api';
import { formatDateManila } from '../../utils/dateUtils';
import { appAlert } from '../../utils/appAlert';
import {
  formatInstallmentPlanPhaseEnrollment,
  programEnrollmentStatusBadgeClass,
} from '../../utils/programEnrollmentStatus';
import InvoicePaymentDueStatusBadge from '../invoices/InvoicePaymentDueStatusBadge';

const formatCurrency = (value) => {
  const n = Number(value || 0);
  return `\u20B1${n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const statusBadgeClass = (status) => {
  switch (String(status || '').toLowerCase()) {
    case 'paid':
    case 'paid all':
      return 'bg-green-100 text-green-800 border border-green-200';
    case 'overdue':
    case 'overdue for penalty':
      return 'bg-red-100 text-red-800 border border-red-200';
    case 'under grace period':
      return 'bg-amber-100 text-amber-800 border border-amber-200';
    case 'cancelled':
    case 'canceled':
      return 'bg-gray-100 text-gray-700 border border-gray-200';
    case 'unpaid':
      return 'bg-blue-50 text-blue-700 border border-blue-200';
    case 'partially paid':
      return 'bg-amber-100 text-amber-800 border border-amber-200';
    default:
      return 'bg-blue-50 text-blue-700 border border-blue-200';
  }
};

const tableScrollStyle = {
  scrollbarWidth: 'thin',
  scrollbarColor: '#cbd5e0 #f7fafc',
  WebkitOverflowScrolling: 'touch',
};

const MetaField = ({ label, children }) => (
  <div className="min-w-0">
    <p className="text-[11px] uppercase tracking-wide font-medium text-gray-500">{label}</p>
    <div className="text-sm font-medium text-gray-800 break-words">{children ?? '\u2014'}</div>
  </div>
);

const openInvoicePdf = async (invoiceId, docType) => {
  const token = localStorage.getItem('firebase_token');
  const suffix = docType ? `?doc_type=${encodeURIComponent(docType)}` : '';
  const response = await fetch(`${API_BASE_URL}/invoices/${invoiceId}/pdf${suffix}`, {
    headers: {
      Authorization: token ? `Bearer ${token}` : '',
    },
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(errText || 'Failed to download PDF');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener,noreferrer');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

const phaseCoverageLabel = (start, end) => {
  if (start == null && end == null) return null;
  if (start != null && end != null && Number(start) === Number(end)) {
    return `Phase ${start}`;
  }
  if (start != null && end != null) return `Phase ${start}\u2013${end}`;
  return `Phase ${start ?? end}`;
};

/**
 * Student History — Full payment tab.
 * One card per native full-payment invoice or installment→full-payment conversion.
 */
const StudentFullPaymentPanel = ({ studentId, focusClassId = null, focusClassName = '' }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [settlements, setSettlements] = useState([]);
  const [pdfBusyId, setPdfBusyId] = useState(null);

  const load = useCallback(async () => {
    if (!studentId) return;
    setLoading(true);
    setError('');
    try {
      const res = await apiRequest(`/invoices/student/${studentId}/full-payment`);
      setSettlements(Array.isArray(res?.data) ? res.data : []);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to load full payment records.');
      setSettlements([]);
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    load();
  }, [load]);

  const handlePdf = async (invoiceId, docType) => {
    setPdfBusyId(`${invoiceId}-${docType || 'invoice'}`);
    try {
      await openInvoicePdf(invoiceId, docType);
    } catch (err) {
      console.error(err);
      appAlert(err.message || 'Failed to download PDF');
    } finally {
      setPdfBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
        {error}
      </div>
    );
  }

  if (settlements.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No full payment records for this student. Installment plans are listed on the Installment tab.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {settlements.map((row, idx) => {
        const isFocused =
          focusClassId != null && row.class_id != null && Number(row.class_id) === Number(focusClassId);
        const coverage = phaseCoverageLabel(row.phase_start, row.phase_end);
        const titleParts = [row.program_name, row.package_name].filter(Boolean);
        const conversion = row.conversion;
        const enrollments = row.enrollment?.phases || [];
        const items = row.items || [];
        const payments = row.payments || [];
        const merchandise = row.merchandise || [];

        return (
          <section
            key={`fp-${row.invoice_id}`}
            className={[
              'rounded-lg border bg-white p-2 sm:p-3 transition-shadow',
              isFocused
                ? 'border-primary-500 ring-2 ring-primary-400/60 bg-primary-50/30 shadow-md'
                : 'border-gray-200',
            ].join(' ')}
            aria-label={
              isFocused && focusClassName
                ? `Selected full payment for ${focusClassName}`
                : undefined
            }
          >
            <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2 px-1">
              <h3 className="text-sm sm:text-base font-semibold text-gray-900">
                Settlement {idx + 1}
                {titleParts.length > 0 ? (
                  <span className="ml-2 text-gray-500 font-normal">
                    · {titleParts.join(' \u2013 ')}
                  </span>
                ) : null}
                {isFocused ? (
                  <span className="ml-2 inline-flex items-center rounded-full bg-primary-100 px-2 py-0.5 text-xs font-medium text-primary-800">
                    Selected class
                  </span>
                ) : null}
              </h3>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={pdfBusyId != null}
                  onClick={() => handlePdf(row.invoice_id, null)}
                  className="inline-flex items-center px-2.5 py-1 text-[11px] font-semibold rounded-md bg-white text-gray-800 border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
                >
                  Invoice PDF
                </button>
                <button
                  type="button"
                  disabled={pdfBusyId != null}
                  onClick={() => handlePdf(row.invoice_id, 'ar')}
                  className="inline-flex items-center px-2.5 py-1 text-[11px] font-semibold rounded-md bg-white text-gray-800 border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
                >
                  AR PDF
                </button>
              </div>
            </header>

            <div className="space-y-4">
              <section className="rounded-lg border border-gray-200 bg-gray-50 p-3 sm:p-4">
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6 gap-3 sm:gap-4">
                  <MetaField label="Package">{row.package_name || '\u2014'}</MetaField>
                  <MetaField label="Class enrolled">{row.class_name || '\u2014'}</MetaField>
                  <MetaField label="Class started date">
                    {row.class_start_date ? formatDateManila(row.class_start_date) : '\u2014'}
                  </MetaField>
                  <MetaField label="Level tag">{row.level_tag || '\u2014'}</MetaField>
                  <MetaField label="Branch">{row.branch_name || '\u2014'}</MetaField>
                  <MetaField label="Phase coverage">{coverage || '\u2014'}</MetaField>
                  <MetaField label="Status">
                    <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusBadgeClass(row.status)}`}
                      >
                        {row.status || '\u2014'}
                      </span>
                      <InvoicePaymentDueStatusBadge label={row.payment_due_status_label} />
                      {row.is_conversion ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800 border border-emerald-200">
                          Converted from installment
                        </span>
                      ) : null}
                    </div>
                  </MetaField>
                  <MetaField label="Student status">
                    {row.student_status === 'active' ? (
                      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-800">
                        <span className="h-2 w-2 rounded-full bg-emerald-500" />
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-600">
                        <span className="h-2 w-2 rounded-full bg-gray-400" />
                        Inactive
                      </span>
                    )}
                  </MetaField>
                </div>
              </section>

              <section className="rounded-lg border border-gray-200 bg-white p-3 sm:p-4">
                <h4 className="text-sm font-semibold text-gray-900 mb-3">Invoice</h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
                  <MetaField label="Inv. ID">{row.invoice_id != null ? `INV-${row.invoice_id}` : '\u2014'}</MetaField>
                  <MetaField label="AR#">{row.invoice_ar_number || '\u2014'}</MetaField>
                  <MetaField label="Issued">
                    {row.issue_date ? formatDateManila(row.issue_date) : '\u2014'}
                  </MetaField>
                  <MetaField label="Due">
                    {row.due_date ? formatDateManila(row.due_date) : '\u2014'}
                  </MetaField>
                  <MetaField label="Paid on">
                    {row.paid_on ? formatDateManila(row.paid_on) : '\u2014'}
                  </MetaField>
                  <MetaField label="Payment method">{row.payment_method || '\u2014'}</MetaField>
                </div>
              </section>

              {conversion ? (
                <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 sm:p-4">
                  <h4 className="text-sm font-semibold text-emerald-900 mb-3">Conversion credits</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 text-sm">
                    <MetaField label="From package">
                      {conversion.from_package_name ||
                        (conversion.from_package_id ? `#${conversion.from_package_id}` : '\u2014')}
                    </MetaField>
                    <MetaField label="To package">
                      {conversion.to_package_name ||
                        (conversion.to_package_id ? `#${conversion.to_package_id}` : '\u2014')}
                    </MetaField>
                    <MetaField label="Target full price">
                      {conversion.target_full_price != null
                        ? formatCurrency(conversion.target_full_price)
                        : '\u2014'}
                    </MetaField>
                    <MetaField label="Credit applied">
                      {conversion.credit_applied != null
                        ? formatCurrency(conversion.credit_applied)
                        : '\u2014'}
                    </MetaField>
                  </div>
                </section>
              ) : null}

              <section className="rounded-lg border border-gray-200 bg-white">
                <div className="px-3 sm:px-4 py-3 border-b border-gray-200">
                  <h4 className="text-sm font-semibold text-gray-900">Line items</h4>
                </div>
                {items.length === 0 ? (
                  <p className="px-3 sm:px-4 py-3 text-sm text-gray-500">No line items on this invoice.</p>
                ) : (
                  <div className="overflow-x-auto rounded-b-lg" style={tableScrollStyle}>
                    <table style={{ width: '100%', minWidth: '640px' }} className="divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-600 uppercase tracking-wide">
                            Description
                          </th>
                          <th className="px-3 py-2 text-right text-[10px] font-semibold text-gray-600 uppercase tracking-wide">
                            Amount
                          </th>
                          <th className="px-3 py-2 text-right text-[10px] font-semibold text-gray-600 uppercase tracking-wide">
                            Discount
                          </th>
                          <th className="px-3 py-2 text-right text-[10px] font-semibold text-gray-600 uppercase tracking-wide">
                            Penalty
                          </th>
                          <th className="px-3 py-2 text-right text-[10px] font-semibold text-gray-600 uppercase tracking-wide">
                            Net
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white">
                        {items.map((item) => (
                          <tr key={item.invoice_item_id}>
                            <td className="px-3 py-2 text-sm text-gray-900 break-words">{item.description}</td>
                            <td className="px-3 py-2 text-sm text-gray-900 text-right whitespace-nowrap">
                              {formatCurrency(item.amount)}
                            </td>
                            <td className="px-3 py-2 text-sm text-gray-900 text-right whitespace-nowrap">
                              {formatCurrency(item.discount_amount)}
                            </td>
                            <td className="px-3 py-2 text-sm text-gray-900 text-right whitespace-nowrap">
                              {formatCurrency(item.penalty_amount)}
                            </td>
                            <td className="px-3 py-2 text-sm font-medium text-gray-900 text-right whitespace-nowrap">
                              {formatCurrency(item.net_amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {payments.length > 0 ? (
                <section className="rounded-lg border border-gray-200 bg-white">
                  <div className="px-3 sm:px-4 py-3 border-b border-gray-200">
                    <h4 className="text-sm font-semibold text-gray-900">Payments</h4>
                  </div>
                  <div className="overflow-x-auto rounded-b-lg" style={tableScrollStyle}>
                    <table style={{ width: '100%', minWidth: '560px' }} className="divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-600 uppercase tracking-wide">
                            Paid on
                          </th>
                          <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-600 uppercase tracking-wide">
                            Type
                          </th>
                          <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-600 uppercase tracking-wide">
                            Method
                          </th>
                          <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-600 uppercase tracking-wide">
                            Reference
                          </th>
                          <th className="px-3 py-2 text-right text-[10px] font-semibold text-gray-600 uppercase tracking-wide">
                            Amount
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white">
                        {payments.map((pay) => (
                          <tr key={pay.payment_id}>
                            <td className="px-3 py-2 text-sm text-gray-900 whitespace-nowrap">
                              {pay.paid_on ? formatDateManila(pay.paid_on) : '\u2014'}
                            </td>
                            <td className="px-3 py-2 text-sm text-gray-900">{pay.payment_type || '\u2014'}</td>
                            <td className="px-3 py-2 text-sm text-gray-900">{pay.payment_method || '\u2014'}</td>
                            <td className="px-3 py-2 text-sm text-gray-900 break-words">
                              {pay.reference_number || '\u2014'}
                            </td>
                            <td className="px-3 py-2 text-sm font-medium text-gray-900 text-right whitespace-nowrap">
                              {formatCurrency(pay.payable_amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}

              <section className="rounded-lg border border-gray-200 bg-white p-3 sm:p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold text-gray-900">Enrollment</h4>
                  {row.student_status === 'active' ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      Active
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700 ring-1 ring-gray-200">
                      <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
                      Inactive
                    </span>
                  )}
                </div>
                {enrollments.length === 0 ? (
                  <p className="text-sm text-gray-500">No class enrollment rows for this settlement.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {enrollments.map((phase, phaseIdx) => {
                      const label =
                        formatInstallmentPlanPhaseEnrollment(phase.status) ||
                        phase.status_label ||
                        phase.status ||
                        '—';
                      return (
                        <span
                          key={`enr-${row.invoice_id}-${phase.phase_number ?? phaseIdx}`}
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${programEnrollmentStatusBadgeClass(phase.status)}`}
                        >
                          {phase.phase_number != null ? `Phase ${phase.phase_number}` : 'Phase'}
                          {' · '}
                          {label}
                          {phase.phase_start_date
                            ? ` · ${formatDateManila(phase.phase_start_date)}`
                            : phase.enrolled
                              ? ` · ${formatDateManila(phase.enrolled)}`
                              : ''}
                        </span>
                      );
                    })}
                  </div>
                )}
                {row.enrollment?.first_enrolled ? (
                  <p className="mt-2 text-xs text-gray-500">
                    First enrolled {formatDateManila(row.enrollment.first_enrolled)}
                  </p>
                ) : null}
              </section>

              {merchandise.length > 0 ? (
                <section className="rounded-lg border border-gray-200 bg-white">
                  <div className="px-3 sm:px-4 py-3 border-b border-gray-200">
                    <h4 className="text-sm font-semibold text-gray-900">Merchandise</h4>
                  </div>
                  <div className="overflow-x-auto rounded-b-lg" style={tableScrollStyle}>
                    <table style={{ width: '100%', minWidth: '520px' }} className="divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-600 uppercase tracking-wide">
                            Item
                          </th>
                          <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-600 uppercase tracking-wide">
                            Size
                          </th>
                          <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-600 uppercase tracking-wide">
                            Category
                          </th>
                          <th className="px-3 py-2 text-right text-[10px] font-semibold text-gray-600 uppercase tracking-wide">
                            Qty
                          </th>
                          <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-600 uppercase tracking-wide">
                            Status
                          </th>
                          <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-600 uppercase tracking-wide">
                            Released
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white">
                        {merchandise.map((merch, merchIdx) => (
                          <tr key={`merch-${row.invoice_id}-${merchIdx}`}>
                            <td className="px-3 py-2 text-sm text-gray-900 break-words">
                              {merch.merchandise_name || '\u2014'}
                            </td>
                            <td className="px-3 py-2 text-sm text-gray-900">{merch.size || '\u2014'}</td>
                            <td className="px-3 py-2 text-sm text-gray-900">{merch.category || '\u2014'}</td>
                            <td className="px-3 py-2 text-sm text-gray-900 text-right">{merch.quantity ?? 1}</td>
                            <td className="px-3 py-2 text-sm text-gray-900">{merch.status || '\u2014'}</td>
                            <td className="px-3 py-2 text-sm text-gray-900 whitespace-nowrap">
                              {merch.released ? formatDateManila(merch.released) : '\u2014'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}

              <section className="rounded-lg border border-gray-200 bg-gray-50 p-3 sm:p-4">
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide font-medium text-gray-500">Amount</p>
                    <p className="text-sm font-semibold text-gray-900">{formatCurrency(row.amount)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide font-medium text-gray-500">Paid</p>
                    <p className="text-sm font-semibold text-emerald-700">{formatCurrency(row.paid_amount)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide font-medium text-gray-500">Balance</p>
                    <p className="text-sm font-semibold text-gray-900">
                      {formatCurrency(row.remaining_balance)}
                    </p>
                  </div>
                </div>
              </section>
            </div>
          </section>
        );
      })}
    </div>
  );
};

export default StudentFullPaymentPanel;
