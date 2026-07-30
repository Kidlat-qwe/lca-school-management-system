// API Configuration — see API_BASE_URL below for per-host routing.
import {
  buildApiCacheKey,
  getApiCache,
  invalidateApiCache,
  resolveCacheOptions,
  setApiCache,
} from '../utils/apiCache/apiCache.js';

export { buildApiCacheKey, invalidateApiCache };

// localhost → local backend; lca-app.com (Coolify) → Coolify API; else Linode production.
const origin = typeof window !== 'undefined' ? window.location?.origin || '' : '';
const isLocalhost = /localhost|127\.0\.0\.1/.test(origin);
const isLcaApp = /lca-app\.com/.test(origin);

/** HTTPS page cannot call HTTP APIs (mixed content). Upgrade http→https when needed. */
const resolveApiBaseUrl = () => {
  const fromEnv = String(import.meta.env.VITE_API_BASE_URL || '').trim();
  let url = fromEnv;

  if (!url) {
    url = isLocalhost
      ? 'http://localhost:3000/api/sms'
      : isLcaApp
        ? 'https://api-cms.lca-app.com/api/sms'
        : 'https://cms.little-champion.com/api/sms';
  }

  if (
    typeof window !== 'undefined' &&
    window.location.protocol === 'https:' &&
    url.startsWith('http://')
  ) {
    url = url.replace(/^http:\/\//, 'https://');
  }

  return url.replace(/\/$/, '');
};

const API_BASE_URL = resolveApiBaseUrl();

export default API_BASE_URL;

const executeFetch = async (endpoint, config, tokenOverride) => {
  const token = tokenOverride ?? localStorage.getItem('firebase_token');

  const defaultHeaders = {};

  if (config.body && !(config.body instanceof FormData)) {
    defaultHeaders['Content-Type'] = 'application/json';
  }

  if (token) {
    defaultHeaders['Authorization'] = `Bearer ${token}`;
  }

  const fetchConfig = {
    ...config,
    headers: {
      ...defaultHeaders,
      ...config.headers,
    },
  };

  if (
    fetchConfig.body &&
    typeof fetchConfig.body === 'object' &&
    !(fetchConfig.body instanceof FormData) &&
    !(fetchConfig.body instanceof Blob) &&
    fetchConfig.body.constructor === Object &&
    ['POST', 'PUT', 'PATCH'].includes(fetchConfig.method?.toUpperCase() || '')
  ) {
    fetchConfig.body = JSON.stringify(fetchConfig.body);
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, fetchConfig);
  const data = await response.json();

  if (!response.ok) {
    const firstFieldError = Array.isArray(data.errors) ? data.errors[0]?.msg : null;
    const error = new Error(firstFieldError || data.message || 'An error occurred');
    error.response = { data, status: response.status };
    error.code = data.error?.code || data.code || undefined;
    throw error;
  }

  return data;
};

/**
 * Make an API request with authentication
 * @param {string} endpoint - API path (e.g. '/auth/verify')
 * @param {object} options - fetch options (method, body, headers, cache, ...)
 * @param {boolean|object|string} [options.cache] - enable GET cache (`true`, `'reference'`, or `{ ttlMs, revalidate, storage }`)
 * @param {string} [tokenOverride] - optional fresh token; if provided, used instead of localStorage (avoids stale/expired token)
 */
export const apiRequest = async (endpoint, options = {}, tokenOverride = null) => {
  const { cache: cacheOption, ...fetchOptions } = options;
  const method = (fetchOptions.method || 'GET').toUpperCase();
  const cacheSettings = resolveCacheOptions(cacheOption);
  const isCacheableGet = method === 'GET' && cacheSettings;

  const cacheKey = isCacheableGet ? buildApiCacheKey(method, endpoint) : null;

  if (isCacheableGet) {
    const cached = getApiCache(cacheKey, { storage: cacheSettings.storage });
    if (cached != null) {
      if (cacheSettings.revalidate) {
        executeFetch(endpoint, { ...fetchOptions, method }, tokenOverride)
          .then((fresh) => {
            setApiCache(cacheKey, fresh, cacheSettings.ttlMs, { storage: cacheSettings.storage });
          })
          .catch(() => {
            /* keep serving stale cache on background failure */
          });
      }
      return cached;
    }
  }

  try {
    const data = await executeFetch(endpoint, { ...fetchOptions, method }, tokenOverride);

    if (isCacheableGet) {
      setApiCache(cacheKey, data, cacheSettings.ttlMs, { storage: cacheSettings.storage });
    }

    return data;
  } catch (error) {
    console.error('API Request Error:', error);
    throw error;
  }
};
