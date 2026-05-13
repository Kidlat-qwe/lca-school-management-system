import * as XLSX from 'xlsx';

/**
 * Column key for payment line amount in Payment Logs Excel exports.
 * Prefer summing TOTAL AMOUNT (matches Payment Logs table: payable + tip), fallback to legacy Amount (₱).
 */
export const PAYMENT_LOGS_EXPORT_TOTAL_AMOUNT_KEY = 'TOTAL AMOUNT';
export const PAYMENT_LOGS_EXPORT_LEGACY_AMOUNT_KEY = 'Amount (₱)';

/**
 * Appends a final row: label in column A, sum of amount column (numeric, 2 decimals).
 * @param {object} ws XLSX worksheet
 * @param {Array<Record<string, unknown>>} rows Same objects passed to json_to_sheet
 */
export function appendPaymentLogsAmountTotalRow(ws, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  const ref = ws['!ref'];
  if (!ref) return;
  const headers = Object.keys(rows[0]);
  const amountKey = headers.includes(PAYMENT_LOGS_EXPORT_TOTAL_AMOUNT_KEY)
    ? PAYMENT_LOGS_EXPORT_TOTAL_AMOUNT_KEY
    : PAYMENT_LOGS_EXPORT_LEGACY_AMOUNT_KEY;
  const amountCol = headers.indexOf(amountKey);
  if (amountCol < 0) return;

  const sum = rows.reduce((acc, row) => {
    const n = parseFloat(String(row[amountKey] ?? '').replace(/,/g, ''));
    return acc + (Number.isFinite(n) ? n : 0);
  }, 0);

  const range = XLSX.utils.decode_range(ref);
  const totalRow = range.e.r + 1;
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
