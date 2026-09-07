import { useState } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../config/api';
import {
  formatMerchandiseStockItemName,
  formatMerchandiseStockSku,
} from '../../utils/merchandiseStock';

/**
 * Manual stock deduct for merchandise types not included in packages.
 * Requires remarks / reason.
 */
export default function ManualDeductStockModal({
  stock,
  open,
  onClose,
  onSuccess,
}) {
  const [quantity, setQuantity] = useState('1');
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!open || !stock) return null;

  const available = parseInt(stock.quantity, 10) || 0;
  const labelParts = [
    stock.merchandise_name,
    formatMerchandiseStockItemName(stock) !== '—'
      ? formatMerchandiseStockItemName(stock)
      : null,
    stock.gender,
    stock.type,
    stock.size && stock.size !== 'N/A' ? stock.size : null,
  ].filter(Boolean);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const qty = parseInt(quantity, 10);
    const reason = String(remarks || '').trim();
    if (!Number.isFinite(qty) || qty < 1) {
      setError('Enter a quantity of at least 1.');
      return;
    }
    if (qty > available) {
      setError(`Cannot deduct more than available stock (${available}).`);
      return;
    }
    if (reason.length < 3) {
      setError('Remarks / reason is required (at least 3 characters).');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiRequest(`/merchandise/${stock.merchandise_id}/manual-deduct`, {
        method: 'POST',
        body: JSON.stringify({ quantity: qty, remarks: reason }),
      });
      onSuccess?.(res?.data || null, qty);
      setQuantity('1');
      setRemarks('');
      onClose?.();
    } catch (err) {
      setError(
        err.response?.data?.message || err.message || 'Failed to deduct stock'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/40">
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-deduct-title"
      >
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <h2 id="manual-deduct-title" className="text-lg font-semibold text-gray-900">
            Manual deduct stock
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4 overflow-y-auto flex-1">
          {error ? (
            <div className="p-2.5 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
              {error}
            </div>
          ) : null}
          <div className="text-sm text-gray-700">
            <p className="font-medium text-gray-900">{labelParts.join(' · ')}</p>
            {formatMerchandiseStockSku(stock) !== '—' ? (
              <p className="text-xs text-gray-500 mt-0.5">
                SKU: {formatMerchandiseStockSku(stock)}
              </p>
            ) : null}
            <p className="text-xs text-gray-500 mt-1">Available: {available}</p>
          </div>
          <div>
            <label htmlFor="manual_deduct_qty" className="label-field">
              Quantity to deduct <span className="text-red-500">*</span>
            </label>
            <input
              id="manual_deduct_qty"
              type="number"
              min={1}
              max={available}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="input-field"
              required
            />
          </div>
          <div>
            <label htmlFor="manual_deduct_remarks" className="label-field">
              Remarks / reason <span className="text-red-500">*</span>
            </label>
            <textarea
              id="manual_deduct_remarks"
              rows={3}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              className="input-field"
              placeholder="Why is this stock being deducted? (required)"
              required
              minLength={3}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || available < 1}
              className="px-4 py-2 text-sm font-medium text-gray-900 bg-[#F7C844] hover:bg-[#e6b83d] rounded-lg disabled:opacity-50"
            >
              {submitting ? 'Deducting…' : 'Deduct stock'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
