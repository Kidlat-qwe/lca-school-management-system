/**
 * Helpers for Superadmin/Admin "Add Merchandise Type" — category must come
 * from RHET Inventory catalog (exact categoryName), not free text.
 */

import { isLearningKitMerchandiseName } from './learningKit';
import { isUniformLikeCategory } from './catalogOptions';
import {
  isTshirtMerchandiseName,
  isUniformMerchandiseName,
} from '../uniformMerchandise';

/**
 * Sorted RHET category names for Create Merchandise Type dropdown.
 * Excludes Learning Kit (not supported for CMS create/request yet).
 */
export function getCreateMerchandiseCategoryOptions(catalog) {
  const names = (catalog?.categories || [])
    .map((c) => String(c.categoryName || c.category_name || '').trim())
    .filter((name) => name && !isLearningKitMerchandiseName(name));
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

/**
 * Defaults after picking a RHET category for a new CMS merchandise type.
 * Stores exact RHET categoryName as merchandise_name.
 */
export function applyCreateTypeCategoryDefaults(categoryName) {
  const name = String(categoryName || '').trim();
  const uniform =
    isUniformLikeCategory(name) || isUniformMerchandiseName(name);
  const tshirt = isTshirtMerchandiseName(name);

  return {
    merchandise_name: name,
    gender: tshirt ? 'Unisex' : '',
    type: tshirt ? 'Shirt' : '',
    size: '',
    requiresSizing: Boolean(uniform),
  };
}
