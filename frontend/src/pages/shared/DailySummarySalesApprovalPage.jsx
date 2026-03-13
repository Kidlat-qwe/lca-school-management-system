import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../config/api';
import { formatDateManila } from '../../utils/dateUtils';

const DailySummarySalesApprovalPage = () => {
  const [summaries, setSummaries] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterBranch, setFilterBranch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1 });
  const [approvingId, setApprovingId] = useState(null);
  const [rejectModal, setRejectModal] = useState({ open: false, id: null, remarks: '' });
  const [detailModal, setDetailModal] = useState({ open: false, summary: null });
  const [openMenuId, setOpenMenuId] = useState(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });

  const fetchSummaries = async (page = 1) => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (filterBranch) params.set('branch_id', filterBranch);
      if (filterStatus) params.set('status', filterStatus);
      if (filterDate) params.set('summary_date', filterDate);
      const res = await apiRequest(`/daily-summary-sales?${params.toString()}`);
      setSummaries(res.data || []);
      if (res.pagination) {
        setPagination({
          page: res.pagination.page,
          limit: res.pagination.limit,
          total: res.pagination.total,
          totalPages: res.pagination.totalPages || 1,
        });
      }
      setError('');
    } catch (err) {
      setError(err.message || 'Failed to load daily summaries');
      setSummaries([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchBranches = async () => {
    try {
      const res = await apiRequest('/branches?limit=200');
      setBranches(res.data || []);
    } catch (err) {
      console.error('Fetch branches error:', err);
    }
  };

  useEffect(() => {
    fetchSummaries(1);
  }, [filterBranch, filterStatus, filterDate]);

  useEffect(() => {
    fetchBranches();
  }, []);

  const handleApprove = async (id) => {
    setApprovingId(id);
    try {
      await apiRequest(`/daily-summary-sales/${id}/approve`, {
        method: 'PUT',
        body: JSON.stringify({ approve: true }),
      });
      await fetchSummaries(pagination.page);
    } catch (err) {
      alert(err.response?.data?.message || err.message || 'Failed to approve');
    } finally {
      setApprovingId(null);
    }
  };

  const handleReject = async () => {
    const { id, remarks } = rejectModal;
    if (!id) return;
    setApprovingId(id);
    try {
      await apiRequest(`/daily-summary-sales/${id}/approve`, {
        method: 'PUT',
        body: JSON.stringify({ approve: false, remarks: remarks.trim() || undefined }),
      });
      setRejectModal({ open: false, id: null, remarks: '' });
      await fetchSummaries(pagination.page);
    } catch (err) {
      alert(err.response?.data?.message || err.message || 'Failed to reject');
    } finally {
      setApprovingId(null);
    }
  };

  const statusBadge = (status) => {
    const classes = {
      Submitted: 'bg-yellow-100 text-yellow-800',
      Approved: 'bg-green-100 text-green-800',
      Rejected: 'bg-red-100 text-red-800',
    };
    return (
      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${classes[status] || 'bg-gray-100 text-gray-800'}`}>
        {status}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Daily Summary Sales</h1>
        <p className="mt-1 text-sm text-gray-600">
          Approve or reject daily sales summaries submitted by branch Admins for financial closing tracking.
        </p>
      </div>

      {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
          )}

          <div className="flex flex-wrap gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Branch</label>
          <select
            value={filterBranch}
            onChange={(e) => setFilterBranch(e.target.value)}
            className="input-field text-sm py-2 min-w-[160px]"
          >
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.branch_id} value={b.branch_id}>
                {b.branch_nickname || b.branch_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="input-field text-sm py-2 min-w-[140px]"
          >
            <option value="">All</option>
            <option value="Submitted">Submitted</option>
            <option value="Approved">Approved</option>
            <option value="Rejected">Rejected</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Date</label>
          <input
            type="date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            className="input-field text-sm py-2"
          />
        </div>
      </div>

      <div
        className="overflow-x-auto rounded-lg"
        style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}
      >
        <table className="min-w-full divide-y divide-gray-200" style={{ width: '100%', minWidth: '800px' }}>
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700">Branch</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700">Date</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700">Amount</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700">Payments</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700">Status</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700">Submitted By</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700">Approved By</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                  Loading...
                </td>
              </tr>
            ) : summaries.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                  No daily summaries found.
                </td>
              </tr>
            ) : (
              summaries.map((s) => (
                <tr key={s.daily_summary_id}>
                  <td className="px-4 py-3 text-sm text-gray-900">{s.branch_name || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-900">{formatDateManila(s.summary_date)}</td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">
                    ₱{(Number(s.total_amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">{s.payment_count ?? 0}</td>
                  <td className="px-4 py-3">{statusBadge(s.status)}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{s.submitted_by_name || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{s.approved_by_name || '-'}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap align-middle">
                    <div className="inline-flex items-center justify-end gap-2">
                      {s.status === 'Submitted' && (
                        <>
                          <button
                            onClick={() => handleApprove(s.daily_summary_id)}
                            disabled={!!approvingId}
                            className="text-sm font-medium text-green-600 hover:text-green-700 disabled:opacity-50"
                          >
                            {approvingId === s.daily_summary_id ? 'Approving...' : 'Approve'}
                          </button>
                          <button
                            onClick={() => setRejectModal({ open: true, id: s.daily_summary_id, remarks: '' })}
                            disabled={!!approvingId}
                            className="text-sm font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          const buttonEl = e.currentTarget;
                          const rect = buttonEl.getBoundingClientRect();
                          const viewportWidth = window.innerWidth;
                          const top = rect.bottom + 4;
                          const right = viewportWidth - rect.right;
                          setMenuPosition({ top, right });
                          setOpenMenuId((prev) =>
                            prev === s.daily_summary_id ? null : s.daily_summary_id
                          );
                        }}
                        className="inline-flex items-center justify-center w-8 h-8 rounded-full hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                        aria-label="More actions"
                      >
                        <svg className="w-4 h-4 text-gray-500" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M10 3a1.5 1.5 0 110-3 1.5 1.5 0 010 3zM10 11.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3zM10 20a1.5 1.5 0 110-3 1.5 1.5 0 010 3z" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between pt-2 border-t border-gray-200">
          <p className="text-sm text-gray-600">
            Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => fetchSummaries(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="px-3 py-1.5 text-sm rounded-md border border-gray-300 bg-white disabled:opacity-50"
            >
              Previous
            </button>
            <button
              onClick={() => fetchSummaries(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
              className="px-3 py-1.5 text-sm rounded-md border border-gray-300 bg-white disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {openMenuId &&
        typeof document !== 'undefined' &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-[9998] bg-transparent"
              onClick={() => setOpenMenuId(null)}
            />
            <div
              className="fixed z-[9999] w-40 bg-white rounded-md shadow-lg border border-gray-200 text-left"
              style={{ top: menuPosition.top, right: menuPosition.right }}
            >
              <button
                type="button"
                onClick={() => {
                  const summary = summaries.find((s) => s.daily_summary_id === openMenuId);
                  if (summary) {
                    setDetailModal({ open: true, summary });
                  }
                  setOpenMenuId(null);
                }}
                className="block w-full px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 text-left"
              >
                View details
              </button>
            </div>
          </>,
          document.body
        )}

      {rejectModal.open && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center backdrop-blur-sm bg-black/5 p-4" onClick={() => setRejectModal({ open: false, id: null, remarks: '' })}>
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900">Reject Daily Summary</h3>
            <p className="mt-2 text-sm text-gray-600">Optional: Add a reason for rejection.</p>
            <textarea
              value={rejectModal.remarks}
              onChange={(e) => setRejectModal((prev) => ({ ...prev, remarks: e.target.value }))}
              className="input-field mt-2 w-full min-h-[80px]"
              placeholder="Reason (optional)"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setRejectModal({ open: false, id: null, remarks: '' })}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handleReject}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700"
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}

      {detailModal.open && detailModal.summary && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center backdrop-blur-sm bg-black/5 p-4"
          onClick={() => setDetailModal({ open: false, summary: null })}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Daily Summary Details</h3>
                <p className="mt-1 text-xs text-gray-500">
                  Overview of this branch&apos;s submitted sales summary.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailModal({ open: false, summary: null })}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Close details"
              >
                <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs font-medium text-gray-500">Branch</p>
                <p className="mt-0.5 text-gray-900">{detailModal.summary.branch_name || '-'}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500">Date</p>
                <p className="mt-0.5 text-gray-900">
                  {detailModal.summary.summary_date ? formatDateManila(detailModal.summary.summary_date) : '-'}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500">Total Amount</p>
                <p className="mt-0.5 text-gray-900 font-semibold">
                  ₱
                  {(Number(detailModal.summary.total_amount) || 0).toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500">Payments Count</p>
                <p className="mt-0.5 text-gray-900">
                  {detailModal.summary.payment_count ?? 0}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500">Status</p>
                <div className="mt-1">{statusBadge(detailModal.summary.status)}</div>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500">Submitted By</p>
                <p className="mt-0.5 text-gray-900">
                  {detailModal.summary.submitted_by_name || '-'}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500">Submitted At</p>
                <p className="mt-0.5 text-gray-900">
                  {detailModal.summary.submitted_at
                    ? formatDateManila(detailModal.summary.submitted_at)
                    : '-'}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500">Approved By</p>
                <p className="mt-0.5 text-gray-900">
                  {detailModal.summary.approved_by_name || '-'}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500">Approved At</p>
                <p className="mt-0.5 text-gray-900">
                  {detailModal.summary.approved_at
                    ? formatDateManila(detailModal.summary.approved_at)
                    : '-'}
                </p>
              </div>
            </div>

            <div className="mt-4">
              <p className="text-xs font-medium text-gray-500">Remarks</p>
              <p className="mt-1 text-sm text-gray-800 whitespace-pre-line">
                {detailModal.summary.remarks && detailModal.summary.remarks.trim()
                  ? detailModal.summary.remarks
                  : 'No remarks.'}
              </p>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setDetailModal({ open: false, summary: null })}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DailySummarySalesApprovalPage;
