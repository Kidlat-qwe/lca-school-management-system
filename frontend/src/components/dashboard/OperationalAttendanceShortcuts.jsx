import { useMemo, useState } from 'react';
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
import MatrixInfoTooltip from './MatrixInfoTooltip';
import ClassSessionAttendanceModal from '../class/ClassSessionAttendanceModal';

const OperationalAttendanceShortcuts = ({
  mode = 'daily',
  summaryDate = '',
  summaryMonth = '',
  branchId = '',
  showBranchColumn = false,
  showHeader = true,
}) => {
  const [activeSession, setActiveSession] = useState(null);

  const { sessions, pendingCount, takenCount, totalCount, loading, error, refresh } =
    useOperationalAttendanceSessions({
      mode,
      summaryDate,
      summaryMonth,
      branchId,
      attendanceFilter: 'all',
    });

  const periodLabel = useMemo(() => {
    if (mode === 'monthly') {
      if (!summaryMonth) return 'selected month';
      const [year, month] = summaryMonth.split('-').map(Number);
      return new Date(year, month - 1, 1).toLocaleDateString('en-PH', {
        month: 'long',
        year: 'numeric',
        timeZone: 'Asia/Manila',
      });
    }
    if (summaryDate) return formatDateManila(`${summaryDate}T12:00:00`);
    return 'selected date';
  }, [mode, summaryDate, summaryMonth]);

  const handleOpenSession = (session) => {
    if (!session?.classsession_id) return;
    setActiveSession(session);
  };

  return (
    <>
      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-100 sm:p-6">
        {showHeader ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="flex flex-wrap items-center gap-1 text-lg font-semibold text-gray-900">
                <span>Class attendance</span>
                <MatrixInfoTooltip label="About class attendance shortcuts">
                  {mode === 'monthly' ? OPERATIONAL_ATTENDANCE.monthlyIntro : OPERATIONAL_ATTENDANCE.dailyIntro}
                </MatrixInfoTooltip>
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                {mode === 'monthly'
                  ? OPERATIONAL_ATTENDANCE.monthlySubtitle(periodLabel, pendingCount, takenCount, totalCount)
                  : OPERATIONAL_ATTENDANCE.dailySubtitle(periodLabel, pendingCount, takenCount, totalCount)}
              </p>
            </div>
            <button
              type="button"
              onClick={refresh}
              className="inline-flex shrink-0 items-center gap-2 self-start rounded-xl bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 transition hover:bg-gray-50"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 014 9m0 0h5m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H16"
                />
              </svg>
              Refresh
            </button>
          </div>
        ) : (
          <div className="mb-4 flex justify-end">
            <button
              type="button"
              onClick={refresh}
              className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 transition hover:bg-gray-50"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 014 9m0 0h5m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H16"
                />
              </svg>
              Refresh
            </button>
          </div>
        )}

        {loading ? (
          <div className="mt-5 flex min-h-[120px] items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#F7C844] border-t-transparent" />
          </div>
        ) : error ? (
          <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
        ) : sessions.length === 0 ? (
          <div className="mt-5 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
            {mode === 'monthly'
              ? OPERATIONAL_ATTENDANCE.emptyMonthly(periodLabel)
              : OPERATIONAL_ATTENDANCE.emptyDaily(periodLabel)}
          </div>
        ) : (
          <div className={`${showHeader ? 'mt-5' : ''} overflow-x-auto rounded-lg`}
            style={{
              scrollbarWidth: 'thin',
              scrollbarColor: '#cbd5e0 #f7fafc',
              WebkitOverflowScrolling: 'touch',
            }}
          >
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
                      <td className="px-3 py-3">{getOperationalSessionLabel(session)}</td>
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
        )}
      </section>

      <ClassSessionAttendanceModal
        open={Boolean(activeSession?.classsession_id)}
        onClose={() => setActiveSession(null)}
        classsessionId={activeSession?.classsession_id}
        teacherName={activeSession?.teacher_name}
        onSaved={refresh}
      />
    </>
  );
};

export default OperationalAttendanceShortcuts;
