import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../config/api';
import { formatDateManila } from '../../utils/dateUtils';

const tableScrollStyle = {
  scrollbarWidth: 'thin',
  scrollbarColor: '#cbd5e0 #f7fafc',
  WebkitOverflowScrolling: 'touch',
};

const formatNumber = (value) => (Number(value) || 0).toLocaleString('en-PH');

export default function OperationalReEnrolledStudentsModal({
  open,
  onClose,
  periodMode = 'daily',
  summaryDate = '',
  summaryMonth = '',
  branchId = '',
  branchName = '',
  cardStudentCount = 0,
}) {
  const [rows, setRows] = useState([]);
  const [studentCount, setStudentCount] = useState(0);
  const [periodLabel, setPeriodLabel] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoading(true);
    setError('');

    const params = new URLSearchParams();
    if (branchId) params.set('branch_id', String(branchId));
    if (periodMode === 'monthly' && summaryMonth) {
      params.set('summary_month', summaryMonth);
    } else if (summaryDate) {
      params.set('summary_date', summaryDate);
    }

    apiRequest(`/dashboard/operational-re-enrolled-students?${params.toString()}`)
      .then((res) => {
        if (cancelled) return;
        setRows(res.data?.students ?? []);
        setStudentCount(res.data?.student_count ?? 0);
        setPeriodLabel(res.data?.period_label ?? res.data?.window_label ?? '');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || 'Failed to load re-enrolled students.');
        setRows([]);
        setStudentCount(0);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, periodMode, summaryDate, summaryMonth, branchId]);

  const periodTitle =
    periodMode === 'monthly'
      ? summaryMonth
        ? `Month ${summaryMonth}`
        : 'Selected month'
      : summaryDate
        ? formatDateManila(summaryDate)
        : 'Selected date';

  const scopeSubtitle = [
    periodLabel ? `Period: ${periodLabel}` : periodTitle,
    branchName ? `Branch: ${branchName}` : branchId ? `Branch ID ${branchId}` : 'All branches',
  ].join(' · ');

  const displayCount = studentCount || cardStudentCount;

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-6">
      <button
        type="button"
        className="absolute inset-0 bg-black/50 backdrop-blur-[1px]"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="operational-re-enrolled-students-title"
        className="relative flex max-h-[min(90vh,720px)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-gray-200"
      >
        <div className="flex-shrink-0 border-b border-gray-100 px-5 py-4 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id="operational-re-enrolled-students-title" className="text-lg font-semibold text-gray-900">
                Re-enrolled students
              </h2>
              <p className="mt-1 text-sm text-gray-500">{scopeSubtitle}</p>
              <p className="mt-1 text-xs text-gray-500">
                One student counts once. Full payment counts once (not per phase).
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex-shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100"
            >
              Close
            </button>
          </div>
          <p className="mt-3 text-sm font-medium text-indigo-700">
            {formatNumber(displayCount)} student{displayCount === 1 ? '' : 's'}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6" style={tableScrollStyle}>
          {loading ? (
            <p className="text-sm text-gray-500">Loading students…</p>
          ) : error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-gray-500">No re-enrolled students for this selection.</p>
          ) : (
            <div
              className="overflow-x-auto rounded-lg ring-1 ring-gray-100"
              style={tableScrollStyle}
            >
              <table style={{ width: '100%', minWidth: '640px' }} className="border-collapse text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <th className="px-3 py-2.5">Student</th>
                    <th className="px-3 py-2.5">Class</th>
                    <th className="px-3 py-2.5">Payment</th>
                    <th className="px-3 py-2.5">Latest issue date</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={`${row.student_id}-${row.branch_id}`} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2.5">
                        <span className="block font-medium text-gray-900">{row.student_name || '—'}</span>
                        {row.student_email ? (
                          <span className="block text-xs text-gray-500">{row.student_email}</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 text-gray-700">
                        {(row.class_names || []).length ? row.class_names.join(', ') : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-gray-700">
                        {(row.payment_labels || []).length ? row.payment_labels.join('; ') : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-gray-700">
                        {row.latest_issue_date ? formatDateManila(row.latest_issue_date) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
