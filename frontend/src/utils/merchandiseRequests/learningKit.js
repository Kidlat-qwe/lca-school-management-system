/**
 * Learning Kit helpers for Request Stock.
 * Mirror of backend learningKitRecipes.js — keep BOM slots in sync.
 */

export const LEARNING_KIT_CATEGORY = 'Learning Kit';

export function isLearningKitMerchandiseName(merchandiseName) {
  if (!merchandiseName) return false;
  return String(merchandiseName).toLowerCase().includes('learning kit');
}

/** @deprecated Use isLearningKitMerchandiseName — kits are supported with components[]. */
export const LEARNING_KIT_NOT_SUPPORTED_MESSAGE =
  'Select a kit and fill every component slot from the kit recipe.';

const BUILTIN_RECIPES = {
  'nc-kg-learningkits': {
    itemName: 'nc-kg-learningkits',
    sku: 'LEA-NC-KG-LEARNINGKITS',
    label: 'NC KG Learning Kits',
    slots: [
      { categoryName: 'LCA T-Shirt', kind: 'uniform', minCount: 1 },
      { categoryName: 'Tool Kit', kind: 'other', minCount: 1 },
      { categoryName: 'Workbooks', kind: 'other', minCount: 1 },
    ],
  },
};

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

export function getLearningKitRecipe({ itemName, sku } = {}) {
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
    kind: slot.kind,
    gender: '',
    type: '',
    size: '',
    item_name: '',
    sku: '',
    catalog_item_key: '',
    quantity: String(kitQuantity || 1),
  };
}

export function buildKitComponentsFromRecipe(recipe, kitQuantity = 1) {
  if (!recipe?.slots?.length) return [];
  const components = [];
  for (const slot of recipe.slots) {
    const count = Math.max(1, Number(slot.minCount) || 1);
    for (let i = 0; i < count; i += 1) {
      components.push(createEmptyKitComponent(slot, kitQuantity));
    }
  }
  return components;
}

export function validateKitLineComponents(line) {
  const itemName = String(line.item_name || '').trim();
  const sku = String(line.sku || '').trim();
  if (!itemName && !sku) {
    return 'Select a Learning Kit from the catalog';
  }
  const recipe = getLearningKitRecipe({ itemName, sku });
  if (!recipe) {
    return 'Kit recipe not configured in CMS for this Learning Kit';
  }
  const components = Array.isArray(line.components) ? line.components : [];
  for (const slot of recipe.slots) {
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
          return `${slot.categoryName}: gender, type, and size are required`;
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
    if (String(c.kind || '').toLowerCase() === 'uniform') {
      return {
        categoryName,
        gender: String(c.gender || '').trim(),
        type: String(c.type || '').trim(),
        size: String(c.size || '').trim(),
        quantity: componentQty,
      };
    }
    const out = { categoryName, quantity: componentQty };
    const itemName = String(c.item_name || '').trim();
    const sku = String(c.sku || '').trim();
    if (itemName) out.itemName = itemName;
    if (sku) out.sku = sku;
    return out;
  });
}
