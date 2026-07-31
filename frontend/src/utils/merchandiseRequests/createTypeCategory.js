/**
 * Helpers for Superadmin/Admin "Add Merchandise Type" — category must come
 * from RHET Inventory catalog (exact categoryName), not free text / hard-coded lists.
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
} from '../uniformMerchandise';

/**
 * Sorted RHET category names for Create Merchandise Type / Request Stock dropdowns.
 * Never invent names — only what the catalog returned.
 */
export function getCreateMerchandiseCategoryOptions(catalog) {
  const names = (catalog?.categories || [])
    .map((c) => String(c.categoryName || c.category_name || '').trim())
    .filter((name) => name);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
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
 * Defaults after picking a RHET category for a new CMS merchandise type.
 * Stores exact RHET categoryName as merchandise_name.
 * Prefer categoryKind from catalog when available.
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
  const mode = resolveRequestStockFormMode({ categoryName: name, categoryKind });
  const uniform =
    mode === 'uniform' ||
    isUniformLikeCategory(name, categoryKind) ||
    isUniformMerchandiseName(name);
  const lcaShirt = isLcaShirtCategory(name, categoryKind);
  // Legacy LCA T-Shirt only — never default type "Shirt" for LCA_SHIRT / "Shirt"
  const legacyTshirt = isTshirtMerchandiseName(name) && !lcaShirt;

  return {
    merchandise_name: name,
    gender: lcaShirt || legacyTshirt ? 'Unisex' : '',
    type: '',
    size: '',
    requiresSizing: Boolean(uniform),
  };
}
