import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  createEmptyReturnLine,
  getReturnableBranchStockRows,
  getReturnStockCategoryNames,
  getReturnStockVariantsForCategory,
  formatReturnStockVariantLabel,
  findReturnableRowById,
  getAvailableReturnQty,
  constrainReturnQuantity,
  isReturnQtyInputAllowed,
  nextReturnQtyAfterKey,
  buildReturnStockSubmitPayload,
} from '../../utils/merchandiseReturns';
import {
  filterUnselectedCartCategories,
  hasUnusedCartCategory,
  isCategoryTakenOnOtherRow,
} from '../../utils/merchandiseRequests/uniqueCartCategory';

function validateReturnLines(lines, returnableRows, reason) {
  const errors = {};
  const lineErrors = {};
  const usedIds = new Set();
  const usedCategories = new Set();

  if (!String(reason || '').trim()) {
    errors.request_reason = 'Return reason is required';
  } else if (String(reason).trim().length < 5) {
    errors.request_reason = 'Return reason must be at least 5 characters';
  }

  if (!lines.length) {
    errors.bulk = 'Add at least one row to return.';
  }

  lines.forEach((line, index) => {
    const err = {};
    if (!line.category_name) {
      err.category_name = 'Select a category';
    } else {
      const catKey = String(line.category_name).trim().toLowerCase();
      if (usedCategories.has(catKey)) {
        err.category_name = 'This category is already selected on another row';
      } else {
        usedCategories.add(catKey);
      }
    }
    const merchandiseId = Number(line.merchandise_id);
    if (!Number.isInteger(merchandiseId) || merchandiseId <= 0) {
      err.merchandise_id = 'Select the variant to return';
    } else if (usedIds.has(merchandiseId)) {
      err.merchandise_id = 'This variant is already on another row';
    } else {
      usedIds.add(merchandiseId);
    }

    const stock = findReturnableRowById(returnableRows, merchandiseId);
    const available = stock ? getAvailableReturnQty(stock) : null;
    const qtyCheck = constrainReturnQuantity(line.quantity, available);
    if (!String(line.quantity || '').trim()) {
      err.quantity = 'Enter a quantity of at least 1';
    } else if (qtyCheck.error) {
      err.quantity = qtyCheck.error;
    } else if (stock && parseInt(line.quantity, 10) > available) {
      err.quantity = `Cannot return more than ${available} on hand`;
    }

    if (Object.keys(err).length) {
      lineErrors[line.id] = err;
      errors.bulk = errors.bulk || `Fix row ${index + 1} before submitting.`;
    }
  });

  return { errors, lineErrors };
}

/**
 * Branch Admin Return Stock modal — same layout as Request Stock,
 * but categories/variants come from existing branch stock.
 */
export default function ReturnStockModal({
  open,
  onClose,
  merchandise = [],
  branchId,
  returnedByDisplay = '',
  returnDateDisplay = '',
  submitting = false,
  onSubmit,
}) {
  const [lines, setLines] = useState([createEmptyReturnLine()]);
  const [reason, setReason] = useState('');
  const [formErrors, setFormErrors] = useState({});
  const [lineErrors, setLineErrors] = useState({});

  const returnableRows = useMemo(
    () => getReturnableBranchStockRows(merchandise, branchId),
    [merchandise, branchId]
  );
  const categoryNames = useMemo(
    () => getReturnStockCategoryNames(returnableRows),
    [returnableRows]
  );

  useEffect(() => {
    if (!open) return;
    setLines([createEmptyReturnLine()]);
    setReason('');
    setFormErrors({});
    setLineErrors({});
  }, [open]);

  if (!open) return null;

  const addLine = () => {
    setLines((prev) => [...prev, createEmptyReturnLine()]);
  };

  const removeLine = (lineId) => {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((line) => line.id !== lineId)));
    setLineErrors((prev) => {
      const next = { ...prev };
      delete next[lineId];
      return next;
    });
  };

  const updateLine = (lineId, field, value) => {
    let quantityError = null;

    setLines((prev) =>
      prev.map((line) => {
        if (line.id !== lineId) return line;
        const next = { ...line, [field]: value };
        if (field === 'category_name') {
          if (value && isCategoryTakenOnOtherRow(prev, value, lineId)) {
            return line;
          }
          next.merchandise_id = '';
          next.quantity = '';
          const variants = getReturnStockVariantsForCategory(returnableRows, value);
          if (variants.length === 1) {
            next.merchandise_id = String(variants[0].merchandise_id);
          }
        }
        if (field === 'merchandise_id' || field === 'category_name') {
          const stock = findReturnableRowById(
            returnableRows,
            next.merchandise_id || (field === 'merchandise_id' ? value : '')
          );
          if (stock && next.quantity) {
            const constrained = constrainReturnQuantity(
              next.quantity,
              getAvailableReturnQty(stock)
            );
            next.quantity = constrained.value;
          }
        }
        if (field === 'quantity') {
          const stock = findReturnableRowById(returnableRows, next.merchandise_id);
          const available = stock ? getAvailableReturnQty(stock) : null;
          if (!stock || !isReturnQtyInputAllowed(value, available)) {
            next.quantity = line.quantity;
          } else {
            next.quantity = value;
          }
        }
        return next;
      })
    );

    setLineErrors((prev) => {
      const next = { ...(prev[lineId] || {}) };
      if (field !== 'quantity') delete next[field];
      if (field === 'category_name') {
        delete next.merchandise_id;
        delete next.quantity;
      }
      if (field === 'merchandise_id') delete next.quantity;
      if (quantityError) next.quantity = quantityError;
      else delete next.quantity;
      if (!Object.keys(next).length) {
        const rest = { ...prev };
        delete rest[lineId];
        return rest;
      }
      return { ...prev, [lineId]: next };
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const { errors, lineErrors: nextLineErrors } = validateReturnLines(
      lines,
      returnableRows,
      reason
    );
    setFormErrors(errors);
    setLineErrors(nextLineErrors);
    if (Object.keys(nextLineErrors).length || errors.request_reason || errors.bulk) {
      return;
    }
    const payload = buildReturnStockSubmitPayload(lines, reason);
    await onSubmit?.(payload);
  };

  return createPortal(
    <div
      className="fixed inset-0 backdrop-blur-sm bg-black/5 flex items-center justify-center z-[9999] p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] min-h-0 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-gray-200 flex-shrink-0 bg-white rounded-t-lg gap-3">
          <div className="min-w-0">
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Return Merchandise Stock</h2>
            <p className="text-sm text-gray-500 mt-1">
              Choose an existing branch category and variant, then how many units to return to RHET Inventory.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0"
            aria-label="Close"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="p-4 sm:p-6 flex flex-col flex-1 min-h-0 overflow-hidden gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 flex-shrink-0">
              <div>
                <label className="label-field">Return Date</label>
                <input
                  type="text"
                  value={returnDateDisplay}
                  className="input-field bg-gray-50 cursor-not-allowed"
                  readOnly
                />
              </div>
              <div>
                <label className="label-field">Returned By</label>
                <input
                  type="text"
                  value={returnedByDisplay}
                  className="input-field bg-gray-50 cursor-not-allowed"
                  readOnly
                />
              </div>
            </div>

            {categoryNames.length === 0 && (
              <div className="flex-shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                No returnable stock on this branch yet. Request or add stock first, then return it here.
              </div>
            )}

            <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
              <div className="flex items-center justify-between gap-3 mb-2 flex-shrink-0">
                <label className="label-field mb-0">Items to return</label>
                <button
                  type="button"
                  onClick={addLine}
                  disabled={
                    categoryNames.length === 0 || !hasUnusedCartCategory(categoryNames, lines)
                  }
                  className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-800 bg-[#F7C844] hover:bg-[#f0c033] rounded-lg transition-colors disabled:opacity-50"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add row
                </button>
              </div>
              {formErrors.bulk && (
                <p className="mb-2 text-sm text-red-600 flex-shrink-0">{formErrors.bulk}</p>
              )}
              <div
                className="rounded-lg border border-gray-200 flex-1 min-h-[140px] max-h-[min(48vh,420px)] overflow-x-auto overflow-y-auto"
                style={{
                  scrollbarWidth: 'thin',
                  scrollbarColor: '#cbd5e0 #f7fafc',
                  WebkitOverflowScrolling: 'touch',
                }}
              >
                <table className="divide-y divide-gray-200" style={{ width: '100%', minWidth: '760px' }}>
                  <thead className="bg-gray-50 sticky top-0 z-10">
                    <tr>
                      <th className="px-2 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">
                        Category
                      </th>
                      <th className="px-2 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">
                        Variant / Item
                      </th>
                      <th
                        className="px-2 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider bg-gray-50"
                        style={{ width: '110px' }}
                      >
                        Available
                      </th>
                      <th
                        className="px-2 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider bg-gray-50"
                        style={{ width: '110px' }}
                      >
                        Return qty
                      </th>
                      <th className="px-1 py-2 bg-gray-50" style={{ width: '40px' }}>
                        {' '}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-100">
                    {lines.map((line, rowIndex) => {
                      const lineErr = lineErrors[line.id] || {};
                      const variants = getReturnStockVariantsForCategory(
                        returnableRows,
                        line.category_name
                      );
                      const selected = findReturnableRowById(returnableRows, line.merchandise_id);
                      const availableQty = selected ? getAvailableReturnQty(selected) : 0;
                      const categoryOptions = filterUnselectedCartCategories(
                        categoryNames,
                        lines,
                        line.id
                      );
                      return (
                        <tr key={line.id}>
                          <td className="px-2 py-2 align-top">
                            <select
                              value={line.category_name}
                              onChange={(e) => updateLine(line.id, 'category_name', e.target.value)}
                              className={`input-field text-sm py-1.5 w-full max-w-full min-w-0 ${
                                lineErr.category_name ? 'border-red-500' : ''
                              }`}
                              aria-label={`Category row ${rowIndex + 1}`}
                              disabled={categoryNames.length === 0}
                            >
                              <option value="">-- Select category --</option>
                              {categoryOptions.map((name) => (
                                <option key={name} value={name}>
                                  {name}
                                </option>
                              ))}
                            </select>
                            {lineErr.category_name && (
                              <p className="mt-1 text-[11px] text-red-600">{lineErr.category_name}</p>
                            )}
                          </td>
                          <td className="px-2 py-2 align-top">
                            <select
                              value={line.merchandise_id}
                              onChange={(e) => updateLine(line.id, 'merchandise_id', e.target.value)}
                              className={`input-field text-sm py-1.5 w-full max-w-full min-w-0 ${
                                lineErr.merchandise_id ? 'border-red-500' : ''
                              }`}
                              aria-label={`Variant row ${rowIndex + 1}`}
                              disabled={!line.category_name}
                            >
                              <option value="">-- Select variant --</option>
                              {variants.map((row) => (
                                <option key={row.merchandise_id} value={String(row.merchandise_id)}>
                                  {formatReturnStockVariantLabel(row)} ({row.quantity} on hand)
                                </option>
                              ))}
                            </select>
                            {lineErr.merchandise_id && (
                              <p className="mt-1 text-[11px] text-red-600">{lineErr.merchandise_id}</p>
                            )}
                            {line.category_name && variants.length === 0 && (
                              <p className="mt-1 text-[11px] text-amber-700">
                                No in-stock variants for this category.
                              </p>
                            )}
                          </td>
                          <td className="px-2 py-2 align-top">
                            <input
                              type="text"
                              value={selected ? String(selected.quantity) : ''}
                              className="input-field text-sm py-1.5 w-full bg-gray-50 cursor-not-allowed"
                              readOnly
                              aria-label={`Available quantity row ${rowIndex + 1}`}
                            />
                          </td>
                          <td className="px-2 py-2 align-top">
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              autoComplete="off"
                              disabled={!selected}
                              value={line.quantity}
                              onChange={(e) => {
                                const next = e.target.value;
                                if (next !== '' && !isReturnQtyInputAllowed(next, availableQty)) {
                                  return;
                                }
                                updateLine(line.id, 'quantity', next);
                              }}
                              onPaste={(e) => {
                                const pasted = e.clipboardData?.getData('text') || '';
                                const start = e.target.selectionStart ?? String(line.quantity || '').length;
                                const end = e.target.selectionEnd ?? start;
                                const next =
                                  String(line.quantity || '').slice(0, start) +
                                  pasted +
                                  String(line.quantity || '').slice(end);
                                if (!isReturnQtyInputAllowed(next, availableQty)) {
                                  e.preventDefault();
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.ctrlKey || e.metaKey || e.altKey) return;
                                if (['Tab', 'Escape', 'Enter', 'Home', 'End', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                                  return;
                                }
                                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                                  e.preventDefault();
                                  return;
                                }
                                if (e.key.length === 1 && !/^\d$/.test(e.key)) {
                                  e.preventDefault();
                                  return;
                                }
                                const next = nextReturnQtyAfterKey(
                                  e.target.value,
                                  e.key,
                                  e.target.selectionStart,
                                  e.target.selectionEnd
                                );
                                if (next != null && !isReturnQtyInputAllowed(next, availableQty)) {
                                  e.preventDefault();
                                }
                              }}
                              className={`input-field text-sm py-1.5 w-full ${
                                lineErr.quantity ? 'border-red-500' : ''
                              } ${!selected ? 'bg-gray-50 cursor-not-allowed' : ''}`}
                              placeholder={selected ? `1–${availableQty}` : '0'}
                              aria-label={`Return quantity row ${rowIndex + 1}`}
                            />
                            {lineErr.quantity && (
                              <p className="mt-1 text-[11px] text-red-600">{lineErr.quantity}</p>
                            )}
                          </td>
                          <td className="px-1 py-2 align-top text-right">
                            <button
                              type="button"
                              onClick={() => removeLine(line.id)}
                              disabled={lines.length <= 1}
                              className="p-1.5 text-gray-400 hover:text-red-600 disabled:opacity-30 disabled:hover:text-gray-400 rounded transition-colors"
                              title="Remove row"
                              aria-label={`Remove row ${rowIndex + 1}`}
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M6 18L18 6M6 6l12 12"
                                />
                              </svg>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex-shrink-0">
              <label htmlFor="return_reason_bulk" className="label-field">
                Reason for Return <span className="text-red-500">*</span>
              </label>
              <textarea
                id="return_reason_bulk"
                name="request_reason"
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  if (formErrors.request_reason) {
                    setFormErrors((prev) => {
                      const next = { ...prev };
                      delete next.request_reason;
                      return next;
                    });
                  }
                }}
                className={`input-field min-h-[72px] resize-y ${
                  formErrors.request_reason ? 'border-red-500' : ''
                }`}
                required
                placeholder="Please explain why these items are being returned (min. 5 characters)..."
                rows={3}
              />
              {formErrors.request_reason && (
                <p className="mt-1 text-sm text-red-600">{formErrors.request_reason}</p>
              )}
              <p className="mt-1 text-xs text-gray-500">
                Applied to every row. Only existing branch categories with on-hand quantity can be returned.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 sm:gap-3 p-4 sm:p-6 border-t border-gray-200 flex-shrink-0 bg-white rounded-b-lg">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium text-white bg-orange-600 hover:bg-orange-700 rounded-lg transition-colors disabled:opacity-50"
              disabled={
                submitting ||
                categoryNames.length === 0 ||
                lines.some((line) => {
                  const stock = findReturnableRowById(returnableRows, line.merchandise_id);
                  if (!stock) return false;
                  const qty = parseInt(line.quantity, 10);
                  return Number.isInteger(qty) && qty > getAvailableReturnQty(stock);
                })
              }
            >
              {submitting ? 'Submitting...' : 'Submit Return'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
