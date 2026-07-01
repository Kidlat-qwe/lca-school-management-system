import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isInvoiceListFocused } from './arInvoiceCrossLink.js';
import {
  getPaymentLogTableAmountColumn,
  getPaymentLogTableTotalAmountColumn,
} from './paymentLogTableAmounts/index.js';

/** Navigation state from Payment Logs → Rejected tab "Go to invoice". */
export function buildInvoiceNavigateStateFromRejectedPayment(payment) {
  if (!payment?.invoice_id) {
    return { focusInvoiceId: null };
  }
  return {
    focusInvoiceId: payment.invoice_id,
    focusRejectedPayment: {
      payment_id: payment.payment_id,
      invoice_id: payment.invoice_id,
      payment_date: payment.payment_date,
      issue_date: payment.issue_date,
      payable_amount: payment.payable_amount,
      discount_amount: payment.discount_amount,
      tip_amount: payment.tip_amount,
      payment_method: payment.payment_method,
      reference_number: payment.reference_number,
      reject_reason: payment.reject_reason,
      rejected_at: payment.rejected_at,
      rejected_by_name: payment.rejected_by_name,
      student_name: payment.student_name,
      invoice_description: payment.invoice_description,
    },
  };
}

export function isInvoiceFocusedFromPaymentLogs(invoice, paymentLogsFocus) {
  return isInvoiceListFocused(invoice, paymentLogsFocus);
}

export { isInvoiceListFocused };

/**
 * Focus an invoice row when opened from AR page (?invoice_id=).
 * Uses layout effect so cross-link fetch runs before list auto-fetch effects.
 */
export function useInvoiceFocusFromQuery({
  searchParams,
  setSearchParams,
  setNameSearchTerm,
  mergeInvoiceIntoList,
  clearListDateFilters,
  refetchListForCrossLink,
  suppressAutoListFetchRef,
  apiRequest,
}) {
  const [queryFocus, setQueryFocus] = useState(null);
  const handledRef = useRef(null);
  const refetchRef = useRef(refetchListForCrossLink);
  refetchRef.current = refetchListForCrossLink;

  useEffect(() => {
    if (!searchParams.get('invoice_id')) {
      handledRef.current = null;
    }
  }, [searchParams]);

  useLayoutEffect(() => {
    const raw = searchParams.get('invoice_id');
    if (raw == null || raw === '') return;

    const invoiceId = Number(raw);
    if (!Number.isFinite(invoiceId) || invoiceId <= 0) {
      const next = new URLSearchParams(searchParams);
      next.delete('invoice_id');
      setSearchParams(next, { replace: true });
      return;
    }

    if (handledRef.current === invoiceId) return;
    handledRef.current = invoiceId;

    const search = `INV-${invoiceId}`;
    if (suppressAutoListFetchRef) suppressAutoListFetchRef.current = true;
    clearListDateFilters?.();
    setQueryFocus({ invoiceId });
    setNameSearchTerm?.(search);

    let cancelled = false;

    (async () => {
      try {
        await refetchRef.current?.(search);
        if (cancelled) return;
        const response = await apiRequest(`/invoices/${invoiceId}`);
        if (cancelled) return;
        const invoice = response?.data ?? response;
        if (invoice?.invoice_id) {
          mergeInvoiceIntoList?.(invoice);
        }
      } catch (err) {
        console.error('Failed to load invoice from AR cross-link:', err);
      } finally {
        if (suppressAutoListFetchRef) suppressAutoListFetchRef.current = false;
        if (!cancelled) {
          const next = new URLSearchParams(searchParams);
          next.delete('invoice_id');
          setSearchParams(next, { replace: true });
        }
      }
    })();

    return () => {
      cancelled = true;
      if (suppressAutoListFetchRef) suppressAutoListFetchRef.current = false;
    };
  }, [
    searchParams,
    setSearchParams,
    setNameSearchTerm,
    mergeInvoiceIntoList,
    clearListDateFilters,
    refetchListForCrossLink,
    suppressAutoListFetchRef,
    apiRequest,
  ]);

  return queryFocus;
}

/** Jump to the page containing the focused invoice and scroll the row into view. */
export function useScrollToFocusedInvoiceRow(
  invoiceListFocus,
  sortedInvoices,
  currentPage,
  setCurrentPage,
  itemsPerPage
) {
  useEffect(() => {
    if (!invoiceListFocus?.invoiceId) return;
    const idx = sortedInvoices.findIndex(
      (inv) => Number(inv.invoice_id) === Number(invoiceListFocus.invoiceId)
    );
    if (idx < 0) return;
    const page = Math.floor(idx / itemsPerPage) + 1;
    setCurrentPage(page);
  }, [invoiceListFocus?.invoiceId, sortedInvoices, itemsPerPage, setCurrentPage]);

  useEffect(() => {
    if (!invoiceListFocus?.invoiceId) return;
    const timer = window.setTimeout(() => {
      document
        .getElementById(`invoice-row-${invoiceListFocus.invoiceId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [invoiceListFocus?.invoiceId, currentPage]);
}

/** Column values from the rejected payment row (Payment Logs selection). */
export function getInvoiceRowRejectedPaymentOverlay(invoice, paymentLogsFocus) {
  if (!isInvoiceFocusedFromPaymentLogs(invoice, paymentLogsFocus)) return null;
  const p = paymentLogsFocus.rejectedPayment;
  if (!p) return null;
  return {
    amount: getPaymentLogTableAmountColumn(p),
    totalAmount: getPaymentLogTableTotalAmountColumn(p),
    paymentDate: p.payment_date || p.issue_date || null,
    rejectReason: p.reject_reason || null,
    referenceNumber: p.reference_number || null,
    paymentMethod: p.payment_method || null,
  };
}

/**
 * From Payment Logs Rejected tab: clear date filters, filter to Rejected, load invoice into list,
 * highlight the row (no details modal).
 */
export function useOpenInvoiceFromPaymentLogsNavigation({
  location,
  navigate,
  apiRequest,
  mergeInvoiceIntoList,
  clearListDateFilters,
  setFilterStatuses,
}) {
  const mergeInvoiceIntoListRef = useRef(mergeInvoiceIntoList);
  const clearListDateFiltersRef = useRef(clearListDateFilters);
  const setFilterStatusesRef = useRef(setFilterStatuses);
  const [paymentLogsFocus, setPaymentLogsFocus] = useState(null);

  mergeInvoiceIntoListRef.current = mergeInvoiceIntoList;
  clearListDateFiltersRef.current = clearListDateFilters;
  setFilterStatusesRef.current = setFilterStatuses;

  useEffect(() => {
    const focusInvoiceId = location?.state?.focusInvoiceId;
    if (focusInvoiceId == null || focusInvoiceId === '') return;

    const invoiceId = Number(focusInvoiceId);
    if (!Number.isFinite(invoiceId) || invoiceId <= 0) {
      navigate(location.pathname, { replace: true, state: {} });
      return;
    }

    let cancelled = false;

    clearListDateFiltersRef.current?.();
    setFilterStatusesRef.current?.(['Rejected']);
    setPaymentLogsFocus({
      invoiceId,
      rejectedPayment: location?.state?.focusRejectedPayment || null,
    });

    (async () => {
      try {
        const response = await apiRequest(`/invoices/${invoiceId}`);
        if (cancelled) return;

        const invoice = response?.data ?? response;
        if (invoice?.invoice_id) {
          mergeInvoiceIntoListRef.current?.(invoice);
        }
      } catch (err) {
        console.error('Failed to load invoice from Payment Logs navigation:', err);
      } finally {
        if (!cancelled) {
          navigate(location.pathname, { replace: true, state: {} });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    location?.state?.focusInvoiceId,
    location?.state?.focusRejectedPayment,
    location?.key,
    location?.pathname,
    navigate,
    apiRequest,
  ]);

  const clearPaymentLogsFocus = useCallback(() => setPaymentLogsFocus(null), []);

  return { paymentLogsFocus, clearPaymentLogsFocus };
}
