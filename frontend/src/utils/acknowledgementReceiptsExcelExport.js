import * as XLSX from 'xlsx';

const AR_EXPORT_AMOUNT_KEY = 'Total Amount (PHP)';

function appendArAmountTotalRow(ws, rows) {
  if (!rows.length) return;
  const ref = ws['!ref'];
  if (!ref) return;

  const headers = Object.keys(rows[0]);
  const amountCol = headers.indexOf(AR_EXPORT_AMOUNT_KEY);
  if (amountCol < 0) return;

  const sum = rows.reduce((acc, row) => {
    const n = parseFloat(String(row[AR_EXPORT_AMOUNT_KEY] ?? '').replace(/,/g, ''));
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

/**
 * Download acknowledgement receipts as .xlsx.
 *
 * @param {Array<Record<string, string | number>>} rows
 * @param {string} filename
 */
export function downloadAcknowledgementReceiptsXlsx(rows, filename = 'Acknowledgement_Receipts.xlsx') {
  const safeRows = Array.isArray(rows) ? rows : [];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(safeRows);
  if (safeRows.length > 0) {
    appendArAmountTotalRow(ws, safeRows);
  }

  ws['!cols'] = [
    { wch: 10 }, // AR ID
    { wch: 28 }, // Student Name
    { wch: 28 }, // Guardian Name
    { wch: 42 }, // Package / Items
    { wch: 16 }, // Level Tag
    { wch: 18 }, // Total Amount
    { wch: 22 }, // Branch
    { wch: 16 }, // Status
    { wch: 18 }, // Payment Method
    { wch: 22 }, // Reference Number
    { wch: 14 }, // Issue Date
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Acknowledgement Receipts');
  XLSX.writeFile(wb, filename);
}
