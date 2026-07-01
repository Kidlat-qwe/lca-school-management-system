import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatDateManila } from '../../utils/dateUtils';
import {
  getOperationalAttendanceActionMeta,
  getOperationalAttendanceTakenMeta,
  getOperationalClassLabel,
  getOperationalScheduleLabel,
  getOperationalSessionLabel,
  getOperationalSessionRowKey,
} from '../../utils/operationalAttendanceDisplay';
import { OPERATIONAL_ATTENDANCE } from '../../constants/dashboardDescriptions';
import useOperationalAttendanceSessions from '../../hooks/useOperationalAttendanceSessions';
import ClassSessionAttendanceModal from '../class/ClassSessionAttendanceModal';

const tableScrollStyle = {
  scrollbarWidth: 'thin',
  scrollbarColor: '#cbd5e0 #f7fafc',
  WebkitOverflowScrolling: 'touch',
};

const FILTER_TABS = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Needs attendance' },
  { id: 'taken', label: 'Already taken' },
  { id: 'upcoming', label: 'Upcoming' },
];

const OperationalAttendanceModal = ({
  open,
  onClose,
  mode = 'daily',
  summaryDate = '',
  summaryMonth = '',
  branchId = '',
  branchName = '',
  showBranchColumn = false,
  onAttendanceSaved,
}) => {
  const [attendanceFilter, setAttendanceFilter] = useState('all');
  const [activeSession, setActiveSession] = useState(null);

  const { sessions, summary, loading, error, refresh, isTruncated } = useOperationalAttendanceSessions({
    mode,
    summaryDate,
    summaryMonth,
    branchId,
    attendanceFilter,
    listLimit: null,
    enabled: open,
  });

  useEffect(() => {
    if (open) {
      setAttendanceFilter('all');
      setActiveSession(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const periodLabel = useMemo(() => {
    if (mode === 'monthly') {
      if (!summaryMonth) return 'Selected month';
      const [year, month] = summaryMonth.split('-').map(Number);
      return new Date(year, month - 1, 1).toLocaleDateString('en-PH', {
        month: 'long',
        year: 'numeric',
        timeZone: 'Asia/Manila',
      });
    }
    if (summaryDate) return formatDateManila(`${summaryDate}T12:00:00`);
    return 'Selected date';
  }, [mode, summaryDate, summaryMonth]);

  const emptyMessage = useMemo(() => {
    if (attendanceFilter === 'pending') {
      return 'No sessions need attendance for this filter.';
    }
    if (attendanceFilter === 'taken') {
      return 'No completed sessions for this period. Completed sessions match class details when attendance is saved.';
    }
    if (attendanceFilter === 'upcoming') {
      return 'No upcoming sessions in this period.';
    }
    return mode === 'monthly'
      ? OPERATIONAL_ATTENDANCE.emptyMonthly(periodLabel)
      : OPERATIONAL_ATTENDANCE.emptyDaily(periodLabel);
  }, [attendanceFilter, mode, periodLabel]);

  const handleOpenSession = (session) => {
    if (!session?.classsession_id) return;
    setActiveSession(session);
  };

  const handleAttendanceSaved = () => {
    refresh();
    onAttendanceSaved?.();
  };

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
        aria-labelledby="operational-attendance-modal-title"
        className="relative z-[201] flex max-h-[min(92vh,880px)] w-full max-w-[min(96vw,1280px)] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-200 bg-gradient-to-r from-teal-50/80 to-white px-5 py-4 sm:px-7">
          <div className="min-w-0 flex-1">
            <h2 id="operational-attendance-modal-title" className="text-xl font-semibold tracking-tight text-gray-900">
              Update attendance
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              {periodLabel}
              {branchName ? ` · ${branchName}` : ''}
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <div className="rounded-xl border border-amber-200/60 bg-amber-50/80 px-4 py-2.5 shadow-sm">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-900/70">Needs attendance</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums text-gray-900">{summary.pendingCount}</p>
              </div>
              <div className="rounded-xl border border-emerald-200/60 bg-emerald-50/80 px-4 py-2.5 shadow-sm">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-900/70">Already taken</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums text-gray-900">{summary.takenCount}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 shadow-sm">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-600">Upcoming</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums text-gray-900">{summary.upcomingCount}</p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 shadow-sm">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Total sessions</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums text-gray-900">{summary.totalCount}</p>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={refresh}
              className="rounded-lg px-3 py-2 text-sm font-medium text-gray-600 ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
              aria-label="Close modal"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="shrink-0 border-b border-gray-100 px-5 py-3 sm:px-7">
          <div className="flex flex-wrap gap-2">
            {FILTER_TABS.map((tab) => {
              const count =
                tab.id === 'all'
                  ? summary.totalCount
                  : tab.id === 'pending'
                    ? summary.pendingCount
                    : tab.id === 'taken'
                      ? summary.takenCount
                      : summary.upcomingCount;

              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setAttendanceFilter(tab.id)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    attendanceFilter === tab.id
                      ? 'bg-teal-600 text-white shadow-sm'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {tab.label}
                  <span className="ml-1 tabular-nums opacity-80">({count})</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-7">
          {loading ? (
            <div className="flex min-h-[200px] items-center justify-center">
              <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#F7C844] border-t-transparent" />
            </div>
          ) : error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
          ) : sessions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-10 text-center text-sm text-gray-500">
              {emptyMessage}
            </div>
          ) : (
            <>
              {isTruncated ? (
                <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Showing the first {sessions.length} sessions for this filter. Use branch filter or a shorter period if
                  you need a smaller list.
                </p>
              ) : null}
              <div className="overflow-x-auto rounded-lg" style={tableScrollStyle}>
                <table style={{ width: '100%', minWidth: '880px' }}>
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                      <th className="px-3 py-3">Class</th>
                      {showBranchColumn ? <th className="px-3 py-3">Branch</th> : null}
                      <th className="px-3 py-3">Teacher</th>
                      <th className="px-3 py-3">Session</th>
                      <th className="px-3 py-3">Schedule</th>
                      <th className="px-3 py-3">Attendance status</th>
                      <th className="px-3 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-sm text-gray-700">
                    {sessions.map((session) => {
                      const takenMeta = getOperationalAttendanceTakenMeta(session);
                      const actionMeta = getOperationalAttendanceActionMeta(session);

                      return (
                        <tr key={getOperationalSessionRowKey(session)} className="hover:bg-gray-50/80">
                          <td className="px-3 py-3">
                            <p className="font-medium text-gray-900">{getOperationalClassLabel(session)}</p>
                            <p className="text-xs text-gray-500">{session.program_name || '—'}</p>
                          </td>
                          {showBranchColumn ? (
                            <td className="px-3 py-3 text-gray-600">{session.branch_name || '—'}</td>
                          ) : null}
                          <td className="px-3 py-3 text-gray-700">
                            <span className="block max-w-[140px] truncate" title={session.teacher_name || '—'}>
                              {session.teacher_name || '—'}
                            </span>
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap">
                            {getOperationalSessionLabel(session)}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap">
                            {getOperationalScheduleLabel(session)}
                          </td>
                          <td className="px-3 py-3">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${takenMeta.badgeClass}`}
                            >
                              {takenMeta.label}
                            </span>
                            {takenMeta.detail ? (
                              <p className="mt-1 text-xs text-gray-500">{takenMeta.detail}</p>
                            ) : null}
                          </td>
                          <td className="px-3 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => handleOpenSession(session)}
                              disabled={!session.classsession_id}
                              className={`inline-flex items-center rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                                actionMeta.actionLabel === 'Update'
                                  ? 'bg-[#F7C844] text-gray-900 hover:bg-[#e5b83d]'
                                  : 'bg-white text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50'
                              }`}
                            >
                              {actionMeta.actionLabel === 'Update' ? 'Update attendance' : 'View attendance'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      <ClassSessionAttendanceModal
        open={Boolean(activeSession?.classsession_id)}
        onClose={() => setActiveSession(null)}
        classsessionId={activeSession?.classsession_id}
        teacherName={activeSession?.teacher_name}
        onSaved={handleAttendanceSaved}
      />
    </div>,
    document.body
  );
};

export default OperationalAttendanceModal;
