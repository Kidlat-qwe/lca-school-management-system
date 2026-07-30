import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../../config/api';
import { appAlert, appConfirm } from '../../utils/appAlert';

/**
 * Settings → Archived Classes panel.
 * Lists soft-archived classes; restore or permanently delete within 30-day window.
 */
export default function ArchivedClassesPanel({ branchId = null }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rows, setRows] = useState([]);
  const [busyId, setBusyId] = useState(null);

  const fetchArchived = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const qs =
        branchId != null && Number.isFinite(Number(branchId))
          ? `?branch_id=${Number(branchId)}`
          : '';
      const res = await apiRequest(`/classes/archived${qs}`);
      setRows(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setError(err.message || 'Failed to load archived classes');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    fetchArchived();
  }, [fetchArchived]);

  const handleRestore = async (classId, className) => {
    if (
      !(await appConfirm({
        title: 'Restore class',
        message: `Restore “${className}” to the main Classes list?`,
        confirmLabel: 'Restore',
      }))
    ) {
      return;
    }
    setBusyId(classId);
    try {
      await apiRequest(`/classes/${classId}/restore`, { method: 'POST' });
      await fetchArchived();
      appAlert('Class restored. It will appear again on the Classes page.');
    } catch (err) {
      appAlert(err.message || 'Failed to restore class');
    } finally {
      setBusyId(null);
    }
  };

  const handlePermanentDelete = async (classId, className) => {
    if (
      !(await appConfirm({
        title: 'Permanently delete class',
        message: `Permanently delete “${className}”? This cannot be undone. Enrollment history for this class will be removed.`,
        destructive: true,
        confirmLabel: 'Delete permanently',
      }))
    ) {
      return;
    }
    setBusyId(classId);
    try {
      await apiRequest(`/classes/${classId}/permanent`, { method: 'DELETE' });
      await fetchArchived();
      appAlert('Class permanently deleted.');
    } catch (err) {
      appAlert(err.message || 'Failed to permanently delete class');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Archived Classes</h2>
          <p className="mt-1 text-sm text-gray-500">
            Classes removed from the main list are kept here for 30 days. Restore them, or they are
            permanently deleted after the purge date.
          </p>
        </div>
        <button
          type="button"
          onClick={fetchArchived}
          disabled={loading}
          className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {error ? (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-gray-500">Loading archived classes…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500">No archived classes.</p>
      ) : (
        <div
          className="overflow-x-auto rounded-lg"
          style={{
            scrollbarWidth: 'thin',
            scrollbarColor: '#cbd5e0 #f7fafc',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          <table style={{ width: '100%', minWidth: '920px' }} className="text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                <th className="px-3 py-2">Class</th>
                <th className="px-3 py-2">Branch</th>
                <th className="px-3 py-2">Program</th>
                <th className="px-3 py-2">End date</th>
                <th className="px-3 py-2">Archived</th>
                <th className="px-3 py-2">Purge on</th>
                <th className="px-3 py-2">Days left</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const id = row.class_id;
                const busy = busyId === id;
                return (
                  <tr key={id} className="border-b border-gray-100 hover:bg-gray-50/80">
                    <td className="px-3 py-2 font-medium text-gray-900">
                      {row.class_name || '—'}
                      {row.level_tag ? (
                        <span className="mt-0.5 block text-xs font-normal text-gray-500">
                          {row.level_tag}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-gray-700">{row.branch_name || '—'}</td>
                    <td className="px-3 py-2 text-gray-700">
                      {row.program_code || row.program_name || '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-700">{row.end_date || '—'}</td>
                    <td className="px-3 py-2 text-gray-700">
                      {row.archived_at || '—'}
                      {row.archived_by_name ? (
                        <span className="mt-0.5 block text-xs text-gray-500">
                          by {row.archived_by_name}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-gray-700">{row.archive_purge_after || '—'}</td>
                    <td className="px-3 py-2 text-gray-700">
                      {row.days_remaining != null ? row.days_remaining : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleRestore(id, row.class_name)}
                          className="rounded-md bg-[#F7C844] px-2.5 py-1.5 text-xs font-semibold text-gray-900 hover:bg-[#f0be2e] disabled:opacity-50"
                        >
                          Restore
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handlePermanentDelete(id, row.class_name)}
                          className="rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          Delete permanently
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
