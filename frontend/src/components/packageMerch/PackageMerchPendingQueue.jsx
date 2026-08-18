import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../config/api';
import { appAlert, appConfirm } from '../../utils/appAlert';
import { formatDateManila } from '../../utils/dateUtils';
import FixedTablePagination, {
  TablePaginationSummary,
} from '../table/FixedTablePagination';

const PAGE_SIZE = 10;

/**
 * Staff queue: package merch still owed after enroll/pay at 0 stock.
 * Out-of-stock enrollments first; latest enrolled student on row 1.
 */
export default function PackageMerchPendingQueue({
  branchId = null,
  showBranchColumn = false,
  active = true,
}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [issuingKey, setIssuingKey] = useState(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);

  const fetchRows = async () => {
    if (!active) return;
    try {
      setLoading(true);
      setError('');
      const params = new URLSearchParams();
      if (branchId) params.set('branch_id', String(branchId));
      const qs = params.toString();
      const response = await apiRequest(
        `/merchandise/package-pending${qs ? `?${qs}` : ''}`
      );
      setRows(Array.isArray(response.data) ? response.data : []);
      setPage(1);
    } catch (err) {
      console.error('Error loading pending package merch:', err);
      setError(err.message || 'Failed to load pending merchandise');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, branchId]);

  const handleIssue = async (row) => {
    if (!row?.can_issue) {
      await appAlert(row?.block_reason || 'Cannot issue this item yet.');
      return;
    }
    const label = [row.merchandise_name, row.size, row.category]
      .filter(Boolean)
      .join(' · ');
    const ok = await appConfirm(
      `Issue ${label || 'this item'} to ${row.student_name}? This deducts 1 from branch stock.`
    );
    if (!ok) return;
    try {
      setIssuingKey(`${row.invoice_id}-${row.line_key}`);
      await apiRequest('/merchandise/package-pending/issue', {
        method: 'POST',
        body: JSON.stringify({
          invoice_id: row.invoice_id,
          student_id: row.student_id,
          line_key: row.line_key,
        }),
      });
      await fetchRows();
    } catch (err) {
      await appAlert(err.message || 'Failed to issue merchandise');
    } finally {
      setIssuingKey(null);
    }
  };

  const readyCount = useMemo(
    () => rows.filter((row) => row.can_issue).length,
    [rows]
  );
  const oosCount = useMemo(
    () =>
      rows.filter(
        (row) =>
          row.has_first_payment &&
          !row.can_issue &&
          Number(row.available_quantity) <= 0
      ).length,
    [rows]
  );

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE) || 1);
  const safePage = Math.min(page, totalPages);
  const pagedRows = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return rows.slice(start, start + PAGE_SIZE);
  }, [rows, safePage]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const minWidth = showBranchColumn ? '1020px' : '920px';

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Pending issue</h2>
          <p className="text-sm text-gray-500">
            Package items still owed when branch stock is 0. Latest enrolled student first. After restock,
            Issue when the student receives the item.
          </p>
        </div>
        <button
          type="button"
          onClick={fetchRows}
          disabled={loading}
          className="self-start px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>
      {readyCount > 0 ? (
        <p className="text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          {readyCount} item{readyCount === 1 ? '' : 's'} in stock and ready to issue.
        </p>
      ) : null}
      {oosCount > 0 ? (
        <p className="text-xs font-medium text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {oosCount} item{oosCount === 1 ? '' : 's'} still out of stock — request stock, then Issue.
        </p>
      ) : null}
      {error ? (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      ) : null}
      {loading && rows.length === 0 ? (
        <p className="text-sm text-gray-500 py-8 text-center">Loading pending merchandise…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500 py-8 text-center">
          No pending package merchandise. Enrollments with 0 stock will appear here until issued.
        </p>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="px-4 pt-3">
            <TablePaginationSummary
              page={safePage}
              totalItems={rows.length}
              itemsPerPage={PAGE_SIZE}
              itemLabel="pending items"
            />
          </div>
          <div
            className="overflow-x-auto rounded-lg"
            style={{
              scrollbarWidth: 'thin',
              scrollbarColor: '#cbd5e0 #f7fafc',
              WebkitOverflowScrolling: 'touch',
            }}
          >
            <table className="divide-y divide-gray-200" style={{ width: '100%', minWidth }}>
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Student</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Class</th>
                  {showBranchColumn ? (
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Branch</th>
                  ) : null}
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Size</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Stock</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Payment</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Enrolled</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {pagedRows.map((row) => {
                  const rowKey = `${row.invoice_id}-${row.line_key}`;
                  const qty = Number(row.available_quantity);
                  return (
                    <tr key={rowKey} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-sm text-gray-900">
                        <div className="font-medium">{row.student_name}</div>
                        <div className="text-xs text-gray-500 truncate max-w-[180px]">
                          {row.package_name || 'Package'}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-700">{row.class_name || '—'}</td>
                      {showBranchColumn ? (
                        <td className="px-3 py-2 text-sm text-gray-700">{row.branch_name || '—'}</td>
                      ) : null}
                      <td className="px-3 py-2 text-sm text-gray-900">
                        <div>{row.merchandise_name}</div>
                        {row.original_type_name &&
                        row.original_type_name !== row.merchandise_name ? (
                          <div className="text-xs text-gray-500">
                            Swapped from {row.original_type_name}
                          </div>
                        ) : null}
                        {row.sku ? (
                          <div className="text-xs text-gray-400">{row.sku}</div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-700">
                        {[row.size, row.category].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="px-3 py-2 text-sm">
                        <span
                          className={
                            qty > 0
                              ? 'text-emerald-700 font-medium'
                              : 'text-red-700 font-medium'
                          }
                        >
                          {Number.isFinite(qty) ? qty : 0}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-sm">
                        {row.has_first_payment ? (
                          <span className="text-emerald-700">Paid</span>
                        ) : (
                          <span className="text-amber-700">Unpaid</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-600 whitespace-nowrap">
                        {row.enrolled_at
                          ? formatDateManila(row.enrolled_at)
                          : row.invoice_issue_date
                            ? formatDateManila(row.invoice_issue_date)
                            : '—'}
                      </td>
                      <td className="px-3 py-2 text-sm">
                        <button
                          type="button"
                          disabled={!row.can_issue || issuingKey === rowKey}
                          title={row.block_reason || 'Issue to student'}
                          onClick={() => handleIssue(row)}
                          className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-[#F7C844] text-gray-900 hover:bg-[#F5B82E] disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {issuingKey === rowKey ? 'Issuing…' : 'Issue'}
                        </button>
                        {!row.can_issue && row.block_reason ? (
                          <div className="text-[10px] text-gray-500 mt-1 max-w-[140px] leading-snug">
                            {row.block_reason}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 pb-4">
            <FixedTablePagination
              page={safePage}
              totalPages={totalPages}
              totalItems={rows.length}
              itemsPerPage={PAGE_SIZE}
              itemLabel="pending items"
              onPageChange={setPage}
            />
          </div>
        </div>
      )}
    </div>
  );
}
