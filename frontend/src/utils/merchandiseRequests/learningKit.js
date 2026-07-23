/**
 * Learning Kit stock requests are not yet supported by Request Stock.
 *
 * RHET Inventory matches Learning Kits via a category-slot bill of materials
 * plus a request-time `components[]` array (uniform pieces, non-uniform items,
 * etc). CMS does not collect that yet, so Learning Kit is blocked in Request
 * Stock until kit support is implemented. Learning Kit stock can still be
 * requested directly in RHET Inventory in the meantime.
 */

export const LEARNING_KIT_NOT_SUPPORTED_MESSAGE =
  'Learning Kit requests are not yet supported via Request Stock. Please request Learning Kit stock directly through RHET Inventory.';

export function isLearningKitMerchandiseName(merchandiseName) {
  if (!merchandiseName) return false;
  return String(merchandiseName).toLowerCase().includes('learning kit');
}
