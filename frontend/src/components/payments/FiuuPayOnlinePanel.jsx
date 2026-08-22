import { useCallback, useEffect, useRef, useState } from 'react';
import { appAlert } from '../../utils/appAlert';
import {
  createFiuuInvoicePayment,
  createFiuuArPayment,
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
 */
export default function FiuuPayOnlinePanel({
  mode = 'invoice',
  invoice,
  studentId,
  amount: amountProp,
  defaultEmail = '',
  arPayloadBuilder,
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
  const pollAbort = useRef(false);

  const remaining = isAr
    ? Number(amountProp ?? 0)
    : Number(invoice?.amount ?? 0);

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
      arPayloadBuilder,
      invoice?.invoice_id,
      studentId,
      recipientEmail,
      onPaid,
      onLinkSent,
    ]
  );

  return (
    <div className="space-y-4 rounded-lg border border-indigo-200 bg-indigo-50/40 p-4">
      <div>
        <h3 className="text-sm font-semibold text-indigo-900">
          {isAr ? 'AR payment (FIUU)' : 'Pay via FIUU (QRPH)'}
        </h3>
        <p className="mt-1 text-xs text-indigo-800/90">
          Send a payment link to the guardian/client email. They open the link and pay on FIUU
          (GCash, Maya, or QR Ph). CMS stays unpaid until FIUU confirms payment.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
        <div>
          <span className="text-gray-500 text-xs">Amount due</span>
          <p className="font-semibold text-gray-900">{formatCurrency(remaining)}</p>
        </div>
        <div>
          <span className="text-gray-500 text-xs">Payment type</span>
          <p className="font-medium text-gray-900">
            {isAr ? 'Acknowledgement receipt (FIUU)' : 'Full Payment (FIUU)'}
          </p>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Guardian / client email <span className="text-red-500">*</span>
        </label>
        <input
          type="email"
          value={recipientEmail}
          onChange={(e) => setRecipientEmail(e.target.value)}
          placeholder="guardian@example.com"
          disabled={phase === 'creating' || phase === 'waiting' || phase === 'link_sent'}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
        />
        <p className="mt-1 text-xs text-gray-500">
          {isAr
            ? 'Defaults from the client email on Step 1 when provided.'
            : 'Defaults from guardian/student record when available; you can edit before sending.'}
        </p>
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
          Payment received ({formatCurrency(amount || remaining)}).{' '}
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
              disabled={phase === 'creating' || phase === 'waiting' || remaining <= 0}
              className="px-4 py-2 text-sm font-medium text-indigo-800 bg-indigo-50 border border-indigo-200 rounded-md hover:bg-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {phase === 'waiting' ? 'Waiting…' : 'Open FIUU now'}
            </button>
            <button
              type="button"
              onClick={() => createAttempt({ sendEmail: true, openNow: false })}
              disabled={
                phase === 'creating' ||
                phase === 'waiting' ||
                remaining <= 0 ||
                !(recipientEmail || '').trim()
              }
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
