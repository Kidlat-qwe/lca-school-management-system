/**
 * RHET bundle (LEARNING_KIT) BOM helpers — mirror of backend bundleBom.js.
 */

import { isLearningKitCategoryKind } from './catalogOptions';

export function isRhetBundleCategoryKind(categoryKind) {
  return isLearningKitCategoryKind(categoryKind);
}

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
  const name = String(category.categoryName || category.category_name || '')
    .trim()
    .toLowerCase();
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

export function getCatalogBomComponents(catalogItem) {
  const all = Array.isArray(catalogItem?.components) ? catalogItem.components : [];
  const unpinned = all.filter((component) => !component.isPinned);
  return unpinned.length ? unpinned : all;
}

/** True when Request Stock line is a RHET bundle (LEARNING_KIT), not name-only Learning Kit. */
export function isBundleRequestCategory(categoryName, categoryKind) {
  if (isRhetBundleCategoryKind(categoryKind)) return true;
  return isRhetBundleCategory({ categoryName, categoryKind });
}

/**
 * Classify each BOM slot of a kit item into SUPPLIES or MERCHANDISE.
 * @param {object} kitItem - catalog item with components[]
 * @param {object[]} catalogCategories - unwrapped catalog categories with categoryType
 * @returns {{ suppliesSlots: object[], merchandiseSlots: object[], isAllSupplies: boolean, isAllMerchandise: boolean, isMixed: boolean }}
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

/**
 * Human-readable BOM kind label.
 * @returns {'supplies' | 'merchandise' | 'mixed' | 'unknown'}
 */
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
