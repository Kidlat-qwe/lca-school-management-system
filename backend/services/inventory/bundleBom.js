/**
 * RHET bundle (LEARNING_KIT) BOM helpers.
 * Primary source: catalog item components[]; CMS static recipes are fallback only.
 */

export function isRhetBundleCategoryKind(categoryKind) {
  return String(categoryKind || '').trim().toUpperCase() === 'LEARNING_KIT';
}

/**
 * True when RHET category is a bundle/kit (LEARNING_KIT kind).
 * Accepts a category object or a categoryKind string.
 */
export function isRhetBundleCategory(category) {
  if (!category) return false;
  if (typeof category === 'string') {
    const text = String(category).trim();
    if (isRhetBundleCategoryKind(text)) return true;
    return text.toLowerCase().includes('learning kit');
  }
  if (isRhetBundleCategoryKind(category.categoryKind || category.category_kind)) {
    return true;
  }
  const name = String(category.categoryName || category.category_name || '').trim().toLowerCase();
  return name.includes('learning kit');
}

export function catalogCategoryByName(categories, name) {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return null;
  return (
    (categories || []).find(
      (c) =>
        String(c.categoryName || c.category_name || '')
          .trim()
          .toLowerCase() === key
    ) || null
  );
}

export function isSuppliesOnlyBom(kitItem, categories) {
  const slots = Array.isArray(kitItem?.components) ? kitItem.components : [];
  if (!slots.length) return false;
  return slots.every((slot) => {
    const cat = catalogCategoryByName(
      categories,
      slot.categoryName || slot.category_name
    );
    return String(cat?.categoryType || cat?.category_type || '').toUpperCase() === 'SUPPLIES';
  });
}

/**
 * BOM slot rows from catalog (unpinned first; pinned-only kits use all rows).
 */
export function getCatalogBomComponents(catalogItem) {
  const all = Array.isArray(catalogItem?.components) ? catalogItem.components : [];
  const unpinned = all.filter((component) => !component.isPinned);
  return unpinned.length ? unpinned : all;
}

/**
 * Resolve kit BOM slots from catalog or CMS fallback map.
 * @returns {Array<{ categoryName: string, quantityPerKit: number }>|null}
 */
export function resolveKitBomSlots(selectedKitItem, catalogCategories, cmsRecipeFallback) {
  const fromCatalog = getCatalogBomComponents(selectedKitItem);
  if (fromCatalog.length && isSuppliesOnlyBom(selectedKitItem, catalogCategories)) {
    return fromCatalog
      .map((slot) => ({
        categoryName: String(slot.categoryName || slot.category_name || '').trim(),
        quantityPerKit: Math.max(1, Number(slot.quantity) || 1),
      }))
      .filter((slot) => slot.categoryName);
  }
  if (fromCatalog.length) {
    return fromCatalog
      .map((slot) => ({
        categoryName: String(slot.categoryName || slot.category_name || '').trim(),
        quantityPerKit: Math.max(1, Number(slot.quantity) || 1),
      }))
      .filter((slot) => slot.categoryName);
  }

  const itemName = selectedKitItem?.itemName || selectedKitItem?.item_name;
  const sku = selectedKitItem?.sku;
  const fallback =
    cmsRecipeFallback?.[itemName] ||
    cmsRecipeFallback?.[sku] ||
    null;
  if (Array.isArray(fallback)) return fallback;
  if (fallback?.slots?.length) {
    return fallback.slots.map((slot) => ({
      categoryName: slot.categoryName,
      quantityPerKit: Math.max(1, Number(slot.minCount) || 1),
    }));
  }
  return null;
}

export function hasKitComponentsJson(inventoryComponentsJson) {
  if (!inventoryComponentsJson) return false;
  let comps = inventoryComponentsJson;
  if (typeof comps === 'string') {
    try {
      comps = JSON.parse(comps);
    } catch {
      return false;
    }
  }
  return Array.isArray(comps) && comps.length > 0;
}

/**
 * Classify each BOM slot of a kit item as SUPPLIES or MERCHANDISE.
 * @returns {{ suppliesSlots: object[], merchandiseSlots: object[], isAllSupplies: boolean, isAllMerchandise: boolean, isMixed: boolean, total: number }}
 */
export function categorizeBomSlots(kitItem, catalogCategories) {
  const all = Array.isArray(kitItem?.components) ? kitItem.components : [];
  const suppliesSlots = [];
  const merchandiseSlots = [];

  for (const slot of all) {
    const name = String(slot.categoryName || slot.category_name || '').trim();
    const cat = catalogCategoryByName(catalogCategories, name);
    const categoryType = String(cat?.categoryType || cat?.category_type || '').toUpperCase();
    if (categoryType === 'SUPPLIES') {
      suppliesSlots.push({ ...slot, categoryName: name, _categoryType: 'SUPPLIES' });
    } else {
      merchandiseSlots.push({ ...slot, categoryName: name, _categoryType: categoryType || 'MERCHANDISE' });
    }
  }

  const total = all.length;
  return {
    suppliesSlots,
    merchandiseSlots,
    isAllSupplies: total > 0 && merchandiseSlots.length === 0,
    isAllMerchandise: total > 0 && suppliesSlots.length === 0,
    isMixed: total > 0 && suppliesSlots.length > 0 && merchandiseSlots.length > 0,
    total,
  };
}

/** @returns {'supplies' | 'merchandise' | 'mixed' | 'unknown'} */
export function getBomKind(kitItem, catalogCategories) {
  const { total, isAllSupplies, isAllMerchandise, isMixed } = categorizeBomSlots(
    kitItem,
    catalogCategories
  );
  if (!total) return 'unknown';
  if (isAllSupplies) return 'supplies';
  if (isAllMerchandise) return 'merchandise';
  if (isMixed) return 'mixed';
  return 'unknown';
}

/**
 * Detect bundle/kit stock request or fulfill rows (LEARNING_KIT or components[]).
 */
export function isBundleStockRequest({
  categoryName,
  categoryKind,
  inventory_components_json: inventoryComponentsJson,
  merchandise_name: merchandiseName,
} = {}) {
  if (hasKitComponentsJson(inventoryComponentsJson)) return true;
  if (isRhetBundleCategoryKind(categoryKind)) return true;
  const name = String(categoryName || merchandiseName || '')
    .trim()
    .toLowerCase();
  return name.includes('learning kit');
}
