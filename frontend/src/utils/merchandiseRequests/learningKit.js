/**
 * Learning Kit / bundle helpers for Request Stock.
 * Mirror of backend learningKitRecipes.js — prefer live catalog BOM.
 */

import {
  catalogCategoryByName,
  getCatalogBomComponents,
  isBundleRequestCategory,
} from './bundleBom';
import { getRequestStockCatalogItemsForCategory } from './catalogOptions';

export { isBundleRequestCategory };

export const LEARNING_KIT_CATEGORY = 'Learning Kit';

export function isLearningKitMerchandiseName(merchandiseName) {
  if (!merchandiseName) return false;
  return String(merchandiseName).toLowerCase().includes('learning kit');
}

/** @deprecated Use isLearningKitMerchandiseName — kits are supported with components[]. */
export const LEARNING_KIT_NOT_SUPPORTED_MESSAGE =
  'Select a kit and fill every component slot from the kit recipe.';

const UNIFORM_BOM_CATEGORY_NAMES = new Set([
  'school uniform',
  'pe uniform',
  'lca uniform',
  'lca pe uniform',
  'shirt',
  'lca t-shirt',
  'lca tshirt',
  'lca shirt',
]);

function isUniformBomCategory(categoryName) {
  const name = String(categoryName || '').trim().toLowerCase();
  if (!name) return false;
  if (name.includes('learning kit')) return false;
  if (UNIFORM_BOM_CATEGORY_NAMES.has(name)) return true;
  if (name.includes('lca') && name.includes('shirt')) return true;
  return name.endsWith(' uniform');
}

/**
 * Slot kinds:
 * - 'uniform'   = MERCHANDISE uniform (gender + type + size pickers)
 * - 'other'     = MERCHANDISE item (catalog item picker)
 * - 'supplies'  = SUPPLIES item (auto-filled from catalog; no picker needed)
 */
function resolveSlotKind(categoryName, catalogCategories) {
  const cat = catalogCategoryByName(catalogCategories, categoryName);
  const categoryType = String(cat?.categoryType || cat?.category_type || '').toUpperCase();
  if (categoryType === 'SUPPLIES') return 'supplies';
  if (isUniformBomCategory(categoryName)) return 'uniform';
  return 'other';
}

/** Build recipe slots from RHET catalog kit item.components[] (live BOM). */
export function recipeFromCatalogKitItem(catalogItem, catalogCategories = []) {
  const bomRows = getCatalogBomComponents(catalogItem);
  if (!catalogItem || !bomRows.length) {
    return null;
  }
  const itemName = String(catalogItem.itemName || catalogItem.item_name || '').trim();
  const sku = String(catalogItem.sku || '').trim();
  const slots = bomRows
    .map((component) => {
      const categoryName = String(
        component.categoryName || component.category_name || ''
      ).trim();
      if (!categoryName) return null;
      return {
        categoryName,
        kind: resolveSlotKind(categoryName, catalogCategories),
        minCount: Math.max(1, Number(component.quantity) || 1),
      };
    })
    .filter(Boolean);
  if (!slots.length) return null;
  return {
    itemName: itemName || sku,
    sku: sku || null,
    label: catalogItem.label || itemName || sku,
    slots,
    source: 'catalog',
  };
}

const BUILTIN_RECIPES = {
  'nc-learningkit': {
    itemName: 'nc-learningkit',
    sku: 'LEA-NC-LEARNINGKIT',
    label: 'NC Learning Kit',
    slots: [
      { categoryName: 'Shirt', kind: 'uniform', minCount: 1 },
      { categoryName: 'Tool Kit', kind: 'other', minCount: 1 },
      { categoryName: 'Workbooks', kind: 'other', minCount: 1 },
    ],
  },
  'nc-kg-learningkits': {
    itemName: 'nc-kg-learningkits',
    sku: 'LEA-NC-KG-LEARNINGKITS',
    label: 'NC KG Learning Kits',
    slots: [
      { categoryName: 'Shirt', kind: 'uniform', minCount: 1 },
      { categoryName: 'Tool Kit', kind: 'other', minCount: 1 },
      { categoryName: 'Workbooks', kind: 'other', minCount: 1 },
    ],
  },
  'arts-crafts-learningkit': {
    itemName: 'arts-crafts-learningkit',
    sku: 'LEA-ARTS-CRAFTS-LEARNINGKIT',
    label: 'Arts & Crafts Learning Kit',
    slots: [
      { categoryName: 'ID Lace', kind: 'other', minCount: 1 },
      { categoryName: 'Shirt', kind: 'uniform', minCount: 1 },
      { categoryName: 'Tool Kit', kind: 'other', minCount: 1 },
      { categoryName: 'Workbooks', kind: 'other', minCount: 1 },
    ],
  },
  'gs-learningkit': {
    itemName: 'gs-learningkit',
    sku: 'LEA-GS-LEARNINGKIT',
    label: 'GS Learning Kit',
    slots: [
      { categoryName: 'ID Lace', kind: 'other', minCount: 1 },
      { categoryName: 'Shirt', kind: 'uniform', minCount: 1 },
      { categoryName: 'Tool Kit', kind: 'other', minCount: 1 },
      { categoryName: 'Workbooks', kind: 'other', minCount: 1 },
    ],
  },
  'kg-learningkit-set-2': {
    itemName: 'kg-learningkit-set-2',
    sku: 'LEA-KG-LEARNINGKIT-SET-2',
    label: 'KG Learning Kit Set 2',
    slots: [
      { categoryName: 'ID Lace', kind: 'other', minCount: 1 },
      { categoryName: 'Shirt', kind: 'uniform', minCount: 1 },
      { categoryName: 'Tool Kit', kind: 'other', minCount: 1 },
      { categoryName: 'Workbooks', kind: 'other', minCount: 1 },
    ],
  },
  'pk-learningkit-set4': {
    itemName: 'pk-learningkit-set4',
    sku: 'LEA-PK-LEARNINGKIT-SET4',
    label: 'PK Learning Kit Set 4',
    slots: [
      { categoryName: 'ID Lace', kind: 'other', minCount: 1 },
      { categoryName: 'Shirt', kind: 'uniform', minCount: 1 },
      { categoryName: 'Tool Kit', kind: 'other', minCount: 1 },
      { categoryName: 'Workbooks', kind: 'other', minCount: 1 },
    ],
  },
};

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

export function getLearningKitRecipe({ itemName, sku, catalogItem, catalogCategories } = {}) {
  const fromCatalog = catalogItem
    ? recipeFromCatalogKitItem(catalogItem, catalogCategories || [])
    : null;
  if (fromCatalog) return fromCatalog;
  const index = {};
  for (const recipe of Object.values(BUILTIN_RECIPES)) {
    index[normalizeKey(recipe.itemName)] = recipe;
    if (recipe.sku) index[normalizeKey(recipe.sku)] = recipe;
  }
  return index[normalizeKey(itemName)] || index[normalizeKey(sku)] || null;
}

export function createEmptyKitComponent(slot, kitQuantity = 1) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    category_name: slot.categoryName,
    kind: slot.kind || 'other',
    gender: '',
    type: '',
    size: '',
    item_name: '',
    sku: '',
    catalog_item_key: '',
    quantity: String(kitQuantity || 1),
  };
}

/**
 * Auto-fill a SUPPLIES slot component using the first available catalog item.
 * @param {object} slot - recipe slot with kind === 'supplies'
 * @param {object[]} catalogItems - full catalog items list
 * @param {number} kitQuantity
 */
export function createAutoFilledSuppliesComponent(slot, catalogItems, kitQuantity = 1) {
  const base = createEmptyKitComponent(slot, kitQuantity);
  const available = getRequestStockCatalogItemsForCategory(catalogItems, slot.categoryName);
  if (available.length > 0) {
    const first = available[0];
    base.item_name = first.itemName || '';
    base.sku = first.sku || '';
    base.catalog_item_key = first.sku && first.itemName
      ? `${first.sku}|${first.itemName}|${first.inventoryId || ''}`
      : '';
    base.auto_filled = true;
  }
  return base;
}

/**
 * Build components array from recipe.
 * @param {object} recipe
 * @param {number} kitQuantity
 * @param {object[]} [catalogItems] - provide to auto-fill SUPPLIES slots
 */
export function buildKitComponentsFromRecipe(recipe, kitQuantity = 1, catalogItems = []) {
  if (!recipe?.slots?.length) return [];
  const components = [];
  for (const slot of recipe.slots) {
    const count = Math.max(1, Number(slot.minCount) || 1);
    for (let i = 0; i < count; i += 1) {
      if (slot.kind === 'supplies' && catalogItems.length > 0) {
        components.push(createAutoFilledSuppliesComponent(slot, catalogItems, kitQuantity));
      } else {
        components.push(createEmptyKitComponent(slot, kitQuantity));
      }
    }
  }
  return components;
}

export function validateKitLineComponents(line) {
  const itemName = String(line.item_name || '').trim();
  const sku = String(line.sku || '').trim();
  if (!itemName && !sku) {
    return 'Select a bundle kit from the catalog';
  }
  const recipe = getLearningKitRecipe({
    itemName,
    sku,
    catalogItem: line.catalog_kit_item,
    catalogCategories: line.catalog_categories,
  });
  if (!recipe) {
    return 'Kit recipe not configured for this bundle';
  }
  const components = Array.isArray(line.components) ? line.components : [];
  for (const slot of recipe.slots) {
    // SUPPLIES slots are auto-filled — skip user-input validation
    if (slot.kind === 'supplies') continue;

    const rows = components.filter(
      (c) =>
        String(c.category_name || '').trim().toLowerCase() ===
        slot.categoryName.toLowerCase()
    );
    if (rows.length < (slot.minCount || 1)) {
      return `Add at least ${slot.minCount || 1} choice(s) for ${slot.categoryName}`;
    }
    for (const row of rows) {
      if (slot.kind === 'uniform') {
        if (!row.gender || !row.type || !row.size) {
          return `${slot.categoryName}: gender, logo/type, and size are required`;
        }
      } else if (!row.item_name && !row.sku) {
        return `${slot.categoryName}: select a catalog item`;
      }
    }
  }
  return null;
}

export function serializeKitComponentsForApi(line) {
  const qty = Math.max(1, parseInt(line.quantity, 10) || 1);
  return (line.components || []).map((c) => {
    const categoryName = String(c.category_name || '').trim();
    const componentQty = Math.max(1, parseInt(c.quantity, 10) || qty);
    const kind = String(c.kind || '').toLowerCase();
    if (kind === 'uniform') {
      return {
        categoryName,
        gender: String(c.gender || '').trim(),
        type: String(c.type || '').trim(),
        size: String(c.size || '').trim(),
        quantity: componentQty,
      };
    }
    // Both 'supplies' (auto-filled) and 'other' (user-picked) — include itemName/sku
    const out = { categoryName, quantity: componentQty };
    const itemName = String(c.item_name || '').trim();
    const sku = String(c.sku || '').trim();
    if (itemName) out.itemName = itemName;
    if (sku) out.sku = sku;
    return out;
  });
}
