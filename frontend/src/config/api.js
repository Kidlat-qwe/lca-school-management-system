// API Configuration
// When deployed (not localhost), always use production API so login/auth works even if build had wrong env
import {
  buildApiCacheKey,
  getApiCache,
  invalidateApiCache,
  resolveCacheOptions,
  setApiCache,
} from '../utils/apiCache/apiCache.js';

export { buildApiCacheKey, invalidateApiCache };

const isLocalhost = typeof window !== 'undefined' && /localhost|127\.0\.0\.1/.test(window.location?.origin || '');
const API_BASE_URL = isLocalhost
  ? 'http://localhost:3000/api/sms'
  : 'https://cms.little-champion.com/api/sms';

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
