import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import API_BASE_URL, { apiRequest } from '../../config/api';
import { formatDateManila, todayManilaYMD } from '../../utils/dateUtils';
import { appAlert } from '../../utils/appAlert';
import { getInstallmentPaymentBlockAlert } from '../../utils/installmentPaymentBlock';
import { formatProgramEnrollmentStatus } from '../../utils/programEnrollmentStatus';
import PaymentRecordedInvoiceSummaryModal from '../invoices/PaymentRecordedInvoiceSummaryModal';
import { PaymentDiscountField, PaymentTipField } from '../common/PaymentAdjustmentFields';
import {
  PAYMENT_DISCOUNT_ADJUSTMENT_LABEL,
  PAYMENT_TIP_ADJUSTMENT_LABEL,
} from '../../constants/paymentFormLabels';

/**
 * Presentation of a single installment plan (`installmentinvoiceprofiles_id`).
 *
 * Loads `GET /installment-invoices/profiles/:id/phases` and renders:
 *   - student / plan / frequency / phase progress / branch / status card
 *   - optional downpayment card
 *   - phases table (every phase: paid, unpaid, or not yet generated)
 *   - totals card (outstanding balance, total paid by student)
 *   - **Pay Now** on the first actionable phase: **existing** unpaid invoice
 *     via `POST /payments`, or **advance** on the next not-yet-generated phase
 *     via `POST .../advance-pay`
 *   - After a successful payment, the same **Payment recorded** modal as the
 *     Invoice page (receipt preview + Print AR PDF)
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
    case 'paid all':
      return 'bg-green-100 text-green-800 border border-green-200';
    case 'overdue':
      return 'bg-red-100 text-red-800 border border-red-200';
    case 'under grace period':
      return 'bg-amber-100 text-amber-800 border border-amber-200';
    case 'pending':
      return 'bg-yellow-100 text-yellow-800 border border-yellow-200';
    case 'cancelled':
    case 'canceled':
      return 'bg-gray-100 text-gray-700 border border-gray-200';
    case 'not generated':
      return 'bg-gray-50 text-gray-500 border border-gray-200';
    case 'unpaid':
    case 'partially paid':
      return 'bg-blue-50 text-blue-700 border border-blue-200';
    default:
      if (String(status || '').toLowerCase().includes('skipped')) {
        return 'bg-slate-100 text-slate-700 border border-slate-200';
      }
      return 'bg-blue-50 text-blue-700 border border-blue-200';
  }
};

// Keep this list in sync with the Invoice payment modal (Invoice.jsx).
const PAYMENT_METHODS = ['Cash', 'Online Banking', 'Credit Card', 'E-wallets'];

const InstallmentPlanDetails = ({ profileId, showStudentName = true, className = '' }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  /** @type {null | { mode: 'invoice'|'advance', phase_number: number, absolute: number, amount: number|null, outstanding?: number, invoice_id?: number }} */
  const [paymentModal, setPaymentModal] = useState(null);
  const [apForm, setApForm] = useState({
    payment_method: 'Cash',
    tip_amount: '',
    discount_amount: '',
    issue_date: '',
    reference_number: '',
    remarks: '',
    attachment_url: '',
  });
  const [apFormErrors, setApFormErrors] = useState({});
  const [apSubmitting, setApSubmitting] = useState(false);
  const [apAttachUploading, setApAttachUploading] = useState(false);
  const apModalRef = useRef(null);

  const [paymentRecordedSummary, setPaymentRecordedSummary] = useState(null);
  const [paymentRecordedPdfLoading, setPaymentRecordedPdfLoading] = useState(false);

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

  const openPaymentModal = useCallback(async (payload) => {
    if (payload?.mode === 'invoice' && payload.invoice_id) {
      try {
        const res = await apiRequest(`/invoices/${payload.invoice_id}`);
        const blockAlert = getInstallmentPaymentBlockAlert(res?.data);
        if (blockAlert) {
          appAlert(blockAlert);
          return;
        }
      } catch (err) {
        console.error('Installment payment eligibility check failed:', err);
        appAlert(err?.message || 'Could not verify payment eligibility. Please try again.');
        return;
      }
    }

    setPaymentModal(payload);
    setApForm({
      payment_method: 'Cash',
      tip_amount: '',
      discount_amount: '',
      issue_date: todayManilaYMD(),
      reference_number: '',
      remarks: '',
      attachment_url: '',
    });
    setApFormErrors({});
  }, []);

  const closePaymentModal = useCallback(() => {
    if (apSubmitting) return;
    setPaymentModal(null);
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

  const closePaymentRecordedInvoiceSummary = useCallback(() => {
    if (paymentRecordedPdfLoading) return;
    setPaymentRecordedSummary(null);
  }, [paymentRecordedPdfLoading]);

  const handlePrintPaymentRecordedAckPdf = useCallback(async () => {
    const inv = paymentRecordedSummary?.invoice;
    if (!inv?.invoice_id) return;
    setPaymentRecordedPdfLoading(true);
    try {
      const token = localStorage.getItem('firebase_token');
      const response = await fetch(`${API_BASE_URL}/invoices/${inv.invoice_id}/pdf?doc_type=ar`, {
        headers: {
          Authorization: token ? `Bearer ${token}` : '',
        },
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || 'Failed to download acknowledgement receipt PDF');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      console.error('Download acknowledgement receipt PDF failed:', err);
      appAlert(err.message || 'Failed to download acknowledgement receipt PDF');
    } finally {
      setPaymentRecordedPdfLoading(false);
    }
  }, [paymentRecordedSummary]);

  const loadPaymentRecordedSummary = useCallback(async (invoiceId, paymentSnapshot, branchId) => {
    let branchInfo = null;
    if (branchId != null && branchId !== '') {
      try {
        const brRes = await apiRequest(`/branches/${branchId}`);
        const d = brRes?.data;
        if (d) {
          branchInfo = {
            address: d.branch_address,
            phone: d.branch_phone_number,
            email: d.branch_email,
            nickname: d.branch_nickname || d.branch_name,
          };
        }
      } catch (e) {
        console.warn('Branch detail fetch for receipt preview skipped:', e);
      }
    }
    const invRes = await apiRequest(`/invoices/${invoiceId}`);
    setPaymentRecordedSummary({
      invoice: invRes.data,
      paymentSnapshot,
      branchInfo,
    });
  }, []);

  const submitPaymentModal = useCallback(async (e) => {
    e?.preventDefault();
    const studentId = data?.profile?.student_id;
    if (!paymentModal || !profileId || studentId == null) return;

    // Validate
    const errors = {};
    if (!apForm.payment_method) errors.payment_method = 'Payment method is required.';
    if (!apForm.issue_date) errors.issue_date = 'Payment date is required.';
    if (!apForm.reference_number || !apForm.reference_number.trim())
      errors.reference_number = 'Reference number is required.';
    if (!apForm.attachment_url) errors.attachment_url = 'Attachment is required.';
    if (apForm.tip_amount && Number.isNaN(parseFloat(apForm.tip_amount)))
      errors.tip_amount = 'Must be a valid number.';

    const grossPayable =
      paymentModal.mode === 'invoice'
        ? Number(paymentModal.outstanding ?? paymentModal.amount ?? 0)
        : Number(paymentModal.amount ?? 0);
    const discountAmountParsed = apForm.discount_amount === ''
      ? 0
      : parseFloat(apForm.discount_amount);
    if (apForm.discount_amount !== '' && (Number.isNaN(discountAmountParsed) || discountAmountParsed < 0)) {
      errors.discount_amount = 'Discount amount must be 0 or greater';
    } else if (apForm.discount_amount !== '' && discountAmountParsed >= grossPayable) {
      errors.discount_amount = 'Discount amount must be less than payable amount';
    }

    if (Object.keys(errors).length) { setApFormErrors(errors); return; }

    const modalSnap = { ...paymentModal };
    const branchId = data?.profile?.branch_id;
    const tipValParsed = apForm.tip_amount ? parseFloat(apForm.tip_amount) : 0;
    const tipVal = Number.isFinite(tipValParsed) && tipValParsed > 0 ? tipValParsed : 0;
    const discountApplied =
      apForm.discount_amount === ''
        ? 0
        : Math.max(0, parseFloat(apForm.discount_amount) || 0);
    const netPayable = Math.max(0, grossPayable - discountApplied);

    setApSubmitting(true);
    try {
      if (modalSnap.mode === 'invoice') {
        if (!Number.isFinite(grossPayable) || grossPayable < 0.01) {
          setApFormErrors({ _general: 'Invalid amount to pay for this phase.' });
          setApSubmitting(false);
          return;
        }
        const paidInvoiceId = modalSnap.invoice_id;
        const paymentSnapshot = {
          student_id: Number(studentId),
          payable_amount: netPayable,
          discount_amount: discountApplied,
          tip_amount: tipVal,
          issue_date: apForm.issue_date,
          reference_number: (apForm.reference_number || '').trim(),
        };

        await apiRequest('/payments', {
          method: 'POST',
          body: JSON.stringify({
            invoice_id: paidInvoiceId,
            student_id: Number(studentId),
            payment_method: apForm.payment_method,
            payment_type: 'Full',
            payable_amount: netPayable,
            discount_amount: discountApplied,
            tip_amount: tipVal,
            issue_date: apForm.issue_date || undefined,
            reference_number: apForm.reference_number.trim() || undefined,
            remarks: apForm.remarks.trim() || undefined,
            attachment_url: apForm.attachment_url || undefined,
          }),
        });

        setPaymentModal(null);
        await fetchPhases();
        try {
          await loadPaymentRecordedSummary(paidInvoiceId, paymentSnapshot, branchId);
        } catch (fetchErr) {
          console.error('Error loading invoice after payment:', fetchErr);
          appAlert('Payment recorded successfully, but the receipt preview could not be loaded. Refresh the page if needed.');
        }
      } else {
        const advRes = await apiRequest(`/installment-invoices/profiles/${profileId}/advance-pay`, {
          method: 'POST',
          body: JSON.stringify({
            phase_index: modalSnap.phase_number,
            payment_method: apForm.payment_method,
            reference_number: apForm.reference_number.trim() || undefined,
            payment_date: apForm.issue_date || undefined,
            remarks: apForm.remarks.trim() || undefined,
            attachment_url: apForm.attachment_url || undefined,
            tip_amount: apForm.tip_amount ? parseFloat(apForm.tip_amount) : undefined,
            discount_amount: discountApplied > 0 ? discountApplied : undefined,
          }),
        });
        const newInvoiceId = advRes?.data?.invoice_id;
        const paymentSnapshot = {
          student_id: Number(studentId),
          payable_amount: netPayable,
          discount_amount: discountApplied,
          tip_amount: tipVal,
          issue_date: apForm.issue_date,
          reference_number: (apForm.reference_number || '').trim(),
        };

        setPaymentModal(null);
        await fetchPhases();
        if (newInvoiceId) {
          try {
            await loadPaymentRecordedSummary(newInvoiceId, paymentSnapshot, branchId);
          } catch (fetchErr) {
            console.error('Error loading invoice after advance payment:', fetchErr);
            appAlert('Advance payment recorded, but the receipt preview could not be loaded. Refresh the page if needed.');
          }
        } else {
          appAlert(`Advance payment for Phase ${modalSnap.absolute} recorded successfully.`);
        }
      }
    } catch (err) {
      setApFormErrors({ _general: err?.message || 'Failed to record payment.' });
    } finally {
      setApSubmitting(false);
    }
  }, [paymentModal, profileId, data?.profile?.student_id, data?.profile?.branch_id, apForm, fetchPhases, loadPaymentRecordedSummary]);

  // Close payment modal on Escape
  useEffect(() => {
    if (!paymentModal) return;
    const handler = (e) => { if (e.key === 'Escape') closePaymentModal(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [paymentModal, closePaymentModal]);

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
    const paid = phases.filter((p) => {
      const st = String(p.status || '').toLowerCase();
      return st === 'paid' || st === 'paid all';
    }).length;
    const reference = total != null && total > 0 ? total : Math.max(generated, paid, 1);
    // Display phase progress in absolute terms (e.g. "6 / 10" for a plan
    // covering phases 6..10) instead of profile-local numbers ("1 / 5").
    // For profiles starting at phase 1 the display is unchanged.
    const denominator =
      total != null && total > 0 ? total + phaseStartOffset : reference + phaseStartOffset;
    const paidDisplay = paid + phaseStartOffset;
    const generatedDisplay = generated + phaseStartOffset;
    const percent = Math.min(100, Math.max(0, Math.round((paid / reference) * 100)));
    const denomPlan =
      totals?.plan_slots_total != null && totals.plan_slots_total > 0
        ? Number(totals.plan_slots_total)
        : total != null && total > 0
          ? total
          : phases.length || 0;
    const addressed =
      totals?.plan_slots_addressed != null
        ? Number(totals.plan_slots_addressed)
        : phases.filter((p) => p.plan_slot_addressed).length;
    const planComplete =
      totals?.plan_complete === true ||
      (denomPlan > 0 && addressed >= denomPlan);
    const planPercent =
      denomPlan > 0 ? Math.min(100, Math.round((addressed / denomPlan) * 100)) : 0;
    const complete = planComplete;
    return {
      total,
      generated,
      paid,
      paidDisplay,
      generatedDisplay,
      percent,
      planPercent,
      addressed,
      denomPlan,
      planComplete,
      complete,
      denominator,
    };
  }, [profile, phases, phaseStartOffset, totals]);

  /** First phase that can accept payment: existing unpaid invoice, else earliest advance slot. */
  const firstPayAction = useMemo(() => {
    if (profile?.upgraded_to_full_payment) return null;

    const priorPlanSlotsOk = (upToIndex) =>
      phases.slice(0, upToIndex).every((prev) => {
        if (prev.plan_slot_addressed === true) return true;
        const s = String(prev.status || '').toLowerCase();
        return s.includes('skipped');
      });

    for (let i = 0; i < phases.length; i += 1) {
      const p = phases[i];
      const out =
        p.is_generated && p.amount != null
          ? Math.max(0, Number(p.amount) - Number(p.paid_amount || 0))
          : 0;
      const st = String(p.status || '').toLowerCase();
      const cancelled = st === 'cancelled' || st === 'canceled';
      if (p.is_generated && p.invoice_id && !cancelled && st !== 'paid' && out > 0.009) {
        return { index: i, mode: 'invoice', outstanding: out };
      }
      const notGen = p.status === 'Not Generated';
      if (!p.is_generated && notGen) {
        if (priorPlanSlotsOk(i)) {
          return { index: i, mode: 'advance' };
        }
        return null;
      }
    }
    return null;
  }, [phases, profile?.upgraded_to_full_payment]);

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
          {profile.upgraded_to_full_payment && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <span className="font-semibold">{profile.upgrade_note || 'Upgraded to Full Payment'}</span>
              {profile.conversion_invoice_id != null && (
                <span className="block text-xs text-emerald-700 mt-0.5">
                  Conversion invoice #{profile.conversion_invoice_id}
                </span>
              )}
              <span className="block text-xs text-emerald-700 mt-0.5">
                Remaining installment slots are shown as paid via full payment conversion.
              </span>
            </div>
          )}

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
                      {phaseProgress.addressed}
                    </span>
                    {' / '}
                    {phaseProgress.denomPlan} phases complete
                  </span>
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
                  {phaseProgress.planComplete && (
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
                  aria-valuenow={phaseProgress.planPercent}
                >
                  <div
                    className={`h-full rounded-full transition-all ${
                      phaseProgress.planComplete ? 'bg-emerald-500' : 'bg-blue-500'
                    }`}
                    style={{ width: `${phaseProgress.planPercent}%` }}
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
                  {profile.is_active
                    ? 'Active'
                    : profile.upgraded_to_full_payment
                      ? `Inactive · ${profile.upgrade_note || 'Upgraded to Full Payment'}`
                      : 'Inactive'}
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
              <table style={{ width: '100%', minWidth: '1120px' }} className="divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-600 uppercase tracking-wide">Phase</th>
                    <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-600 uppercase tracking-wide">Enrollment</th>
                    <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-600 uppercase tracking-wide">Billing</th>
                    <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-600 uppercase tracking-wide">Inv. ID</th>
                    <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-600 uppercase tracking-wide">AR#</th>
                    <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-600 uppercase tracking-wide">Issued</th>
                    <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-600 uppercase tracking-wide">Due</th>
                    <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-600 uppercase tracking-wide">Paid On</th>
                    <th className="px-2 py-2 text-right text-[10px] font-semibold text-gray-600 uppercase tracking-wide">Amount</th>
                    <th className="px-2 py-2 text-right text-[10px] font-semibold text-gray-600 uppercase tracking-wide">Paid</th>
                    <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-600 uppercase tracking-wide">Status</th>
                    <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-600 uppercase tracking-wide">Note</th>
                    <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-600 uppercase tracking-wide">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {phases.length === 0 ? (
                    <tr>
                      <td colSpan={13} className="px-3 py-8 text-center text-sm text-gray-500">
                        No phase records found.
                      </td>
                    </tr>
                  ) : (
                    phases.map((phase, idx) => {
                      const absolutePhase = Number(phase.phase_number) + phaseStartOffset;
                      const isNotGenerated = phase.status === 'Not Generated';
                      const billingLabel =
                        phase.billing_kind === 'skipped_gap'
                          ? 'Skipped — no invoice'
                          : !phase.is_generated
                            ? '\u2014'
                            : phase.is_rejoin_invoice
                              ? 'Rejoin'
                              : Number(phase.phase_number) === 1
                                ? 'Auto-generated'
                                : 'Generated';
                      const outstanding =
                        phase.is_generated && phase.amount != null
                          ? Math.max(0, Number(phase.amount) - Number(phase.paid_amount || 0))
                          : 0;
                      const isPayRow =
                        firstPayAction &&
                        firstPayAction.index === idx &&
                        (firstPayAction.mode === 'invoice' || firstPayAction.mode === 'advance');
                      const isLockedFuture =
                        isNotGenerated &&
                        !(firstPayAction && firstPayAction.index === idx && firstPayAction.mode === 'advance');

                      return (
                        <tr
                          key={`phase-${phase.phase_number}`}
                          className={isNotGenerated ? 'bg-gray-50/60' : ''}
                        >
                          <td className="px-2 py-2.5 text-sm text-gray-900 font-medium whitespace-nowrap">
                            Phase {absolutePhase}
                          </td>
                          <td className="px-2 py-2.5 text-sm text-gray-700 max-w-[140px]">
                            {phase.program_enrollment_status
                              ? formatProgramEnrollmentStatus(phase.program_enrollment_status)
                              : '\u2014'}
                          </td>
                          <td className="px-2 py-2.5 text-xs text-gray-600 whitespace-nowrap" title="Installment invoice slot">
                            {billingLabel}
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
                          <td className="px-2 py-2.5 text-xs text-gray-600 max-w-[160px]">
                            {phase.phase_note ? (
                              <span className="text-emerald-700 font-medium">{phase.phase_note}</span>
                            ) : '\u2014'}
                          </td>
                          <td className="px-2 py-2.5 whitespace-nowrap">
                            {isPayRow ? (
                              <button
                                type="button"
                                onClick={() => {
                                  if (firstPayAction.mode === 'invoice') {
                                    openPaymentModal({
                                      mode: 'invoice',
                                      phase_number: phase.phase_number,
                                      absolute: absolutePhase,
                                      amount: phase.amount,
                                      outstanding,
                                      invoice_id: phase.invoice_id,
                                    });
                                  } else {
                                    openPaymentModal({
                                      mode: 'advance',
                                      phase_number: phase.phase_number,
                                      absolute: absolutePhase,
                                      amount: phase.amount,
                                    });
                                  }
                                }}
                                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded bg-primary-50 text-primary-700 border border-primary-200 hover:bg-primary-100 transition-colors"
                              >
                                Pay Now
                              </button>
                            ) : isLockedFuture ? (
                              <span
                                title="Pay the current phase (or earlier unpaid invoice) first"
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
                    })
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

      {/* Record payment (existing invoice) or advance payment — matches Invoice page payment flow */}
      {paymentModal && createPortal(
        <div className="fixed inset-0 z-[20000] flex items-center justify-center backdrop-blur-sm bg-black/30">
          <div
            ref={apModalRef}
            className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4"
          >
            {/* Sticky header */}
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center z-10">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">
                  {paymentModal.mode === 'invoice' ? 'Record Payment' : 'Record Advance Payment'}
                </h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  Phase {paymentModal.absolute} —{' '}
                  {formatCurrency(
                    paymentModal.mode === 'invoice'
                      ? (paymentModal.outstanding ?? 0)
                      : (paymentModal.amount || 0),
                  )}
                  {paymentModal.mode === 'invoice' && paymentModal.invoice_id != null && (
                    <span className="block text-xs text-gray-400 mt-0.5">
                      Invoice #{paymentModal.invoice_id}
                    </span>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={closePaymentModal}
                disabled={apSubmitting}
                className="text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Form */}
            <form onSubmit={submitPaymentModal} className="p-6 space-y-6">
              <div className="space-y-4">
                {/* Payment Type + Payment Method */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label-field text-xs">Payment Type</label>
                    <input
                      type="text"
                      value={paymentModal.mode === 'invoice' ? 'Full payment (invoice)' : 'Advance Payment'}
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
                      value={formatCurrency(
                        paymentModal.mode === 'invoice'
                          ? (paymentModal.outstanding ?? 0)
                          : (paymentModal.amount || 0),
                      )}
                      readOnly
                      className="input-field text-sm bg-gray-100 text-gray-600 cursor-not-allowed"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      {paymentModal.mode === 'invoice'
                        ? 'Remaining balance on this invoice — fixed.'
                        : 'Full phase amount — fixed.'}
                    </p>
                  </div>
                  <PaymentTipField
                    value={apForm.tip_amount}
                    onChange={handleApInput}
                    error={apFormErrors.tip_amount}
                    disabled={apSubmitting}
                  />
                </div>

                <PaymentDiscountField
                  value={apForm.discount_amount}
                  onChange={handleApInput}
                  error={apFormErrors.discount_amount}
                  disabled={apSubmitting}
                  payableAmount={
                    paymentModal.mode === 'invoice'
                      ? Number(paymentModal.outstanding ?? paymentModal.amount ?? 0)
                      : Number(paymentModal.amount ?? 0)
                  }
                />

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
                      <p className="font-medium text-gray-900">Phase {paymentModal.absolute}</p>
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
                      <span className="text-gray-800">
                        {paymentModal.mode === 'invoice' ? 'Amount due' : 'Phase Amount'}
                      </span>
                      <span className="text-gray-900">
                        {formatCurrency(
                          paymentModal.mode === 'invoice'
                            ? (paymentModal.outstanding ?? 0)
                            : (paymentModal.amount || 0),
                        )}
                      </span>
                    </div>
                    {apForm.discount_amount && parseFloat(apForm.discount_amount) > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">{PAYMENT_DISCOUNT_ADJUSTMENT_LABEL}</span>
                        <span className="text-gray-900">
                          -{formatCurrency(parseFloat(apForm.discount_amount))}
                        </span>
                      </div>
                    )}
                    {apForm.tip_amount && parseFloat(apForm.tip_amount) > 0 && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">{PAYMENT_TIP_ADJUSTMENT_LABEL}</span>
                        <span className="text-gray-900">{formatCurrency(parseFloat(apForm.tip_amount))}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-semibold border-t border-gray-200 pt-2 mt-2">
                      <span className="text-gray-800">Total Collected</span>
                      <span className="text-emerald-700">
                        {formatCurrency(
                          Math.max(
                            0,
                            (paymentModal.mode === 'invoice'
                              ? (parseFloat(paymentModal.outstanding) || 0)
                              : (parseFloat(paymentModal.amount) || 0)) -
                              (parseFloat(apForm.discount_amount) || 0),
                          ) + (parseFloat(apForm.tip_amount) || 0),
                        )}
                      </span>
                    </div>
                  </div>
                  {paymentModal.mode === 'invoice' ? (
                    <p className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-3 py-2 mt-2">
                      This records the same <strong>Full</strong> payment as on the Invoice page. When the
                      balance is settled, the invoice status becomes <strong>Paid</strong> and appears paid
                      everywhere invoices are listed.
                    </p>
                  ) : (
                    <p className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-3 py-2 mt-2">
                      This creates a <strong>Paid</strong> invoice and <strong>Completed</strong> payment. The
                      auto-generation schedule advances by one month and the student is enrolled in Phase{' '}
                      {paymentModal.absolute} class sessions.
                    </p>
                  )}
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
                  onClick={closePaymentModal}
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

      <PaymentRecordedInvoiceSummaryModal
        open={!!paymentRecordedSummary}
        invoice={paymentRecordedSummary?.invoice}
        branchName={
          paymentRecordedSummary?.invoice
            ? paymentRecordedSummary.invoice.branch_name ||
              paymentRecordedSummary.branchInfo?.nickname ||
              ''
            : ''
        }
        branchInfo={paymentRecordedSummary?.branchInfo || null}
        paymentSnapshot={paymentRecordedSummary?.paymentSnapshot}
        onClose={closePaymentRecordedInvoiceSummary}
        onPrintAcknowledgementReceipt={handlePrintPaymentRecordedAckPdf}
        printLoading={paymentRecordedPdfLoading}
        overlayClassName="fixed inset-0 z-[21000] flex items-center justify-center bg-black/40 p-3 sm:p-4"
      />
    </div>
  );
};

export default InstallmentPlanDetails;
