/**
 * Cross-navigation between Acknowledgement Receipts and Invoice list pages.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isArInvoiceCrossLinkParam, isArSearchCrossLinkParam } from './billingListCrossLink.js';

export function getBillingModuleBasePath(userType) {
  switch (String(userType || '').trim()) {
    case 'Admin':
      return '/admin';
    case 'Finance':
      return '/finance';
    case 'Superfinance':
      return '/superfinance';
    default:
      return '/superadmin';
  }
}

export function getInvoiceListPath(userType) {
  return `${getBillingModuleBasePath(userType)}/invoice`;
}

export function getAcknowledgementReceiptsListPath(userType) {
  return `${getBillingModuleBasePath(userType)}/acknowledgement-receipts`;
}

/** Link to Invoice list with row focus for INV-{id}. */
export function buildInvoiceListLink(userType, invoiceId) {
  const id = Number(invoiceId);
  if (!Number.isFinite(id) || id <= 0) return null;
  return `${getInvoiceListPath(userType)}?invoice_id=${id}`;
}

/** Link to AR list — prefer invoice_id (from Invoice page), then ack_receipt_id, then AR# search. */
export function buildAcknowledgementReceiptsListLink(userType, { ackReceiptId, arNumber, invoiceId } = {}) {
  const base = getAcknowledgementReceiptsListPath(userType);
  const invId = Number(invoiceId);
  if (Number.isFinite(invId) && invId > 0) {
    const num = String(arNumber || '').trim();
    if (num) {
      return `${base}?invoice_id=${invId}&ar_focus=1&search=${encodeURIComponent(num)}`;
    }
    return `${base}?invoice_id=${invId}&ar_focus=1`;
  }
  const arId = Number(ackReceiptId);
  if (Number.isFinite(arId) && arId > 0) {
    return `${base}?ack_receipt_id=${arId}`;
  }
  const arNum = String(arNumber || '').trim();
  if (arNum) {
    return `${base}?search=${encodeURIComponent(arNum)}&ar_focus=1`;
  }
  return null;
}

export function isInvoiceListFocused(invoice, focus) {
  if (!focus?.invoiceId || !invoice?.invoice_id) return false;
  return Number(invoice.invoice_id) === Number(focus.invoiceId);
}

export function isAckReceiptListFocused(receipt, focusAckReceiptId, focusInvoiceOnlyId = null) {
  if (receipt?.invoice_only_payment && focusInvoiceOnlyId) {
    return Number(receipt.linked_invoice_id) === Number(focusInvoiceOnlyId);
  }
  if (!focusAckReceiptId || !receipt?.ack_receipt_id) return false;
  return Number(receipt.ack_receipt_id) === Number(focusAckReceiptId);
}

export function getArListRowDomId(receipt) {
  if (receipt?.invoice_only_payment && receipt?.linked_invoice_id) {
    return `ar-row-invoice-${receipt.linked_invoice_id}`;
  }
  if (receipt?.ack_receipt_id) return `ar-row-${receipt.ack_receipt_id}`;
  return null;
}

function stripArCrossLinkParams(searchParams) {
  const next = new URLSearchParams(searchParams);
  next.delete('ack_receipt_id');
  next.delete('ar_focus');
  next.delete('invoice_id');
  return next;
}

function pickMatchingArRow(rows, searchRaw, invoiceId = null) {
  const invId = Number(invoiceId);
  if (Number.isFinite(invId) && invId > 0) {
    const byInvoice =
      rows.find((row) => Number(row?.linked_invoice_id) === invId) ||
      rows.find((row) => row?.invoice_only_payment && Number(row?.linked_invoice_id) === invId);
    if (byInvoice) return byInvoice;
  }
  const needle = String(searchRaw || '').trim();
  if (!needle) return rows[0] || null;
  return (
    rows.find((row) => {
      const arNum = String(
        row?.display_ar_number || row?.receipt_ar_number || row?.invoice_ar_number || ''
      ).trim();
      return arNum === needle || String(row?.ack_receipt_id) === needle;
    }) || rows[0] || null
  );
}

/**
 * Focus an AR row when opened from Invoice page.
 * Uses layout effect so cross-link fetch runs before list auto-fetch effects.
 */
export function useAckReceiptFocusFromQuery({
  searchParams,
  setSearchParams,
  setSearchTerm,
  clearListDateFilters,
  refetchListForCrossLink,
  suppressAutoListFetchRef,
  pendingArCrossLinkRef,
  apiRequest,
  sortedReceipts,
  paginationPage,
}) {
  const [focusAckReceiptId, setFocusAckReceiptId] = useState(null);
  const [focusInvoiceOnlyId, setFocusInvoiceOnlyId] = useState(null);
  const [crossLinkLoadedReceipt, setCrossLinkLoadedReceipt] = useState(null);
  const handledRef = useRef(null);
  const refetchRef = useRef(refetchListForCrossLink);
  refetchRef.current = refetchListForCrossLink;

  useEffect(() => {
    if (
      !searchParams.get('ack_receipt_id') &&
      !isArSearchCrossLinkParam(searchParams) &&
      !isArInvoiceCrossLinkParam(searchParams)
    ) {
      handledRef.current = null;
    }
  }, [searchParams]);

  useLayoutEffect(() => {
    const ackRaw = searchParams.get('ack_receipt_id');
    const searchCrossLink = isArSearchCrossLinkParam(searchParams);
    const invoiceCrossLink = isArInvoiceCrossLinkParam(searchParams);
    const searchRaw = String(searchParams.get('search') || '').trim();
    const invoiceCrossLinkId = invoiceCrossLink ? Number(searchParams.get('invoice_id')) : null;

    const ackId = ackRaw != null && ackRaw !== '' ? Number(ackRaw) : null;
    const hasAckId = Number.isFinite(ackId) && ackId > 0;

    if (!hasAckId && !searchCrossLink && !invoiceCrossLink) return;

    const handleKey = hasAckId
      ? `ack:${ackId}`
      : invoiceCrossLink
        ? `inv:${invoiceCrossLinkId}`
        : `search:${searchRaw}`;
    if (!handleKey || handleKey === 'search:') return;

    if (handledRef.current === handleKey) return;
    handledRef.current = handleKey;

    if (suppressAutoListFetchRef) suppressAutoListFetchRef.current = true;
    if (pendingArCrossLinkRef) pendingArCrossLinkRef.current = true;
    clearListDateFilters?.();
    setCrossLinkLoadedReceipt(null);

    if (searchRaw) setSearchTerm(searchRaw);

    let cancelled = false;

    (async () => {
      try {
        if (hasAckId) {
          setFocusAckReceiptId(ackId);
          setSearchTerm(String(ackId));
          await refetchRef.current?.(String(ackId), { invoiceId: null });
          if (cancelled) return;

          const response = await apiRequest(`/acknowledgement-receipts/${ackId}`);
          if (cancelled) return;
          const ar = response?.data ?? response;
          if (ar?.ack_receipt_id) {
            setCrossLinkLoadedReceipt(ar);
          }
          const arNum =
            ar?.display_ar_number || ar?.receipt_ar_number || ar?.invoice_ar_number || '';
          const search = arNum ? String(arNum) : String(ackId);
          if (search !== String(ackId)) {
            setSearchTerm(search);
            await refetchRef.current?.(search, { invoiceId: null });
          }
          return;
        }

        if (invoiceCrossLink) {
          const invResponse = await apiRequest(`/invoices/${invoiceCrossLinkId}`);
          if (cancelled) return;
          const invoice = invResponse?.data ?? invResponse;
          const resolvedAckId = Number(invoice?.ack_receipt_id);
          const arNum = String(invoice?.invoice_ar_number || searchRaw || '').trim();

          if (Number.isFinite(resolvedAckId) && resolvedAckId > 0) {
            setFocusInvoiceOnlyId(null);
            setFocusAckReceiptId(resolvedAckId);
            setSearchTerm(arNum || String(resolvedAckId));
            await refetchRef.current?.(arNum || String(resolvedAckId), {
              invoiceId: invoiceCrossLinkId,
            });
            if (cancelled) return;
            const arResponse = await apiRequest(`/acknowledgement-receipts/${resolvedAckId}`);
            if (cancelled) return;
            const ar = arResponse?.data ?? arResponse;
            if (ar?.ack_receipt_id) {
              setCrossLinkLoadedReceipt(ar);
            }
            return;
          }

          if (arNum) {
            setSearchTerm(arNum);
            const rows =
              (await refetchRef.current?.(arNum, { invoiceId: invoiceCrossLinkId })) || [];
            if (cancelled) return;
            const match = pickMatchingArRow(rows, arNum, invoiceCrossLinkId);
            if (match?.invoice_only_payment && match?.linked_invoice_id) {
              setFocusAckReceiptId(null);
              setFocusInvoiceOnlyId(match.linked_invoice_id);
              setCrossLinkLoadedReceipt(match);
            } else if (match?.ack_receipt_id) {
              setFocusInvoiceOnlyId(null);
              setFocusAckReceiptId(match.ack_receipt_id);
              setCrossLinkLoadedReceipt(match);
            }
          }
          return;
        }

        setSearchTerm(searchRaw);
        const rows = (await refetchRef.current?.(searchRaw, { invoiceId: null })) || [];
        if (cancelled) return;
        const match = pickMatchingArRow(rows, searchRaw);
        if (match?.invoice_only_payment && match?.linked_invoice_id) {
          setFocusAckReceiptId(null);
          setFocusInvoiceOnlyId(match.linked_invoice_id);
          setCrossLinkLoadedReceipt(match);
        } else if (match?.ack_receipt_id) {
          setFocusInvoiceOnlyId(null);
          setFocusAckReceiptId(match.ack_receipt_id);
          setCrossLinkLoadedReceipt(match);
        }
      } catch (err) {
        console.error('Failed to load acknowledgement receipt from invoice cross-link:', err);
      } finally {
        if (suppressAutoListFetchRef) suppressAutoListFetchRef.current = false;
        if (pendingArCrossLinkRef) pendingArCrossLinkRef.current = false;
        if (!cancelled) {
          setSearchParams(stripArCrossLinkParams(searchParams), { replace: true });
        }
      }
    })();

    return () => {
      cancelled = true;
      if (suppressAutoListFetchRef) suppressAutoListFetchRef.current = false;
      if (pendingArCrossLinkRef) pendingArCrossLinkRef.current = false;
    };
  }, [
    searchParams,
    setSearchParams,
    setSearchTerm,
    clearListDateFilters,
    refetchListForCrossLink,
    suppressAutoListFetchRef,
    pendingArCrossLinkRef,
    apiRequest,
  ]);

  useEffect(() => {
    if (!focusAckReceiptId && !focusInvoiceOnlyId) return;
    const timer = window.setTimeout(() => {
      const el = focusInvoiceOnlyId
        ? document.getElementById(`ar-row-invoice-${focusInvoiceOnlyId}`)
        : document.getElementById(`ar-row-${focusAckReceiptId}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [focusAckReceiptId, focusInvoiceOnlyId, sortedReceipts, paginationPage]);

  return { focusAckReceiptId, focusInvoiceOnlyId, crossLinkLoadedReceipt };
}
