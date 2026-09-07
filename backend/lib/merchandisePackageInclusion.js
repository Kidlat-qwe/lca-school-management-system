/**
 * Package-inclusion flag helpers for merchandise types.
 * When is_package_included is false, stock is reduced via manual deduct + remarks only
 * (not package enroll auto-issue). Default true for existing rows.
 */

export function parseIsPackageIncluded(value, defaultValue = true) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  if (value === 0 || value === '0' || value === 'false' || value === 'False') return false;
  if (value === 1 || value === '1' || value === 'true' || value === 'True') return true;
  return defaultValue;
}

export function isMerchandisePackageIncluded(row) {
  if (!row) return true;
  if (row.is_package_included === false || row.is_package_included === 0) return false;
  if (row.is_package_included === true || row.is_package_included === 1) return true;
  // Column missing / null → included (legacy)
  return true;
}
