/**
 * Client-side GET response cache for apiRequest (memory + sessionStorage).
 */

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const REFERENCE_TTL_MS = 30 * 60 * 1000;
const STORAGE_PREFIX = 'psms_api_cache_';

/** @type {Map<string, { data: unknown, expiresAt: number }>} */
const memoryCache = new Map();

let userScope = 'anonymous';

const scopedMemoryKey = (key) => `${userScope}:${key}`;

const storageEntryKey = (key) => `${STORAGE_PREFIX}${userScope}_${key}`;

const isSessionStorage = (storage) =>
  storage === 'session' || storage === 'sessionStorage';

/**
 * @param {boolean|object|string|undefined} cacheOption
 * @returns {{ ttlMs: number, revalidate: boolean, storage: string } | null}
 */
export const resolveCacheOptions = (cacheOption) => {
  if (!cacheOption) return null;

  if (cacheOption === true) {
    return { ttlMs: DEFAULT_TTL_MS, revalidate: false, storage: 'memory' };
  }

  if (cacheOption === 'reference') {
    return { ttlMs: REFERENCE_TTL_MS, revalidate: true, storage: 'session' };
  }

  if (typeof cacheOption === 'object') {
    return {
      ttlMs: cacheOption.ttlMs ?? DEFAULT_TTL_MS,
      revalidate: Boolean(cacheOption.revalidate),
      storage: cacheOption.storage ?? 'memory',
    };
  }

  return null;
};

export const buildApiCacheKey = (method, endpoint) =>
  `${String(method || 'GET').toUpperCase()}:${String(endpoint || '')}`;

export const setApiCacheUserScope = (userId) => {
  userScope = String(userId ?? 'anonymous');
};

/**
 * @param {string} key
 * @param {{ storage?: string }} [options]
 */
export const getApiCache = (key, options = {}) => {
  if (!key) return null;

  if (isSessionStorage(options.storage)) {
    try {
      const raw = sessionStorage.getItem(storageEntryKey(key));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed?.expiresAt && Date.now() > parsed.expiresAt) {
        sessionStorage.removeItem(storageEntryKey(key));
        return null;
      }
      return parsed?.data ?? null;
    } catch {
      return null;
    }
  }

  const entry = memoryCache.get(scopedMemoryKey(key));
  if (!entry) return null;
  if (entry.expiresAt && Date.now() > entry.expiresAt) {
    memoryCache.delete(scopedMemoryKey(key));
    return null;
  }
  return entry.data;
};

/**
 * @param {string} key
 * @param {unknown} data
 * @param {number} ttlMs
 * @param {{ storage?: string }} [options]
 */
export const setApiCache = (key, data, ttlMs, options = {}) => {
  if (!key) return;

  const expiresAt = Date.now() + (Number(ttlMs) > 0 ? Number(ttlMs) : DEFAULT_TTL_MS);

  if (isSessionStorage(options.storage)) {
    try {
      sessionStorage.setItem(
        storageEntryKey(key),
        JSON.stringify({ data, expiresAt })
      );
    } catch {
      /* sessionStorage full or unavailable */
    }
    return;
  }

  memoryCache.set(scopedMemoryKey(key), { data, expiresAt });
};

const clearSessionStorageForScope = (scope) => {
  try {
    const prefix = `${STORAGE_PREFIX}${scope}_`;
    const keysToRemove = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(prefix)) keysToRemove.push(k);
    }
    keysToRemove.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    /* ignore */
  }
};

/** Clear cache entries for the current user scope (e.g. after mutations). */
export const invalidateApiCache = () => {
  const prefix = `${userScope}:`;
  for (const key of [...memoryCache.keys()]) {
    if (key.startsWith(prefix)) memoryCache.delete(key);
  }
  clearSessionStorageForScope(userScope);
};

/** Clear all cached API data (e.g. on logout). */
export const clearAllApiCache = () => {
  memoryCache.clear();
  try {
    const keysToRemove = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(STORAGE_PREFIX)) keysToRemove.push(k);
    }
    keysToRemove.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    /* ignore */
  }
  userScope = 'anonymous';
};
