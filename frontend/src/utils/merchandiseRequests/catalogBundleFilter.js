/**
 * RHET catalog virtual-bundle helpers for Request Stock item pickers.
 * Parent categories (e.g. Tool Kit) may list kit SKUs and raw BOM parts together.
 */

export function normalizeCatalogIdentityKey(itemName, sku) {
  const name = String(itemName || '').trim().toLowerCase();
  const skuKey = String(sku || '').trim().toLowerCase();
  if (skuKey) return `sku:${skuKey}`;
  if (name) return `name:${name}`;
  return null;
}

function catalogComponentIdentityKey(component) {
  return normalizeCatalogIdentityKey(
    component?.itemName || component?.item_name,
    component?.sku
  );
}

/** RHET virtual bundle / kit row (parent SKU with BOM children). */
export function isVirtualBundleCatalogItem(item) {
  if (!item) return false;
  const mode = String(item.stockMode || '').trim().toUpperCase();
  if (mode === 'VIRTUAL_BUNDLE') return true;
  if (item.bomComplete === true) return true;
  return Array.isArray(item.components) && item.components.length > 0;
}

/**
 * Filter category rows for Request Stock: keep virtual bundles + standalone items;
 * hide raw BOM parts referenced in another item's components[] for this category.
 */
export function filterRequestStockCatalogItems(rows, categoryName) {
  const categoryKey = String(categoryName || '').trim().toLowerCase();
  if (!categoryKey || !rows?.length) return rows || [];

  const bundles = rows.filter(isVirtualBundleCatalogItem);
  if (!bundles.length) return rows;

  const bomComponentKeys = new Set();
  for (const bundle of bundles) {
    for (const component of bundle.components || []) {
      const compCategory = String(
        component?.categoryName || component?.category_name || categoryName || ''
      )
        .trim()
        .toLowerCase();
      if (compCategory && compCategory !== categoryKey) continue;
      const key = catalogComponentIdentityKey(component);
      if (key) bomComponentKeys.add(key);
    }
  }

  return rows.filter((item) => {
    if (isVirtualBundleCatalogItem(item)) return true;
    const key = normalizeCatalogIdentityKey(item.itemName, item.sku);
    if (!key) return true;
    return !bomComponentKeys.has(key);
  });
}
