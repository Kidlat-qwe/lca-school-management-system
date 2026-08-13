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
 *   INVENTORY_HTTP_TIMEOUT_MS     Optional fetch timeout (default 45000)
 *   INVENTORY_CATALOG_CACHE_MS    Catalog memory TTL (default 120000); 0 disables
 */

function readBaseUrl() {
  return String(process.env.INVENTORY_API_URL || '').trim().replace(/\/$/, '');
}

function readIntegrationKey() {
  return String(
    process.env.INVENTORY_INTEGRATION_KEY || process.env.INVENTORY_API_KEY || ''
  ).trim();
}

function readHttpTimeoutMs() {
  const raw = Number(process.env.INVENTORY_HTTP_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw >= 3000) return Math.floor(raw);
  // Learning Kit + components can be slower on RHET; default 45s
  return 45000;
}

function readCatalogCacheMs() {
  const raw = Number(process.env.INVENTORY_CATALOG_CACHE_MS);
  if (Number.isFinite(raw) && raw >= 0) return Math.floor(raw);
  // Soften intermittent RHET /catalog 5xx for Request Stock dropdowns
  return 120000;
}

/** In-process catalog cache (per backend instance). */
let catalogCache = { payload: null, expiresAt: 0 };

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
      { code: 'INTEGRATION_DISABLED', status: 503 }
    );
  }

  return { baseUrl, key };
}

async function inventoryRequest(path, options = {}) {
  const { baseUrl, key } = assertConfigured();
  const timeoutMs = readHttpTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Integration-Key': key,
        ...options.headers,
      },
    });
  } catch (networkError) {
    const aborted = networkError?.name === 'AbortError';
    throw new InventoryApiError(
      aborted
        ? `RHET Inventory API timed out after ${timeoutMs}ms (${path}). Try again — upstream may be slow.`
        : `Could not reach RHET Inventory API: ${networkError.message}`,
      { code: aborted ? 'NETWORK_TIMEOUT' : 'NETWORK_ERROR', status: 502 }
    );
  } finally {
    clearTimeout(timer);
  }

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (!response.ok) {
    // Upstream 5xx (incl. RHET DB timeouts) → surface as 502 to CMS clients
    const upstreamStatus = response.status;
    const mappedStatus = upstreamStatus >= 500 ? 502 : upstreamStatus;
    const message = formatInventoryErrorMessage(payload, upstreamStatus);
    throw new InventoryApiError(
      upstreamStatus >= 500
        ? `RHET Inventory is temporarily unavailable (${message}). Please retry in a moment.`
        : message,
      {
        status: mappedStatus,
        code: payload.error?.code || 'INVENTORY_API_ERROR',
        details: payload.error?.details || { upstreamStatus, rawMessage: message },
      }
    );
  }

  return payload;
}

function isRetryableInventoryError(error) {
  if (!error) return false;
  if (error.code === 'NETWORK_TIMEOUT' || error.code === 'NETWORK_ERROR') return true;
  if (error.status === 502 || error.status === 503 || error.status === 504) return true;
  const msg = String(error.message || '').toLowerCase();
  return (
    msg.includes('timeout') ||
    msg.includes('temporar') ||
    msg.includes('econnreset') ||
    msg.includes('fetch failed')
  );
}

async function inventoryRequestWithRetry(path, options = {}, { retries = 0 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await inventoryRequest(path, options);
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !isRetryableInventoryError(error)) throw error;
      const delayMs = 700 * (attempt + 1);
      console.warn(
        `[inventoryClient] Retry ${attempt + 1}/${retries} for ${path} after: ${error.message}`
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

/**
 * GET /catalog — categories + items for dropdowns.
 * Retries transient RHET failures; serves a short-lived cache when upstream
 * remains unavailable so Request Stock can still open.
 */
export async function getCatalog() {
  const cacheMs = readCatalogCacheMs();
  const now = Date.now();
  if (cacheMs > 0 && catalogCache.payload && catalogCache.expiresAt > now) {
    return catalogCache.payload;
  }

  try {
    const payload = await inventoryRequestWithRetry('/catalog', {}, { retries: 2 });
    if (cacheMs > 0 && payload) {
      catalogCache = { payload, expiresAt: now + cacheMs };
    }
    return payload;
  } catch (error) {
    // Stale cache: still usable for dropdowns while RHET recovers
    if (cacheMs > 0 && catalogCache.payload) {
      console.warn(
        `[inventoryClient] Serving stale RHET catalog after upstream failure: ${error.message}`
      );
      return {
        ...catalogCache.payload,
        meta: {
          ...(catalogCache.payload.meta || {}),
          cached: true,
          stale: true,
          cacheWarning: error.message,
        },
      };
    }
    throw error;
  }
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
  return inventoryRequestWithRetry(
    '/stock-requests',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    { retries: 1 }
  );
}

/**
 * POST /stock-returns — branch returns existing stock to RHET warehouse.
 * Payload mirrors /stock-requests plus top-level `requestType: "RETURN"`.
 */
export async function submitStockReturns(payload) {
  return inventoryRequestWithRetry(
    '/stock-returns',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    { retries: 1 }
  );
}

/** GET /stock-requests/:id — poll status by RHET request UUID. */
export async function getStockRequest(requestId) {
  return inventoryRequest(`/stock-requests/${requestId}`);
}

/**
 * POST /stock-requests/:id/deliver — branch confirms physical receipt.
 *
 * RHET contract:
 * - Path is /deliver (not /confirm-delivery) — keep hardcoded.
 * - Auth: X-Integration-Key / Bearer (same PSMS integration key).
 * - Only SHIPPED → DELIVERED; otherwise RHET returns 409.
 * - If already DELIVERED → 200 idempotent (safe CMS retry; no re-webhook / no re-deduct).
 * - Optional body: confirmedBy, branchName, notes.
 * - Success 200: { success, data: { requestId, status: "DELIVERED", externalReference, ... } }
 */
export async function markStockRequestDelivered(requestId, body = {}) {
  const id = String(requestId || '').trim();
  if (!id) {
    throw new InventoryApiError('Missing RHET stock request id for deliver', {
      code: 'MISSING_REQUEST_ID',
      status: 400,
    });
  }

  const payload = {};
  const confirmedBy = String(body.confirmedBy || '').trim();
  const branchName = String(body.branchName || '').trim();
  const notes = String(body.notes || '').trim();
  if (confirmedBy) payload.confirmedBy = confirmedBy;
  if (branchName) payload.branchName = branchName;
  if (notes) payload.notes = notes;

  // Retry is safe: RHET /deliver is idempotent when already DELIVERED (200, no re-webhook).
  return inventoryRequestWithRetry(
    `/stock-requests/${encodeURIComponent(id)}/deliver`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    { retries: 1 }
  );
}
