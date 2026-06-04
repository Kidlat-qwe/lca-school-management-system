/**
 * Uniform types that use separate Top / Bottom stock rows (type column on merchandisestbl).
 * Keep in sync with backend PACKAGE_UNIFORM_TYPE_NAMES in merchandiseReleaseLog.js.
 */
export const UNIFORM_TOP_BOTTOM_TYPE_NAMES = ['LCA Uniform', 'LCA PE Uniform'];

export function isUniformTopBottomType(merchandiseName) {
  if (!merchandiseName) return false;
  return UNIFORM_TOP_BOTTOM_TYPE_NAMES.includes(String(merchandiseName).trim());
}

/**
 * Resolve the correct stock row for a sized uniform (Top vs Bottom).
 * @param {Array} merchandiseList — branch merchandise catalog
 * @param {string} merchandiseName
 * @param {string} size
 * @param {string|null} category — 'Top' | 'Bottom' | null
 * @param {(item: object) => string} getCategory — e.g. component getUniformCategory
 */
export function findUniformStockByNameSizeCategory(
  merchandiseList,
  merchandiseName,
  size,
  category,
  getCategory
) {
  if (!merchandiseName || !size || !Array.isArray(merchandiseList)) return null;

  if (isUniformTopBottomType(merchandiseName) && category && category !== 'General') {
    return (
      merchandiseList.find(
        (item) =>
          item.merchandise_name === merchandiseName &&
          item.size === size &&
          getCategory(item) === category
      ) || null
    );
  }

  return (
    merchandiseList.find(
      (item) => item.merchandise_name === merchandiseName && item.size === size
    ) || null
  );
}
