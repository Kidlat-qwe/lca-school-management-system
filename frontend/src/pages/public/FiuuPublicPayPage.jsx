import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import API_BASE_URL from '../../config/api';
import { submitFiuuPaymentForm } from '../../utils/fiuuPayment';

const formatCurrency = (value) => {
  const n = Number(value || 0);
  return `₱${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/**
 * Public page opened from FIUU payment-link email.
 * Loads payUrl + formFields by token and auto-POSTs to FIUU hosted page.
 */
export default function FiuuPublicPayPage() {
  const { token } = useParams();
  const [phase, setPhase] = useState('loading');
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState('');
  const submitted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!token) {
        setError('Invalid payment link.');
        setPhase('error');
        return;
      }
      try {
        const res = await fetch(
          `${API_BASE_URL}/payments/fiuu/public/${encodeURIComponent(token)}`
        );
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(json.message || 'Payment link not found or expired.');
        }
        if (cancelled) return;
        const data = json.data;
        setPayload(data);
        if (data.status === 'paid') {
          setPhase('paid');
          return;
        }
        if (data.status === 'expired' || data.status === 'failed' || data.status === 'cancelled') {
          setPhase(data.status);
          return;
        }
        if (!data.payUrl || !data.formFields) {
          setError('Payment session is not available.');
          setPhase('error');
          return;
        }
        setPhase('redirecting');
        if (!submitted.current) {
          submitted.current = true;
          // Allow paint of redirect message, then POST to FIUU.
          setTimeout(() => {
            submitFiuuPaymentForm(data.payUrl, data.formFields);
          }, 400);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err.message || 'Could not open payment link.');
        setPhase('error');
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-indigo-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-xl border border-indigo-100 bg-white shadow-sm p-6 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">
          Little Champion Academy
        </p>
        <h1 className="mt-2 text-xl font-semibold text-gray-900">Secure payment</h1>

        {phase === 'loading' ? (
          <p className="mt-4 text-sm text-gray-600">Preparing your FIUU payment…</p>
        ) : null}

        {phase === 'redirecting' && payload ? (
          <div className="mt-4 space-y-3 text-sm text-gray-700">
            <p>Opening FIUU payment page…</p>
            <p className="font-semibold text-gray-900">{formatCurrency(payload.amount)}</p>
            {payload.description ? (
              <p className="text-xs text-gray-500 break-words">{payload.description}</p>
            ) : null}
            <p className="text-xs text-amber-700">
              If a new tab did not open, check your browser popup blocker, then refresh this page.
            </p>
            <button
              type="button"
              className="mt-2 w-full rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700"
              onClick={() => submitFiuuPaymentForm(payload.payUrl, payload.formFields)}
            >
              Continue to FIUU
            </button>
          </div>
        ) : null}

        {phase === 'paid' ? (
          <p className="mt-4 text-sm text-green-800 bg-green-50 border border-green-200 rounded-md px-3 py-2">
            This payment was already received. Thank you.
          </p>
        ) : null}

        {phase === 'expired' ? (
          <p className="mt-4 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            This payment link has expired. Please contact the school for a new link.
          </p>
        ) : null}

        {phase === 'failed' || phase === 'cancelled' ? (
          <p className="mt-4 text-sm text-red-800 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            This payment attempt was cancelled or failed. Contact the school for a new link.
          </p>
        ) : null}

        {phase === 'error' ? (
          <p className="mt-4 text-sm text-red-700">{error || 'Something went wrong.'}</p>
        ) : null}
      </div>
    </div>
  );
}
