/**
 * Branch Admin Return Stock helpers.
 * Rows come from existing branch merchandisestbl (not the RHET catalog).
 */

import { isMerchandiseTypeShellRow } from '../merchandiseRequests/createTypeCategory';
import {
  isUniformStockCategory,
  getMerchandiseStockItemName,
  getMerchandiseStockSku,
} from '../merchandiseStock';

export const STOCK_RETURN_REASON_PREFIX = '[STOCK_RETURN]';

export function isStockReturnRequest(rowOrReason) {
  const reason =
    typeof rowOrReason === 'string'
      ? rowOrReason
      : String(rowOrReason?.request_reason || '');
  return reason.trim().startsWith(STOCK_RETURN_REASON_PREFIX);
}

export function wrapStockReturnReason(userReason) {
  const extra = String(userReason || '').trim();
  return extra ? `${STOCK_RETURN_REASON_PREFIX} ${extra}` : STOCK_RETURN_REASON_PREFIX;
}

export function unwrapStockReturnReason(reason) {
  const text = String(reason || '').trim();
  if (!text.startsWith(STOCK_RETURN_REASON_PREFIX)) return text;
  return text.slice(STOCK_RETURN_REASON_PREFIX.length).trim();
}

export function createEmptyReturnLine() {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    category_name: '',
    merchandise_id: '',
    quantity: '',
  };
}

/**
 * Concrete in-stock branch rows that can be returned (type shells excluded).
 */
export function getReturnableBranchStockRows(merchandise = [], branchId) {
  if (!branchId) return [];
  return (merchandise || [])
    .filter(
      (item) =>
        Number(item?.branch_id) === Number(branchId) &&
        !isMerchandiseTypeShellRow(item)
    )
    .map((item) => {
      const quantity = Number(item.quantity) || 0;
      return {
        merchandise_id: item.merchandise_id,
        merchandise_name: String(item.merchandise_name || '').trim(),
        quantity,
        gender: item.gender || '',
        type: item.type || '',
        size: item.size || '',
        item_name: getMerchandiseStockItemName(item),
        sku: getMerchandiseStockSku(item),
      };
    })
    .filter((row) => row.merchandise_name && row.quantity > 0);
}

export function getReturnStockCategoryNames(rows = []) {
  return [...new Set((rows || []).map((row) => row.merchandise_name).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b)
  );
}

export function getReturnStockVariantsForCategory(rows = [], categoryName) {
  const name = String(categoryName || '').trim().toLowerCase();
  if (!name) return [];
  return (rows || []).filter(
    (row) => String(row.merchandise_name || '').trim().toLowerCase() === name
  );
}

export function formatReturnStockVariantLabel(row) {
  if (!row) return '';
  if (isUniformStockCategory(row.merchandise_name)) {
    return (
      [row.gender, row.type, row.size].filter(Boolean).join(' · ') || 'Unspecified piece'
    );
  }
  return (
    [row.item_name, row.sku].filter(Boolean).join(' · ') || 'Unlabeled item'
  );
}

export function findReturnableRowById(rows = [], merchandiseId) {
  const id = Number(merchandiseId);
  if (!Number.isInteger(id) || id <= 0) return null;
  return (rows || []).find((row) => Number(row.merchandise_id) === id) || null;
}

/** On-hand qty for a returnable stock row (0 if unknown). */
export function getAvailableReturnQty(row) {
  const n = Number(row?.quantity);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

/**
 * Keep Return Qty within 1..available. Empty stays empty while typing.
 * If the typed value is above on-hand, it is clamped to available.
 *
 * @param {string|number} raw
 * @param {number|null|undefined} available
 * @returns {{ value: string, error: string|null, clamped: boolean }}
 */
export function constrainReturnQuantity(raw, available) {
  const text = String(raw ?? '').trim();
  if (text === '') {
    return { value: '', error: null, clamped: false };
  }

  const qty = parseInt(text, 10);
  if (!Number.isInteger(qty) || qty < 1) {
    return {
      value: text,
      error: 'Enter a quantity of at least 1',
      clamped: false,
    };
  }

  const max = Number(available);
  if (Number.isFinite(max) && max >= 0 && qty > max) {
    return {
      value: max > 0 ? String(max) : '',
      error:
        max <= 0
          ? 'No stock available to return'
          : `Cannot return more than ${max} on hand`,
      clamped: true,
    };
  }

  return { value: String(qty), error: null, clamped: false };
}

/**
 * True when the proposed Return Qty string is empty or <= on-hand stock.
 * Used to block keystrokes / paste that would exceed available.
 */
export function isReturnQtyInputAllowed(nextRaw, available) {
  const text = String(nextRaw ?? '').trim();
  if (text === '') return true;
  if (!/^\d+$/.test(text)) return false;
  const qty = parseInt(text, 10);
  if (!Number.isInteger(qty) || qty < 0) return false;
  const max = Number(available);
  if (!Number.isFinite(max)) return true;
  if (max <= 0) return false;
  return qty <= max;
}

/** Next field value after a digit / backspace / delete, honoring selection. */
export function nextReturnQtyAfterKey(current, key, selectionStart, selectionEnd) {
  const value = String(current ?? '');
  const start = Number.isInteger(selectionStart) ? selectionStart : value.length;
  const end = Number.isInteger(selectionEnd) ? selectionEnd : start;
  if (key === 'Backspace') {
    if (start !== end) return value.slice(0, start) + value.slice(end);
    if (start <= 0) return value;
    return value.slice(0, start - 1) + value.slice(start);
  }
  if (key === 'Delete') {
    if (start !== end) return value.slice(0, start) + value.slice(end);
    return value.slice(0, start) + value.slice(start + 1);
  }
  if (/^\d$/.test(key)) {
    return value.slice(0, start) + key + value.slice(end);
  }
  return null;
}

/**
 * CMS batch body: merchandise_id + requested_quantity per row.
 */
export function buildReturnStockSubmitPayload(lines = [], reason = '') {
  return {
    request_reason: String(reason || '').trim(),
    items: (lines || [])
      .filter((line) => line.merchandise_id && line.quantity)
      .map((line) => ({
        merchandise_id: Number(line.merchandise_id),
        requested_quantity: parseInt(line.quantity, 10),
      })),
  };
}
