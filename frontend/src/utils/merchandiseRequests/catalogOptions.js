/**
 * RHET Inventory catalog helpers for Merchandise → Request Stock.
 *
 * Source of truth is GET /merchandise-requests/inventory/catalog (CMS proxy).
 * Never invent category names — only use exact RHET categoryName / itemName / sku
 * and uniform gender · type · size values that exist on catalog items.
 */

import { isLearningKitMerchandiseName } from './learningKit';

const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'];

/**
 * Uniform-like RHET categories: School Uniform, PE Uniform, LCA T-Shirt,
 * and any name ending with " uniform".
 */
export function isUniformLikeCategory(categoryName) {
  if (!categoryName) return false;
  const name = String(categoryName).trim().toLowerCase();
  if (isLearningKitMerchandiseName(name)) return false;
  if (name === 'school uniform' || name === 'pe uniform') return true;
  if (name === 'lca t-shirt' || name === 'lca tshirt' || name === 'lca shirt') return true;
  return name.endsWith(' uniform');
}

/** Parse catalog item.variation "Male · Polo · S" into structured fields. */
export function parseVariation(variation) {
  const text = String(variation || '').trim();
  if (!text) return { gender: '', type: '', size: '' };
  const parts = text.split(/\s*[·•|]\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3) {
    return { gender: parts[0], type: parts[1], size: parts[2] };
  }
  if (parts.length === 2) {
    return { gender: parts[0], type: parts[1], size: '' };
  }
  return { gender: '', type: '', size: '' };
}

/** Normalize a catalog item with gender/type/size from columns or variation. */
export function normalizeCatalogItem(item) {
  if (!item || typeof item !== 'object') return null;
  const fromVariation = parseVariation(item.variation);
  return {
    ...item,
    categoryName: String(item.categoryName || item.category_name || '').trim(),
    itemName: String(item.itemName || item.item_name || '').trim(),
    sku: String(item.sku || '').trim(),
    gender: String(item.gender || fromVariation.gender || '').trim(),
    type: String(item.type || fromVariation.type || '').trim(),
    size: String(item.size || fromVariation.size || '').trim(),
    stocks: item.stocks ?? item.stock ?? null,
    status: item.status || '',
    variation: item.variation || '',
    inventoryId: item.inventoryId || item.inventory_id || null,
  };
}

export function unwrapCatalogPayload(payload) {
  const root = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  const categories = Array.isArray(root?.categories) ? root.categories : [];
  const items = Array.isArray(root?.items) ? root.items : [];
  return {
    categories: categories
      .map((c) => ({
        categoryId: c.categoryId || c.category_id || null,
        categoryName: String(c.categoryName || c.category_name || '').trim(),
      }))
      .filter((c) => c.categoryName && !isLearningKitMerchandiseName(c.categoryName)),
    items: items.map(normalizeCatalogItem).filter(Boolean),
  };
}

export function getCatalogItemsForCategory(items, categoryName) {
  const key = String(categoryName || '').trim().toLowerCase();
  if (!key) return [];
  return (items || []).filter(
    (item) => String(item.categoryName || '').trim().toLowerCase() === key
  );
}

function uniqueSorted(values, orderList = null) {
  const set = new Set();
  for (const v of values) {
    const text = String(v || '').trim();
    if (text) set.add(text);
  }
  const list = Array.from(set);
  if (!orderList) return list.sort((a, b) => a.localeCompare(b));
  return list.sort((a, b) => {
    const ia = orderList.indexOf(a);
    const ib = orderList.indexOf(b);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return a.localeCompare(b);
  });
}

export function getUniformGenderOptions(items, categoryName) {
  const rows = getCatalogItemsForCategory(items, categoryName);
  return uniqueSorted(rows.map((r) => r.gender), ['Male', 'Female', 'Unisex']);
}

export function getUniformTypeOptions(items, categoryName, gender) {
  let rows = getCatalogItemsForCategory(items, categoryName);
  if (gender) {
    const g = String(gender).trim().toLowerCase();
    rows = rows.filter((r) => String(r.gender || '').trim().toLowerCase() === g);
  }
  return uniqueSorted(rows.map((r) => r.type), [
    'Polo',
    'Short',
    'Blouse',
    'Skirt',
    'Shirt',
    'Pants',
  ]);
}

export function getUniformSizeOptions(items, categoryName, gender, type) {
  let rows = getCatalogItemsForCategory(items, categoryName);
  if (gender) {
    const g = String(gender).trim().toLowerCase();
    rows = rows.filter((r) => String(r.gender || '').trim().toLowerCase() === g);
  }
  if (type) {
    const t = String(type).trim().toLowerCase();
    rows = rows.filter((r) => String(r.type || '').trim().toLowerCase() === t);
  }
  return uniqueSorted(rows.map((r) => r.size), SIZE_ORDER);
}

export function findUniformCatalogItem(items, { categoryName, gender, type, size }) {
  const rows = getCatalogItemsForCategory(items, categoryName);
  return (
    rows.find((r) => {
      return (
        String(r.gender || '').toLowerCase() === String(gender || '').toLowerCase() &&
        String(r.type || '').toLowerCase() === String(type || '').toLowerCase() &&
        String(r.size || '').toLowerCase() === String(size || '').toLowerCase()
      );
    }) || null
  );
}

export function formatNonUniformItemLabel(item) {
  if (!item) return '';
  const name = item.itemName || 'item';
  const sku = item.sku ? ` · ${item.sku}` : '';
  const stocks =
    item.stocks != null && item.stocks !== '' ? ` (${item.stocks} in stock)` : '';
  const variation = item.variation ? ` — ${item.variation}` : '';
  return `${name}${sku}${stocks}${variation}`;
}

export function createEmptyCatalogRequestLine() {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    category_name: '',
    gender: '',
    type: '',
    size: '',
    item_name: '',
    sku: '',
    inventory_id: '',
    catalog_item_key: '',
    quantity: '',
  };
}

/**
 * Build POST /merchandise-requests body from a catalog-driven line.
 */
export function buildCatalogRequestPayload(line, requestReason) {
  const categoryName = String(line.category_name || '').trim();
  const qty = parseInt(line.quantity, 10);
  const base = {
    category_name: categoryName,
    requested_quantity: qty,
    request_reason: String(requestReason || '').trim(),
  };

  if (isUniformLikeCategory(categoryName)) {
    return {
      ...base,
      gender: String(line.gender || '').trim() || null,
      type: String(line.type || '').trim() || null,
      size: String(line.size || '').trim() || null,
      item_name: null,
      sku: null,
    };
  }

  return {
    ...base,
    gender: null,
    type: null,
    size: null,
    item_name: String(line.item_name || '').trim() || null,
    sku: String(line.sku || '').trim() || null,
  };
}
