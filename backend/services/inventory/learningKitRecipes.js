/**
 * CMS kit recipes (BOM category slots) for Learning Kit Request Stock.
 *
 * RHET kit BOM is category-only; CMS must send concrete components[] at request time.
 * Until RHET /catalog returns live BOM, keep recipes here (or extend via env JSON).
 *
 * When RHET exposes BOM on catalog/detail, prefer that live source and deprecate
 * these static entries.
 *
 * Keys: lowercase kit itemName and/or sku.
 */

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
 * Find a kit recipe by catalog itemName or sku.
 * @returns {object|null}
 */
export function getLearningKitRecipe({ itemName, sku } = {}) {
  const index = recipeIndex();
  return (
    index[normalizeKey(itemName)] ||
    index[normalizeKey(sku)] ||
    null
  );
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
        'Kit recipe not configured in CMS for this Learning Kit. Add it to learningKitRecipes.js (or LEARNING_KIT_RECIPES_JSON).',
    };
  }

  const qty = Math.max(1, Number(kitQuantity) || 1);
  const list = Array.isArray(components) ? components : [];
  if (list.length === 0) {
    return { ok: false, error: 'Learning Kit requests require components[] for every BOM category.' };
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
      const itemName = String(raw.itemName || raw.item_name || '').trim();
      const sku = String(raw.sku || '').trim();
      if (!itemName && !sku) {
        return {
          ok: false,
          error: `Component ${categoryName} requires itemName and/or sku.`,
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
