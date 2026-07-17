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

const TYPE_MAP = {
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

export function mapCategoryNameToInventory(merchandiseName) {
  const name = String(merchandiseName || '').trim();
  return CATEGORY_NAME_MAP[name] || name;
}

export function mapGenderToInventory(gender) {
  if (!gender) return undefined;
  const key = String(gender).trim();
  return GENDER_MAP[key] || key;
}

export function mapTypeToInventory(type) {
  if (!type) return undefined;
  const key = String(type).trim();
  return TYPE_MAP[key] || key;
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
      type: mapTypeToInventory(requestRow.type),
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
