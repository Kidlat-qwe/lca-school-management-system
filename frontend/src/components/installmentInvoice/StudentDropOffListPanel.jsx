import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../../config/api';

/**
 * Shared panel for students whose unpaid installment phase will auto-drop
 * within the configured window (default 7 days).
 *
 * Used by:
 * - BranchAdminUpcomingDropAlertModal (Admin login modal only)
 * - Admin / Superadmin Installment Invoice "Student drop off list" tab
 */

export const formatDropOffPHP = (amount) => {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '\u20B10.00';
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
};

export const formatDropOffDate = (ymd) => {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(String(ymd))) return ymd || '—';
  const [y, m, d] = String(ymd).split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  });
};

export const formatDaysUntilDrop = (days) => {
  const n = Number(days);
  if (!Number.isFinite(n)) return '—';
  if (n <= 0) return 'Today';
  if (n === 1) return '1 day';
  return `${n} days`;
};

export async function fetchUpcomingDelinquencyDrops({ branchId } = {}) {
  const params = new URLSearchParams();
  if (branchId != null && branchId !== '' && Number.isFinite(Number(branchId))) {
    params.set('branch_id', String(branchId));
  }
  const qs = params.toString();
  const response = await apiRequest(
    `/installment-invoices/upcoming-delinquency-drops${qs ? `?${qs}` : ''}`
  );
  if (!response?.success || !response.data) {
    throw new Error(response?.message || 'Failed to load student drop off list');
  }
  return response.data;
}

const StudentDropOffListTable = ({ students, compact = false, showBranch = false }) => {
  const cellPad = compact ? 'px-2.5 py-2' : 'px-3 py-2.5';
  const rows = Array.isArray(students) ? students : [];
  const minWidth = showBranch ? '1100px' : '980px';

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-10 text-center text-sm text-gray-600">
        No students are scheduled to be dropped within the next 7 days.
      </div>
    );
  }

  return (
    <div
      className="overflow-x-auto rounded-lg border border-red-100"
      style={{
        scrollbarWidth: 'thin',
        scrollbarColor: '#cbd5e0 #f7fafc',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      <table style={{ width: '100%', minWidth }} className="text-sm">
        <thead className="bg-red-50 text-left text-xs font-semibold uppercase tracking-wide text-red-800">
          <tr>
            <th className={cellPad}>Student</th>
            {showBranch ? <th className={cellPad}>Branch</th> : null}
            <th className={cellPad}>Class</th>
            <th className={cellPad}>Phase</th>
            <th className={cellPad}>AR#</th>
            <th className={cellPad}>Due</th>
            <th className={cellPad}>Drop date</th>
            <th className={cellPad}>In</th>
            <th className={`${cellPad} text-right`}>Balance</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {rows.map((row) => (
            <tr key={`${row.student_id}-${row.invoice_id}`} className="hover:bg-red-50/40">
              <td className={`${cellPad} align-top`}>
                <div className="font-medium text-gray-900">{row.student_name || '—'}</div>
                <div
                  className="text-xs text-gray-500 truncate max-w-[220px]"
                  title={row.student_email || ''}
                >
                  {row.student_email || ''}
                </div>
              </td>
              {showBranch ? (
                <td className={`${cellPad} align-top text-gray-700`}>{row.branch_name || '—'}</td>
              ) : null}
              <td className={`${cellPad} align-top text-gray-700`}>{row.class_name || '—'}</td>
              <td className={`${cellPad} align-top text-gray-700`}>
                {row.phase_number != null ? row.phase_number : '—'}
              </td>
              <td className={`${cellPad} align-top text-gray-700`}>{row.invoice_ar_number || '—'}</td>
              <td className={`${cellPad} align-top text-gray-700 whitespace-nowrap`}>
                {formatDropOffDate(row.due_date)}
              </td>
              <td className={`${cellPad} align-top text-gray-700 whitespace-nowrap`}>
                {formatDropOffDate(row.drop_date)}
              </td>
              <td className={`${cellPad} align-top`}>
                <span
                  className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
                    Number(row.days_until_drop) <= 2
                      ? 'bg-red-100 text-red-800'
                      : 'bg-amber-100 text-amber-900'
                  }`}
                >
                  {formatDaysUntilDrop(row.days_until_drop)}
                </span>
              </td>
              <td
                className={`${cellPad} align-top text-right font-medium text-gray-900 whitespace-nowrap`}
              >
                {formatDropOffPHP(row.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/**
 * Self-fetching panel for the Installment Invoice tab.
 * @param {{ refreshKey?: number, branchId?: number|null, showBranchColumn?: boolean }} props
 */
const StudentDropOffListPanel = ({
  refreshKey = 0,
  branchId = null,
  showBranchColumn = false,
}) => {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const data = await fetchUpcomingDelinquencyDrops({ branchId });
      setPayload(data);
    } catch (err) {
      setError(err.message || 'Failed to load student drop off list');
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <span>{error}</span>
        <button
          type="button"
          onClick={load}
          className="px-4 py-2 text-sm font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700"
        >
          Retry
        </button>
      </div>
    );
  }

  const students = payload?.students || [];
  const withinDays = payload?.within_days ?? 7;
  const finalDropoffDays = payload?.final_dropoff_days ?? 30;
  const branchName = payload?.branch_name;
  const isAllBranches = payload?.scope === 'all' || showBranchColumn;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Student drop off list</h2>
          <p className="text-sm text-gray-600 mt-1">
            Students with unpaid installment invoices who will be auto-dropped within{' '}
            <span className="font-medium text-gray-800">{withinDays} days</span> (
            {finalDropoffDays} days after due date)
            {branchName ? (
              <>
                {' '}
                · Branch: <span className="font-medium text-gray-800">{branchName}</span>
              </>
            ) : isAllBranches ? (
              <> · All branches</>
            ) : null}
            .
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-red-100 text-red-800">
            {students.length} at risk
          </span>
          <button
            type="button"
            onClick={load}
            className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            Refresh
          </button>
        </div>
      </div>

      <StudentDropOffListTable students={students} showBranch={isAllBranches} />
    </div>
  );
};

export { StudentDropOffListTable };
export default StudentDropOffListPanel;
