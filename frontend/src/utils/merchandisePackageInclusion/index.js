/**
 * Frontend helpers: package inclusion flag on merchandise types.
 */

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
