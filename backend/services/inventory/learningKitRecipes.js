/**
 * CMS kit recipes (BOM category slots) for Learning Kit Request Stock.
 *
 * Prefer live BOM on RHET `/catalog` kit items (`components[]`).
 * Static `BUILTIN_RECIPES` + env JSON are fallback when catalog is unavailable.
 */

import { getCatalog } from './inventoryClient.js';
import {
  catalogCategoryByName,
  getCatalogBomComponents,
} from './bundleBom.js';

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
 * - 'uniform'   = MERCHANDISE uniform (gender + type + size)
 * - 'other'     = MERCHANDISE item (itemName + sku picker)
 * - 'supplies'  = SUPPLIES item (auto-filled by frontend/RHET; no picker)
 */
function resolveSlotKind(categoryName, catalogCategories) {
  const cat = catalogCategoryByName(catalogCategories, categoryName);
  const categoryType = String(cat?.categoryType || cat?.category_type || '').toUpperCase();
  if (categoryType === 'SUPPLIES') return 'supplies';
  if (isUniformBomCategory(categoryName)) return 'uniform';
  return 'other';
}

/**
 * Build a CMS recipe from a RHET catalog bundle item (live BOM).
 * @param {object} catalogItem
 * @param {object[]} [catalogCategories]
 * @returns {object|null}
 */
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

/** Match catalog itemName/sku with hyphen/underscore variants. */
function normalizeCatalogIdentity(value) {
  return normalizeKey(value).replace(/_/g, '-');
}

function loadEnvRecipes() {
  const raw = String(process.env.LEARNING_KIT_RECIPES_JSON || '').trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out = {};
    for (const [key, recipe] of Object.entries(parsed)) {
      if (!recipe || !Array.isArray(recipe.slots)) continue;
      out[normalizeKey(key)] = {
        itemName: recipe.itemName || key,
        sku: recipe.sku || null,
        label: recipe.label || key,
        slots: recipe.slots.map((s) => ({
          categoryName: String(s.categoryName || '').trim(),
          kind: String(s.kind || 'other').toLowerCase() === 'uniform' ? 'uniform' : 'other',
          minCount: Math.max(1, Number(s.minCount) || 1),
        })),
      };
    }
    return out;
  } catch (err) {
    console.warn('[learningKitRecipes] Invalid LEARNING_KIT_RECIPES_JSON:', err.message);
    return {};
  }
}

function recipeIndex() {
  const index = {};
  for (const [key, recipe] of Object.entries({ ...BUILTIN_RECIPES, ...loadEnvRecipes() })) {
    index[normalizeKey(key)] = recipe;
    if (recipe.itemName) index[normalizeKey(recipe.itemName)] = recipe;
    if (recipe.sku) index[normalizeKey(recipe.sku)] = recipe;
  }
  return index;
}

/**
 * Find a kit recipe by catalog item, itemName, or sku.
 * @returns {object|null}
 */
export function getLearningKitRecipe({ itemName, sku, catalogItem, catalogCategories } = {}) {
  const fromCatalog = catalogItem
    ? recipeFromCatalogKitItem(catalogItem, catalogCategories || [])
    : null;
  if (fromCatalog) return fromCatalog;
  const index = recipeIndex();
  return (
    index[normalizeCatalogIdentity(itemName)] ||
    index[normalizeKey(itemName)] ||
    index[normalizeCatalogIdentity(sku)] ||
    index[normalizeKey(sku)] ||
    null
  );
}

/**
 * Resolve kit recipe: live RHET /catalog BOM first, then static/env CMS map.
 * @returns {Promise<object|null>}
 */
export async function resolveLearningKitRecipe({ itemName, sku } = {}) {
  try {
    const payload = await getCatalog();
    const root = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
    const items = Array.isArray(root?.items) ? root.items : [];
    const categories = Array.isArray(root?.categories) ? root.categories : [];
    const keyName = normalizeCatalogIdentity(itemName);
    const keySku = normalizeCatalogIdentity(sku);
    const match = items.find((item) => {
      const name = normalizeCatalogIdentity(item.itemName || item.item_name);
      const itemSku = normalizeCatalogIdentity(item.sku);
      return (keyName && name === keyName) || (keySku && itemSku === keySku);
    });
    if (match) {
      const fromCatalog = recipeFromCatalogKitItem(match, categories);
      if (fromCatalog) return fromCatalog;
    }
  } catch (err) {
    console.warn('[learningKitRecipes] Catalog recipe lookup failed:', err.message);
  }
  return getLearningKitRecipe({ itemName, sku });
}

/**
 * Validate request components against recipe slots.
 * @returns {{ ok: true, components: object[] } | { ok: false, error: string }}
 */
export function validateLearningKitComponents(recipe, components, kitQuantity) {
  if (!recipe) {
    return {
      ok: false,
      error:
        'Kit recipe not configured for this bundle. RHET catalog must expose components[] or add a CMS fallback in learningKitRecipes.js.',
    };
  }

  const qty = Math.max(1, Number(kitQuantity) || 1);
  const list = Array.isArray(components) ? components : [];

  // Supplies-only kits: all slots are auto-filled by frontend / RHET internals.
  // Accept empty components[] when every slot is 'supplies' — RHET resolves them.
  const allSlotsAreSupplies =
    recipe.slots.length > 0 && recipe.slots.every((s) => s.kind === 'supplies');
  if (list.length === 0 && !allSlotsAreSupplies) {
    return { ok: false, error: 'Kit requests require components[] for every BOM category.' };
  }
  if (list.length === 0 && allSlotsAreSupplies) {
    return { ok: true, components: [] };
  }

  const normalized = [];
  for (const raw of list) {
    const categoryName = String(raw.categoryName || raw.category_name || '').trim();
    if (!categoryName) {
      return { ok: false, error: 'Each component needs categoryName.' };
    }
    const slot = recipe.slots.find(
      (s) => s.categoryName.toLowerCase() === categoryName.toLowerCase()
    );
    if (!slot) {
      return {
        ok: false,
        error: `Component category "${categoryName}" is not in the kit BOM (${recipe.slots
          .map((s) => s.categoryName)
          .join(', ')}).`,
      };
    }

    const componentQty = Math.max(1, Number(raw.quantity) || qty);
    if (slot.kind === 'uniform') {
      const gender = String(raw.gender || '').trim();
      const type = String(raw.type || '').trim();
      const size = String(raw.size || '').trim();
      if (!gender || !type || !size) {
        return {
          ok: false,
          error: `Component ${categoryName} requires gender, type, and size.`,
        };
      }
      normalized.push({
        categoryName: slot.categoryName,
        gender,
        type,
        size,
        quantity: componentQty,
      });
    } else {
      // Both 'supplies' (auto-filled) and 'other' (user-picked) require itemName/sku
      const itemName = String(raw.itemName || raw.item_name || '').trim();
      const sku = String(raw.sku || '').trim();
      if (!itemName && !sku) {
        // For supplies, auto-fill may not have resolved — backend still needs identity
        return {
          ok: false,
          error:
            slot.kind === 'supplies'
              ? `Supplies component ${categoryName} could not be auto-resolved (no itemName/sku). Check RHET catalog items for this category.`
              : `Component ${categoryName} requires itemName and/or sku.`,
        };
      }
      const row = {
        categoryName: slot.categoryName,
        quantity: componentQty,
      };
      if (itemName) row.itemName = itemName;
      if (sku) row.sku = sku;
      normalized.push(row);
    }
  }

  for (const slot of recipe.slots) {
    // SUPPLIES slots may have 0 user-provided rows when all-supplies kit omits components[]
    // In that case, allow it — RHET resolves them; still enforce minCount for MERCHANDISE slots
    if (slot.kind === 'supplies') {
      const count = normalized.filter(
        (c) => c.categoryName.toLowerCase() === slot.categoryName.toLowerCase()
      ).length;
      if (count === 0) continue; // SUPPLIES OK to omit — RHET handles
    }
    const count = normalized.filter(
      (c) => c.categoryName.toLowerCase() === slot.categoryName.toLowerCase()
    ).length;
    if (count < slot.minCount) {
      return {
        ok: false,
        error: `Kit requires at least ${slot.minCount} component line(s) for "${slot.categoryName}" (got ${count}).`,
      };
    }
  }

  return { ok: true, components: normalized };
}

export function listLearningKitRecipes() {
  const seen = new Set();
  const out = [];
  for (const recipe of Object.values(recipeIndex())) {
    const key = normalizeKey(recipe.itemName || recipe.sku);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(recipe);
  }
  return out;
}
