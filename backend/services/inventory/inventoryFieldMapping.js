/**
 * Maps this system's merchandise request fields to RHET Inventory API format,
 * and builds/parses the `externalReference` used to correlate records across systems.
 *
 * externalReference format: `<SYSTEM_CODE>-<local_request_id>`
 * SYSTEM_CODE comes from INVENTORY_SYSTEM_CODE (default "PSMS") — never hardcode
 * a single system code, since this client pattern is reused by other systems
 * (HR, VENDOR, etc.) connecting to the same RHET Inventory.
 */

const DEFAULT_SYSTEM_CODE = 'PSMS';

const CATEGORY_NAME_MAP = {
  'LCA Uniform': 'School Uniform',
  'LCA PE Uniform': 'PE Uniform',
  'School Uniform_Replacement': 'School Uniform',
  'PE Uniform_Replacement': 'PE Uniform',
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

// CRITICAL: Polo and Shirt are distinct RHET types — never collapse one into the
// other. School Uniform pieces map to Polo/Short; PE Uniform pieces map to
// Shirt/Pants. Sending the wrong type means RHET finds no matching stock row.
const SCHOOL_UNIFORM_TYPE_MAP = {
  Top: 'Polo',
  Bottom: 'Short',
  Polo: 'Polo',
  Short: 'Short',
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

function isUniformCategory(merchandiseName) {
  if (!merchandiseName) return false;
  const normalized = String(merchandiseName).trim();
  if (CATEGORY_NAME_MAP[normalized]) return true;
  return normalized.toLowerCase().includes('uniform');
}

/**
 * Learning Kit requests are not yet supported by Request Stock. RHET Inventory
 * matches kits via a category-slot BOM + request-time `components[]`, which
 * CMS does not collect yet. Callers must reject these before calling RHET
 * (see POST /api/v1/merchandise-requests guard in merchandiserequests.js).
 */
export function isLearningKitCategory(merchandiseName) {
  if (!merchandiseName) return false;
  return String(merchandiseName).toLowerCase().includes('learning kit');
}

export function mapCategoryNameToInventory(merchandiseName) {
  const name = String(merchandiseName || '').trim();
  return CATEGORY_NAME_MAP[name] || name;
}

export function mapGenderToInventory(gender) {
  if (!gender) return undefined;
  const key = String(gender).trim();
  return GENDER_MAP[key] || key;
}

function isPeUniform(merchandiseName) {
  return String(merchandiseName || '')
    .trim()
    .toLowerCase()
    .includes('pe');
}

export function mapTypeToInventory(type, merchandiseName = '') {
  if (!type) return undefined;
  const key = String(type).trim();
  const typeMap = isPeUniform(merchandiseName) ? PE_UNIFORM_TYPE_MAP : SCHOOL_UNIFORM_TYPE_MAP;
  return typeMap[key] || key;
}

export function mapSizeToInventory(size) {
  if (!size) return undefined;
  const key = String(size).trim();
  return SIZE_MAP[key] || key;
}

/**
 * Build one RHET stock-request item from a local merchandiserequestlogtbl row.
 */
export function buildInventoryStockRequestItem(requestRow) {
  const categoryName = mapCategoryNameToInventory(requestRow.merchandise_name);
  const externalReference = buildExternalReference(requestRow.request_id);

  if (isUniformCategory(requestRow.merchandise_name)) {
    return {
      categoryName,
      gender: mapGenderToInventory(requestRow.gender),
      type: mapTypeToInventory(requestRow.type, requestRow.merchandise_name),
      size: mapSizeToInventory(requestRow.size),
      quantity: Number(requestRow.requested_quantity),
      externalReference,
    };
  }

  return {
    categoryName,
    itemName: String(requestRow.merchandise_name || '').trim(),
    quantity: Number(requestRow.requested_quantity),
    externalReference,
  };
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
  const payload = {
    requestDate: new Date().toISOString().slice(0, 10),
    requestedBy: String(requestedBy || 'PSMS Admin').trim() || 'PSMS Admin',
    reason: normalizeInventoryReason(reason, requestRow.request_reason),
    items: [buildInventoryStockRequestItem(requestRow)],
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
