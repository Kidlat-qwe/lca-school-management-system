/**
 * RHET Centralized Inventory Management System — integration API client.
 *
 * Backend-only. Never import this module from frontend code and never expose
 * INVENTORY_INTEGRATION_KEY / INVENTORY_API_KEY to the browser.
 *
 * Env vars (backend `.env` only):
 *   INVENTORY_API_URL          Base URL, e.g. https://api-inventory.lca-app.com/api/v1/integrations
 *   INVENTORY_INTEGRATION_KEY  Shared secret issued by RHET Inventory (Management → API Keys)
 *   INVENTORY_API_KEY          Alias for INVENTORY_INTEGRATION_KEY (fallback)
 *   INVENTORY_WEBHOOK_URL      This system's webhook receiver, sent on every stock request
 */

function readBaseUrl() {
  return String(process.env.INVENTORY_API_URL || '').trim().replace(/\/$/, '');
}

function readIntegrationKey() {
  return String(
    process.env.INVENTORY_INTEGRATION_KEY || process.env.INVENTORY_API_KEY || ''
  ).trim();
}

export function isInventoryIntegrationEnabled() {
  return Boolean(readBaseUrl() && readIntegrationKey());
}

export function getInventoryWebhookUrl() {
  return String(process.env.INVENTORY_WEBHOOK_URL || '').trim();
}

export class InventoryApiError extends Error {
  constructor(message, { status, code, details } = {}) {
    super(message);
    this.name = 'InventoryApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function formatInventoryErrorMessage(payload, status) {
  const base =
    payload.error?.message || payload.message || `Inventory API request failed (${status})`;
  const fieldErrors = payload.error?.details?.fieldErrors;
  if (fieldErrors && typeof fieldErrors === 'object') {
    const parts = Object.entries(fieldErrors)
      .flatMap(([field, messages]) => {
        const list = Array.isArray(messages) ? messages : [messages];
        return list.filter(Boolean).map((msg) => `${field}: ${msg}`);
      });
    if (parts.length > 0) {
      return `${base} (${parts.join('; ')})`;
    }
  }
  return base;
}

function assertConfigured() {
  const baseUrl = readBaseUrl();
  const key = readIntegrationKey();

  if (!baseUrl || !key) {
    const missing = [];
    if (!baseUrl) missing.push('INVENTORY_API_URL');
    if (!key) missing.push('INVENTORY_INTEGRATION_KEY (or INVENTORY_API_KEY)');
    throw new InventoryApiError(
      `RHET Inventory integration is not configured. Missing: ${missing.join(', ')}`,
      { code: 'INTEGRATION_DISABLED' }
    );
  }

  return { baseUrl, key };
}

async function inventoryRequest(path, options = {}) {
  const { baseUrl, key } = assertConfigured();

  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Integration-Key': key,
        ...options.headers,
      },
    });
  } catch (networkError) {
    throw new InventoryApiError(
      `Could not reach RHET Inventory API: ${networkError.message}`,
      { code: 'NETWORK_ERROR' }
    );
  }

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (!response.ok) {
    throw new InventoryApiError(formatInventoryErrorMessage(payload, response.status), {
      status: response.status,
      code: payload.error?.code || 'INVENTORY_API_ERROR',
      details: payload.error?.details || null,
    });
  }

  return payload;
}

/** GET /catalog — categories + items for dropdowns. */
export async function getCatalog() {
  return inventoryRequest('/catalog');
}

/** GET /availability — optional stock check before submit. */
export async function checkAvailability(queryParams = {}) {
  const filtered = Object.fromEntries(
    Object.entries(queryParams).filter(([, v]) => v !== undefined && v !== null && v !== '')
  );
  const params = new URLSearchParams(filtered);
  return inventoryRequest(`/availability?${params.toString()}`);
}

/** POST /stock-requests — submit one or more stock request line items. */
export async function submitStockRequests(payload) {
  return inventoryRequest('/stock-requests', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** GET /stock-requests/:id — poll status by RHET request UUID. */
export async function getStockRequest(requestId) {
  return inventoryRequest(`/stock-requests/${requestId}`);
}
