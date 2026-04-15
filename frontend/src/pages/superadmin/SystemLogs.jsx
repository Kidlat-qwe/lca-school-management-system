import { useEffect, useState, useCallback } from 'react';
import { apiRequest } from '../../config/api';
import { useAuth } from '../../contexts/AuthContext';
import FixedTablePagination from '../../components/table/FixedTablePagination';
import { formatDateTimeManila } from '../../utils/dateUtils';

const ACTIONS = ['', 'GET', 'POST', 'UPDATE', 'DELETE'];

const formatLogTime = (iso) => {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return formatDateTimeManila(d);
  } catch {
    return iso;
  }
};

const SystemLogs = () => {
  const { userInfo } = useAuth();
  const isAdminOnly = (userInfo?.user_type || userInfo?.userType) === 'Admin';

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 25,
    total: 0,
    totalPages: 1,
  });

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(id);
  }, [search]);

  const fetchLogs = useCallback(
    async (page = 1) => {
      try {
        setLoading(true);
        setError('');
        const params = new URLSearchParams({
          page: String(page),
          limit: String(pagination.limit),
        });
        if (debouncedSearch) params.set('search', debouncedSearch);
        if (action) params.set('action', action);
        if (entityType.trim()) params.set('entity_type', entityType.trim());
        if (from) params.set('from', from);
        if (to) params.set('to', to);

        const res = await apiRequest(`/system-logs?${params.toString()}`);
        setRows(res.data || []);
        if (res.pagination) {
          setPagination((p) => ({
            ...p,
            page: res.pagination.page,
            total: res.pagination.total,
            totalPages: res.pagination.totalPages || 1,
          }));
        }
      } catch (err) {
        console.error(err);
        setError(err.message || 'Failed to load system logs.');
        setRows([]);
      } finally {
        setLoading(false);
      }
    },
    [debouncedSearch, action, entityType, from, to, pagination.limit]
  );

  useEffect(() => {
    fetchLogs(1);
  }, [debouncedSearch, action, entityType, from, to, fetchLogs]);

  const handlePageChange = (p) => {
    fetchLogs(p);
  };

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">System Logs</h1>
        <p className="text-sm text-gray-600 mt-1">
          Actions: GET (API reads and opening a screen), POST, UPDATE (PUT/PATCH), DELETE.{' '}
          {isAdminOnly
            ? 'Showing logs for your branch only.'
            : 'Superadmin: all branches. Admin users see their branch only.'}
        </p>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Search</label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Summary, path, user…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              autoComplete="off"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Action</label>
            <select
              value={action}
              onChange={(e) => setAction(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              {ACTIONS.map((a) => (
                <option key={a || 'all'} value={a}>
                  {a || 'All'}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Entity (area)</label>
            <input
              type="text"
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              placeholder="e.g. classes, payments"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              autoComplete="off"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3">{error}</div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div
          className="overflow-x-auto rounded-lg"
          style={{
            scrollbarWidth: 'thin',
            scrollbarColor: '#cbd5e0 #f7fafc',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          <table className="divide-y divide-gray-200" style={{ width: '100%', minWidth: '1100px' }}>
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                  Time
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                  User
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                  Role
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                  Branch
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                  Action
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                  Area
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                  HTTP
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[200px]">
                  Request
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[240px]">
                  Summary
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                  IP
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-gray-500 text-sm">
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-gray-500 text-sm">
                    No log entries yet. Activity appears after GET, POST, UPDATE, or DELETE operations.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.system_log_id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-xs text-gray-800 whitespace-nowrap">
                      {formatLogTime(r.created_at)}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-900">{r.user_full_name || '—'}</td>
                    <td className="px-3 py-2 text-xs text-gray-600">{r.user_type || '—'}</td>
                    <td className="px-3 py-2 text-xs text-gray-600 max-w-[120px] truncate" title={r.branch_name || ''}>
                      {r.branch_name || '—'}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <span className="inline-flex px-2 py-0.5 rounded bg-gray-100 text-gray-800 font-medium">
                        {r.action}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-700 font-mono">{r.entity_type || '—'}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">
                      <span className="font-mono">{r.http_method}</span>{' '}
                      {r.http_status != null && r.http_status !== '' ? (
                        <span
                          className={
                            r.http_status >= 400
                              ? 'text-red-600'
                              : r.http_status >= 300
                                ? 'text-amber-600'
                                : 'text-emerald-600'
                          }
                        >
                          {r.http_status}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-700 font-mono break-all max-w-xs">{r.request_path}</td>
                    <td className="px-3 py-2 text-xs text-gray-800">{r.summary}</td>
                    <td className="px-3 py-2 text-xs text-gray-500 font-mono whitespace-nowrap">{r.ip_address || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {!loading && rows.length > 0 && (
          <div className="px-4 pb-4">
            <FixedTablePagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              onPageChange={handlePageChange}
              totalItems={pagination.total}
              itemsPerPage={pagination.limit}
              itemLabel="entries"
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default SystemLogs;
