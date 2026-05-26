import { useEffect, useRef } from 'react';

/**
 * When Payment Logs navigates with `{ state: { focusInvoiceId } }`, clear list date
 * filters (so older invoices are not hidden), fetch the invoice, and open details.
 */
export function useOpenInvoiceFromPaymentLogsNavigation({
  location,
  navigate,
  apiRequest,
  openInvoiceDetails,
  mergeInvoiceIntoList,
  clearListDateFilters,
}) {
  const openInvoiceDetailsRef = useRef(openInvoiceDetails);
  const mergeInvoiceIntoListRef = useRef(mergeInvoiceIntoList);
  const clearListDateFiltersRef = useRef(clearListDateFilters);

  openInvoiceDetailsRef.current = openInvoiceDetails;
  mergeInvoiceIntoListRef.current = mergeInvoiceIntoList;
  clearListDateFiltersRef.current = clearListDateFilters;

  useEffect(() => {
    const focusInvoiceId = location?.state?.focusInvoiceId;
    if (focusInvoiceId == null || focusInvoiceId === '') return;

    const invoiceId = Number(focusInvoiceId);
    if (!Number.isFinite(invoiceId) || invoiceId <= 0) {
      navigate(location.pathname, { replace: true, state: {} });
      return;
    }

    let cancelled = false;

    (async () => {
      clearListDateFiltersRef.current?.();

      try {
        const response = await apiRequest(`/invoices/${invoiceId}`);
        if (cancelled) return;

        const invoice = response?.data ?? response;
        if (invoice?.invoice_id) {
          mergeInvoiceIntoListRef.current?.(invoice);
          await openInvoiceDetailsRef.current?.(invoice);
        }
      } catch (err) {
        console.error('Failed to open invoice from Payment Logs navigation:', err);
        if (!cancelled) {
          await openInvoiceDetailsRef.current?.({ invoice_id: invoiceId });
        }
      } finally {
        if (!cancelled) {
          navigate(location.pathname, { replace: true, state: {} });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [location?.state?.focusInvoiceId, location?.key, location?.pathname, navigate, apiRequest]);
}
