/**
 * Helpers for Superadmin/Admin "Add Merchandise Type" — category must come
 * from RHET Inventory catalog (exact categoryName), not free text / hard-coded lists.
 *
 * Create-type UX is category + image only. Stock attrs come from Request Stock.
 * Edit-type may realign category when the current CMS name is not in the RHET catalog.
 *
 * Source of truth: GET /merchandise-requests/inventory/catalog (CMS → RHET proxy).
 */

import {
  isUniformLikeCategory,
  resolveRequestStockFormMode,
  isLcaShirtCategory,
  findCatalogCategoryKind,
} from './catalogOptions';
import {
  isTshirtMerchandiseName,
  isUniformMerchandiseName,
  isLearningKitMerchandiseName,
} from '../uniformMerchandise';

/**
 * Sorted RHET category names for Create Merchandise Type dropdown.
 * Never invent names — only what the catalog returned.
 *
 * @param {object} catalog
 * @param {{
 *   excludeLearningKit?: boolean,
 *   excludeNames?: string[],
 * }} [opts]
 */
export function getCreateMerchandiseCategoryOptions(catalog, opts = {}) {
  const excludeLearningKit = opts.excludeLearningKit !== false; // default hide Learning Kit
  const excludeSet = new Set(
    (opts.excludeNames || []).map((n) => String(n || '').trim().toLowerCase()).filter(Boolean)
  );

  const names = (catalog?.categories || [])
    .map((c) => String(c.categoryName || c.category_name || '').trim())
    .filter((name) => {
      if (!name) return false;
      if (excludeLearningKit && isLearningKitMerchandiseName(name)) return false;
      if (excludeSet.has(name.toLowerCase())) return false;
      return true;
    });
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

/**
 * Request Stock category dropdown for Branch Admin:
 * only RHET catalog categories that were already added as a merchandise type on this branch.
 * Preserves catalog objects (categoryId / categoryKind) for form mode + items.
 *
 * @param {object} catalog
 * @param {string[]} branchTypeNames - unique merchandise_name values for the branch
 * @returns {Array<{ categoryName: string, categoryId?: string|number, categoryKind?: string }>}
 */
export function getRequestStockCategoryOptions(catalog, branchTypeNames = []) {
  const allowed = new Set(
    (branchTypeNames || [])
      .map((n) => String(n || '').trim().toLowerCase())
      .filter(Boolean)
  );
  if (!allowed.size) return [];

  const seen = new Set();
  const out = [];
  for (const cat of catalog?.categories || []) {
    const name = String(cat?.categoryName || cat?.category_name || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (!allowed.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(cat);
  }
  return out.sort((a, b) =>
    String(a.categoryName || a.category_name || '').localeCompare(
      String(b.categoryName || b.category_name || '')
    )
  );
}

/**
 * Unique merchandise_name values from branch stock, for Promo / filters.
 * Prefer RHET catalog order when available; never use a hard-coded type list.
 *
 * @param {Array<{ merchandise_name?: string }>} merchandiseList
 * @param {Array<{ categoryName?: string }|string>} [catalogCategories]
 */
export function getMerchandiseTypeNamesFromStock(merchandiseList, catalogCategories = []) {
  const names = [
    ...new Set(
      (merchandiseList || [])
        .map((m) => String(m?.merchandise_name || '').trim())
        .filter(Boolean)
    ),
  ];

  const catalogOrder = (catalogCategories || [])
    .map((c) =>
      typeof c === 'string'
        ? c.trim()
        : String(c?.categoryName || c?.category_name || '').trim()
    )
    .filter(Boolean);

  const rank = new Map(catalogOrder.map((n, i) => [n.toLowerCase(), i]));

  return names.sort((a, b) => {
    const ra = rank.has(a.toLowerCase()) ? rank.get(a.toLowerCase()) : 9999;
    const rb = rank.has(b.toLowerCase()) ? rank.get(b.toLowerCase()) : 9999;
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });
}

/** True when CMS inventory env is not configured (legacy Superadmin approval mode). */
export function isInventoryIntegrationDisabledError(err) {
  const code = err?.code || err?.response?.data?.error?.code;
  if (code === 'INTEGRATION_DISABLED') return true;
  const msg = String(err?.message || err?.response?.data?.message || '').toLowerCase();
  return msg.includes('integration is not configured') || msg.includes('integration_disabled');
}

/**
 * True when merchandise_name matches an exact RHET Inventory categoryName
 * (case-insensitive). Misaligned CMS-only names (e.g. "Toga Set" vs "Toga") return false.
 * Also checks item.categoryName when the categories[] list is sparse.
 *
 * @param {string} categoryName
 * @param {{
 *   categories?: Array<{ categoryName?: string, category_name?: string }>,
 *   items?: Array<{ categoryName?: string, category_name?: string }>,
 * }} catalog
 */
export function isMerchandiseCategoryInInventoryCatalog(categoryName, catalog) {
  const key = String(categoryName || '').trim().toLowerCase();
  if (!key) return false;

  const names = new Set();
  for (const c of catalog?.categories || []) {
    const name = String(c?.categoryName || c?.category_name || '').trim().toLowerCase();
    if (name) names.add(name);
  }
  for (const item of catalog?.items || []) {
    const name = String(item?.categoryName || item?.category_name || '').trim().toLowerCase();
    if (name) names.add(name);
  }
  return names.has(key);
}

/**
 * Edit Merchandise Type may change category only when the current CMS name is
 * not aligned with RHET Inventory — then Superadmin picks a real catalog category.
 * Already-aligned types stay locked (fulfill matching uses exact categoryName).
 *
 * @param {string} currentCategoryName
 * @param {{
 *   inventoryIntegrationEnabled?: boolean,
 *   catalog?: object,
 *   catalogLoading?: boolean,
 * }} [opts]
 * @returns {boolean}
 */
export function canEditMerchandiseTypeCategory(currentCategoryName, opts = {}) {
  const integrationOn = opts.inventoryIntegrationEnabled !== false;
  if (!integrationOn) {
    // Legacy free-text mode: allow rename when no catalog to lock against.
    return true;
  }
  // While loading (or catalog unavailable), show the edit control — never false-lock
  // with "already matches RHET". The select stays disabled until options arrive.
  if (opts.catalogLoading) return true;

  const hasCatalogSignal =
    (opts.catalog?.categories || []).length > 0 ||
    (opts.catalog?.items || []).length > 0;
  if (!hasCatalogSignal) {
    return Boolean(String(currentCategoryName || '').trim());
  }

  return !isMerchandiseCategoryInInventoryCatalog(currentCategoryName, opts.catalog);
}

/**
 * True when this submit is Add Merchandise Type (category + image shell),
 * not Add/Edit Stock.
 */
export function isCreateMerchandiseTypeMode({
  editingMerchandise,
  editingMerchandiseType,
  viewingStocksFor,
} = {}) {
  return !editingMerchandise && !editingMerchandiseType && !viewingStocksFor;
}

/**
 * CMS type-shell row: category + image only (no concrete stock variant yet).
 * These must not appear in View Stocks — stock lines arrive via Request Stock / Add Stocks.
 *
 * @param {{
 *   gender?: string|null,
 *   type?: string|null,
 *   size?: string|null,
 *   item_name?: string|null,
 *   sku?: string|null,
 *   quantity?: number|string|null,
 * }} row
 */
export function isMerchandiseTypeShellRow(row) {
  if (!row) return false;
  const blank = (v) => !String(v ?? '').trim();
  const size = String(row.size ?? '').trim();
  const sizeBlank = !size || ['n/a', 'na'].includes(size.toLowerCase());
  const qtyRaw = row.quantity;
  const qty =
    qtyRaw == null || qtyRaw === ''
      ? 0
      : Number.isFinite(Number(qtyRaw))
        ? Number(qtyRaw)
        : 0;

  return (
    blank(row.gender) &&
    blank(row.type) &&
    sizeBlank &&
    blank(row.item_name) &&
    blank(row.sku) &&
    qty <= 0
  );
}

/**
 * Defaults after picking a RHET category for a new CMS merchandise type shell.
 * Stores exact RHET categoryName as merchandise_name. No local taxonomy.
 *
 * @param {string} categoryName
 * @param {{ categoryKind?: string, categories?: Array }} [opts]
 */
export function applyCreateTypeCategoryDefaults(categoryName, opts = {}) {
  const name = String(categoryName || '').trim();
  const categoryKind =
    opts.categoryKind ||
    findCatalogCategoryKind(opts.categories || [], name) ||
    null;
  // Kept for callers that still inspect mode; create-type UI no longer uses sizing defaults.
  const mode = resolveRequestStockFormMode({ categoryName: name, categoryKind });
  const uniform =
    mode === 'uniform' ||
    isUniformLikeCategory(name, categoryKind) ||
    isUniformMerchandiseName(name);
  const lcaShirt = isLcaShirtCategory(name, categoryKind);
  const legacyTshirt = isTshirtMerchandiseName(name) && !lcaShirt;

  return {
    merchandise_name: name,
    gender: '',
    type: '',
    size: '',
    requiresSizing: Boolean(uniform),
    // unused by create-type form; retained for Request Stock / legacy callers
    _legacyDefaultGender: lcaShirt || legacyTshirt ? 'Unisex' : '',
  };
}
