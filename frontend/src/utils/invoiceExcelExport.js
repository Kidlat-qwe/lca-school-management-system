import * as XLSX from 'xlsx';
import { formatDateManila } from './dateUtils.js';

/** Column key used for invoice Excel exports across Finance / Admin / Superfinance / Superadmin. */
export const INVOICE_EXPORT_AMOUNT_KEY = 'Amount (PHP)';

/** Default column widths matching existing invoice export layouts (8 columns). */
export const INVOICE_EXPORT_COL_WIDTHS = [
  { wch: 14 },
  { wch: 12 },
  { wch: 34 },
  { wch: 22 },
  { wch: 14 },
  { wch: 14 },
  { wch: 14 },
  { wch: 14 },
];

/** Excel columns when exporting completed payments by payment date (matches Financial Dashboard revenue). */
export const PAYMENT_DATE_EXPORT_COL_WIDTHS = [
  { wch: 14 },
  { wch: 12 },
  { wch: 34 },
  { wch: 22 },
  { wch: 16 },
  { wch: 14 },
  { wch: 14 },
  { wch: 16 },
];

/**
 * One row per completed payment (Manila payment date filter applied by API).
 *
 * Status column shows the parent **invoice's** status (Paid / Partially Paid /
 * Unpaid) so it stays in the same vocabulary as the user's status checkboxes
 * on the Invoice page. Falls back to payment.approval_status / payment.status
 * for legacy rows where invoice_status isn't available.
 */
export function mapCompletedPaymentsToExportRows(payments) {
  return (payments || []).map((p) => ({
    'Invoice ID': p.invoice_id ? `INV-${p.invoice_id}` : '-',
    'Acknowledgement Receipt#': p.invoice_ar_number || '-',
    'Student Name(s)': p.student_name || '-',
    Branch: p.branch_name || '-',
    Status: p.invoice_status || p.approval_status || p.status || '-',
    'Amount (PHP)': (Number(p.payable_amount || 0) + Number(p.tip_amount || 0)).toFixed(2),
    'Payment Date': p.payment_date ? formatDateManila(`${p.payment_date}T12:00:00+08:00`) : '-',
    'Invoice Issue Date': p.invoice_issue_date ? formatDateManila(`${p.invoice_issue_date}T12:00:00+08:00`) : '-',
  }));
}

/**
 * Apply the user's invoice-status checkbox filter to a payment record
 * (used by the payment-date Excel export). Matches against the parent
 * invoice's status (`payment.invoice_status`), with a soft fallback on
 * `approval_status` / `status` for legacy rows that didn't carry the
 * invoice status from the API.
 *
 * Same null/empty semantics as `shouldIncludeInvoiceByStatuses`:
 * - null/undefined => no filter, include everything.
 * - []             => exclude everything.
 */
export function shouldIncludePaymentByInvoiceStatuses(payment, allowedStatuses) {
  if (allowedStatuses == null) return true;
  if (!Array.isArray(allowedStatuses)) return true;
  const target = String(
    payment?.invoice_status || payment?.approval_status || payment?.status || ''
  ).trim().toLowerCase();
  return allowedStatuses.some(
    (allowed) => String(allowed || '').trim().toLowerCase() === target
  );
}

/**
 * Maps an unpaid invoice into the same shape as a completed-payment row
 * so we can merge it into the payment-date Excel export. Used when the
 * user opts in via the "Unpaid" status checkbox while a payment date
 * range is set: unpaid invoices have no payment date, so we surface
 * the invoice issue date and leave Payment Date blank.
 */
export function mapUnpaidInvoiceToPaymentExportRow(invoice) {
  const studentNames = Array.isArray(invoice?.students)
    ? invoice.students
        .map((s) => s?.full_name)
        .filter(Boolean)
        .join(', ')
    : '';
  return {
    'Invoice ID': invoice?.invoice_id ? `INV-${invoice.invoice_id}` : '-',
    'Acknowledgement Receipt#': invoice?.invoice_ar_number || '-',
    'Student Name(s)': studentNames || '-',
    Branch: invoice?.branch_name || invoice?.branch_nickname || '-',
    Status: invoice?.status || 'Unpaid',
    'Amount (PHP)': Number(invoice?.amount || 0).toFixed(2),
    'Payment Date': '-',
    'Invoice Issue Date': invoice?.issue_date
      ? formatDateManila(`${String(invoice.issue_date).slice(0, 10)}T12:00:00+08:00`)
      : '-',
  };
}

/**
 * Fetches unpaid invoices to merge into a payment-date Excel export.
 *
 * The user's payment-date range is reused as the **issue-date** range
 * for unpaid invoices (they have no payment date yet, so issue date
 * is the natural anchor). Returns the merged set across all branches.
 *
 * @param {(path: string) => Promise<any>} apiRequest
 * @param {{ branchIds: Array<string|number>, issueDateFrom?: string, issueDateTo?: string }} opts
 */
export async function fetchUnpaidInvoicesForPaymentDateExport(apiRequest, opts) {
  const { branchIds = [], issueDateFrom = '', issueDateTo = '' } = opts || {};
  if (!Array.isArray(branchIds) || branchIds.length === 0) return [];

  const buildParams = (branchId, page) => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', '100');
    params.set('status', 'Unpaid');
    if (branchId != null && String(branchId).trim() !== '') {
      params.set('branch_id', String(branchId));
    }
    if (issueDateFrom) params.set('issue_date_from', issueDateFrom);
    if (issueDateTo) params.set('issue_date_to', issueDateTo);
    return params;
  };

  const fetchBranch = async (branchId) => {
    const collected = [];
    let page = 1;
    let total = Infinity;
    while (collected.length < total) {
      const params = buildParams(branchId, page);
      const response = await apiRequest(`/invoices?${params.toString()}`);
      const rows = response?.data || [];
      const paginationTotal = response?.pagination?.total ?? rows.length;
      total = Number(paginationTotal) || rows.length;
      collected.push(...rows);
      if (rows.length < 100) break;
      page += 1;
    }
    return collected;
  };

  const batches = await Promise.all(branchIds.map((bid) => fetchBranch(bid)));
  return batches.flat();
}

/**
 * When `includeUnpaid` is false, rows with status "Unpaid" (case-insensitive) are excluded from export.
 *
 * @deprecated Prefer `shouldIncludeInvoiceByStatuses` which supports
 * per-status checkbox filtering (Paid / Unpaid / Partially Paid /
 * Cancelled / etc). Kept for backward compatibility with callers that
 * still use the legacy single-flag UI.
 */
export function shouldIncludeInvoiceInExport(invoice, includeUnpaid) {
  if (includeUnpaid) return true;
  const s = String(invoice?.status || '').trim().toLowerCase();
  return s !== 'unpaid';
}

/**
 * Returns true if the invoice's status is in the user-selected list.
 *
 * Semantics:
 * - `allowedStatuses` is null/undefined => no filter, include everything.
 * - `allowedStatuses` is an empty array => exclude everything.
 * - Otherwise: include only invoices whose status (case-insensitive,
 *   trimmed) matches one of the allowed statuses.
 *
 * Used by the per-status checkbox filter in the Excel export modal on
 * the Invoice page (every role variant).
 */
export function shouldIncludeInvoiceByStatuses(invoice, allowedStatuses) {
  if (allowedStatuses == null) return true;
  if (!Array.isArray(allowedStatuses)) return true;
  const target = String(invoice?.status || '').trim().toLowerCase();
  return allowedStatuses.some(
    (allowed) => String(allowed || '').trim().toLowerCase() === target
  );
}

/**
 * Default invoice statuses presented as checkboxes in the export
 * modal. Kept here so every role page stays consistent and a new
 * status only needs to be added once.
 *
 * Note: "Cancelled" is intentionally excluded from the export filter
 * UI per business decision — cancelled invoices shouldn't typically
 * be part of payment / receivable exports.
 */
export const INVOICE_EXPORT_DEFAULT_STATUSES = [
  'Paid',
  'Partially Paid',
  'Unpaid',
];

/**
 * Cash collected on an invoice: paid_amount + total_tip_amount (same as API `total_received_amount`).
 * Matches Financial Dashboard revenue (payable + tip per payment). For invoices with no payments yet,
 * uses remaining billed amount so Unpaid exports still show the bill.
 */
export function getInvoiceExportCollectedAmount(invoice) {
  if (!invoice) return 0;
  const paid = Number(invoice.paid_amount ?? 0);
  const tip = Number(invoice.total_tip_amount ?? 0);
  if (paid !== 0 || tip !== 0) {
    return paid + tip;
  }
  const tr = invoice.total_received_amount;
  if (tr != null && tr !== '' && Number.isFinite(Number(tr)) && Number(tr) !== 0) {
    return Number(tr);
  }
  return Number(invoice.amount ?? 0);
}

function appendAmountTotalRow(ws, exportRows) {
  const amountKey = INVOICE_EXPORT_AMOUNT_KEY;
  const sum = exportRows.reduce((acc, row) => {
    const raw = String(row[amountKey] ?? '').replace(/,/g, '');
    const n = parseFloat(raw);
    return acc + (Number.isFinite(n) ? n : 0);
  }, 0);
  const ref = ws['!ref'];
  if (!ref) return;
  const range = XLSX.utils.decode_range(ref);
  const totalRow = range.e.r + 1;
  const headers = Object.keys(exportRows[0]);
  const amountCol = headers.indexOf(amountKey);
  if (amountCol < 0) return;

  ws[XLSX.utils.encode_cell({ r: totalRow, c: 0 })] = { t: 's', v: 'Total amount' };
  ws[XLSX.utils.encode_cell({ r: totalRow, c: amountCol })] = {
    t: 'n',
    v: Math.round(sum * 100) / 100,
    z: '#,##0.00',
  };
  ws['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: totalRow, c: range.e.c },
  });
}

/**
 * Builds a workbook with one sheet: data rows plus a final "Total" row under the amount column.
 */
export function createInvoiceExportWorkbook(exportRows, options = {}) {
  const { sheetName = 'Invoices', colWidths = null } = options;
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(exportRows);
  if (colWidths) {
    ws['!cols'] = colWidths;
  }
  if (exportRows.length > 0) {
    appendAmountTotalRow(ws, exportRows);
  }
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return wb;
}

/**
 * Create sheet (with total row) and download as .xlsx.
 */
export function downloadInvoiceExportXlsx(exportRows, filename, options = {}) {
  const wb = createInvoiceExportWorkbook(exportRows, options);
  XLSX.writeFile(wb, filename);
}
