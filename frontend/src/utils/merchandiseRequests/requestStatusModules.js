/**
 * Status modules for Merchandise → My Requests / Stock Requests tab.
 * Mirrors RHET Inventory request buckets: Pending, Shipped, Delivered, Returned, Rejected.
 * Legacy local status "Approved" counts as Delivered.
 */

import { normalizeTrackStatus } from './trackProgress.js';

export const REQUEST_STATUS_MODULES = [
  {
    key: 'Pending',
    label: 'Pending',
    emptyTitle: 'No pending requests',
    activeClass: 'bg-amber-50 border-amber-300 text-amber-950',
  },
  {
    key: 'Shipped',
    label: 'Shipped',
    emptyTitle: 'No shipped requests',
    activeClass: 'bg-blue-50 border-blue-300 text-blue-950',
  },
  {
    key: 'Delivered',
    label: 'Delivered',
    emptyTitle: 'No delivered requests',
    activeClass: 'bg-emerald-50 border-emerald-300 text-emerald-950',
  },
  {
    key: 'Returned',
    label: 'Returned',
    emptyTitle: 'No returned requests',
    activeClass: 'bg-orange-50 border-orange-300 text-orange-950',
  },
  {
    key: 'Rejected',
    label: 'Rejected',
    emptyTitle: 'No rejected requests',
    activeClass: 'bg-red-50 border-red-300 text-red-950',
  },
];

export const DEFAULT_REQUEST_STATUS_MODULE = 'Pending';

/** Map a request row status onto one of the five modules (or null if Cancelled / unknown). */
export function getRequestStatusModuleKey(status) {
  const normalized = normalizeTrackStatus(status);
  if (REQUEST_STATUS_MODULES.some((m) => m.key === normalized)) {
    return normalized;
  }
  return null;
}

/**
 * @param {Array<{ status?: string }>} requests
 * @returns {Record<string, number>}
 */
export function countRequestsByStatusModule(requests = []) {
  const counts = Object.fromEntries(REQUEST_STATUS_MODULES.map((m) => [m.key, 0]));
  for (const request of requests) {
    const key = getRequestStatusModuleKey(request?.status);
    if (key) counts[key] += 1;
  }
  return counts;
}

/**
 * @param {Array<{ status?: string }>} requests
 * @param {string} moduleKey
 */
export function filterRequestsByStatusModule(requests = [], moduleKey) {
  const key = String(moduleKey || DEFAULT_REQUEST_STATUS_MODULE);
  return (requests || []).filter((r) => getRequestStatusModuleKey(r?.status) === key);
}

export function getRequestStatusModuleMeta(moduleKey) {
  return (
    REQUEST_STATUS_MODULES.find((m) => m.key === moduleKey) || REQUEST_STATUS_MODULES[0]
  );
}

/** Default page size for My Requests / Stock Requests tables. */
export const REQUEST_STATUS_MODULE_PAGE_SIZE = 10;

/**
 * Slice a filtered request list for the active status module.
 * @param {Array} list
 * @param {number} page
 * @param {number} [perPage]
 */
export function paginateRequestList(list = [], page = 1, perPage = REQUEST_STATUS_MODULE_PAGE_SIZE) {
  const total = Array.isArray(list) ? list.length : 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage) || 1);
  const safePage = Math.min(Math.max(Number(page) || 1, 1), totalPages);
  const start = (safePage - 1) * perPage;
  return {
    page: safePage,
    totalPages,
    total,
    items: total === 0 ? [] : list.slice(start, start + perPage),
  };
}
