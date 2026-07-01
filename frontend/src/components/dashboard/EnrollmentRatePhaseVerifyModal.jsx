import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../config/api';

const tableScrollStyle = {
  scrollbarWidth: 'thin',
  scrollbarColor: '#cbd5e0 #f7fafc',
  WebkitOverflowScrolling: 'touch',
};

const VerifyTable = ({ rows, loading }) => {
  if (loading) {
    return (
      <div className="flex h-52 items-center justify-center rounded-xl bg-gray-50/80">
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-[#F7C844] border-t-transparent" />
      </div>
    );
  }
  if (!rows.length) {
    return (
      <p className="rounded-xl border border-dashed border-gray-200 bg-gray-50/80 py-12 text-center text-sm text-gray-500">
        No students match this view.
      </p>
    );
  }
  return (
    <div
      className="max-h-[min(58vh,480px)] overflow-y-auto overflow-x-auto rounded-xl border border-gray-200 bg-white sm:overflow-x-hidden"
      style={tableScrollStyle}
    >
      <table style={{ width: '100%' }}>
        <colgroup>
          <col style={{ width: '22%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '26%' }} />
          <col style={{ width: '16%' }} />
          <col style={{ width: '12%' }} />
          <col style={{ width: '10%' }} />
        </colgroup>
        <thead className="sticky top-0 z-[1] border-b border-gray-200 bg-gray-50 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-4 py-3">Student</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Classes</th>
            <th className="px-4 py-3">Enrolled at</th>
            <th className="px-4 py-3">Branch</th>
            <th className="px-4 py-3 text-center">Enrolled</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 text-sm text-gray-800">
          {rows.map((row) => (
            <tr key={`${row.student_id}-${row.phase_number}`} className="transition-colors hover:bg-amber-50/50">
              <td className="px-4 py-3 align-top">
                <p className="font-medium leading-snug text-gray-900">{row.full_name || '—'}</p>
                <p className="mt-0.5 truncate text-xs text-gray-500" title={row.email || ''}>
                  {row.email || '—'}
                </p>
              </td>
              <td className="px-4 py-3 align-top text-xs leading-relaxed text-gray-700">
                {row.statuses_seen || '—'}
              </td>
              <td className="px-4 py-3 align-top text-xs leading-relaxed text-gray-600" title={row.class_names || ''}>
                <span className="line-clamp-3 break-words">{row.class_names || '—'}</span>
              </td>
              <td className="whitespace-nowrap px-4 py-3 align-top text-xs tabular-nums text-gray-600">
                {row.enrolled_at_manila || '—'}
              </td>
              <td className="px-4 py-3 align-top text-xs text-gray-600">{row.branch_name || '—'}</td>
              <td className="px-4 py-3 align-top text-center">
                {row.is_enrolled ? (
                  <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                    Yes
                  </span>
                ) : (
                  <span className="inline-flex rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                    No
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/**
 * Drill-down modal: student lists behind one phase row on Enrollment Rate by Phase.
 */
export default function EnrollmentRatePhaseVerifyModal({
  open,
  onClose,
  phaseNumber,
  phaseRow,
  queryParams,
  scopeLabel,
  onOpenReport,
}) {
  const [listTab, setListTab] = useState('all');
  const [students, setStudents] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !phaseNumber) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setListTab('all');
    const params = new URLSearchParams(queryParams || '');
    params.set('phase_number', String(phaseNumber));
    apiRequest(`/dashboard/enrollment-rate-phase-students?${params.toString()}`)
      .then((res) => {
        if (cancelled) return;
        setStudents(res.data?.students ?? []);
        setSummary(res.data?.summary ?? null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || 'Failed to load student list.');
        setStudents([]);
        setSummary(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, phaseNumber, queryParams]);

  const enrolledRows = useMemo(() => students.filter((s) => s.is_enrolled), [students]);
  const displayRows = listTab === 'enrolled' ? enrolledRows : students;

  const tableEnrolled = summary?.enrolled_count ?? phaseRow?.enrolled_count ?? 0;
  const tableStudents = summary?.student_count ?? phaseRow?.student_count ?? 0;
  const tableRate =
    tableStudents > 0 ? Number(((tableEnrolled / tableStudents) * 100).toFixed(2)) : 0;

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
        aria-labelledby="enrollment-phase-verify-title"
        className="relative z-[201] flex max-h-[min(92vh,880px)] w-full max-w-[min(96vw,1180px)] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-white px-5 py-4 sm:px-7">
          <div className="min-w-0 flex-1">
            <h2 id="enrollment-phase-verify-title" className="text-xl font-semibold tracking-tight text-gray-900">
              Verify Phase {phaseNumber}
            </h2>
            <p className="mt-1 text-sm text-gray-500">{scopeLabel}</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <div className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 shadow-sm">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Enrolled</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums text-gray-900">
                  {tableEnrolled.toLocaleString()}
                </p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 shadow-sm">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Students</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums text-gray-900">
                  {tableStudents.toLocaleString()}
                </p>
              </div>
              <div className="rounded-xl border border-[#F7C844]/40 bg-[#F7C844]/10 px-4 py-2.5 shadow-sm">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-900/80">Rate</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums text-gray-900">{tableRate.toFixed(2)}%</p>
              </div>
            </div>
            <p className="mt-3 max-w-3xl text-xs leading-relaxed text-gray-500">
              Enrolled = new, re_enrolled, upsell, rejoin, or completed, and not removed. One row per student in this
              phase.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-200/60 hover:text-gray-800"
            aria-label="Close dialog"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-100 bg-gray-50/50 px-5 py-3 sm:px-7">
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 shadow-sm">
            <button
              type="button"
              onClick={() => setListTab('all')}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                listTab === 'all' ? 'bg-gray-900 text-white shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              All students ({tableStudents.toLocaleString()})
            </button>
            <button
              type="button"
              onClick={() => setListTab('enrolled')}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                listTab === 'enrolled' ? 'bg-gray-900 text-white shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Enrolled ({tableEnrolled.toLocaleString()})
            </button>
          </div>
          {typeof onOpenReport === 'function' ? (
            <button
              type="button"
              onClick={() => onOpenReport({ phaseNumber, enrolledOnly: listTab === 'enrolled' })}
              className="ml-auto rounded-lg border border-gray-300 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
            >
              Open in Report
            </button>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-hidden px-5 py-4 sm:px-7 sm:py-5">
          {error ? (
            <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          ) : null}
          <VerifyTable rows={displayRows} loading={loading} />
        </div>

        <div className="flex shrink-0 justify-end border-t border-gray-200 bg-gray-50/80 px-5 py-3 sm:px-7">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-gray-900 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gray-800"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
