import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { apiRequest } from '../../config/api';
import { appAlert } from '../../utils/appAlert';
import ConfirmDeliveryLoadingOverlay from '../../components/merchandise/ConfirmDeliveryLoadingOverlay';

const ConfirmDeliveryContext = createContext(null);

/**
 * Keeps Branch Admin "Confirm received" in-flight across route changes so the
 * loading overlay / mini spinner survive navigating away from Merchandise.
 */
export function ConfirmDeliveryProvider({ children }) {
  const [inFlightIds, setInFlightIds] = useState(() => []);

  const isBusy = inFlightIds.length > 0;

  const isRequestInFlight = useCallback(
    (requestId) => {
      if (requestId == null) return false;
      return inFlightIds.some((id) => Number(id) === Number(requestId));
    },
    [inFlightIds]
  );

  const addInFlight = useCallback((ids) => {
    const normalized = (ids || []).map((id) => Number(id)).filter((id) => Number.isFinite(id));
    if (normalized.length === 0) return;
    setInFlightIds((prev) => {
      const next = [...prev];
      for (const id of normalized) {
        if (!next.some((x) => Number(x) === id)) next.push(id);
      }
      return next;
    });
  }, []);

  const removeInFlight = useCallback((ids) => {
    const removeSet = new Set(
      (ids || []).map((id) => Number(id)).filter((id) => Number.isFinite(id))
    );
    if (removeSet.size === 0) return;
    setInFlightIds((prev) => prev.filter((id) => !removeSet.has(Number(id))));
  }, []);

  const confirmDelivery = useCallback(
    async (request, { notes } = {}) => {
      const requestId = request?.request_id;
      if (!requestId) return { ok: false, reason: 'missing_request' };
      if (isBusy) return { ok: false, reason: 'busy' };
      if (isRequestInFlight(requestId)) return { ok: false, reason: 'already_in_flight' };

      addInFlight([requestId]);
      try {
        const response = await apiRequest(
          `/merchandise-requests/${requestId}/confirm-delivery`,
          {
            method: 'POST',
            body: JSON.stringify({
              notes: notes || 'Branch admin confirmed physical receipt in CMS',
            }),
          }
        );
        appAlert(
          response?.message ||
            'Receipt confirmed. Stock was added to your branch and RHET Inventory is now Delivered.'
        );
        return { ok: true, response };
      } catch (err) {
        appAlert(err.message || 'Failed to confirm delivery. Please try again.');
        return { ok: false, error: err };
      } finally {
        removeInFlight([requestId]);
      }
    },
    [addInFlight, isBusy, isRequestInFlight, removeInFlight]
  );

  const confirmDeliveryBulk = useCallback(
    async (selectedRequests, { notes } = {}) => {
      const list = (selectedRequests || []).filter((r) => r?.request_id);
      if (list.length === 0) return { ok: false, reason: 'empty' };
      if (isBusy) return { ok: false, reason: 'busy' };

      const ids = list.map((r) => r.request_id);
      addInFlight(ids);

      let ok = 0;
      const failures = [];
      try {
        for (const request of list) {
          try {
            await apiRequest(`/merchandise-requests/${request.request_id}/confirm-delivery`, {
              method: 'POST',
              body: JSON.stringify({
                notes: notes || 'Branch admin confirmed physical receipt in CMS (bulk)',
              }),
            });
            ok += 1;
          } catch (err) {
            failures.push({
              id: request.request_id,
              name:
                request.inventory_category_name ||
                request.merchandise_name ||
                `#${request.request_id}`,
              message: err.message || 'Failed',
            });
          }
        }

        const count = list.length;
        if (failures.length === 0) {
          appAlert(
            ok === 1
              ? 'Receipt confirmed. Stock was added to your branch.'
              : `${ok} shipments confirmed received. Stock was added to your branch.`
          );
        } else {
          const detail = failures
            .slice(0, 3)
            .map((f) => `${f.name}: ${f.message}`)
            .join('\n');
          appAlert(
            `Confirmed ${ok} of ${count}. ${failures.length} failed:\n${detail}${
              failures.length > 3 ? `\n…and ${failures.length - 3} more` : ''
            }`
          );
        }

        return { ok: failures.length === 0, confirmed: ok, failures };
      } finally {
        removeInFlight(ids);
      }
    },
    [addInFlight, isBusy, removeInFlight]
  );

  const value = useMemo(
    () => ({
      isBusy,
      inFlightIds,
      isRequestInFlight,
      confirmDelivery,
      confirmDeliveryBulk,
    }),
    [confirmDelivery, confirmDeliveryBulk, inFlightIds, isBusy, isRequestInFlight]
  );

  return (
    <ConfirmDeliveryContext.Provider value={value}>
      {children}
      <ConfirmDeliveryLoadingOverlay open={isBusy} />
    </ConfirmDeliveryContext.Provider>
  );
}

export function useConfirmDelivery() {
  const ctx = useContext(ConfirmDeliveryContext);
  if (!ctx) {
    throw new Error('useConfirmDelivery must be used within ConfirmDeliveryProvider');
  }
  return ctx;
}

export default ConfirmDeliveryContext;
