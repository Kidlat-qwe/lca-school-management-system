import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../config/api';
import { formatDateManila } from '../../utils/dateUtils';

/**
 * Self-contained, read-only presentation of a single installment plan
 * (`installmentinvoiceprofiles_id`).
 *
 * Loads `GET /installment-invoices/profiles/:id/phases` and renders:
 *   - student / plan / frequency / phase progress / branch / status card
 *   - optional downpayment card
 *   - phases table (every phase: paid, unpaid, or not yet generated)
 *   - totals card (outstanding balance, total paid by student)
 *
 * Used by:
 *   - `InstallmentInvoicePhasesModal`     (wrapped in a modal shell)
 *   - `StudentHistoryModal` › Invoices tab (rendered inline)
 *
 * Props:
 *   - profileId            (number|string) installmentinvoiceprofiles_id
 *   - showStudentName      (bool, default true)
 *   - className            (string, optional)  applied to the wrapper
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

const InstallmentPlanDetails = ({ profileId, showStudentName = true, className = '' }) => {
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
    if (profileId) fetchPhases();
    return () => {
      setData(null);
      setError('');
    };
  }, [profileId, fetchPhases]);

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

  const phaseProgress = useMemo(() => {
    const total = profile?.total_phases != null ? Number(profile.total_phases) : null;
    const generated = phases.filter((p) => p.is_generated).length;
    const paid = phases.filter(
      (p) => String(p.status || '').toLowerCase() === 'paid'
    ).length;
    const reference = total != null && total > 0 ? total : Math.max(generated, paid, 1);
    const denominator = total != null && total > 0 ? total : reference;
    const percent = Math.min(100, Math.max(0, Math.round((paid / reference) * 100)));
    const complete = total != null && total > 0 ? paid >= total : false;
    return { total, generated, paid, percent, complete, denominator };
  }, [profile, phases]);

  return (
    <div className={`space-y-4 sm:space-y-6 ${className}`}>
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
              {showStudentName && (
                <div>
                  <p className="text-[11px] uppercase tracking-wide font-medium text-gray-500">
                    Student Name
                  </p>
                  <p className="text-sm sm:text-base font-semibold text-gray-900 break-words">
                    {profile.student_name || '\u2014'}
                  </p>
                </div>
              )}
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
              <div className="sm:col-span-2">
                <p className="text-[11px] uppercase tracking-wide font-medium text-gray-500">
                  Phase Progress
                </p>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm font-medium text-gray-800">
                  <span>
                    <span className="text-emerald-700 font-semibold">
                      {phaseProgress.paid}
                    </span>
                    {' / '}
                    {phaseProgress.denominator} paid
                  </span>
                  <span className="text-gray-500">
                    <span className="text-gray-700 font-semibold">
                      {phaseProgress.generated}
                    </span>
                    {' / '}
                    {phaseProgress.denominator} generated
                  </span>
                  {phaseProgress.complete && (
                    <span className="text-xs font-semibold text-green-700">
                      Completed
                    </span>
                  )}
                </div>
                <div
                  className="mt-2 w-full max-w-md h-2 rounded-full bg-gray-200 overflow-hidden"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={phaseProgress.percent}
                >
                  <div
                    className={`h-full rounded-full transition-all ${
                      phaseProgress.complete ? 'bg-emerald-500' : 'bg-blue-500'
                    }`}
                    style={{ width: `${phaseProgress.percent}%` }}
                  />
                </div>
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
              <h3 className="text-sm font-semibold text-gray-900">Phases</h3>
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
  );
};

export default InstallmentPlanDetails;
