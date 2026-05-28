import { useCallback, useEffect, useRef, useState } from 'react';
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
  if (!paymentLogsFocus?.invoiceId || !invoice?.invoice_id) return false;
  return Number(invoice.invoice_id) === Number(paymentLogsFocus.invoiceId);
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

/** Jump to the page containing the focused invoice and scroll the row into view. */
export function useScrollToFocusedInvoiceRow(
  paymentLogsFocus,
  sortedInvoices,
  currentPage,
  setCurrentPage,
  itemsPerPage
) {
  useEffect(() => {
    if (!paymentLogsFocus?.invoiceId) return;
    const idx = sortedInvoices.findIndex(
      (inv) => Number(inv.invoice_id) === Number(paymentLogsFocus.invoiceId)
    );
    if (idx < 0) return;
    const page = Math.floor(idx / itemsPerPage) + 1;
    setCurrentPage(page);
  }, [paymentLogsFocus?.invoiceId, sortedInvoices, itemsPerPage, setCurrentPage]);

  useEffect(() => {
    if (!paymentLogsFocus?.invoiceId) return;
    const timer = window.setTimeout(() => {
      document
        .getElementById(`invoice-row-${paymentLogsFocus.invoiceId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [paymentLogsFocus?.invoiceId, currentPage]);
}
