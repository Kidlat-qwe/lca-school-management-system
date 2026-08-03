import { useEffect, useRef } from 'react';

/** Local request statuses that still expect RHET / courier updates. */
const IN_FLIGHT_STATUSES = new Set(['Pending', 'Shipped']);

/**
 * Quietly refresh Merchandise requests (and related stock) while the page is open
 * so RHET webhook updates (Shipped → Delivered, etc.) appear without a manual reload.
 *
 * - Pauses while the browser tab is hidden; refreshes immediately when visible again
 * - Uses a faster interval while any request is Pending / Shipped
 * - Does not manage loading spinners — callers should use silent fetches
 *
 * @param {{
 *   enabled?: boolean,
 *   requests?: Array<{ status?: string }>,
 *   onRefresh: () => void | Promise<void>,
 *   fastIntervalMs?: number,
 *   slowIntervalMs?: number,
 *   initialDelayMs?: number,
 * }} opts
 */
export function useMerchandiseLiveRefresh({
  enabled = true,
  requests = [],
  onRefresh,
  fastIntervalMs = 10000,
  slowIntervalMs = 30000,
  initialDelayMs = 2500,
} = {}) {
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  const hasInFlight = (requests || []).some((r) =>
    IN_FLIGHT_STATUSES.has(String(r?.status || ''))
  );
  const intervalMs = hasInFlight ? fastIntervalMs : slowIntervalMs;

  useEffect(() => {
    if (!enabled) return undefined;

    let cancelled = false;
    let intervalId = null;

    const tick = async () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      if (typeof onRefreshRef.current !== 'function') return;
      try {
        await onRefreshRef.current();
      } catch (err) {
        console.error('Merchandise live refresh failed:', err);
      }
    };

    const initialId = setTimeout(() => {
      void tick();
    }, Math.max(0, initialDelayMs));

    intervalId = setInterval(() => {
      void tick();
    }, intervalMs);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void tick();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      clearTimeout(initialId);
      if (intervalId) clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, intervalMs, initialDelayMs]);
}

export default useMerchandiseLiveRefresh;
