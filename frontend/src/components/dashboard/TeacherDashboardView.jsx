import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { formatDateManila } from '../../utils/dateUtils';
import { DashboardStatIcon } from './DashboardStatIcons';
import MatrixInfoTooltip from './MatrixInfoTooltip';
import OperationalAttendanceShortcuts from './OperationalAttendanceShortcuts';
import OperationalAttendanceCard from './OperationalAttendanceCard';
import useOperationalAttendanceSessions from '../../hooks/useOperationalAttendanceSessions';
import useTeacherAssignedClasses from '../../hooks/useTeacherAssignedClasses';
import { DASHBOARD_DATE_NOTE, TEACHER_DASHBOARD } from '../../constants/dashboardDescriptions';

const getTodayManila = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
const maxSummaryMonth = () => getTodayManila().slice(0, 7);

const formatNumber = (value) => (Number(value) || 0).toLocaleString('en-PH');

const StatsCard = ({ title, value, iconName, accent, tooltip }) => (
  <div className="group relative h-full w-full overflow-visible rounded-2xl bg-white p-5 text-left shadow-sm ring-1 ring-gray-100 transition-all duration-300 hover:shadow-lg hover:ring-gray-200">
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3">
        <p className="flex min-w-0 flex-wrap items-center gap-0.5 text-sm font-semibold leading-tight text-gray-700">
          <span>{title}</span>
          {tooltip ? <MatrixInfoTooltip label={`About ${title}`}>{tooltip}</MatrixInfoTooltip> : null}
        </p>
        <div
          className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg ${accent} shadow-sm transition-transform duration-300 group-hover:scale-110`}
        >
          <DashboardStatIcon name={iconName} className="h-5 w-5 text-white drop-shadow-sm" />
        </div>
      </div>
      <p className="mt-3 text-[1.65rem] leading-none font-bold tracking-tight text-gray-900 break-words">
        {value}
      </p>
    </div>
    <div
      className={`absolute inset-x-0 bottom-0 h-1 ${accent.replace('bg-', 'bg-gradient-to-r from-').replace('/80', ' to-transparent')}`}
    />
  </div>
);

const TeacherDashboardView = () => {
  const { userInfo } = useAuth();
  const teacherId = userInfo?.user_id || userInfo?.userId;
  const branchId = userInfo?.branch_id || userInfo?.branchId || '';
  const branchName = userInfo?.branch_name || userInfo?.branchName || 'Your branch';
  const teacherName = userInfo?.full_name || userInfo?.fullName || 'Teacher';

  const today = getTodayManila();
  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedMonth, setSelectedMonth] = useState(maxSummaryMonth());

  const {
    pendingCount: todayPending,
    takenCount: todayTaken,
    totalCount: todayTotal,
    upcomingCount: todayUpcoming,
    loading: todayStatsLoading,
  } = useOperationalAttendanceSessions({
    mode: 'daily',
    summaryDate: selectedDate,
    branchId,
    attendanceFilter: 'all',
    listLimit: 1,
    enabled: Boolean(branchId),
  });

  const {
    pendingCount: monthPending,
    takenCount: monthTaken,
    totalCount: monthTotal,
  } = useOperationalAttendanceSessions({
    mode: 'monthly',
    summaryMonth: selectedMonth,
    branchId,
    attendanceFilter: 'all',
    listLimit: 1,
    enabled: Boolean(branchId),
  });

  const { classes, classCount, loading: classesLoading, error: classesError } = useTeacherAssignedClasses({
    teacherId,
    branchId,
    enabled: Boolean(teacherId && branchId),
  });

  const periodLabel = useMemo(() => {
    if (selectedDate === today) return 'Today';
    return formatDateManila(`${selectedDate}T12:00:00`);
  }, [selectedDate, today]);

  const monthLabel = useMemo(() => {
    const [year, month] = selectedMonth.split('-').map(Number);
    return new Date(year, month - 1, 1).toLocaleDateString('en-PH', {
      month: 'long',
      year: 'numeric',
      timeZone: 'Asia/Manila',
    });
  }, [selectedMonth]);

  const previewClasses = useMemo(() => classes.slice(0, 8), [classes]);

  return (
    <div className="w-full min-w-0 space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Dashboard</h1>
          <p className="mt-1 text-sm text-gray-600">{TEACHER_DASHBOARD.pageIntro}</p>
          <p className="mt-1 text-xs text-gray-500">
            Welcome, <span className="font-medium text-gray-700">{teacherName}</span> · {DASHBOARD_DATE_NOTE}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/teacher/classes"
            className="inline-flex items-center rounded-xl bg-[#F7C844] px-4 py-2 text-sm font-semibold text-gray-900 shadow-sm transition hover:bg-[#e5b83d]"
          >
            My classes
          </Link>
          <Link
            to="/teacher/calendar"
            className="inline-flex items-center rounded-xl bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 transition hover:bg-gray-50"
          >
            Calendar
          </Link>
        </div>
      </div>

      <div className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 to-indigo-50 px-5 py-4 shadow-sm ring-1 ring-blue-100">
        <p className="text-sm font-semibold text-blue-900">
          Branch: <span className="font-bold text-blue-700">{branchName}</span>
        </p>
        <p className="text-xs text-blue-700">{TEACHER_DASHBOARD.branchHint}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatsCard
          title="My classes"
          value={classesLoading ? '…' : formatNumber(classCount)}
          iconName="academicCap"
          accent="bg-indigo-500/80"
          tooltip={TEACHER_DASHBOARD.myClassesStat}
        />
        <StatsCard
          title={selectedDate === today ? 'Sessions today' : 'Sessions on date'}
          value={todayStatsLoading ? '…' : formatNumber(todayTotal)}
          iconName="clock"
          accent="bg-sky-500/80"
          tooltip={TEACHER_DASHBOARD.sessionsStat}
        />
        <StatsCard
          title="Needs attendance"
          value={todayStatsLoading ? '…' : formatNumber(todayPending)}
          iconName="exclamationTriangle"
          accent="bg-amber-500/80"
          tooltip={TEACHER_DASHBOARD.pendingStat}
        />
        <StatsCard
          title="Already taken"
          value={todayStatsLoading ? '…' : formatNumber(todayTaken)}
          iconName="checkCircle"
          accent="bg-emerald-500/80"
          tooltip={TEACHER_DASHBOARD.takenStat}
        />
      </div>

      <div className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-900">{TEACHER_DASHBOARD.dailySectionTitle(periodLabel)}</p>
          <p className="mt-0.5 text-xs text-gray-500">
            {todayStatsLoading
              ? 'Loading session counts…'
              : TEACHER_DASHBOARD.dailySectionSubtitle(todayPending, todayTaken, todayTotal, todayUpcoming)}
          </p>
        </div>
        <label className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Date</span>
          <input
            type="date"
            value={selectedDate}
            max={today}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-700 focus:border-[#F7C844] focus:outline-none focus:ring-2 focus:ring-[#F7C844]/40"
          />
        </label>
      </div>

      <OperationalAttendanceShortcuts
        mode="daily"
        summaryDate={selectedDate}
        branchId={branchId}
        showHeader={false}
      />

      <div className="grid grid-cols-1 items-stretch gap-6 xl:grid-cols-2">
        <section className="flex min-h-0 flex-col rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-100 sm:p-6">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="flex flex-wrap items-center gap-1 text-lg font-semibold text-gray-900">
                <span>My assigned classes</span>
                <MatrixInfoTooltip label="About assigned classes">{TEACHER_DASHBOARD.myClassesSection}</MatrixInfoTooltip>
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                {classesLoading
                  ? 'Loading classes…'
                  : TEACHER_DASHBOARD.myClassesSubtitle(classCount)}
              </p>
            </div>
            <Link
              to="/teacher/classes"
              className="inline-flex shrink-0 self-start text-sm font-semibold text-indigo-600 hover:text-indigo-800"
            >
              View all →
            </Link>
          </div>

          {classesLoading ? (
            <div className="flex min-h-[160px] flex-1 items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#F7C844] border-t-transparent" />
            </div>
          ) : classesError ? (
            <p className="text-sm text-red-600">{classesError}</p>
          ) : previewClasses.length === 0 ? (
            <p className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
              {TEACHER_DASHBOARD.noClasses}
            </p>
          ) : (
            <div
              className="overflow-x-auto rounded-lg"
              style={{
                scrollbarWidth: 'thin',
                scrollbarColor: '#cbd5e0 #f7fafc',
                WebkitOverflowScrolling: 'touch',
              }}
            >
              <table style={{ width: '100%', minWidth: '520px' }}>
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <th className="px-3 py-3">Class</th>
                    <th className="px-3 py-3">Program</th>
                    <th className="px-3 py-3">Room</th>
                    <th className="px-3 py-3 text-center">Students</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-sm text-gray-700">
                  {previewClasses.map((classItem) => (
                    <tr key={classItem.class_id} className="hover:bg-gray-50/80">
                      <td className="px-3 py-3">
                        <p className="font-medium text-gray-900">{classItem.class_name || classItem.level_tag || '—'}</p>
                        <p className="text-xs text-gray-500">{classItem.level_tag || '—'}</p>
                      </td>
                      <td className="px-3 py-3 text-gray-600">{classItem.program_name || classItem.program_code || '—'}</td>
                      <td className="px-3 py-3 text-gray-600">{classItem.room_name || 'Unassigned'}</td>
                      <td className="px-3 py-3 text-center font-medium text-gray-900">
                        {formatNumber(classItem.enrolled_students)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="flex min-h-0 flex-col space-y-3">
          <div className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="flex flex-wrap items-center gap-1 text-lg font-semibold text-gray-900">
                <span>Monthly attendance</span>
                <MatrixInfoTooltip label="About monthly attendance">{TEACHER_DASHBOARD.monthlySection}</MatrixInfoTooltip>
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                {TEACHER_DASHBOARD.monthlySectionSubtitle(monthLabel, monthPending, monthTaken, monthTotal)}
              </p>
            </div>
            <label className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Month</span>
              <input
                type="month"
                value={selectedMonth}
                max={maxSummaryMonth()}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-700 focus:border-[#F7C844] focus:outline-none focus:ring-2 focus:ring-[#F7C844]/40"
              />
            </label>
          </div>
          <OperationalAttendanceCard
            mode="monthly"
            summaryMonth={selectedMonth}
            branchId={branchId}
            branchName={branchName}
            title="Take attendance"
            seeAllLabel="See all this month"
          />
        </section>
      </div>
    </div>
  );
};

export default TeacherDashboardView;
