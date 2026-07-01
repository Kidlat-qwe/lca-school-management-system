import { apiRequest } from '../../config/api';

/**
 * Prefetch stable reference data after login (non-blocking).
 * @param {object|null|undefined} user
 */
export const warmupReferenceCache = (user) => {
  if (!user) return;

  apiRequest('/branches', { cache: 'reference' }).catch(() => {
    /* warmup is best-effort */
  });
};
