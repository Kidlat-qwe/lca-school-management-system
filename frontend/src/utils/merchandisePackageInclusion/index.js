/**
 * Frontend helpers: package inclusion flag on merchandise types.
 */

/** Sub-tabs on branch Merchandise inventory (card grid). */
export const BRANCH_INVENTORY_CATEGORY_TABS = {
  MERCHANDISE: 'merchandise',
  SUPPLIES: 'supplies',
};

export function parseIsPackageIncluded(value, defaultValue = true) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  if (value === 0 || value === '0' || value === 'false' || value === 'False') return false;
  if (value === 1 || value === '1' || value === 'true' || value === 'True') return true;
  return defaultValue;
}

export function isMerchandisePackageIncluded(rowOrType) {
  if (!rowOrType) return true;
  return parseIsPackageIncluded(rowOrType.is_package_included, true);
}

export function formatPackageInclusionLabel(included) {
  return included ? 'Included in package' : 'Not included in package';
}

/**
 * Filter unique merchandise type cards by Merchandise vs Supplies tab.
 * Supplies = types marked not included in package.
 */
export function filterTypesByInventoryCategoryTab(types, tab) {
  const list = Array.isArray(types) ? types : [];
  if (tab === BRANCH_INVENTORY_CATEGORY_TABS.SUPPLIES) {
    return list.filter((t) => !isMerchandisePackageIncluded(t));
  }
  return list.filter((t) => isMerchandisePackageIncluded(t));
}
