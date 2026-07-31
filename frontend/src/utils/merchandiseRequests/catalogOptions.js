/**
 * RHET Inventory catalog helpers for Merchandise → Request Stock.
 *
 * Source of truth is GET /merchandise-requests/inventory/catalog (CMS proxy).
 * Prefer categories[].categoryKind for uniform vs non-uniform form mode.
 * Never invent category names — only use exact RHET categoryName / itemName / sku
 * and uniform gender · type · size values that exist on catalog items.
 */

import {
  isLearningKitMerchandiseName,
  serializeKitComponentsForApi,
} from './learningKit';

const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', 'Teen'];

/** RHET kinds that require gender + type + size (not Item picker). */
export const UNIFORM_CATEGORY_KINDS = Object.freeze([
  'SCHOOL_UNIFORM',
  'PE_UNIFORM',
  'LCA_SHIRT',
]);

export const LEARNING_KIT_CATEGORY_KIND = 'LEARNING_KIT';
export const OTHER_CATEGORY_KIND = 'OTHER';

export function normalizeCategoryKind(categoryKind) {
  return String(categoryKind || '').trim().toUpperCase();
}

export function isUniformCategoryKind(categoryKind) {
  return UNIFORM_CATEGORY_KINDS.includes(normalizeCategoryKind(categoryKind));
}

export function isLearningKitCategoryKind(categoryKind) {
  return normalizeCategoryKind(categoryKind) === LEARNING_KIT_CATEGORY_KIND;
}

export function isLcaShirtCategoryKind(categoryKind) {
  return normalizeCategoryKind(categoryKind) === 'LCA_SHIRT';
}

/**
 * Name-heuristic fallback when categoryKind is missing.
 * Includes plain "Shirt" (RHET LCA_SHIRT) — name does not end with "uniform".
 */
export function isUniformLikeCategoryName(categoryName) {
  if (!categoryName) return false;
  const name = String(categoryName).trim().toLowerCase();
  if (isLearningKitMerchandiseName(name)) return false;
  if (name === 'school uniform' || name === 'pe uniform') return true;
  if (
    name === 'lca t-shirt' ||
    name === 'lca tshirt' ||
    name === 'lca shirt' ||
    name === 'shirt'
  ) {
    return true;
  }
  if (name.includes('lca') && name.includes('shirt')) return true;
  return name.endsWith(' uniform');
}

/**
 * Prefer categoryKind; fall back to name heuristics when kind is missing.
 * @param {string} categoryName
 * @param {string} [categoryKind]
 */
export function isUniformLikeCategory(categoryName, categoryKind) {
  const kind = normalizeCategoryKind(categoryKind);
  if (kind) {
    if (isLearningKitCategoryKind(kind)) return false;
    if (isUniformCategoryKind(kind)) return true;
    if (kind === OTHER_CATEGORY_KIND) return false;
  }
  return isUniformLikeCategoryName(categoryName);
}

/**
 * @returns {'uniform'|'kit'|'other'}
 */
export function resolveRequestStockFormMode({ categoryName, categoryKind } = {}) {
  const kind = normalizeCategoryKind(categoryKind);
  if (isLearningKitCategoryKind(kind)) return 'kit';
  if (isUniformCategoryKind(kind)) return 'uniform';
  if (kind === OTHER_CATEGORY_KIND) return 'other';
  if (isLearningKitMerchandiseName(categoryName)) return 'kit';
  if (isUniformLikeCategoryName(categoryName)) return 'uniform';
  return 'other';
}

/** Shirt / LCA_SHIRT — RHET type values are Logo 1 / Logo 2 (UI may label "Logo"). */
export function isLcaShirtCategory(categoryName, categoryKind) {
  if (isLcaShirtCategoryKind(categoryKind)) return true;
  const name = String(categoryName || '').trim().toLowerCase();
  return name === 'shirt' || name === 'lca shirt';
}

/** Look up categoryKind from unwrapped catalog categories. */
export function findCatalogCategoryKind(categories, categoryName) {
  const key = String(categoryName || '').trim().toLowerCase();
  if (!key) return null;
  const match = (categories || []).find(
    (c) => String(c.categoryName || '').trim().toLowerCase() === key
  );
  return match?.categoryKind || null;
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
  const gender = String(
    item.uniformGender ||
      item.uniform_gender ||
      item.gender ||
      fromVariation.gender ||
      ''
  ).trim();
  const type = String(
    item.uniformType ||
      item.uniform_type ||
      item.type ||
      fromVariation.type ||
      ''
  ).trim();
  const size = String(
    item.uniformSize ||
      item.uniform_size ||
      item.size ||
      fromVariation.size ||
      ''
  ).trim();
  return {
    ...item,
    categoryName: String(item.categoryName || item.category_name || '').trim(),
    categoryKind: normalizeCategoryKind(
      item.categoryKind || item.category_kind || ''
    ) || null,
    itemName: String(item.itemName || item.item_name || '').trim(),
    sku: String(item.sku || '').trim(),
    gender,
    type,
    size,
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
  const meta = payload?.meta || root?.meta || null;
  return {
    categories: categories
      .map((c) => ({
        categoryId: c.categoryId || c.category_id || null,
        categoryName: String(c.categoryName || c.category_name || '').trim(),
        categoryKind:
          normalizeCategoryKind(c.categoryKind || c.category_kind || '') || null,
      }))
      .filter((c) => c.categoryName),
    items: items.map(normalizeCatalogItem).filter(Boolean),
    ...(meta ? { meta } : {}),
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
  // Prefer catalog order; Logo 1/2 first for Shirt, then classic piece types
  return uniqueSorted(rows.map((r) => r.type), [
    'Logo 1',
    'Logo 2',
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

/**
 * Resolve a catalog item from a select value key.
 * Key format: `${sku}|${itemName}|${inventoryId||''}`
 * Always returns itemName + sku from the SAME catalog row (never mix).
 */
export function findCatalogItemByKey(items, value) {
  const key = String(value || '').trim();
  if (!key) return null;
  const list = Array.isArray(items) ? items : [];
  const parts = key.split('|');
  const sku = String(parts[0] || '').trim();
  const itemName = String(parts[1] || '').trim();
  const inventoryId = String(parts[2] || '').trim();

  if (inventoryId) {
    const byId = list.find(
      (item) => String(item.inventoryId || item.inventory_id || '').trim() === inventoryId
    );
    if (byId) return byId;
  }

  if (sku && itemName) {
    const byBoth = list.find(
      (item) =>
        String(item.sku || '').trim() === sku &&
        String(item.itemName || '').trim() === itemName
    );
    if (byBoth) return byBoth;
  }

  // Last resort: unique sku or unique itemName only
  if (sku) {
    const bySku = list.filter((item) => String(item.sku || '').trim() === sku);
    if (bySku.length === 1) return bySku[0];
  }
  if (itemName) {
    const byName = list.filter((item) => String(item.itemName || '').trim() === itemName);
    if (byName.length === 1) return byName[0];
  }
  return null;
}

export function catalogItemSelectKey(item) {
  if (!item) return '';
  return `${item.sku || ''}|${item.itemName || ''}|${item.inventoryId || item.inventory_id || ''}`;
}

export function createEmptyCatalogRequestLine() {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    category_name: '',
    category_kind: '',
    gender: '',
    type: '',
    size: '',
    item_name: '',
    sku: '',
    inventory_id: '',
    catalog_item_key: '',
    quantity: '',
    components: [],
  };
}

/**
 * Build POST /merchandise-requests body from a catalog-driven line.
 */
export function buildCatalogRequestPayload(line, requestReason) {
  const categoryName = String(line.category_name || '').trim();
  const categoryKind = String(line.category_kind || '').trim() || null;
  const qty = parseInt(line.quantity, 10);
  const mode = resolveRequestStockFormMode({
    categoryName,
    categoryKind,
  });
  const base = {
    category_name: categoryName,
    category_kind: categoryKind,
    requested_quantity: qty,
    request_reason: String(requestReason || '').trim(),
  };

  if (mode === 'kit' || isLearningKitMerchandiseName(categoryName)) {
    return {
      ...base,
      item_name: String(line.item_name || '').trim() || null,
      sku: String(line.sku || '').trim() || null,
      gender: null,
      type: null,
      size: null,
      components: serializeKitComponentsForApi(line),
    };
  }

  if (mode === 'uniform' || isUniformLikeCategory(categoryName, categoryKind)) {
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
