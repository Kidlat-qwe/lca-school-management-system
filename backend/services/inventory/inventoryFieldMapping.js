/**
 * Maps this system's merchandise request fields to RHET Inventory API format,
 * and builds/parses the `externalReference` used to correlate records across systems.
 *
 * Preferred path (Request Stock redesign): pass through exact RHET catalog values
 * stored on the request row (`inventory_category_name`, `inventory_item_name`,
 * `inventory_requested_sku`, plus gender/type/size for uniforms).
 *
 * Legacy path: map local CMS labels (LCA Uniform, Men, Extra Small) → RHET labels.
 * Never invent RHET categories from free-text local names like "LCA Bag" without
 * a concrete itemName/sku.
 *
 * externalReference format: `<SYSTEM_CODE>-<local_request_id>`
 */

import {
  getLearningKitRecipe,
  validateLearningKitComponents,
} from './learningKitRecipes.js';

const DEFAULT_SYSTEM_CODE = 'PSMS';

/** RHET categoryName → preferred local merchandisestbl name for fulfill apply. */
const CATEGORY_NAME_TO_LOCAL = {
  'School Uniform': 'School Uniform',
  'PE Uniform': 'PE Uniform',
  'LCA T-Shirt': 'LCA T-Shirt',
  Backpack: 'Backpack',
  'Learning Kit': 'Learning Kit',
};

/** Local CMS merchandise_name → RHET categoryName (legacy bridge only). */
const CATEGORY_NAME_MAP = {
  'LCA Uniform': 'School Uniform',
  'LCA PE Uniform': 'PE Uniform',
  'School Uniform_Replacement': 'School Uniform',
  'PE Uniform_Replacement': 'PE Uniform',
  'LCA Bag': 'Backpack',
  'LCA T-Shirt': 'LCA T-Shirt',
  'LCA Tshirt': 'LCA T-Shirt',
  'LCA Learning Kit': 'Learning Kit',
  'Learning Kit': 'Learning Kit',
};

const GENDER_MAP = {
  Men: 'Male',
  Women: 'Female',
  Boys: 'Male',
  Girls: 'Female',
  Unisex: 'Unisex',
  Male: 'Male',
  Female: 'Female',
};

const GENDER_TO_LOCAL = {
  Male: 'Men',
  Female: 'Women',
  Unisex: 'Unisex',
};

// CRITICAL: Polo and Shirt are distinct RHET types — never collapse one into the
// other. School Uniform pieces map to Polo/Short; PE Uniform pieces map to
// Shirt/Pants. Sending the wrong type means RHET finds no matching stock row.
const SCHOOL_UNIFORM_TYPE_MAP = {
  Top: 'Polo',
  Bottom: 'Short',
  Polo: 'Polo',
  Short: 'Short',
  Blouse: 'Blouse',
  Skirt: 'Skirt',
};

const PE_UNIFORM_TYPE_MAP = {
  Top: 'Shirt',
  Bottom: 'Pants',
  Shirt: 'Shirt',
  Pants: 'Pants',
};

const SIZE_MAP = {
  'Extra Small': 'XS',
  Small: 'S',
  Medium: 'M',
  Large: 'L',
  'Extra Large': 'XL',
  '2XL': '2XL',
  '3XL': '3XL',
  '4XL': '4XL',
  '5XL': '5XL',
  XS: 'XS',
  S: 'S',
  M: 'M',
  L: 'L',
  XL: 'XL',
};

const SIZE_TO_LOCAL = {
  XS: 'Extra Small',
  S: 'Small',
  M: 'Medium',
  L: 'Large',
  XL: 'Extra Large',
  '2XL': '2XL',
  '3XL': '3XL',
  '4XL': '4XL',
  '5XL': '5XL',
};

export function getInventorySystemCode() {
  return String(process.env.INVENTORY_SYSTEM_CODE || DEFAULT_SYSTEM_CODE).trim() || DEFAULT_SYSTEM_CODE;
}

export function buildExternalReference(localRequestId) {
  return `${getInventorySystemCode()}-${localRequestId}`;
}

/** Parses `<SYSTEM_CODE>-<id>` back to the numeric local request id (current system code only). */
export function parseLocalRequestIdFromExternalReference(externalReference) {
  if (!externalReference) return null;
  const systemCode = getInventorySystemCode().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(externalReference).match(new RegExp(`^${systemCode}-(\\d+)$`));
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Learning Kit category (RHET virtual kit). Request Stock collects components[]
 * from CMS kit recipes; fulfill credits branch type "Learning Kit".
 */
export function isLearningKitCategory(name) {
  if (!name) return false;
  return String(name).toLowerCase().includes('learning kit');
}

/**
 * Uniform-like RHET categories (and legacy local names that map to them).
 * Non-uniform categories (Workbooks, Backpack, Accessory, …) must return false
 * so fulfill keys stock rows by item_name/sku.
 */
export function isUniformLikeCategory(categoryOrMerchandiseName) {
  if (!categoryOrMerchandiseName) return false;
  const raw = String(categoryOrMerchandiseName).trim();
  if (isLearningKitCategory(raw)) return false;
  const mapped = CATEGORY_NAME_MAP[raw] || raw;
  const name = String(mapped).trim().toLowerCase();
  if (name === 'school uniform' || name === 'pe uniform') return true;
  if (name === 'lca t-shirt' || name === 'lca tshirt' || name === 'lca shirt') return true;
  if (name.endsWith(' uniform')) return true;
  return false;
}

export function mapCategoryNameToInventory(merchandiseName) {
  const name = String(merchandiseName || '').trim();
  return CATEGORY_NAME_MAP[name] || name;
}

/** RHET category → local merchandisestbl name for branch stock apply. */
export function mapCategoryNameToLocal(rhetCategoryName) {
  const name = String(rhetCategoryName || '').trim();
  return CATEGORY_NAME_TO_LOCAL[name] || name;
}

/**
 * CMS merchandise type/category name to use when applying fulfilled stock.
 * Prefer inventory_category_name (RHET categoryName). Never use itemName/sku
 * as the type title (that created erroneous types like `lca-backpack`).
 */
export function resolveLocalMerchandiseTypeName(requestRow) {
  const fromInventoryCol = String(requestRow?.inventory_category_name || '').trim();
  if (fromInventoryCol) {
    return mapCategoryNameToLocal(fromInventoryCol);
  }

  const raw = String(requestRow?.merchandise_name || '').trim();
  if (!raw) return '';

  const itemName = String(
    requestRow?.inventory_item_name || requestRow?.item_name || ''
  ).trim();
  if (itemName && raw.toLowerCase() === itemName.toLowerCase()) {
    return '';
  }

  const sku = String(
    requestRow?.inventory_requested_sku || requestRow?.inventory_matched_sku || ''
  ).trim();
  if (sku && raw.toLowerCase() === sku.toLowerCase()) {
    return '';
  }

  // Slug-like RHET item names are never CMS type titles
  if (/^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(raw) && !CATEGORY_NAME_MAP[raw]) {
    return '';
  }

  return mapCategoryNameToLocal(mapCategoryNameToInventory(raw));
}

/**
 * Name variants to match an existing CMS type on the branch
 * (e.g. Backpack + legacy LCA Bag).
 */
export function localMerchandiseTypeNameCandidates(requestRow) {
  const preferred = resolveLocalMerchandiseTypeName(requestRow);
  const candidates = new Set();
  if (preferred) candidates.add(preferred);

  const category = String(requestRow?.inventory_category_name || '').trim();
  if (category) {
    candidates.add(mapCategoryNameToLocal(category));
    candidates.add(category);
    for (const [localName, rhetName] of Object.entries(CATEGORY_NAME_MAP)) {
      if (
        String(rhetName).toLowerCase() === String(category).toLowerCase() ||
        (preferred &&
          mapCategoryNameToLocal(rhetName).toLowerCase() === preferred.toLowerCase())
      ) {
        candidates.add(localName);
      }
    }
  }

  const raw = String(requestRow?.merchandise_name || '').trim();
  if (raw && (CATEGORY_NAME_MAP[raw] || CATEGORY_NAME_TO_LOCAL[raw])) {
    candidates.add(raw);
    candidates.add(mapCategoryNameToLocal(mapCategoryNameToInventory(raw)));
  }
  for (const localCanonical of Object.values(CATEGORY_NAME_TO_LOCAL)) {
    if (raw && raw.toLowerCase() === String(localCanonical).toLowerCase()) {
      candidates.add(localCanonical);
    }
  }

  const itemName = String(requestRow?.inventory_item_name || '').trim().toLowerCase();
  const sku = String(
    requestRow?.inventory_requested_sku || requestRow?.inventory_matched_sku || ''
  )
    .trim()
    .toLowerCase();
  for (const name of [...candidates]) {
    const key = String(name).toLowerCase();
    if (itemName && key === itemName) candidates.delete(name);
    if (sku && key === sku) candidates.delete(name);
    if (/^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(name) && !CATEGORY_NAME_MAP[name]) {
      candidates.delete(name);
    }
  }

  return [...candidates].filter(Boolean);
}

export function mapGenderToInventory(gender) {
  if (!gender) return undefined;
  const key = String(gender).trim();
  return GENDER_MAP[key] || key;
}

export function mapGenderToLocal(gender) {
  if (!gender) return null;
  const key = String(gender).trim();
  // Prefer RHET-canonical Male/Female when already canonical
  if (key === 'Male' || key === 'Female' || key === 'Unisex') return key;
  return GENDER_TO_LOCAL[key] || key;
}

function isPeUniform(categoryOrMerchandiseName) {
  const mapped = mapCategoryNameToInventory(categoryOrMerchandiseName);
  return mapped.toLowerCase().includes('pe');
}

export function mapTypeToInventory(type, merchandiseName = '') {
  if (!type) return undefined;
  const key = String(type).trim();
  // Exact RHET types pass through — never Polo → Shirt.
  if (['Polo', 'Short', 'Blouse', 'Skirt', 'Shirt', 'Pants'].includes(key)) {
    return key;
  }
  const typeMap = isPeUniform(merchandiseName) ? PE_UNIFORM_TYPE_MAP : SCHOOL_UNIFORM_TYPE_MAP;
  return typeMap[key] || key;
}

export function mapSizeToInventory(size) {
  if (!size) return undefined;
  const key = String(size).trim();
  return SIZE_MAP[key] || key;
}

export function mapSizeToLocal(size) {
  if (!size) return null;
  const key = String(size).trim();
  // Prefer RHET-canonical XS/S/… when already canonical
  if (['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'].includes(key)) {
    return key;
  }
  return SIZE_TO_LOCAL[key] || key;
}

/**
 * Resolve the RHET categoryName for a request row (catalog-first).
 */
export function resolveInventoryCategoryName(requestRow) {
  const fromInventory = String(requestRow?.inventory_category_name || '').trim();
  if (fromInventory) return fromInventory;
  return mapCategoryNameToInventory(requestRow?.merchandise_name);
}

/**
 * Build one RHET stock-request item from a local merchandiserequestlogtbl row.
 * Prefer inventory_* catalog fields; never send local-only names as category
 * without itemName for non-uniforms. Learning Kits include components[].
 */
export function buildInventoryStockRequestItem(requestRow) {
  const categoryName = resolveInventoryCategoryName(requestRow);
  const externalReference = buildExternalReference(requestRow.request_id);
  const quantity = Number(requestRow.requested_quantity);

  if (isLearningKitCategory(categoryName) || isLearningKitCategory(requestRow.merchandise_name)) {
    const itemName = String(
      requestRow.inventory_item_name || requestRow.item_name || ''
    ).trim();
    const sku = String(
      requestRow.inventory_requested_sku || requestRow.sku || ''
    ).trim();
    let components = requestRow.inventory_components_json;
    if (typeof components === 'string') {
      try {
        components = JSON.parse(components);
      } catch {
        components = [];
      }
    }
    if (!Array.isArray(components)) components = [];

    const item = {
      categoryName: mapCategoryNameToInventory(categoryName) || 'Learning Kit',
      quantity,
      externalReference,
      components,
    };
    if (itemName) item.itemName = itemName;
    if (sku) item.sku = sku;
    return omitEmpty(item);
  }

  if (isUniformLikeCategory(categoryName) || isUniformLikeCategory(requestRow.merchandise_name)) {
    const item = {
      categoryName,
      gender: mapGenderToInventory(requestRow.gender),
      type: mapTypeToInventory(requestRow.type, categoryName || requestRow.merchandise_name),
      size: mapSizeToInventory(requestRow.size),
      quantity,
      externalReference,
    };
    return omitEmpty(item);
  }

  const itemName = String(
    requestRow.inventory_item_name || requestRow.item_name || ''
  ).trim();
  const sku = String(
    requestRow.inventory_requested_sku || requestRow.sku || ''
  ).trim();

  // Non-uniform MUST have itemName and/or sku — never category-only (LCA Bag bug).
  const item = {
    categoryName,
    quantity,
    externalReference,
  };
  if (itemName) item.itemName = itemName;
  if (sku) item.sku = sku;
  return omitEmpty(item);
}

function omitEmpty(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue;
    // Keep arrays (e.g. Learning Kit components[]) even when checking emptiness elsewhere
    out[k] = v;
  }
  return out;
}

/**
 * Normalize create-request body into DB + RHET identity fields.
 * Accepts catalog-driven fields: category_name, item_name, sku, gender, type, size.
 */
export function normalizeMerchandiseRequestInput(body = {}) {
  const categoryName = String(body.category_name || body.categoryName || '').trim();
  const itemName = String(body.item_name || body.itemName || '').trim();
  const sku = String(body.sku || '').trim();
  const merchandiseNameInput = String(body.merchandise_name || body.merchandiseName || '').trim();

  // Prefer explicit RHET category; fall back to mapping local merchandise_name.
  const inventoryCategoryName =
    categoryName || (merchandiseNameInput ? mapCategoryNameToInventory(merchandiseNameInput) : '');

  if (!inventoryCategoryName) {
    return { error: 'RHET category is required' };
  }

  // Learning Kit: category + kit itemName/sku + components[] (BOM slots)
  if (isLearningKitCategory(inventoryCategoryName) || isLearningKitCategory(merchandiseNameInput)) {
    const resolvedItemName = itemName || '';
    if (!resolvedItemName && !sku) {
      return {
        error: 'Select a Learning Kit from the RHET catalog (item name or SKU).',
      };
    }
    const recipe = getLearningKitRecipe({ itemName: resolvedItemName, sku });
    if (!recipe) {
      return {
        error:
          'Kit recipe not configured in CMS for this Learning Kit. Contact an admin to add the kit BOM slots.',
        code: 'KIT_RECIPE_MISSING',
      };
    }
    const qty = Number(body.requested_quantity || body.quantity || 1) || 1;
    const validated = validateLearningKitComponents(
      recipe,
      body.components || body.inventory_components || [],
      qty
    );
    if (!validated.ok) {
      return { error: validated.error, code: 'KIT_COMPONENTS_INVALID' };
    }
    return {
      inventory_category_name: 'Learning Kit',
      inventory_item_name: resolvedItemName || recipe.itemName || null,
      inventory_requested_sku: sku || recipe.sku || null,
      inventory_components_json: validated.components,
      merchandise_name: 'Learning Kit',
      // Request-log `type` CHECK only allows uniform pieces — kit identity lives in inventory_*
      gender: null,
      type: null,
      size: null,
      is_uniform: false,
      is_learning_kit: true,
    };
  }

  const uniform = isUniformLikeCategory(inventoryCategoryName);
  const gender = String(body.gender || '').trim() || null;
  const type = String(body.type || '').trim() || null;
  const size = String(body.size || '').trim() || null;

  if (uniform) {
    if (!gender || !type || !size) {
      return { error: 'Gender, type, and size are required for uniform categories' };
    }
    return {
      inventory_category_name: inventoryCategoryName,
      inventory_item_name: null,
      inventory_requested_sku: sku || null,
      // Local branch stock labels (fulfill apply)
      merchandise_name: mapCategoryNameToLocal(inventoryCategoryName),
      gender: mapGenderToLocal(mapGenderToInventory(gender)),
      type: mapTypeToInventory(type, inventoryCategoryName),
      size: mapSizeToLocal(mapSizeToInventory(size)),
      is_uniform: true,
    };
  }

  const resolvedItemName = itemName || '';
  const resolvedSku = sku || '';
  if (!resolvedItemName || !resolvedSku) {
    return {
      error:
        'Select a concrete catalog item with both item name and SKU. Category-only non-uniform requests (Workbooks, Backpack, Book, Accessory, …) are not allowed.',
    };
  }

  return {
    inventory_category_name: inventoryCategoryName,
    inventory_item_name: resolvedItemName,
    inventory_requested_sku: resolvedSku,
    // CMS type/category bucket = RHET categoryName (Backpack), NEVER itemName (lca-backpack)
    merchandise_name: mapCategoryNameToLocal(inventoryCategoryName),
    gender: null,
    type: null,
    size: null,
    is_uniform: false,
  };
}

/**
 * Validate that a non-uniform RHET payload has item identity (guard against LCA Bag bug).
 */
export function assertInventoryItemHasMatchKey(item) {
  if (!item?.categoryName) {
    return 'categoryName is required';
  }
  if (isLearningKitCategory(item.categoryName)) {
    if (!item.itemName && !item.sku) {
      return 'Learning Kit requests require itemName and/or sku';
    }
    if (!Array.isArray(item.components) || item.components.length === 0) {
      return 'Learning Kit requests require components[] for every BOM category';
    }
    return null;
  }
  if (isUniformLikeCategory(item.categoryName)) {
    if (!item.gender || !item.type || !item.size) {
      return 'Uniform requests require gender, type, and size';
    }
    return null;
  }
  if (!item.itemName || !item.sku) {
    return 'Non-uniform requests require both itemName and sku';
  }
  return null;
}

/**
 * RHET validates `reason` as a string with length >= 5.
 * Short UI reasons like "test" / "low" must be padded or replaced.
 */
export function normalizeInventoryReason(reason, fallbackReason) {
  const candidates = [reason, fallbackReason, 'Merchandise stock request'];
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (value.length >= 5) return value;
  }
  return 'Merchandise stock request';
}

/**
 * Build the full POST /stock-requests body for one local request row.
 * Omits empty optional fields so RHET does not reject null/undefined values.
 */
export function buildInventorySubmitPayload({ requestRow, requestedBy, reason, webhookUrl }) {
  const item = buildInventoryStockRequestItem(requestRow);
  const matchError = assertInventoryItemHasMatchKey(item);
  if (matchError) {
    const err = new Error(matchError);
    err.code = 'INVALID_INVENTORY_ITEM';
    throw err;
  }

  const payload = {
    requestDate: new Date().toISOString().slice(0, 10),
    requestedBy: String(requestedBy || 'PSMS Admin').trim() || 'PSMS Admin',
    reason: normalizeInventoryReason(reason, requestRow.request_reason),
    items: [item],
  };

  const webhook = String(webhookUrl || '').trim();
  if (webhook) {
    payload.webhookUrl = webhook;
  }

  return payload;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** True when value looks like a user/request UUID instead of a display name. */
export function looksLikeUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}

/** @deprecated Use looksLikeUuid — kept for existing imports. */
export function looksLikeInventoryUserId(value) {
  return looksLikeUuid(String(value || '').trim());
}

/**
 * Pick the RHET admin display name for Approved By.
 * Order: processedBy → approvedBy → processedByName → rejectedBy.
 * NEVER use processedByUserId. NEVER return a UUID.
 */
export function pickApproverName(body) {
  if (!body || typeof body !== 'object') return null;

  const roots = [body];
  if (body.data && typeof body.data === 'object') roots.push(body.data);
  if (body.payload && typeof body.payload === 'object') roots.push(body.payload);

  for (const root of roots) {
    for (const raw of [
      root.processedBy,
      root.approvedBy,
      root.processedByName,
      root.rejectedBy,
      root.processed_by,
      root.approved_by,
      root.processed_by_name,
      root.rejected_by,
    ]) {
      const value = String(raw || '').trim();
      if (!value || looksLikeUuid(value)) continue;
      return value;
    }
  }
  return null;
}

/**
 * Alias used by webhook / sync / repair paths.
 * Accepts webhook bodies and GET /stock-requests/:id response `data` objects.
 */
export function extractInventoryProcessedBy(source) {
  return pickApproverName(source);
}
