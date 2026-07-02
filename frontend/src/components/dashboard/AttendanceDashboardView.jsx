import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAuth } from '../../contexts/AuthContext';
import { formatDateManila, manilaMonthYYYYMM } from '../../utils/dateUtils';
import { DashboardStatIcon } from './DashboardStatIcons';
import MatrixInfoTooltip from './MatrixInfoTooltip';
import OperationalAttendanceShortcuts from './OperationalAttendanceShortcuts';
import OperationalAttendanceModal from './OperationalAttendanceModal';
import AttendanceDashboardFilters from './AttendanceDashboardFilters';
import AttendanceRateSummarySection from './AttendanceRateSummarySection';
import useOperationalAttendanceSessions from '../../hooks/useOperationalAttendanceSessions';
import useAttendanceDashboardFilters from '../../hooks/useAttendanceDashboardFilters';
import { ATTENDANCE_DASHBOARD, DASHBOARD_DATE_NOTE } from '../../constants/dashboardDescriptions';

const MARK_COLORS = {
  Present: '#22C55E',
  Absent: '#EF4444',
  Late: '#F59E0B',
  Excused: '#6366F1',
  'Leave Early': '#14B8A6',
};

const CHART_COLORS = ['#22C55E', '#EF4444', '#F59E0B', '#6366F1', '#14B8A6', '#94A3B8'];

const getTodayManila = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
const maxSummaryMonth = () => manilaMonthYYYYMM();
const formatNumber = (value) => (Number(value) || 0).toLocaleString('en-PH');
const formatRate = (value) => (value == null || Number.isNaN(Number(value)) ? '—' : `${Number(value).toFixed(1)}%`);

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

const ChartCard = ({ title, subtitle, children, className = '' }) => (
  <div className={`rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100 ${className}`}>
    <div className="mb-4">
      <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
      {subtitle ? <p className="mt-1 text-sm text-gray-500">{subtitle}</p> : null}
    </div>
    {children}
  </div>
);

const AttendanceDashboardView = ({
  mode = 'daily',
  branchId = '',
  branchName = 'All Branches',
  canFilterAcrossBranches = false,
}) => {
  const { userInfo } = useAuth();
  const userType = userInfo?.user_type || userInfo?.userType;
  const isMonthly = mode === 'monthly';
  const today = getTodayManila();

  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedMonth, setSelectedMonth] = useState(maxSummaryMonth());
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedProgramId, setSelectedProgramId] = useState('');
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedTeacherId, setSelectedTeacherId] = useState('');

  const isTeacher = userType === 'Teacher';
  const canEditAttendance = userType === 'Admin' || userType === 'Teacher';

  const { options: filterOptions, loading: filtersLoading } = useAttendanceDashboardFilters({
    branchId,
    programId: selectedProgramId,
  });

  useEffect(() => {
    setSelectedProgramId('');
    setSelectedClassId('');
    setSelectedTeacherId('');
  }, [branchId]);

  useEffect(() => {
    setSelectedClassId('');
  }, [selectedProgramId]);

  useEffect(() => {
    if (!selectedClassId) return;
    if (!filterOptions.classes.some((c) => String(c.class_id) === String(selectedClassId))) {
      setSelectedClassId('');
    }
  }, [filterOptions.classes, selectedClassId]);

  const {
    pendingCount,
    takenCount,
    totalCount,
    totalMarks,
    presentCount,
    absentCount,
    absentRate,
    lateCount,
    excusedCount,
    leaveEarlyCount,
    presentRate,
    rateSummaries,
    dailyBreakdown,
    loading,
    error,
    refresh,
    isTruncated,
  } = useOperationalAttendanceSessions({
    mode,
    summaryDate: selectedDate,
    summaryMonth: selectedMonth,
    branchId,
    programId: selectedProgramId,
    classId: selectedClassId,
    teacherId: selectedTeacherId,
    attendanceFilter: 'all',
    enabled: true,
  });

  const periodLabel = useMemo(() => {
    if (isMonthly) {
      const [year, month] = selectedMonth.split('-').map(Number);
      return new Date(year, month - 1, 1).toLocaleDateString('en-PH', {
        month: 'long',
        year: 'numeric',
        timeZone: 'Asia/Manila',
      });
    }
    if (selectedDate === today) return 'Today';
    return formatDateManila(`${selectedDate}T12:00:00`);
  }, [isMonthly, selectedMonth, selectedDate, today]);

  const scopeNote = useMemo(() => {
    if (userType === 'Teacher') return ATTENDANCE_DASHBOARD.teacherScopeNote;
    if (userType === 'Admin') return ATTENDANCE_DASHBOARD.adminScopeNote;
    if (canFilterAcrossBranches) return ATTENDANCE_DASHBOARD.superadminScopeNote;
    return null;
  }, [userType, canFilterAcrossBranches]);

  const markChartData = useMemo(
    () =>
      [
        { name: 'Present', value: presentCount },
        { name: 'Absent', value: absentCount },
        { name: 'Late', value: lateCount },
        { name: 'Excused', value: excusedCount },
        { name: 'Leave Early', value: leaveEarlyCount },
      ].filter((item) => item.value > 0),
    [presentCount, absentCount, lateCount, excusedCount, leaveEarlyCount]
  );

  const dailyTrendData = useMemo(
    () =>
      (dailyBreakdown || []).map((row) => ({
        label: formatDateManila(`${row.session_date}T12:00:00`),
        taken: row.taken_sessions,
        pending: row.pending_sessions,
        total: row.total_sessions,
      })),
    [dailyBreakdown]
  );

  const showBranchColumn = canFilterAcrossBranches && !branchId;

  return (
    <div className="w-full min-w-0 space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
            {isMonthly ? ATTENDANCE_DASHBOARD.monthlyPageTitle : ATTENDANCE_DASHBOARD.dailyPageTitle}
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            {isMonthly ? ATTENDANCE_DASHBOARD.monthlyIntro : ATTENDANCE_DASHBOARD.dailyIntro}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {canFilterAcrossBranches ? (
              <>
                Branch: <span className="font-medium text-gray-700">{branchName}</span> ·{' '}
              </>
            ) : null}
            {DASHBOARD_DATE_NOTE}
          </p>
          {scopeNote ? <p className="mt-1 text-xs text-gray-500">{scopeNote}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              {isMonthly ? 'Month' : 'Date'}
            </span>
            {isMonthly ? (
              <input
                type="month"
                value={selectedMonth}
                max={maxSummaryMonth()}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-700 focus:border-[#F7C844] focus:outline-none focus:ring-2 focus:ring-[#F7C844]/40"
              />
            ) : (
              <input
                type="date"
                value={selectedDate}
                max={today}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-700 focus:border-[#F7C844] focus:outline-none focus:ring-2 focus:ring-[#F7C844]/40"
              />
            )}
          </label>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center rounded-xl bg-[#F7C844] px-4 py-2 text-sm font-semibold text-gray-900 shadow-sm transition hover:bg-[#e5b83d]"
          >
            See all sessions
          </button>
        </div>
      </div>

      <AttendanceDashboardFilters
        programId={selectedProgramId}
        classId={selectedClassId}
        teacherId={selectedTeacherId}
        onProgramChange={setSelectedProgramId}
        onClassChange={setSelectedClassId}
        onTeacherChange={setSelectedTeacherId}
        programs={filterOptions.programs}
        classes={filterOptions.classes}
        teachers={filterOptions.teachers}
        loading={filtersLoading}
        showTeacherFilter={!isTeacher}
        onClear={() => {
          setSelectedProgramId('');
          setSelectedClassId('');
          setSelectedTeacherId('');
        }}
      />

      <div className="rounded-2xl border border-amber-100 bg-gradient-to-r from-amber-50 to-yellow-50 px-5 py-4 shadow-sm ring-1 ring-amber-100">
        <p className="text-sm font-semibold text-amber-900">
          Period: <span className="font-bold text-amber-800">{periodLabel}</span>
        </p>
        <p className="text-xs text-amber-800">
          {loading
            ? 'Loading attendance summary…'
            : `${formatNumber(pendingCount)} need attendance · ${formatNumber(takenCount)} taken · ${formatNumber(totalCount)} total sessions`}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatsCard
          title="Total sessions"
          value={loading ? '…' : formatNumber(totalCount)}
          iconName="clock"
          accent="bg-sky-500/80"
        />
        <StatsCard
          title="Needs attendance"
          value={loading ? '…' : formatNumber(pendingCount)}
          iconName="exclamationTriangle"
          accent="bg-amber-500/80"
        />
        <StatsCard
          title="Already taken"
          value={loading ? '…' : formatNumber(takenCount)}
          iconName="checkCircle"
          accent="bg-emerald-500/80"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatsCard
          title="Present rate"
          value={loading ? '…' : formatRate(presentRate)}
          iconName="academicCap"
          accent="bg-green-500/80"
          tooltip={ATTENDANCE_DASHBOARD.presentRate}
        />
        <StatsCard
          title="Absences rate"
          value={loading ? '…' : formatRate(absentRate)}
          iconName="xCircle"
          accent="bg-red-500/80"
          tooltip={ATTENDANCE_DASHBOARD.absentRate}
        />
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ChartCard
          title="Student mark distribution"
          subtitle={ATTENDANCE_DASHBOARD.markDistribution}
        >
          {loading ? (
            <div className="flex h-64 items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#F7C844] border-t-transparent" />
            </div>
          ) : markChartData.length === 0 ? (
            <p className="py-12 text-center text-sm text-gray-500">No attendance marks recorded for this period.</p>
          ) : (
            <div className="h-64 w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={markChartData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    {markChartData.map((entry) => (
                      <Cell key={entry.name} fill={MARK_COLORS[entry.name] || CHART_COLORS[0]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => formatNumber(value)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
          <p className="mt-3 text-center text-sm text-gray-600">
            Total marks: <span className="font-semibold text-gray-900">{formatNumber(totalMarks)}</span>
          </p>
        </ChartCard>

        {isMonthly ? (
          <ChartCard title="Daily session trend" subtitle={ATTENDANCE_DASHBOARD.dailyTrend}>
            {loading ? (
              <div className="flex h-64 items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#F7C844] border-t-transparent" />
              </div>
            ) : dailyTrendData.length === 0 ? (
              <p className="py-12 text-center text-sm text-gray-500">No sessions in this month.</p>
            ) : (
              <div className="h-64 w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyTrendData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="taken" name="Taken" fill="#22C55E" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="pending" name="Pending" fill="#F59E0B" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </ChartCard>
        ) : (
          <ChartCard title="Mark summary" subtitle="Counts for the selected date">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[
                { label: 'Present', value: presentCount, color: 'text-green-700 bg-green-50 ring-green-100' },
                { label: 'Absent', value: absentCount, color: 'text-red-700 bg-red-50 ring-red-100' },
                { label: 'Late', value: lateCount, color: 'text-amber-700 bg-amber-50 ring-amber-100' },
                { label: 'Excused', value: excusedCount, color: 'text-indigo-700 bg-indigo-50 ring-indigo-100' },
                { label: 'Leave Early', value: leaveEarlyCount, color: 'text-teal-700 bg-teal-50 ring-teal-100' },
                { label: 'Total marks', value: totalMarks, color: 'text-gray-800 bg-gray-50 ring-gray-100' },
              ].map((item) => (
                <div
                  key={item.label}
                  className={`rounded-xl px-4 py-3 text-center ring-1 ${item.color}`}
                >
                  <p className="text-xs font-semibold uppercase tracking-wide opacity-80">{item.label}</p>
                  <p className="mt-1 text-xl font-bold">{loading ? '…' : formatNumber(item.value)}</p>
                </div>
              ))}
            </div>
          </ChartCard>
        )}
      </div>

      <AttendanceRateSummarySection mode={mode} rateSummaries={rateSummaries} loading={loading} />

      {isTruncated ? (
        <p className="text-sm text-amber-700">
          Showing a capped session list. Use <strong>See all sessions</strong> for the full list.
        </p>
      ) : null}

      <OperationalAttendanceShortcuts
        mode={mode}
        summaryDate={selectedDate}
        summaryMonth={selectedMonth}
        branchId={branchId}
        programId={selectedProgramId}
        classId={selectedClassId}
        teacherId={selectedTeacherId}
        showBranchColumn={showBranchColumn}
        canEditAttendance={canEditAttendance}
      />

      <OperationalAttendanceModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        mode={mode}
        summaryDate={selectedDate}
        summaryMonth={selectedMonth}
        branchId={branchId}
        programId={selectedProgramId}
        classId={selectedClassId}
        teacherId={selectedTeacherId}
        branchName={branchName}
        showBranchColumn={showBranchColumn}
        canEditAttendance={canEditAttendance}
        onAttendanceSaved={refresh}
      />
    </div>
  );
};

export default AttendanceDashboardView;
