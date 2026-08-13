import { useCallback, useEffect, useRef, useState } from 'react';
import { appAlert } from '../../utils/appAlert';
import {
  createFiuuInvoicePayment,
  pollFiuuPaymentStatus,
  submitFiuuPaymentForm,
} from '../../utils/fiuuPayment';

const formatCurrency = (value) => {
  const n = Number(value || 0);
  return `₱${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/**
 * Staff-assisted FIUU QRPH payment panel for invoice full balance.
 */
export default function FiuuPayOnlinePanel({
  invoice,
  studentId,
  onPaid,
  onCancel,
}) {
  const [phase, setPhase] = useState('idle');
  const [orderid, setOrderid] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const pollAbort = useRef(false);

  const remaining = Number(invoice?.amount ?? 0);

  useEffect(() => {
    pollAbort.current = false;
    return () => {
      pollAbort.current = true;
    };
  }, []);

  const startPayment = useCallback(async () => {
    if (!invoice?.invoice_id || !studentId) {
      appAlert('Select a student before paying via FIUU.');
      return;
    }
    setError('');
    setPhase('creating');
    try {
      const data = await createFiuuInvoicePayment({
        invoice_id: invoice.invoice_id,
        student_id: parseInt(studentId, 10),
      });
      setOrderid(data.orderid);
      setDescription(data.description || '');
      setAmount(data.amount);
      submitFiuuPaymentForm(data.payUrl, data.formFields);
      setPhase('waiting');
      const status = await pollFiuuPaymentStatus(data.orderid);
      if (pollAbort.current) return;
      if (status.status === 'paid') {
        setPhase('paid');
        onPaid?.({ orderid: data.orderid, payment_id: status.payment_id, amount: data.amount });
      }
    } catch (err) {
      if (pollAbort.current) return;
      const msg = err?.message || 'FIUU payment could not be started.';
      setError(msg);
      setPhase('error');
      appAlert(msg);
    }
  }, [invoice?.invoice_id, studentId, onPaid]);

  return (
    <div className="space-y-4 rounded-lg border border-indigo-200 bg-indigo-50/40 p-4">
      <div>
        <h3 className="text-sm font-semibold text-indigo-900">Pay via FIUU (QRPH)</h3>
        <p className="mt-1 text-xs text-indigo-800/90">
          Opens FIUU in a new tab. Parent scans with GCash, Maya, or any QR Ph app. CMS updates
          automatically when payment succeeds.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
        <div>
          <span className="text-gray-500 text-xs">Amount due</span>
          <p className="font-semibold text-gray-900">{formatCurrency(remaining)}</p>
        </div>
        <div>
          <span className="text-gray-500 text-xs">Payment type</span>
          <p className="font-medium text-gray-900">Full Payment (FIUU)</p>
        </div>
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
          Payment received ({formatCurrency(amount || remaining)}). Invoice will refresh.
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
        {phase !== 'paid' ? (
          <button
            type="button"
            onClick={startPayment}
            disabled={phase === 'creating' || phase === 'waiting' || remaining <= 0}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {phase === 'creating'
              ? 'Starting…'
              : phase === 'waiting'
                ? 'Waiting for payment…'
                : 'Open FIUU QR payment'}
          </button>
        ) : null}
      </div>
    </div>
  );
}
