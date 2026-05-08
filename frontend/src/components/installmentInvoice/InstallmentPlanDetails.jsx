import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import API_BASE_URL, { apiRequest } from '../../config/api';
import { formatDateManila, todayManilaYMD } from '../../utils/dateUtils';
import { appAlert } from '../../utils/appAlert';

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

// Keep this list in sync with the Invoice payment modal (Invoice.jsx).
const PAYMENT_METHODS = ['Cash', 'Online Banking', 'Credit Card', 'E-wallets'];

const InstallmentPlanDetails = ({ profileId, showStudentName = true, className = '' }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  // Advance payment modal state
  const [advancePayPhase, setAdvancePayPhase] = useState(null); // { phase_number, amount, absolute }
  const [apForm, setApForm] = useState({
    payment_method: 'Cash',
    tip_amount: '',
    issue_date: '',
    reference_number: '',
    remarks: '',
    attachment_url: '',
  });
  const [apFormErrors, setApFormErrors] = useState({});
  const [apSubmitting, setApSubmitting] = useState(false);
  const [apAttachUploading, setApAttachUploading] = useState(false);
  const apModalRef = useRef(null);

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

  const openAdvancePay = useCallback((phase) => {
    setAdvancePayPhase(phase);
    setApForm({
      payment_method: 'Cash',
      tip_amount: '',
      issue_date: todayManilaYMD(),
      reference_number: '',
      remarks: '',
      attachment_url: '',
    });
    setApFormErrors({});
  }, []);

  const closeAdvancePay = useCallback(() => {
    if (apSubmitting) return;
    setAdvancePayPhase(null);
    setApFormErrors({});
  }, [apSubmitting]);

  const handleApInput = useCallback((e) => {
    const { name, value } = e.target;
    setApForm((prev) => ({ ...prev, [name]: value }));
    setApFormErrors((prev) => ({ ...prev, [name]: undefined }));
  }, []);

  const handleApAttachmentChange = useCallback(async (e) => {
    const file = e.target?.files?.[0];
    if (!file) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(file.type)) {
      appAlert('Please select an image (JPEG, PNG, WebP, or GIF).');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      appAlert('Image must be 50MB or less.');
      return;
    }
    setApAttachUploading(true);
    try {
      const fd = new FormData();
      fd.append('image', file);
      const token = localStorage.getItem('firebase_token');
      const res = await fetch(`${API_BASE_URL}/upload/invoice-payment-image`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Upload failed');
      }
      setApForm((prev) => ({ ...prev, attachment_url: data.imageUrl || '' }));
      setApFormErrors((prev) => ({ ...prev, attachment_url: undefined }));
    } catch (err) {
      console.error('Advance payment attachment upload error:', err);
      appAlert(err.message || 'Failed to upload image. Please try again.');
    } finally {
      setApAttachUploading(false);
      if (e.target) e.target.value = '';
    }
  }, []);

  const clearApAttachment = useCallback(() => {
    setApForm((prev) => ({ ...prev, attachment_url: '' }));
  }, []);

  const submitAdvancePay = useCallback(async (e) => {
    e?.preventDefault();
    if (!advancePayPhase || !profileId) return;

    // Validate
    const errors = {};
    if (!apForm.payment_method) errors.payment_method = 'Payment method is required.';
    if (!apForm.issue_date) errors.issue_date = 'Payment date is required.';
    if (!apForm.reference_number || !apForm.reference_number.trim())
      errors.reference_number = 'Reference number is required.';
    if (!apForm.attachment_url) errors.attachment_url = 'Attachment is required.';
    if (apForm.tip_amount && Number.isNaN(parseFloat(apForm.tip_amount)))
      errors.tip_amount = 'Must be a valid number.';
    if (Object.keys(errors).length) { setApFormErrors(errors); return; }

    setApSubmitting(true);
    try {
      await apiRequest(`/installment-invoices/profiles/${profileId}/advance-pay`, {
        method: 'POST',
        body: JSON.stringify({
          phase_index: advancePayPhase.phase_number,
          payment_method: apForm.payment_method,
          reference_number: apForm.reference_number.trim() || undefined,
          payment_date: apForm.issue_date || undefined,
          remarks: apForm.remarks.trim() || undefined,
          attachment_url: apForm.attachment_url || undefined,
          tip_amount: apForm.tip_amount ? parseFloat(apForm.tip_amount) : undefined,
        }),
      });
      appAlert(`Advance payment for Phase ${advancePayPhase.absolute} recorded successfully.`);
      setAdvancePayPhase(null);
      fetchPhases();
    } catch (err) {
      setApFormErrors({ _general: err?.message || 'Failed to record advance payment.' });
    } finally {
      setApSubmitting(false);
    }
  }, [advancePayPhase, profileId, apForm, fetchPhases]);

  // Close advance-pay modal on Escape
  useEffect(() => {
    if (!advancePayPhase) return;
    const handler = (e) => { if (e.key === 'Escape') closeAdvancePay(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [advancePayPhase, closeAdvancePay]);

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

  const phaseStartRaw = profile?.phase_start != null ? Number(profile.phase_start) : 1;
  const phaseStartOffset = Math.max(
    0,
    (Number.isFinite(phaseStartRaw) ? phaseStartRaw : 1) - 1
  );

  const phaseProgress = useMemo(() => {
    const total = profile?.total_phases != null ? Number(profile.total_phases) : null;
    const generated = phases.filter((p) => p.is_generated).length;
    const paid = phases.filter(
      (p) => String(p.status || '').toLowerCase() === 'paid'
    ).length;
    const reference = total != null && total > 0 ? total : Math.max(generated, paid, 1);
    // Display phase progress in absolute terms (e.g. "6 / 10" for a plan
    // covering phases 6..10) instead of profile-local numbers ("1 / 5").
    // For profiles starting at phase 1 the display is unchanged.
    const denominator =
      total != null && total > 0 ? total + phaseStartOffset : reference + phaseStartOffset;
    const paidDisplay = paid + phaseStartOffset;
    const generatedDisplay = generated + phaseStartOffset;
    const percent = Math.min(100, Math.max(0, Math.round((paid / reference) * 100)));
    const complete = total != null && total > 0 ? paid >= total : false;
    return {
      total,
      generated,
      paid,
      paidDisplay,
      generatedDisplay,
      percent,
      complete,
      denominator,
    };
  }, [profile, phases, phaseStartOffset]);

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
              <div>
                <p className="text-[11px] uppercase tracking-wide font-medium text-gray-500">
                  Level Tag
                </p>
                <p className="text-sm font-medium text-gray-800 break-words">
                  {profile.level_tag || '\u2014'}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide font-medium text-gray-500">
                  Class Enrolled
                </p>
                <p className="text-sm font-medium text-gray-800 break-words">
                  {profile.class_name || '\u2014'}
                </p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-[11px] uppercase tracking-wide font-medium text-gray-500">
                  Phase Progress
                </p>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm font-medium text-gray-800">
                  <span>
                    <span className="text-emerald-700 font-semibold">
                      {phaseProgress.paidDisplay}
                    </span>
                    {' / '}
                    {phaseProgress.denominator} paid
                  </span>
                  <span className="text-gray-500">
                    <span className="text-gray-700 font-semibold">
                      {phaseProgress.generatedDisplay}
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
              <table style={{ width: '100%', minWidth: '860px' }} className="divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-600 uppercase tracking-wide">Phase</th>
                    <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-600 uppercase tracking-wide">Inv. ID</th>
                    <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-600 uppercase tracking-wide">AR#</th>
                    <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-600 uppercase tracking-wide">Issued</th>
                    <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-600 uppercase tracking-wide">Due</th>
                    <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-600 uppercase tracking-wide">Paid On</th>
                    <th className="px-2 py-2 text-right text-[10px] font-semibold text-gray-600 uppercase tracking-wide">Amount</th>
                    <th className="px-2 py-2 text-right text-[10px] font-semibold text-gray-600 uppercase tracking-wide">Paid</th>
                    <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-600 uppercase tracking-wide">Status</th>
                    <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-600 uppercase tracking-wide">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {phases.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-3 py-8 text-center text-sm text-gray-500">
                        No phase records found.
                      </td>
                    </tr>
                  ) : (() => {
                    // Sequential locking: only the immediate next unpaid phase can be advance-paid.
                    // Find the lowest phase_number among "Not Generated" phases.
                    const nextPayablePhaseNum = phases
                      .filter((p) => p.status === 'Not Generated')
                      .reduce((min, p) => (p.phase_number < min ? p.phase_number : min), Infinity);

                    return phases.map((phase) => {
                      const absolutePhase = Number(phase.phase_number) + phaseStartOffset;
                      const isNotGenerated = phase.status === 'Not Generated';
                      // Only the very next not-generated phase is unlocked.
                      const isPayable = isNotGenerated && phase.phase_number === nextPayablePhaseNum;
                      const isLocked = isNotGenerated && !isPayable;
                      return (
                        <tr
                          key={`phase-${phase.phase_number}`}
                          className={isNotGenerated ? 'bg-gray-50/60' : ''}
                        >
                          <td className="px-2 py-2.5 text-sm text-gray-900 font-medium whitespace-nowrap">
                            Phase {absolutePhase}
                          </td>
                          <td className="px-2 py-2.5 text-sm text-gray-700 whitespace-nowrap">
                            {phase.invoice_id != null ? phase.invoice_id : '\u2014'}
                          </td>
                          <td className="px-2 py-2.5 text-sm text-gray-700 whitespace-nowrap">
                            {phase.invoice_ar_number || '\u2014'}
                          </td>
                          <td className="px-2 py-2.5 text-sm text-gray-700 whitespace-nowrap">
                            {phase.issue_date ? formatDateManila(phase.issue_date) : '\u2014'}
                          </td>
                          <td className="px-2 py-2.5 text-sm text-gray-700 whitespace-nowrap">
                            {phase.due_date ? formatDateManila(phase.due_date) : '\u2014'}
                          </td>
                          <td className="px-2 py-2.5 text-sm text-gray-700 whitespace-nowrap">
                            {phase.payment_date ? formatDateManila(phase.payment_date) : '\u2014'}
                          </td>
                          <td className="px-2 py-2.5 text-sm text-gray-900 font-medium text-right whitespace-nowrap">
                            {phase.amount != null ? formatCurrency(phase.amount) : '\u2014'}
                          </td>
                          <td className="px-2 py-2.5 text-sm text-emerald-700 font-medium text-right whitespace-nowrap">
                            {formatCurrency(phase.paid_amount || 0)}
                          </td>
                          <td className="px-2 py-2.5 whitespace-nowrap">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusBadgeClass(phase.status)}`}>
                              {phase.status}
                            </span>
                          </td>
                          <td className="px-2 py-2.5 whitespace-nowrap">
                            {isPayable ? (
                              <button
                                type="button"
                                onClick={() => openAdvancePay({
                                  phase_number: phase.phase_number,
                                  absolute: absolutePhase,
                                  amount: phase.amount,
                                })}
                                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded bg-primary-50 text-primary-700 border border-primary-200 hover:bg-primary-100 transition-colors"
                              >
                                Pay Now
                              </button>
                            ) : isLocked ? (
                              <span
                                title="Pay the previous phase first"
                                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed select-none"
                              >
                                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                                </svg>
                                Locked
                              </span>
                            ) : '\u2014'}
                          </td>
                        </tr>
                      );
                    });
                  })()}
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

      {/* Advance Payment Modal — styled to match the Invoice payment modal */}
      {advancePayPhase && createPortal(
        <div className="fixed inset-0 z-[20000] flex items-center justify-center backdrop-blur-sm bg-black/30">
          <div
            ref={apModalRef}
            className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4"
          >
            {/* Sticky header */}
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center z-10">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Record Advance Payment</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  Phase {advancePayPhase.absolute} — {formatCurrency(advancePayPhase.amount || 0)}
                </p>
              </div>
              <button
                type="button"
                onClick={closeAdvancePay}
                disabled={apSubmitting}
                className="text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Form */}
            <form onSubmit={submitAdvancePay} className="p-6 space-y-6">
              <div className="space-y-4">
                {/* Payment Type + Payment Method */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label-field text-xs">Payment Type</label>
                    <input
                      type="text"
                      value="Advance Payment"
                      readOnly
                      className="input-field text-sm bg-gray-100 text-gray-600 cursor-not-allowed"
                    />
                  </div>
                  <div>
                    <label className="label-field text-xs">
                      Payment Method <span className="text-red-500">*</span>
                    </label>
                    <select
                      name="payment_method"
                      value={apForm.payment_method}
                      onChange={handleApInput}
                      disabled={apSubmitting}
                      className={`input-field text-sm ${apFormErrors.payment_method ? 'border-red-500' : ''}`}
                      required
                    >
                      {PAYMENT_METHODS.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                    {apFormErrors.payment_method && (
                      <p className="text-xs text-red-500 mt-1">{apFormErrors.payment_method}</p>
                    )}
                  </div>
                </div>

                {/* Payable Amount + Tip */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label-field text-xs">Payable Amount</label>
                    <input
                      type="text"
                      value={formatCurrency(advancePayPhase.amount || 0)}
                      readOnly
                      className="input-field text-sm bg-gray-100 text-gray-600 cursor-not-allowed"
                    />
                    <p className="text-xs text-gray-500 mt-1">Full phase amount — fixed.</p>
                  </div>
                  <div>
                    <label className="label-field text-xs">Tip / Excess Amount (Optional)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      name="tip_amount"
                      value={apForm.tip_amount}
                      onChange={handleApInput}
                      disabled={apSubmitting}
                      className={`input-field text-sm ${apFormErrors.tip_amount ? 'border-red-500' : ''}`}
                      placeholder="0.00"
                    />
                    {apFormErrors.tip_amount && (
                      <p className="text-xs text-red-500 mt-1">{apFormErrors.tip_amount}</p>
                    )}
                  </div>
                </div>

                {/* Payment Date — full width */}
                <div>
                  <label className="label-field text-xs">
                    Payment Date <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    name="issue_date"
                    value={apForm.issue_date}
                    onChange={handleApInput}
                    disabled={apSubmitting}
                    className={`input-field text-sm ${apFormErrors.issue_date ? 'border-red-500' : ''}`}
                    required
                  />
                  {apFormErrors.issue_date && (
                    <p className="text-xs text-red-500 mt-1">{apFormErrors.issue_date}</p>
                  )}
                  <p className="text-xs text-gray-500 mt-1">
                    When the client actually paid (e.g. bank or e-wallet transfer date). Defaults to today.
                  </p>
                </div>

                {/* Attachment */}
                <div>
                  <label className="label-field text-xs">
                    Attachment (image) <span className="text-red-500">*</span>
                  </label>
                  <p className="text-xs text-gray-500 mb-1">
                    Upload a receipt or proof of payment (JPEG, PNG, WebP, GIF, max 50 MB)
                  </p>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    onChange={handleApAttachmentChange}
                    disabled={apAttachUploading || apSubmitting}
                    className={`block w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-3 file:rounded file:border-0 file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200 ${
                      apFormErrors.attachment_url ? 'border border-red-500 rounded-lg p-1' : ''
                    }`}
                  />
                  {apAttachUploading && (
                    <p className="text-xs text-amber-600 mt-1">Uploading…</p>
                  )}
                  {apFormErrors.attachment_url && (
                    <p className="text-xs text-red-500 mt-1">{apFormErrors.attachment_url}</p>
                  )}
                  {apForm.attachment_url && !apAttachUploading && (
                    <div className="mt-2">
                      <img
                        src={apForm.attachment_url}
                        alt="Payment attachment preview"
                        className="max-h-48 w-auto rounded-lg border border-gray-200 object-contain bg-gray-50"
                      />
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        <a
                          href={apForm.attachment_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-primary-600 hover:underline"
                        >
                          View attached image
                        </a>
                        <button
                          type="button"
                          onClick={clearApAttachment}
                          className="text-xs text-red-600 hover:text-red-700"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Reference Number */}
                <div>
                  <label className="label-field text-xs">
                    Reference Number <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    name="reference_number"
                    value={apForm.reference_number}
                    onChange={handleApInput}
                    disabled={apSubmitting}
                    className={`input-field text-sm ${apFormErrors.reference_number ? 'border-red-500' : ''}`}
                    placeholder="Enter reference number (e.g. cash voucher, GCash ref, bank receipt no.)"
                    required
                  />
                  {apFormErrors.reference_number && (
                    <p className="text-xs text-red-500 mt-1">{apFormErrors.reference_number}</p>
                  )}
                </div>

                {/* Remarks */}
                <div>
                  <label className="label-field text-xs">Remarks</label>
                  <textarea
                    name="remarks"
                    value={apForm.remarks}
                    onChange={handleApInput}
                    disabled={apSubmitting}
                    className="input-field text-sm"
                    rows={3}
                    placeholder="Optional remarks or notes"
                  />
                </div>

                {/* Invoice / Phase Summary */}
                <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-gray-700">Phase Information</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-gray-500">Phase</p>
                      <p className="font-medium text-gray-900">Phase {advancePayPhase.absolute}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Student</p>
                      <p className="font-medium text-gray-900">{profile?.student_name || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Plan</p>
                      <p className="font-medium text-gray-900">{profile?.program_name || profile?.package_description || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Frequency</p>
                      <p className="font-medium text-gray-900">{profile?.frequency || '—'}</p>
                    </div>
                  </div>
                  <div className="border-t border-gray-200 pt-3 space-y-1 text-sm">
                    <div className="flex justify-between font-semibold">
                      <span className="text-gray-800">Phase Amount</span>
                      <span className="text-gray-900">{formatCurrency(advancePayPhase.amount || 0)}</span>
                    </div>
                    {apForm.tip_amount && parseFloat(apForm.tip_amount) > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Tip / Excess</span>
                        <span className="text-gray-900">{formatCurrency(parseFloat(apForm.tip_amount))}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-semibold border-t border-gray-200 pt-2 mt-2">
                      <span className="text-gray-800">Total Collected</span>
                      <span className="text-emerald-700">
                        {formatCurrency(
                          (parseFloat(advancePayPhase.amount) || 0) +
                          (parseFloat(apForm.tip_amount) || 0)
                        )}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-3 py-2 mt-2">
                    This creates a <strong>Paid</strong> invoice and <strong>Completed</strong> payment. The
                    auto-generation schedule advances by one month and the student is enrolled in Phase{' '}
                    {advancePayPhase.absolute} class sessions.
                  </p>
                </div>

                {apFormErrors._general && (
                  <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                    {apFormErrors._general}
                  </p>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={closeAdvancePay}
                  disabled={apSubmitting}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={apSubmitting || apAttachUploading}
                  className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {apSubmitting && (
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                  )}
                  {apSubmitting ? 'Recording…' : 'Record Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default InstallmentPlanDetails;
