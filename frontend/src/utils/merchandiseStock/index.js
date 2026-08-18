/**
 * Merchandise stock helpers for Stocks tables, enrollment, and AR flows.
 *
 * Category (merchandise_name) = RHET categoryName / CMS type.
 * Item name (item_name) = concrete RHET itemName for non-uniform / Learning Kit.
 */

import { isUniformMerchandiseName } from '../uniformMerchandise';
import { isLearningKitMerchandiseName } from '../merchandiseRequests/learningKit';
import { isUniformLikeCategory } from '../merchandiseRequests/catalogOptions';
import { isMerchandiseTypeShellRow } from '../merchandiseRequests/createTypeCategory';

export function parseMerchandiseQuantity(item) {
  if (!item || item.quantity == null || item.quantity === '') return null;
  const n = parseInt(item.quantity, 10);
  return Number.isFinite(n) ? n : null;
}

export function formatStockCountLabel(qty) {
  if (qty === null || qty === undefined) return null;
  const n = Number(qty);
  if (!Number.isFinite(n)) return null;
  return `${n} in stock`;
}

/** Sum real stock rows for a merchandise type (excludes type-shell placeholders). */
export function sumMerchandiseTypeStock(merchandiseList, typeName) {
  const name = String(typeName || '').trim().toLowerCase();
  if (!name) return null;
  let total = 0;
  let tracked = false;
  let foundType = false;
  for (const item of merchandiseList || []) {
    if (String(item.merchandise_name || '').trim().toLowerCase() !== name) continue;
    foundType = true;
    if (isMerchandiseTypeShellRow(item)) continue;
    const qty = parseMerchandiseQuantity(item);
    if (qty === null) continue;
    tracked = true;
    total += qty;
  }
  if (!foundType) return null;
  return tracked ? total : 0;
}

export function lookupMerchandiseQuantity(merchandiseList, merchandiseId) {
  if (merchandiseId == null || merchandiseId === '') return null;
  const item = (merchandiseList || []).find(
    (m) => String(m.merchandise_id) === String(merchandiseId)
  );
  return parseMerchandiseQuantity(item);
}

/** True when quantity is untracked or strictly greater than zero. */
export function merchandiseHasAvailableStock(item) {
  if (!item) return false;
  if (item.quantity === null || item.quantity === undefined) return true;
  return (parseInt(item.quantity, 10) || 0) > 0;
}

/** Prefer the first in-stock variant; fall back to the first row when all are out of stock. */
export function pickFirstInStockMerchandiseItem(items = []) {
  if (!items?.length) return null;
  const inStock = items.filter(merchandiseHasAvailableStock);
  return inStock[0] || items[0];
}

/** True when remarks are ops audit notes, not RHET item identity. */
export function isOpsAuditRemarks(remarks) {
  const text = String(remarks || '').trim();
  if (!text) return false;
  return (
    /^Ops\s+(seed|repair)\b/i.test(text) ||
    /(?:^|\|\s*)Ops\s+(seed|repair)\b/i.test(text)
  );
}

/** True for pre-migration rows: compact slug + SKU, not free-text ops notes. */
function looksLikeLegacyItemIdentityPair(itemName, sku) {
  if (!itemName || !sku) return false;
  if (isOpsAuditRemarks(itemName) || isOpsAuditRemarks(sku)) return false;
  if (itemName.length > 80 || sku.length > 80) return false;
  if (itemName.includes('—') || sku.includes('—')) return false;
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(itemName)) return false;
  if (!/^[A-Z0-9][A-Z0-9-]*$/i.test(sku)) return false;
  return true;
}

/** Parse legacy remarks "itemName | sku" (pre item_name/sku columns). */
export function parseLegacyItemIdentityFromRemarks(remarks) {
  const text = String(remarks || '').trim();
  if (!text || !text.includes('|') || isOpsAuditRemarks(text)) {
    return { itemName: '', sku: '' };
  }
  const [left, ...rest] = text.split('|');
  const itemName = String(left || '').trim();
  const sku = String(rest.join('|') || '').trim();
  if (!looksLikeLegacyItemIdentityPair(itemName, sku)) {
    return { itemName: '', sku: '' };
  }
  return { itemName, sku };
}

export function getMerchandiseStockItemName(stock) {
  const direct = String(stock?.item_name || '').trim();
  if (direct) return direct;
  return parseLegacyItemIdentityFromRemarks(stock?.remarks).itemName;
}

export function getMerchandiseStockSku(stock) {
  const direct = String(stock?.sku || '').trim();
  if (direct) return direct;
  return parseLegacyItemIdentityFromRemarks(stock?.remarks).sku;
}

/**
 * Uniform-like stock tables show Gender / Type / Size.
 * Non-uniform + Learning Kit show Item name (+ optional SKU).
 */
export function isUniformStockCategory(categoryName) {
  if (isLearningKitMerchandiseName(categoryName)) return false;
  return (
    isUniformMerchandiseName(categoryName) || isUniformLikeCategory(categoryName)
  );
}

export function isItemNamedStockCategory(categoryName) {
  return !isUniformStockCategory(categoryName);
}

/** Display label for Item name column; empty → em dash. */
export function formatMerchandiseStockItemName(stock) {
  const name = getMerchandiseStockItemName(stock);
  return name || '—';
}

export function formatMerchandiseStockSku(stock) {
  const sku = getMerchandiseStockSku(stock);
  return sku || '—';
}

/**
 * Label for AR / enrollment variant dropdowns.
 * Uniforms: Size · Gender · Type (+ price).
 * Non-uniform: Item name · SKU (+ price) — never "One Type".
 */
export function formatMerchandiseVariantOptionLabel(stock, { includePrice = true } = {}) {
  if (!stock) return '';
  const pricePart = includePrice
    ? `₱${Number(stock.price || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
    : null;

  if (isUniformStockCategory(stock.merchandise_name)) {
    const parts = [
      stock.size || 'One Size',
      stock.gender || null,
      stock.type || null,
      pricePart,
    ].filter(Boolean);
    return parts.join(' - ');
  }

  const itemName = getMerchandiseStockItemName(stock);
  const sku = getMerchandiseStockSku(stock);
  const remarksText = String(stock.remarks || '').trim();
  const identity =
    [itemName, sku].filter(Boolean).join(' · ') ||
    (remarksText && !isOpsAuditRemarks(remarksText) ? remarksText : '') ||
    'Unlabeled item';
  return [identity, pricePart].filter(Boolean).join(' - ');
}

/** Compact identity for selected-row subtitle (no price). */
export function formatMerchandiseVariantSubtitle(stock) {
  if (!stock) return '';
  if (isUniformStockCategory(stock.merchandise_name)) {
    return [stock.size, stock.gender, stock.type].filter(Boolean).join(' • ') || 'Select size';
  }
  const itemName = getMerchandiseStockItemName(stock);
  const sku = getMerchandiseStockSku(stock);
  const remarksText = String(stock.remarks || '').trim();
  return (
    [itemName, sku].filter(Boolean).join(' • ') ||
    (remarksText && !isOpsAuditRemarks(remarksText) ? remarksText : '') ||
    'Select item'
  );
}
