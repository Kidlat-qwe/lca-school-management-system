/**
 * Request Stock / Return Stock carts: one category per row.
 * Once a category is selected, other rows cannot pick it again.
 */

export function normalizeCartCategoryKey(name) {
  return String(name || '').trim().toLowerCase();
}

export function getCategoryOptionName(option) {
  if (typeof option === 'string') return String(option || '').trim();
  return String(option?.categoryName || option?.category_name || '').trim();
}

/**
 * Category keys already used on other cart rows.
 * Pass excludeLineId so the current row still sees its own category.
 */
export function getUsedCartCategoryKeys(lines = [], excludeLineId = null) {
  const used = new Set();
  for (const line of lines || []) {
    if (excludeLineId && line?.id === excludeLineId) continue;
    const key = normalizeCartCategoryKey(line?.category_name);
    if (key) used.add(key);
  }
  return used;
}

export function isCategoryTakenOnOtherRow(lines, categoryName, lineId) {
  const key = normalizeCartCategoryKey(categoryName);
  if (!key) return false;
  return getUsedCartCategoryKeys(lines, lineId).has(key);
}

/** Dropdown options still available for this row (keeps the row's own selection). */
export function filterUnselectedCartCategories(options = [], lines = [], lineId = null) {
  const used = getUsedCartCategoryKeys(lines, lineId);
  return (options || []).filter((option) => {
    const name = getCategoryOptionName(option);
    const key = normalizeCartCategoryKey(name);
    if (!key) return false;
    return !used.has(key);
  });
}

export function hasUnusedCartCategory(options = [], lines = []) {
  return filterUnselectedCartCategories(options, lines).length > 0;
}
