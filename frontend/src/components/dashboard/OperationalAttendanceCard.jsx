import { useMemo, useState } from 'react';
import {
  getOperationalAttendanceActionMeta,
  getOperationalAttendanceTakenMeta,
  getOperationalClassLabel,
  getOperationalScheduleLabel,
  getOperationalSessionLabel,
  getOperationalSessionRowKey,
  OPERATIONAL_ATTENDANCE_VISIBLE_ROW_COUNT,
} from '../../utils/operationalAttendanceDisplay';
import { OPERATIONAL_ATTENDANCE } from '../../constants/dashboardDescriptions';
import useOperationalAttendanceSessions from '../../hooks/useOperationalAttendanceSessions';
import MatrixInfoTooltip from './MatrixInfoTooltip';
import OperationalAttendanceModal from './OperationalAttendanceModal';
import ClassSessionAttendanceModal from '../class/ClassSessionAttendanceModal';

const ROW_HEIGHT_REM = 2.5;
const SCROLL_MAX_HEIGHT = `${(OPERATIONAL_ATTENDANCE_VISIBLE_ROW_COUNT + 1) * ROW_HEIGHT_REM}rem`;

const OperationalAttendanceCard = ({
  mode = 'daily',
  summaryDate = '',
  summaryMonth = '',
  branchId = '',
  branchName = '',
  showBranchColumn = false,
  title = 'Take attendance',
  seeAllLabel = 'See all',
  canEditAttendance = true,
}) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [activeSession, setActiveSession] = useState(null);

  const { sessions, pendingCount, totalCount, takenCount, loading, error, refresh } =
    useOperationalAttendanceSessions({
    mode,
    summaryDate,
    summaryMonth,
    branchId,
    attendanceFilter: 'pending',
    listLimit: OPERATIONAL_ATTENDANCE_VISIBLE_ROW_COUNT,
  });

  const previewSessions = useMemo(() => sessions, [sessions]);
  const hasScroll = pendingCount > OPERATIONAL_ATTENDANCE_VISIBLE_ROW_COUNT;

  const tooltip = mode === 'monthly' ? OPERATIONAL_ATTENDANCE.monthlyIntro : OPERATIONAL_ATTENDANCE.dailyIntro;

  const handleOpenSession = (session) => {
    if (!session?.classsession_id) return;
    setActiveSession(session);
  };

  const handleAttendanceSaved = () => {
    refresh();
  };

  const subtitle = useMemo(() => {
    if (loading || error) return null;
    if (pendingCount > 0) {
      return `${pendingCount} session(s) need attendance · ${takenCount} already taken`;
    }
    if (totalCount > 0) {
      return `All ${totalCount} session(s) have attendance taken or are upcoming`;
    }
    return 'No class sessions in this period';
  }, [loading, error, pendingCount, takenCount, totalCount]);

  return (
    <>
      <div className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-100">
        <div className="mb-3 flex flex-shrink-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex min-w-0 flex-wrap items-center gap-0.5 text-sm font-semibold leading-tight text-gray-700">
              <span>{title}</span>
              <MatrixInfoTooltip label={`About ${title}`}>{tooltip}</MatrixInfoTooltip>
            </p>
            {subtitle ? <p className="mt-1 text-xs text-gray-500">{subtitle}</p> : null}
          </div>
          {totalCount > 0 ? (
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="flex-shrink-0 text-xs font-medium text-indigo-600 hover:text-indigo-800"
            >
              {seeAllLabel}
            </button>
          ) : null}
        </div>

        {loading ? (
          <div className="flex min-h-[8rem] flex-1 items-center justify-center">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-[#F7C844] border-t-transparent" />
          </div>
        ) : error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : previewSessions.length === 0 ? (
          <p className="text-sm text-gray-500">
            {pendingCount === 0 && takenCount > 0
              ? 'No pending sessions — open See all to view taken sessions.'
              : mode === 'monthly'
                ? 'No class sessions in this month.'
                : 'No class sessions on this date.'}
          </p>
        ) : (
          <div
            className="overflow-x-auto overflow-y-auto rounded-lg"
            style={{
              height: SCROLL_MAX_HEIGHT,
              scrollbarWidth: 'thin',
              scrollbarColor: '#cbd5e0 #f7fafc',
              WebkitOverflowScrolling: 'touch',
            }}
            aria-label={hasScroll ? 'Scroll for more attendance sessions' : undefined}
          >
            <table style={{ width: '100%', minWidth: '420px' }} className="border-collapse text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-white text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <th className="sticky top-0 z-10 bg-white px-2 py-2 shadow-[inset_0_-1px_0_#f3f4f6]">
                    Class
                  </th>
                  <th className="sticky top-0 z-10 w-[72px] bg-white px-2 py-2 shadow-[inset_0_-1px_0_#f3f4f6]">
                    Session
                  </th>
                  <th className="sticky top-0 z-10 bg-white px-2 py-2 shadow-[inset_0_-1px_0_#f3f4f6]">
                    Status
                  </th>
                  <th className="sticky top-0 z-10 w-[52px] bg-white px-2 py-2 text-right shadow-[inset_0_-1px_0_#f3f4f6]">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {previewSessions.map((session) => {
                  const takenMeta = getOperationalAttendanceTakenMeta(session);
                  const actionMeta = getOperationalAttendanceActionMeta(session, { canEditAttendance });

                  return (
                    <tr key={getOperationalSessionRowKey(session)} className="text-gray-800">
                      <td className="px-2 py-2 min-w-0">
                        <span
                          className="block truncate font-medium text-gray-900"
                          title={getOperationalClassLabel(session)}
                        >
                          {getOperationalClassLabel(session)}
                        </span>
                        <span className="block truncate text-xs text-gray-500">
                          {getOperationalScheduleLabel(session, { includeDate: mode === 'monthly' })}
                        </span>
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap text-xs text-gray-600">
                        {getOperationalSessionLabel(session)}
                      </td>
                      <td className="px-2 py-2">
                        <span
                          className={`inline-flex max-w-full truncate rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${takenMeta.badgeClass}`}
                          title={takenMeta.detail || takenMeta.label}
                        >
                          {takenMeta.label}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => handleOpenSession(session)}
                          disabled={!session.classsession_id}
                          className={`text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50 ${actionMeta.actionClass}`}
                        >
                          {actionMeta.actionLabel}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 h-1 bg-teal-500" />
      </div>

      <OperationalAttendanceModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        mode={mode}
        summaryDate={summaryDate}
        summaryMonth={summaryMonth}
        branchId={branchId}
        branchName={branchName}
        showBranchColumn={showBranchColumn}
        canEditAttendance={canEditAttendance}
        onAttendanceSaved={handleAttendanceSaved}
      />

      <ClassSessionAttendanceModal
        open={Boolean(activeSession?.classsession_id)}
        onClose={() => setActiveSession(null)}
        classsessionId={activeSession?.classsession_id}
        teacherName={activeSession?.teacher_name}
        canEditAttendance={canEditAttendance}
        onSaved={handleAttendanceSaved}
      />
    </>
  );
};

export default OperationalAttendanceCard;
