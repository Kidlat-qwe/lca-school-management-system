/**
 * Merchandise stock helpers for Stocks tables, enrollment, and AR flows.
 *
 * Category (merchandise_name) = RHET categoryName / CMS type.
 * Item name (item_name) = concrete RHET itemName for non-uniform / Learning Kit.
 */

import { isUniformMerchandiseName } from '../uniformMerchandise';
import { isLearningKitMerchandiseName } from '../merchandiseRequests/learningKit';
import { isUniformLikeCategory } from '../merchandiseRequests/catalogOptions';

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

/** Parse legacy remarks "itemName | sku". */
export function parseLegacyItemIdentityFromRemarks(remarks) {
  const text = String(remarks || '').trim();
  if (!text || !text.includes('|')) {
    return { itemName: '', sku: '' };
  }
  const [left, ...rest] = text.split('|');
  return {
    itemName: String(left || '').trim(),
    sku: String(rest.join('|') || '').trim(),
  };
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
  const identity =
    [itemName, sku].filter(Boolean).join(' · ') ||
    String(stock.remarks || '').trim() ||
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
  return [itemName, sku].filter(Boolean).join(' • ') || String(stock.remarks || '').trim() || 'Select item';
}
