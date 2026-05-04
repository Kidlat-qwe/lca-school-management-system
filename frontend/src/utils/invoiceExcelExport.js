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
 */
export function mapCompletedPaymentsToExportRows(payments) {
  return (payments || []).map((p) => ({
    'Invoice ID': p.invoice_id ? `INV-${p.invoice_id}` : '-',
    'AR #': p.invoice_ar_number || '-',
    'Student Name(s)': p.student_name || '-',
    Branch: p.branch_name || '-',
    Status: p.approval_status || p.status || '-',
    'Amount (PHP)': (Number(p.payable_amount || 0) + Number(p.tip_amount || 0)).toFixed(2),
    'Payment Date': p.payment_date ? formatDateManila(`${p.payment_date}T12:00:00+08:00`) : '-',
    'Invoice Issue Date': p.invoice_issue_date ? formatDateManila(`${p.invoice_issue_date}T12:00:00+08:00`) : '-',
  }));
}

/**
 * When `includeUnpaid` is false, rows with status "Unpaid" (case-insensitive) are excluded from export.
 */
export function shouldIncludeInvoiceInExport(invoice, includeUnpaid) {
  if (includeUnpaid) return true;
  const s = String(invoice?.status || '').trim().toLowerCase();
  return s !== 'unpaid';
}

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

  ws[XLSX.utils.encode_cell({ r: totalRow, c: 0 })] = { t: 's', v: 'Total' };
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
