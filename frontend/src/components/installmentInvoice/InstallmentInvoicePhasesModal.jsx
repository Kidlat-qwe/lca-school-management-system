import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../config/api';
import { formatDateManila } from '../../utils/dateUtils';

/**
 * Shared read-only modal used by every "Installment Invoice Logs"
 * page (Superadmin, Admin, Finance, Superfinance) for the
 * "View Details" action.
 *
 * Loads the per-phase breakdown from
 *   GET /installment-invoices/profiles/:id/phases
 * and renders the student name, plan, every phase (paid, unpaid, or
 * not yet generated), the optional downpayment, and the totals.
 *
 * Props:
 *   open      (bool)              whether the modal is shown
 *   profileId (number|string|null) installmentinvoiceprofiles_id
 *   onClose   (fn)                invoked when the modal is closed
 */

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
      return 'bg-green-100 text-green-800 border border-green-200';
    case 'overdue':
      return 'bg-red-100 text-red-800 border border-red-200';
    case 'pending':
      return 'bg-yellow-100 text-yellow-800 border border-yellow-200';
    case 'cancelled':
    case 'canceled':
      return 'bg-gray-100 text-gray-700 border border-gray-200';
    case 'not generated':
      return 'bg-gray-50 text-gray-500 border border-gray-200';
    default:
      return 'bg-blue-50 text-blue-700 border border-blue-200';
  }
};

const InstallmentInvoicePhasesModal = ({ open, profileId, onClose }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  const fetchPhases = useCallback(async () => {
    if (!profileId) return;
    try {
      setLoading(true);
      setError('');
      const response = await apiRequest(
        `/installment-invoices/profiles/${profileId}/phases`
      );
      setData(response?.data || null);
    } catch (err) {
      console.error('Failed to load installment phases:', err);
      setError(err?.message || 'Failed to load installment phases.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    if (open && profileId) {
      fetchPhases();
    }
    if (!open) {
      setData(null);
      setError('');
    }
  }, [open, profileId, fetchPhases]);

  const profile = data?.profile || null;
  const phases = data?.phases || [];
  const downpayment = data?.downpayment || null;
  const totals = data?.totals || null;

  const planLabel = useMemo(() => {
    if (!profile) return '';
    const parts = [];
    if (profile.program_name) parts.push(profile.program_name);
    if (profile.package_description) parts.push(profile.package_description);
    return parts.join(' \u2013 ') || '\u2014';
  }, [profile]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9998] flex items-stretch justify-center backdrop-blur-sm bg-black/30 p-2 sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="installment-phases-modal-title"
    >
      <div
        className="bg-white rounded-t-xl sm:rounded-lg shadow-xl max-w-4xl w-full max-h-[95vh] sm:max-h-[90vh] my-auto sm:my-0 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 p-4 sm:p-6 border-b border-gray-200 flex-shrink-0">
          <div className="min-w-0">
            <h2
              id="installment-phases-modal-title"
              className="text-lg sm:text-xl font-bold text-gray-900"
            >
              Installment Plan Details
            </h2>
            <p className="text-xs sm:text-sm text-gray-500 mt-1">
              View every phase, paid or unpaid, and the total student
              payment for this installment plan.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors shrink-0"
            aria-label="Close"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 sm:space-y-6">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
            </div>
          )}

          {!loading && error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {!loading && !error && profile && (
            <>
              <section className="rounded-lg border border-gray-200 bg-gray-50 p-4 sm:p-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide font-medium text-gray-500">
                      Student Name
                    </p>
                    <p className="text-sm sm:text-base font-semibold text-gray-900 break-words">
                      {profile.student_name || '\u2014'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide font-medium text-gray-500">
                      Plan
                    </p>
                    <p className="text-sm sm:text-base font-semibold text-gray-900 break-words">
                      {planLabel}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide font-medium text-gray-500">
                      Frequency
                    </p>
                    <p className="text-sm font-medium text-gray-800">
                      {profile.frequency || '\u2014'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide font-medium text-gray-500">
                      Phase Progress
                    </p>
                    <p className="text-sm font-medium text-gray-800">
                      {profile.total_phases != null
                        ? `${phases.filter((p) => p.is_generated).length} of ${profile.total_phases} generated`
                        : `${phases.filter((p) => p.is_generated).length} generated`}
                    </p>
                  </div>
                  {profile.branch_name && (
                    <div>
                      <p className="text-[11px] uppercase tracking-wide font-medium text-gray-500">
                        Branch
                      </p>
                      <p className="text-sm font-medium text-gray-800">
                        {profile.branch_name}
                      </p>
                    </div>
                  )}
                  <div>
                    <p className="text-[11px] uppercase tracking-wide font-medium text-gray-500">
                      Status
                    </p>
                    <p className="text-sm font-medium text-gray-800">
                      {profile.is_active ? 'Active' : 'Inactive'}
                    </p>
                  </div>
                </div>
              </section>

              {downpayment && (
                <section className="rounded-lg border border-gray-200 bg-white p-4 sm:p-5">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">
                    Downpayment
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
                    <div>
                      <p className="text-[11px] uppercase tracking-wide font-medium text-gray-500">
                        AR Number
                      </p>
                      <p className="text-gray-900 break-words">
                        {downpayment.invoice_ar_number || '\u2014'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide font-medium text-gray-500">
                        Amount
                      </p>
                      <p className="text-gray-900 font-medium">
                        {downpayment.amount != null
                          ? formatCurrency(downpayment.amount)
                          : '\u2014'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide font-medium text-gray-500">
                        Paid
                      </p>
                      <p className="text-emerald-700 font-medium">
                        {formatCurrency(downpayment.paid_amount || 0)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide font-medium text-gray-500">
                        Payment Date
                      </p>
                      <p className="text-gray-900">
                        {downpayment.payment_date
                          ? formatDateManila(downpayment.payment_date)
                          : '\u2014'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide font-medium text-gray-500">
                        Status
                      </p>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusBadgeClass(downpayment.status)}`}
                      >
                        {downpayment.status}
                      </span>
                    </div>
                  </div>
                </section>
              )}

              <section className="rounded-lg border border-gray-200 bg-white">
                <div className="px-4 sm:px-5 py-3 border-b border-gray-200 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-900">
                    Phases
                  </h3>
                  <span className="text-xs text-gray-500">
                    {phases.length} {phases.length === 1 ? 'phase' : 'phases'}
                  </span>
                </div>

                <div
                  className="overflow-x-auto"
                  style={{
                    scrollbarWidth: 'thin',
                    scrollbarColor: '#cbd5e0 #f7fafc',
                    WebkitOverflowScrolling: 'touch',
                  }}
                >
                  <table style={{ width: '100%', minWidth: '820px' }} className="divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-600 uppercase tracking-wide">
                          Phase
                        </th>
                        <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-600 uppercase tracking-wide">
                          AR / Invoice
                        </th>
                        <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-600 uppercase tracking-wide">
                          Issue Date
                        </th>
                        <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-600 uppercase tracking-wide">
                          Due Date
                        </th>
                        <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-600 uppercase tracking-wide">
                          Payment Date
                        </th>
                        <th className="px-3 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase tracking-wide">
                          Amount
                        </th>
                        <th className="px-3 py-2.5 text-right text-[11px] font-semibold text-gray-600 uppercase tracking-wide">
                          Paid
                        </th>
                        <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-600 uppercase tracking-wide">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {phases.length === 0 ? (
                        <tr>
                          <td
                            colSpan={8}
                            className="px-3 py-8 text-center text-sm text-gray-500"
                          >
                            No phase records found.
                          </td>
                        </tr>
                      ) : (
                        phases.map((phase) => (
                          <tr key={`phase-${phase.phase_number}`}>
                            <td className="px-3 py-3 text-sm text-gray-900 font-medium whitespace-nowrap">
                              Phase {phase.phase_number}
                            </td>
                            <td className="px-3 py-3 text-sm text-gray-700">
                              {phase.invoice_ar_number || (phase.is_generated ? `INV-${phase.invoice_id}` : '\u2014')}
                            </td>
                            <td className="px-3 py-3 text-sm text-gray-700 whitespace-nowrap">
                              {phase.issue_date ? formatDateManila(phase.issue_date) : '\u2014'}
                            </td>
                            <td className="px-3 py-3 text-sm text-gray-700 whitespace-nowrap">
                              {phase.due_date ? formatDateManila(phase.due_date) : '\u2014'}
                            </td>
                            <td className="px-3 py-3 text-sm text-gray-700 whitespace-nowrap">
                              {phase.payment_date ? formatDateManila(phase.payment_date) : '\u2014'}
                            </td>
                            <td className="px-3 py-3 text-sm text-gray-900 font-medium text-right whitespace-nowrap">
                              {phase.amount != null ? formatCurrency(phase.amount) : '\u2014'}
                            </td>
                            <td className="px-3 py-3 text-sm text-emerald-700 font-medium text-right whitespace-nowrap">
                              {formatCurrency(phase.paid_amount || 0)}
                            </td>
                            <td className="px-3 py-3 whitespace-nowrap">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusBadgeClass(phase.status)}`}
                              >
                                {phase.status}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              {totals && (
                <section className="rounded-lg border border-gray-200 bg-gradient-to-r from-emerald-50 to-white p-4 sm:p-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    <div>
                      <p className="text-[11px] uppercase tracking-wide font-medium text-gray-500">
                        Total Outstanding Balance
                      </p>
                      <p className="text-base sm:text-lg font-semibold text-gray-900">
                        {formatCurrency(totals.total_outstanding || 0)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide font-medium text-emerald-700">
                        Total Paid (Student)
                      </p>
                      <p className="text-lg sm:text-xl font-bold text-emerald-700">
                        {formatCurrency(totals.total_paid || 0)}
                      </p>
                    </div>
                  </div>
                </section>
              )}
            </>
          )}

          {!loading && !error && !profile && (
            <div className="rounded-lg bg-yellow-50 border border-yellow-200 px-4 py-3 text-sm text-yellow-800">
              No installment data available for this record.
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 sm:gap-3 p-4 sm:p-6 border-t border-gray-200 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default InstallmentInvoicePhasesModal;
