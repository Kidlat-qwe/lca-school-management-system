import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { appAlert } from '../../utils/appAlert';
import {
  PAYMENT_DISCOUNT_ADJUSTMENT_HINT,
  PAYMENT_DISCOUNT_ADJUSTMENT_LABEL,
  PAYMENT_TIP_ADJUSTMENT_LABEL,
} from '../../constants/paymentFormLabels';
import {
  createFiuuInvoicePayment,
  createFiuuArPayment,
  previewFiuuPaymentEmail,
  pollFiuuPaymentStatus,
  submitFiuuPaymentForm,
} from '../../utils/fiuuPayment';

const formatCurrency = (value) => {
  const n = Number(value || 0);
  return `₱${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/**
 * Staff-assisted FIUU panel.
 * Primary: email CMS payment link to guardian (client pays; CMS stays unpaid until webhook).
 * Secondary: open FIUU QR now (counter).
 *
 * mode="invoice" | mode="ar"
 * Invoice mode: tip (+) / discount (−) adjustments (same meaning as manual Record Payment).
 * AR mode: tip/discount come from the create form above this panel.
 */
export default function FiuuPayOnlinePanel({
  mode = 'invoice',
  invoice,
  studentId,
  amount: amountProp,
  defaultEmail = '',
  branchId = null,
  arPayloadBuilder,
  /** AR Package installment-like — client decides auto-debit on pay link. */
  arInstallmentEligible = false,
  arClassLabel = '',
  onPaid,
  onLinkSent,
  onCancel,
}) {
  const isAr = mode === 'ar';
  const [phase, setPhase] = useState('idle');
  const [orderid, setOrderid] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [payLinkUrl, setPayLinkUrl] = useState('');
  const [recipientEmail, setRecipientEmail] = useState(defaultEmail || '');
  const [error, setError] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [expiryDate, setExpiryDate] = useState('');
  const [tipAmount, setTipAmount] = useState('');
  const [discountAmount, setDiscountAmount] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const pollAbort = useRef(false);

  const isInstallmentLike = isAr
    ? Boolean(arInstallmentEligible)
    : Boolean(invoice?.installmentinvoiceprofiles_id);

  const remaining = isAr
    ? Number(amountProp ?? 0)
    : Number(invoice?.amount ?? 0);

  const tipApplied = !isAr && tipAmount !== '' ? Math.max(0, parseFloat(tipAmount) || 0) : 0;
  const discountApplied =
    !isAr && discountAmount !== '' ? Math.max(0, parseFloat(discountAmount) || 0) : 0;
  const netPayable = isAr ? remaining : Math.max(0, remaining - discountApplied);
  const chargeAmount = isAr ? remaining : netPayable + tipApplied;

  const adjustmentError = useMemo(() => {
    if (isAr) return '';
    if (tipAmount !== '' && (Number.isNaN(parseFloat(tipAmount)) || parseFloat(tipAmount) < 0)) {
      return 'Tip amount must be 0 or greater';
    }
    if (
      discountAmount !== '' &&
      (Number.isNaN(parseFloat(discountAmount)) || parseFloat(discountAmount) < 0)
    ) {
      return 'Discount amount must be 0 or greater';
    }
    if (discountApplied > 0 && discountApplied >= remaining) {
      return 'Discount amount must be less than amount due';
    }
    if (remaining > 0 && chargeAmount <= 0) {
      return 'Charge amount after discount must be greater than 0';
    }
    return '';
  }, [isAr, tipAmount, discountAmount, discountApplied, remaining, chargeAmount]);

  const linkOptions = useMemo(
    () => ({
      pay_link_expires_on: expiryDate || undefined,
    }),
    [expiryDate]
  );

  useEffect(() => {
    setRecipientEmail(defaultEmail || '');
  }, [defaultEmail]);

  useEffect(() => {
    pollAbort.current = false;
    return () => {
      pollAbort.current = true;
    };
  }, []);

  const createAttempt = useCallback(
    async ({ sendEmail, openNow }) => {
      setError('');
      if (!isAr && adjustmentError) {
        appAlert(adjustmentError);
        return;
      }
      setPhase('creating');
      try {
        let data;
        if (isAr) {
          if (typeof arPayloadBuilder !== 'function') {
            appAlert('Unable to start FIUU AR payment.');
            setPhase('error');
            return;
          }
          const body = arPayloadBuilder();
          if (!body) {
            setPhase('idle');
            return;
          }
          if (sendEmail && !(recipientEmail || '').trim()) {
            appAlert('Enter the guardian/client email to send the payment link.');
            setPhase('idle');
            return;
          }
          data = await createFiuuArPayment({
            ...body,
            send_email: Boolean(sendEmail),
            recipient_email: sendEmail ? (recipientEmail || undefined) : undefined,
            ...linkOptions,
          });
        } else {
          if (!invoice?.invoice_id || !studentId) {
            appAlert('Select a student before paying via FIUU.');
            setPhase('idle');
            return;
          }
          if (sendEmail && !(recipientEmail || '').trim()) {
            appAlert('Enter the guardian/client email to send the payment link.');
            setPhase('idle');
            return;
          }
          data = await createFiuuInvoicePayment({
            invoice_id: invoice.invoice_id,
            student_id: parseInt(studentId, 10),
            send_email: Boolean(sendEmail),
            recipient_email: sendEmail ? recipientEmail.trim() : undefined,
            tip_amount: tipApplied,
            discount_amount: discountApplied,
            ...linkOptions,
          });
        }

        setOrderid(data.orderid);
        setDescription(data.description || '');
        setAmount(data.amount);
        setPayLinkUrl(data.pay_link_url || '');

        if (sendEmail) {
          const sentTo = data.email?.recipients?.join(', ') || recipientEmail;
          setPhase('link_sent');
          appAlert(
            `Payment link sent to ${sentTo || 'the client'}. The bill stays unpaid until they complete FIUU payment.`
          );
          onLinkSent?.({
            orderid: data.orderid,
            amount: data.amount,
            pay_link_url: data.pay_link_url,
            email: data.email,
            ack_receipt_id: data.ack_receipt_id,
            ar_type: data.ar_type,
          });
          return;
        }

        if (openNow) {
          submitFiuuPaymentForm(data.payUrl, data.formFields);
          setPhase('waiting');
          const status = await pollFiuuPaymentStatus(data.orderid);
          if (pollAbort.current) return;
          if (status.status === 'paid') {
            setPhase('paid');
            onPaid?.({
              orderid: data.orderid,
              payment_id: status.payment_id,
              amount: data.amount,
              ack_receipt_id: data.ack_receipt_id,
              ack_receipt_number: data.ack_receipt_number,
              ar_type: data.ar_type,
            });
          }
        }
      } catch (err) {
        if (pollAbort.current) return;
        const msg = err?.message || 'FIUU payment could not be started.';
        setError(msg);
        setPhase('error');
        appAlert(msg);
      }
    },
    [
      isAr,
      adjustmentError,
      arPayloadBuilder,
      invoice?.invoice_id,
      studentId,
      recipientEmail,
      tipApplied,
      discountApplied,
      linkOptions,
      onPaid,
      onLinkSent,
      isInstallmentLike,
    ]
  );

  const handlePreview = useCallback(async () => {
    if (!(recipientEmail || '').trim()) {
      appAlert('Enter the guardian/client email before preview.');
      return;
    }
    if (!isAr && adjustmentError) {
      appAlert(adjustmentError);
      return;
    }
    setPreviewLoading(true);
    setError('');
    try {
      let payload;
      if (isAr) {
        if (typeof arPayloadBuilder !== 'function') {
          appAlert('Unable to preview AR payment email.');
          return;
        }
        const body = arPayloadBuilder();
        if (!body) return;
        payload = {
          mode: 'ar',
          recipient_email: recipientEmail.trim(),
          amount: remaining,
          student_name: body.prospect_student_name,
          ref_label: 'AR preview',
          item_description:
            body.ar_type === 'Merchandise'
              ? 'Merchandise (acknowledgement receipt)'
              : 'Package (acknowledgement receipt)',
          branch_id: body.branch_id || branchId,
          tip_amount: body.tip_amount || 0,
          discount_amount: body.discount_amount || 0,
          ...linkOptions,
        };
      } else {
        if (!invoice?.invoice_id || !studentId) {
          appAlert('Select a student before preview.');
          return;
        }
        payload = {
          mode: 'invoice',
          invoice_id: invoice.invoice_id,
          student_id: parseInt(studentId, 10),
          recipient_email: recipientEmail.trim(),
          tip_amount: tipApplied,
          discount_amount: discountApplied,
          ...linkOptions,
        };
      }
      const data = await previewFiuuPaymentEmail(payload);
      const w = window.open('', '_blank', 'noopener,noreferrer');
      if (w) {
        w.document.open();
        w.document.write(data.html || '<p>No preview</p>');
        w.document.close();
      } else {
        appAlert('Popup blocked. Allow popups to preview the email.');
      }
    } catch (err) {
      const msg = err?.message || 'Could not preview email.';
      setError(msg);
      appAlert(msg);
    } finally {
      setPreviewLoading(false);
    }
  }, [
    isAr,
    adjustmentError,
    arPayloadBuilder,
    recipientEmail,
    remaining,
    branchId,
    invoice?.invoice_id,
    studentId,
    tipApplied,
    discountApplied,
    linkOptions,
  ]);

  const controlsDisabled =
    phase === 'creating' || phase === 'waiting' || phase === 'link_sent';
  const actionsDisabled =
    controlsDisabled || chargeAmount <= 0 || Boolean(adjustmentError);

  return (
    <div className="space-y-4 rounded-lg border border-indigo-200 bg-indigo-50/40 p-4">
      <div>
        <h3 className="text-sm font-semibold text-indigo-900">
          {isAr ? 'AR payment (FIUU)' : 'Pay via FIUU (QRPH)'}
        </h3>
        <p className="mt-1 text-xs text-indigo-800/90">
          Send a payment link to the guardian/client email. They open the link and pay on FIUU
          (GCash, Maya, or QR Ph). CMS stays unpaid until FIUU confirms payment.
          {isInstallmentLike
            ? ' Installment uses Card payment — on FIUU the client can optionally save their card for future invoices for this class only.'
            : ''}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
        <div>
          <span className="text-gray-500 text-xs">{isAr ? 'Amount to charge' : 'Amount due'}</span>
          <p className="font-semibold text-gray-900">{formatCurrency(remaining)}</p>
        </div>
        <div>
          <span className="text-gray-500 text-xs">Payment type</span>
          <p className="font-medium text-gray-900">
            {isAr
              ? 'Acknowledgement receipt (FIUU)'
              : isInstallmentLike
                ? 'Installment (FIUU)'
                : 'Full Payment (FIUU)'}
          </p>
        </div>
      </div>

      {!isAr ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              {PAYMENT_TIP_ADJUSTMENT_LABEL}
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={tipAmount}
              onChange={(e) => setTipAmount(e.target.value)}
              placeholder="0.00"
              disabled={controlsDisabled}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              {PAYMENT_DISCOUNT_ADJUSTMENT_LABEL}
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              max={remaining > 0 ? Math.max(0, remaining - 0.01).toFixed(2) : undefined}
              value={discountAmount}
              onChange={(e) => setDiscountAmount(e.target.value)}
              placeholder="0.00"
              disabled={controlsDisabled}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
            <p className="mt-1 text-xs text-gray-500">{PAYMENT_DISCOUNT_ADJUSTMENT_HINT}</p>
          </div>
          <div className="sm:col-span-2 rounded-md bg-white border border-indigo-100 px-3 py-2 text-sm">
            <div className="flex flex-wrap justify-between gap-2">
              <span className="text-gray-600">Charge on FIUU</span>
              <span className="font-semibold text-gray-900">{formatCurrency(chargeAmount)}</span>
            </div>
            {(tipApplied > 0 || discountApplied > 0) && (
              <p className="mt-1 text-xs text-gray-500">
                {formatCurrency(remaining)}
                {discountApplied > 0 ? ` − discount ${formatCurrency(discountApplied)}` : ''}
                {tipApplied > 0 ? ` + tip ${formatCurrency(tipApplied)}` : ''}
              </p>
            )}
          </div>
          {adjustmentError ? (
            <p className="sm:col-span-2 text-xs text-red-600">{adjustmentError}</p>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-gray-600">
          Tip and discount for AR are set in the fields above (before Pay via FIUU). Amount to charge
          already includes those adjustments.
        </p>
      )}

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Guardian / client email <span className="text-red-500">*</span>
        </label>
        <input
          type="email"
          value={recipientEmail}
          onChange={(e) => setRecipientEmail(e.target.value)}
          placeholder="guardian@example.com"
          disabled={controlsDisabled}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
        />
        <p className="mt-1 text-xs text-gray-500">
          {isAr
            ? 'Defaults from the client email on Step 1 when provided.'
            : 'Defaults from guardian/student record when available; you can edit before sending.'}
        </p>
      </div>

      <div className="rounded-md border border-slate-200 bg-slate-50 overflow-hidden">
        <button
          type="button"
          onClick={() => setAdvancedOpen((o) => !o)}
          className="w-full flex items-center justify-between px-3 py-2.5 text-left text-sm font-medium text-sky-800 hover:bg-slate-100"
          disabled={controlsDisabled}
        >
          <span>Advanced settings</span>
          <span className="text-slate-500" aria-hidden>
            {advancedOpen ? '∧' : '∨'}
          </span>
        </button>
        {advancedOpen ? (
          <div className="border-t border-slate-200 bg-white px-3 py-3 space-y-3">
            <div>
              <label className="block text-xs font-semibold text-gray-800 mb-1">Expiry Date</label>
              <input
                type="date"
                value={expiryDate}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setExpiryDate(e.target.value)}
                disabled={controlsDisabled}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-gray-500">
                Optional. Leave blank to show N/A in the email (link does not auto-expire). If set,
                the link stops working after this date.
              </p>
            </div>
            <button
              type="button"
              onClick={handlePreview}
              disabled={actionsDisabled || previewLoading}
              className="w-full rounded-md bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {previewLoading ? 'Preparing preview…' : 'Preview'}
            </button>
          </div>
        ) : null}
      </div>

      {orderid ? (
        <div className="rounded-md bg-white px-3 py-2 text-xs text-gray-600 border border-gray-200">
          <div>
            <span className="font-medium text-gray-700">Order ID:</span> {orderid}
          </div>
          {description ? (
            <div className="mt-1 truncate" title={description}>
              <span className="font-medium text-gray-700">FIUU description:</span> {description}
            </div>
          ) : null}
          {payLinkUrl ? (
            <div className="mt-1 break-all">
              <span className="font-medium text-gray-700">Pay link:</span>{' '}
              <a href={payLinkUrl} className="text-indigo-600 hover:underline" target="_blank" rel="noreferrer">
                {payLinkUrl}
              </a>
            </div>
          ) : null}
        </div>
      ) : null}

      {phase === 'link_sent' ? (
        <div className="text-sm text-indigo-900 bg-indigo-50 border border-indigo-200 rounded-md px-3 py-2">
          Link sent. Status remains unpaid until the client completes payment. You can close this
          window and refresh the list later.
        </div>
      ) : null}

      {phase === 'waiting' ? (
        <div className="flex items-center gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          <svg className="animate-spin h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Waiting for FIUU payment… keep this window open.
        </div>
      ) : null}

      {phase === 'paid' ? (
        <div className="text-sm text-green-800 bg-green-50 border border-green-200 rounded-md px-3 py-2">
          Payment received ({formatCurrency(amount || chargeAmount)}).{' '}
          {isAr ? 'Acknowledgement receipt will refresh.' : 'Invoice will refresh.'}
        </div>
      ) : null}

      {error ? <p className="text-xs text-red-600">{error}</p> : null}

      <div className="flex flex-wrap gap-2 justify-end pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
        >
          Back to manual
        </button>
        {phase !== 'paid' && phase !== 'link_sent' ? (
          <>
            <button
              type="button"
              onClick={() => createAttempt({ sendEmail: false, openNow: true })}
              disabled={actionsDisabled || phase === 'waiting'}
              className="px-4 py-2 text-sm font-medium text-indigo-800 bg-indigo-50 border border-indigo-200 rounded-md hover:bg-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {phase === 'waiting' ? 'Waiting…' : 'Open FIUU now'}
            </button>
            <button
              type="button"
              onClick={() => createAttempt({ sendEmail: true, openNow: false })}
              disabled={actionsDisabled || !(recipientEmail || '').trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {phase === 'creating' ? 'Sending…' : 'Send payment link'}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
