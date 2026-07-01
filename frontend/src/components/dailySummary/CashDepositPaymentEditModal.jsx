import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../config/api';
import { formatDateManila } from '../../utils/dateUtils';
import { uploadInvoicePaymentImage } from '../../utils/uploadInvoicePaymentImage';
import { appAlert } from '../../utils/appAlert';
import { getInvoicePaymentBreakdown } from '../../utils/invoicePaymentBreakdown';
import { isPaymentMethodSelected, PAYMENT_METHOD_REQUIRED_MESSAGE } from '../../constants/paymentFormLabels';
import PaymentMethodSelect from '../common/PaymentMethodSelect';
import PaymentAttachmentViewerModal from '../paymentLogs/PaymentAttachmentViewerModal';

/**
 * Edit an existing payment line from a returned cash deposit (invoice-page style).
 * Refreshes parent totals via onSaved after PUT /payments/:id.
 */
export default function CashDepositPaymentEditModal({ payment, onClose, onSaved }) {
  const [ref, setRef] = useState('');
  const [attachment, setAttachment] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [paymentType, setPaymentType] = useState('');
  const [payableAmount, setPayableAmount] = useState('');
  const [tipAmount, setTipAmount] = useState('');
  const [discountAmount, setDiscountAmount] = useState('');
  const [remarks, setRemarks] = useState('');
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [invoiceSummary, setInvoiceSummary] = useState(null);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [attachmentViewerUrl, setAttachmentViewerUrl] = useState(null);

  const resetFromPayment = useCallback((p) => {
    if (!p) return;
    setRef(String(p.reference_number || '').trim());
    setAttachment(p.payment_attachment_url || '');
    setPaymentMethod(String(p.payment_method || '').trim());
    setIssueDate(String(p.issue_date || '').slice(0, 10));
    setPaymentType(String(p.payment_type || '').trim() || '');
    const pa = p.payable_amount;
    setPayableAmount(pa != null && pa !== '' ? String(pa) : '');
    const tip = p.tip_amount;
    setTipAmount(tip != null && tip !== '' ? Number(tip).toFixed(2) : '0.00');
    const disc = p.discount_amount;
    setDiscountAmount(disc != null && disc !== '' ? Number(disc).toFixed(2) : '');
    setRemarks(String(p.remarks || '').trim());
    setInvoiceSummary(null);
  }, []);

  useEffect(() => {
    if (!payment?.payment_id) return;
    resetFromPayment(payment);
    if (!payment.invoice_id) return;

    let cancelled = false;
    setInvoiceLoading(true);
    apiRequest(`/invoices/${payment.invoice_id}`)
      .then((res) => {
        if (!cancelled) setInvoiceSummary(res.data || null);
      })
      .catch((err) => {
        if (!cancelled) {
          setInvoiceSummary(null);
          appAlert(err.message || 'Could not load invoice details.');
        }
      })
      .finally(() => {
        if (!cancelled) setInvoiceLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [payment, resetFromPayment]);

  const getReleaseCap = () => {
    if (!invoiceSummary || !payment) return null;
    const b = getInvoicePaymentBreakdown(invoiceSummary);
    const linePayable = parseFloat(payment.payable_amount) || 0;
    const lineDisc = parseFloat(payment.discount_amount || 0) || 0;
    return Math.max(0, b.remaining + linePayable + lineDisc);
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    const releaseCap = invoiceSummary && payment ? getReleaseCap() : null;
    const discountNum = discountAmount === '' ? 0 : Math.max(0, parseFloat(discountAmount) || 0);

    if (name === 'payment_type') {
      if (value === 'Full Payment' && releaseCap != null && releaseCap > 0) {
        setPaymentType(value);
        const disc = discountAmount === '' ? 0 : Math.max(0, parseFloat(discountAmount) || 0);
        setPayableAmount(Math.max(0.01, releaseCap - disc).toFixed(2));
        return;
      }
      if (value === 'Partial Payment' && releaseCap != null && releaseCap > 0) {
        const currentAmount = parseFloat(payableAmount || 0);
        if (currentAmount >= releaseCap) {
          setPaymentType(value);
          setPayableAmount('');
          return;
        }
      }
      setPaymentType(value);
      return;
    }

    if (name === 'payable_amount') {
      if (
        paymentType === 'Partial Payment' &&
        releaseCap != null &&
        releaseCap > 0 &&
        Number(value) + discountNum >= releaseCap
      ) {
        return;
      }
      setPayableAmount(value);
      return;
    }

    if (name === 'tip_amount') {
      setTipAmount(value);
      return;
    }

    if (name === 'discount_amount') {
      const nextDisc = value === '' ? 0 : Math.max(0, parseFloat(value) || 0);
      const payableVal = parseFloat(payableAmount || 0) || 0;
      if (
        paymentType === 'Partial Payment' &&
        releaseCap != null &&
        releaseCap > 0 &&
        payableVal + nextDisc >= releaseCap
      ) {
        return;
      }
      setDiscountAmount(value);
      return;
    }

    if (name === 'remarks') {
      setRemarks(value);
    }
  };

  useEffect(() => {
    if (!invoiceSummary || !payment) return;
    if (paymentType !== 'Full Payment') return;
    const b = getInvoicePaymentBreakdown(invoiceSummary);
    const linePayable = parseFloat(payment.payable_amount) || 0;
    const lineDisc = parseFloat(payment.discount_amount || 0) || 0;
    const cap = Math.max(0, b.remaining + linePayable + lineDisc);
    const disc = discountAmount === '' ? 0 : Math.max(0, parseFloat(discountAmount) || 0);
    if (cap > 0) {
      setPayableAmount(Math.max(0.01, cap - disc).toFixed(2));
    }
  }, [invoiceSummary, payment, paymentType, discountAmount]);

  const handleAttachmentChange = async (e) => {
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
    setAttachmentUploading(true);
    try {
      const imageUrl = await uploadInvoicePaymentImage(file);
      setAttachment(imageUrl);
    } catch (err) {
      appAlert(err.message || 'Failed to upload image.');
    } finally {
      setAttachmentUploading(false);
      e.target.value = '';
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!payment?.payment_id) return;

    const remarksHadReturned = String(payment.remarks || '').includes('[Returned]');
    const refTrim = ref.trim();
    const attTrim = attachment.trim();
    const issueDateTrim = String(issueDate || '').trim();

    if (!issueDateTrim) {
      appAlert('Please select the payment date.');
      return;
    }
    if (remarksHadReturned && !String(remarks || '').includes('[Returned]')) {
      appAlert('Remarks must keep the Finance return marker ([Returned]).');
      return;
    }
    if (!String(paymentType || '').trim()) {
      appAlert('Please select a payment type.');
      return;
    }

    const payableNum = parseFloat(payableAmount);
    if (!payableAmount || Number.isNaN(payableNum) || payableNum <= 0) {
      appAlert('Payable amount must be greater than 0.');
      return;
    }

    const tipNum = tipAmount === '' ? 0 : parseFloat(tipAmount);
    if (Number.isNaN(tipNum) || tipNum < 0) {
      appAlert('Tip amount must be 0 or greater.');
      return;
    }

    const discountNum = discountAmount === '' ? 0 : parseFloat(discountAmount);
    if (discountAmount !== '' && (Number.isNaN(discountNum) || discountNum < 0)) {
      appAlert('Discount amount must be 0 or greater.');
      return;
    }
    if (discountAmount !== '' && discountNum >= payableNum) {
      appAlert('Discount amount must be less than payable amount.');
      return;
    }
    if (!refTrim) {
      appAlert('Reference number is required.');
      return;
    }
    if (!attTrim) {
      appAlert('Please keep or upload a proof-of-payment image.');
      return;
    }

    if (!isPaymentMethodSelected(paymentMethod)) {
      appAlert(PAYMENT_METHOD_REQUIRED_MESSAGE);
      return;
    }

    if (paymentType === 'Partial Payment') {
      if (!invoiceSummary) {
        appAlert(
          invoiceLoading
            ? 'Please wait for the invoice summary to finish loading.'
            : 'Invoice details are required to validate a partial payment.'
        );
        return;
      }
      const b = getInvoicePaymentBreakdown(invoiceSummary);
      const linePayable = parseFloat(payment.payable_amount) || 0;
      const lineDisc = parseFloat(payment.discount_amount || 0) || 0;
      const releaseCap = Math.max(0, b.remaining + linePayable + lineDisc);
      if (releaseCap > 0 && payableNum + discountNum >= releaseCap) {
        appAlert(
          'For partial payment, combined payable and discount must be less than the remaining invoice amount for this line.'
        );
        return;
      }
    }

    const payload = {
      reference_number: refTrim,
      attachment_url: attTrim,
      payment_method: paymentMethod.trim(),
      payment_type: paymentType.trim(),
      payable_amount: payableNum,
      tip_amount: tipNum,
      discount_amount: discountNum,
      issue_date: issueDateTrim,
    };
    if (remarks.trim()) {
      payload.remarks = remarks.trim();
    }

    setSaving(true);
    try {
      await apiRequest(`/payments/${payment.payment_id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });

      const approvalStatus = String(payment.approval_status || 'Pending').trim();
      if (approvalStatus === 'Returned') {
        await apiRequest(`/payments/${payment.payment_id}/resubmit-for-verification`, {
          method: 'PUT',
        });
      }

      appAlert('Payment updated. Deposit totals have been refreshed.');
      await onSaved?.();
      onClose?.();
    } catch (err) {
      appAlert(err.message || 'Failed to update payment.');
    } finally {
      setSaving(false);
    }
  };

  if (!payment?.payment_id || typeof document === 'undefined') return null;

  const releaseCap = getReleaseCap();
  const inv = invoiceSummary;
  const breakdown = inv ? getInvoicePaymentBreakdown(inv) : null;
  const linePayable = parseFloat(payment.payable_amount) || 0;
  const lineDiscount = parseFloat(payment.discount_amount || 0) || 0;
  const oldSettlement = linePayable + lineDiscount;
  const enteredPayable = parseFloat(payableAmount || 0) || 0;
  const enteredDiscount = discountAmount === '' ? 0 : Math.max(0, parseFloat(discountAmount) || 0);
  const newSettlement = enteredPayable + enteredDiscount;
  const releaseCapVal = breakdown ? Math.max(0, breakdown.remaining + oldSettlement) : 0;
  const settlementToApply =
    releaseCapVal > 0 ? Math.max(0, Math.min(newSettlement, releaseCapVal)) : newSettlement;
  const projectedPaid = breakdown ? breakdown.paidAmount - oldSettlement + settlementToApply : 0;
  const projectedRemaining = breakdown ? Math.max(0, breakdown.totalDue - projectedPaid) : 0;

  return (
    <>
      {createPortal(
        <div
          className="fixed inset-0 z-[10050] flex items-center justify-center backdrop-blur-sm bg-black/40 p-2 sm:p-4"
          onClick={() => !saving && onClose?.()}
        >
          <div
            className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[min(92dvh,90vh)] overflow-y-auto m-2 sm:m-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white border-b border-gray-200 px-4 sm:px-6 py-4 flex justify-between items-center z-10 gap-3">
              <div className="min-w-0">
                <h2 className="text-lg sm:text-xl font-semibold text-gray-900">Update payment</h2>
                <p className="text-sm text-gray-600 mt-1 truncate">
                  INV-{payment.invoice_id}
                  {payment.student_name ? ` · ${payment.student_name}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600 shrink-0"
                disabled={saving}
                aria-label="Close"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-5">
              {payment.return_reason ? (
                <div className="rounded-md bg-amber-50 border border-amber-100 px-3 py-2 text-sm text-amber-900">
                  <span className="font-medium">Finance note: </span>
                  {payment.return_reason}
                </div>
              ) : null}

              <div className="space-y-4">
                <div>
                  <label className="label-field text-xs">Student</label>
                  <input
                    type="text"
                    readOnly
                    value={
                      `${payment.student_name || 'N/A'}` +
                      (payment.student_email ? ` (${payment.student_email})` : '')
                    }
                    className="input-field text-sm bg-gray-50 text-gray-700 cursor-not-allowed"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="label-field text-xs">
                      Payment Type <span className="text-red-500">*</span>
                    </label>
                    <select
                      name="payment_type"
                      value={paymentType}
                      onChange={handleInputChange}
                      disabled={saving || attachmentUploading}
                      className="input-field text-sm"
                      required
                    >
                      <option value="">Select Payment Type</option>
                      <option value="Full Payment">Full Payment</option>
                      <option value="Partial Payment">Partial Payment</option>
                      <option value="Advance Payment">Advance Payment</option>
                    </select>
                  </div>
                  <div>
                    <label className="label-field text-xs">
                      Payment Method <span className="text-red-500">*</span>
                    </label>
                    <PaymentMethodSelect
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value)}
                      disabled={saving || attachmentUploading}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="label-field text-xs">
                      Payable Amount <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      name="payable_amount"
                      step="0.01"
                      min="0.01"
                      max={
                        paymentType === 'Partial Payment' && releaseCap != null && releaseCap > 0
                          ? Math.max(
                              0.01,
                              releaseCap -
                                (discountAmount === '' ? 0 : Math.max(0, parseFloat(discountAmount) || 0)) -
                                0.01
                            ).toFixed(2)
                          : undefined
                      }
                      value={payableAmount}
                      onChange={handleInputChange}
                      disabled={saving || attachmentUploading || paymentType === 'Full Payment'}
                      className={`input-field text-sm ${
                        paymentType === 'Full Payment' ? 'bg-gray-100 text-gray-600 cursor-not-allowed' : ''
                      }`}
                      required
                    />
                  </div>
                  <div>
                    <label className="label-field text-xs">Tip / adjustment</label>
                    <input
                      type="number"
                      name="tip_amount"
                      step="0.01"
                      min="0"
                      value={tipAmount}
                      onChange={handleInputChange}
                      disabled={saving || attachmentUploading}
                      className="input-field text-sm"
                    />
                  </div>
                  <div>
                    <label className="label-field text-xs">Discount / adjustment</label>
                    <input
                      type="number"
                      name="discount_amount"
                      step="0.01"
                      min="0"
                      max={
                        parseFloat(payableAmount || 0) > 0
                          ? Math.max(0, parseFloat(payableAmount || 0) - 0.01).toFixed(2)
                          : undefined
                      }
                      value={discountAmount}
                      onChange={handleInputChange}
                      disabled={saving || attachmentUploading}
                      className="input-field text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label className="label-field text-xs">
                    Issue Date <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={issueDate}
                    onChange={(e) => setIssueDate(e.target.value)}
                    disabled={saving || attachmentUploading}
                    className="input-field text-sm max-w-md"
                    required
                  />
                </div>

                <div>
                  <label className="label-field text-xs">
                    Attachment (image) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    onChange={handleAttachmentChange}
                    disabled={saving || attachmentUploading}
                    className="block w-full text-sm text-gray-600"
                  />
                  {attachmentUploading ? <p className="text-xs text-amber-600 mt-1">Uploading…</p> : null}
                  {attachment && !attachmentUploading ? (
                    <div className="mt-2">
                      <img
                        src={attachment}
                        alt="Payment attachment"
                        className="max-h-40 w-auto rounded-lg border border-gray-200 object-contain bg-gray-50"
                      />
                      <button
                        type="button"
                        onClick={() => setAttachmentViewerUrl(attachment)}
                        className="mt-2 text-sm text-primary-600 hover:underline"
                      >
                        View attached image
                      </button>
                    </div>
                  ) : null}
                </div>

                <div>
                  <label className="label-field text-xs">
                    Reference Number <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={ref}
                    onChange={(e) => setRef(e.target.value)}
                    disabled={saving || attachmentUploading}
                    className="input-field text-sm"
                  />
                </div>

                <div>
                  <label className="label-field text-xs">Remarks</label>
                  <textarea
                    name="remarks"
                    rows={2}
                    value={remarks}
                    onChange={handleInputChange}
                    disabled={saving || attachmentUploading}
                    className="input-field text-sm"
                  />
                </div>

                {invoiceLoading ? (
                  <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-600">Loading invoice summary…</div>
                ) : null}
                {!invoiceLoading && inv && breakdown ? (
                  <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                    <h3 className="text-sm font-semibold text-gray-700">Invoice Information</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-gray-600">Invoice</p>
                        <p className="font-medium text-gray-900 break-words">
                          {inv.display_description || inv.invoice_description || `INV-${inv.invoice_id}`}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600">Remaining Balance</p>
                        <p className="font-semibold text-blue-700">₱{breakdown.remaining.toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600">Issue Date</p>
                        <p className="font-medium text-gray-900">{formatDateManila(inv.issue_date)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600">Due Date</p>
                        <p className="font-medium text-gray-900">{formatDateManila(inv.due_date)}</p>
                      </div>
                    </div>
                    <div className="border-t border-gray-200 pt-3 space-y-1 text-sm">
                      <div className="flex justify-between gap-2 font-semibold">
                        <span className="text-gray-800">Total Invoice Amount</span>
                        <span>₱{breakdown.totalDue.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-gray-600">Payment to apply (this line)</span>
                        <span>₱{settlementToApply.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between gap-2 font-semibold">
                        <span className="text-gray-800">Projected Remaining</span>
                        <span className="text-blue-700">₱{projectedRemaining.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                  disabled={saving || attachmentUploading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50"
                  disabled={saving || attachmentUploading || invoiceLoading}
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      <PaymentAttachmentViewerModal
        open={Boolean(attachmentViewerUrl)}
        url={attachmentViewerUrl}
        onClose={() => setAttachmentViewerUrl(null)}
      />
    </>
  );
}
