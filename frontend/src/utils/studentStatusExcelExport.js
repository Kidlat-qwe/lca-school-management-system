import * as XLSX from 'xlsx';
import { formatDateTimeManila } from './dateUtils.js';

export const STUDENT_STATUS_EXPORT_OPTIONS = [
  { value: 'active', label: 'Active only' },
  { value: 'inactive', label: 'Inactive only' },
  { value: 'all', label: 'All (active + inactive)' },
];

export const STUDENT_STATUS_EXPORT_COL_WIDTHS = [
  { wch: 28 },
  { wch: 32 },
  { wch: 16 },
  { wch: 28 },
  { wch: 12 },
  { wch: 28 },
  { wch: 22 },
];

/**
 * Map Student Status report API rows to Excel columns.
 * @param {Array<object>} rows
 * @param {string} summaryMonth YYYY-MM
 */
export function mapStudentStatusRowsToExportRows(rows, summaryMonth = '') {
  return (rows || []).map((row) => ({
    'Student Name': row.full_name || '-',
    Email: row.email || '-',
    'Level Tag': row.level_tag || '-',
    Branch: row.branch_name || '-',
    Status: row.status || '-',
    'Matrix Labels': row.matrix_labels || '—',
    'Billing Month': row.matrix_month || summaryMonth || '-',
    'Updated At': row.updated_at
      ? formatDateTimeManila(row.updated_at, { hour12: true })
      : '-',
  }));
}

/**
 * Download Student Status report as .xlsx.
 * @param {Array<object>} rows
 * @param {string} filename
 * @param {{ summaryMonth?: string, sheetName?: string, statusScope?: string }} options
 */
export function downloadStudentStatusExportXlsx(rows, filename, options = {}) {
  const {
    summaryMonth = '',
    sheetName = 'Student Status',
    statusScope = 'all',
  } = options;
  const exportRows = mapStudentStatusRowsToExportRows(rows, summaryMonth);
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(exportRows);
  ws['!cols'] = STUDENT_STATUS_EXPORT_COL_WIDTHS;
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));

  const scopeLabel =
    statusScope === 'active'
      ? 'active'
      : statusScope === 'inactive'
        ? 'inactive'
        : 'all';
  const safeMonth = String(summaryMonth || 'month').replace(/[^\d-]/g, '');
  const safeName =
    filename || `Student_Status_${scopeLabel}_${safeMonth}.xlsx`;
  XLSX.writeFile(wb, safeName);
}
