import { useEffect, useMemo, useRef, useState } from 'react';
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
import { apiRequest } from '../../config/api';
import { useAuth } from '../../contexts/AuthContext';
import { useGlobalBranchFilter } from '../../contexts/GlobalBranchFilterContext';
import { DashboardStatIcon } from '../../components/dashboard/DashboardStatIcons';

const COLORS = ['#22C55E', '#94A3B8', '#F7C844', '#4F46E5'];
const CURRENT_MONTH = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }).slice(0, 7);

/** Sum enrolled / students across phases 1–10, then overall % (e.g. 20/40 → 50%). */
function summarizeEnrollmentRatePhases1To10(rows) {
  const phaseRows = (rows || []).filter(
    (row) => Number(row.phase_number) >= 1 && Number(row.phase_number) <= 10
  );
  const enrolledCount = phaseRows.reduce((sum, row) => sum + Number(row.enrolled_count || 0), 0);
  const studentCount = phaseRows.reduce(
    (sum, row) => sum + Number(row.student_count ?? row.cohort_count ?? 0),
    0
  );
  const enrollmentRate =
    studentCount > 0 ? Number(((enrolledCount / studentCount) * 100).toFixed(2)) : 0;
  return { enrolledCount, studentCount, enrollmentRate, phaseRows };
}

const StatsCard = ({ title, value, iconName, accent, description }) => (
  <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100 transition-all hover:shadow-md">
    <div className="flex items-start justify-between">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-600">{title}</p>
        <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900">
          {typeof value === 'number' ? value.toLocaleString() : value}
        </p>
        {description && (
          <p className="mt-2 text-xs text-gray-500 leading-snug">{description}</p>
        )}
      </div>
      <div className={`ml-4 flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl ${accent}`}>
        <DashboardStatIcon name={iconName} className="h-6 w-6 text-white drop-shadow-sm" />
      </div>
    </div>
  </div>
);

const CombinedStatsCard = ({ title, iconName, accent, description, metrics = [] }) => (
  <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100 transition-all hover:shadow-md">
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-600">{title}</p>
        <div className="mt-3 space-y-2">
          {metrics.map((metric) => (
            <div key={metric.label} className="flex items-baseline justify-between gap-3">
              <span className="text-xs font-medium text-gray-500">{metric.label}</span>
              <span className="text-2xl font-bold tabular-nums tracking-tight text-gray-900">
                {typeof metric.value === 'number' ? metric.value.toLocaleString() : metric.value}
              </span>
            </div>
          ))}
        </div>
        {description && (
          <p className="mt-2 text-xs leading-snug text-gray-500">{description}</p>
        )}
      </div>
      <div className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl ${accent}`}>
        <DashboardStatIcon name={iconName} className="h-6 w-6 text-white drop-shadow-sm" />
      </div>
    </div>
  </div>
);

const OverallToggle = ({ checked, onChange, disabled = false }) => (
  <div className="inline-flex items-center gap-2">
    <span className="text-xs font-medium text-gray-600">Overall</span>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label="Show overall enrollment rate"
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'border-gray-900 bg-gray-900' : 'border-gray-300 bg-white'
      }`}
    >
      <span
        aria-hidden
        className={`pointer-events-none absolute top-0.5 inline-block h-4 w-4 rounded-full shadow transition-transform duration-200 ${
          checked ? 'translate-x-5 bg-white' : 'translate-x-0.5 bg-gray-900'
        }`}
      />
    </button>
  </div>
);

const ChartCard = ({ title, subtitle, children, className = '' }) => (
  <div className={`rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100 ${className}`}>
    <div className="mb-4">
      <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
      {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
    </div>
    <div className="h-72">{children}</div>
  </div>
);

const EnrollmentDashboard = () => {
  const { userInfo } = useAuth();
  const { selectedBranchId } = useGlobalBranchFilter();
  const userType = userInfo?.userType || userInfo?.user_type;
  const branchId = userInfo?.branchId ?? userInfo?.branch_id;
  const showBranchFilter = userType === 'Superadmin' || (userType === 'Finance' && (branchId === null || branchId === undefined));

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Default to the current Manila month so the "Enrollments by Month" trend defaults to
  // "this month" on first paint. Users can still pick another month from the picker.
  const [selectedMonth, setSelectedMonth] = useState(CURRENT_MONTH);
  const [selectedCurriculumId, setSelectedCurriculumId] = useState('');
  const [enrollmentRateOverall, setEnrollmentRateOverall] = useState(false);
  const [enrollmentRateByPhase, setEnrollmentRateByPhase] = useState([]);
  const [enrollmentRateLoading, setEnrollmentRateLoading] = useState(false);
  const [enrollmentRateError, setEnrollmentRateError] = useState('');
  const skipCurriculumTableFetchRef = useRef(true);

  const buildEnrollmentParams = (scope) => {
    const params = new URLSearchParams();
    if (selectedBranchId) params.set('branch_id', selectedBranchId);
    if (selectedMonth) params.set('month', selectedMonth);
    if (selectedCurriculumId) params.set('curriculum_id', selectedCurriculumId);
    params.set('enrollment_rate_scope', scope);
    return params;
  };

  const fetchEnrollmentRateTable = async (scopeOverride) => {
    const scope = scopeOverride ?? (enrollmentRateOverall ? 'overall' : 'month');
    try {
      setEnrollmentRateLoading(true);
      setEnrollmentRateError('');
      const res = await apiRequest(`/dashboard/enrollment?${buildEnrollmentParams(scope).toString()}`);
      setEnrollmentRateByPhase(res.data?.enrollment_rate_by_phase ?? []);
    } catch (err) {
      setEnrollmentRateError(err?.message || 'Failed to load enrollment rate table.');
    } finally {
      setEnrollmentRateLoading(false);
    }
  };

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const params = buildEnrollmentParams(enrollmentRateOverall ? 'overall' : 'month');
      const res = await apiRequest(`/dashboard/enrollment?${params.toString()}`);
      setData(res.data);
      setEnrollmentRateByPhase(res.data?.enrollment_rate_by_phase ?? []);
      setEnrollmentRateError('');
    } catch (err) {
      setError(err?.message || 'Failed to load enrollment dashboard.');
    } finally {
      setLoading(false);
    }
  };

  const handleEnrollmentRateOverallToggle = () => {
    const nextOverall = !enrollmentRateOverall;
    setEnrollmentRateOverall(nextOverall);
    fetchEnrollmentRateTable(nextOverall ? 'overall' : 'month');
  };

  useEffect(() => {
    fetchData();
  }, [selectedBranchId, selectedMonth]);

  useEffect(() => {
    if (skipCurriculumTableFetchRef.current) {
      skipCurriculumTableFetchRef.current = false;
      return;
    }
    if (loading || !data) return;
    fetchEnrollmentRateTable();
  }, [selectedCurriculumId]);

  const pieData = useMemo(() => {
    if (!data) return [];
    const newEnrollees = Number(data.new_enrollees_count ?? 0);
    const reEnrolled = Number(data.re_enrollment_count ?? 0);
    return [
      { name: 'New enrollee', value: newEnrollees, fill: COLORS[0] },
      { name: 'Re-enrolled', value: reEnrolled, fill: COLORS[3] },
    ].filter((d) => d.value > 0);
  }, [data]);

  const monthlyEnrollmentRate = useMemo(() => data?.monthly_enrollment_rate ?? [], [data]);
  const curricula = useMemo(() => data?.curricula ?? [], [data]);
  const byBranch = useMemo(() => data?.active_inactive_by_branch ?? [], [data]);
  const branches = useMemo(() => data?.branches ?? [], [data]);
  const selectedCurriculum = useMemo(() => {
    if (!selectedCurriculumId) return null;
    return curricula.find((item) => String(item.curriculum_id) === String(selectedCurriculumId)) || null;
  }, [curricula, selectedCurriculumId]);
  const selectedBranchName = useMemo(() => {
    if (!selectedBranchId) return 'All Branches';
    const b = branches.find((x) => String(x.branch_id) === String(selectedBranchId));
    return b?.branch_name ?? 'All Branches';
  }, [selectedBranchId, branches]);

  const totalEnrollmentRate = useMemo(
    () => summarizeEnrollmentRatePhases1To10(enrollmentRateByPhase),
    [enrollmentRateByPhase]
  );

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-2 border-[#F7C844] border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm font-medium text-red-800">{error}</p>
      </div>
    );
  }

  const activeStudents = data?.active_students ?? 0;
  const inactiveStudents = data?.inactive_students ?? 0;
  const newEnrolleesCount = Number(data?.new_enrollees_count ?? 0);
  const reEnrollmentCount = Number(data?.re_enrollment_count ?? 0);
  const droppedCount = Number(data?.dropped_count ?? 0);
  const rejoinCount = Number(data?.rejoin_count ?? 0);
  const reservedStudents = Number(data?.reserved_students_count ?? data?.reserved_only_count ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Enrollment Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">
            Active and inactive students, enrollment status movement, reservations, and trends.
          </p>
          {selectedMonth ? (
            <p className="mt-1 text-xs font-medium text-amber-700">
              Month filter: applies to new, re-enrollment, dropped, rejoin, the enrollment trend, and the enrollment rate table (unless Overall is toggled on that table).
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Month</span>
            <input
              type="month"
              value={selectedMonth}
              max={CURRENT_MONTH}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-700 focus:border-[#F7C844] focus:outline-none focus:ring-2 focus:ring-[#F7C844]/40"
            />
          </label>
          <button
            type="button"
            onClick={fetchData}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#F7C844] focus:ring-offset-2"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H16" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {showBranchFilter && selectedBranchId && (
        <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-2 text-sm text-blue-800">
          Viewing: <span className="font-semibold">{selectedBranchName}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <CombinedStatsCard
          title="Active / Inactive Students"
          iconName="userMinus"
          accent="bg-gradient-to-br from-emerald-400 to-slate-500"
          metrics={[
            { label: 'Active', value: activeStudents },
            { label: 'Inactive', value: inactiveStudents },
          ]}
          description="Current student status from studentstatustbl."
        />
        <CombinedStatsCard
          title="New Enrollees / Re-enrollment"
          iconName="users"
          accent="bg-gradient-to-br from-teal-400 to-cyan-500"
          metrics={[
            { label: 'New enrollees', value: newEnrolleesCount },
            { label: 'Re-enrollment', value: reEnrollmentCount },
          ]}
          description="Selected month from program_enrollment_status."
        />
        <CombinedStatsCard
          title="Dropped / Rejoin"
          iconName="userMinus"
          accent="bg-gradient-to-br from-rose-500 to-orange-500"
          metrics={[
            { label: 'Dropped', value: droppedCount },
            { label: 'Rejoin', value: rejoinCount },
          ]}
          description="Selected month from program_enrollment_status."
        />
        <StatsCard
          title="Total Enrollment Rate"
          value={`${totalEnrollmentRate.enrollmentRate.toFixed(2)}%`}
          iconName="chartBar"
          accent="bg-gradient-to-br from-blue-400 to-cyan-500"
          description={
            enrollmentRateLoading
              ? 'Loading…'
              : `${totalEnrollmentRate.enrolledCount.toLocaleString()} enrolled of ${totalEnrollmentRate.studentCount.toLocaleString()} students (phases 1–10). ${
                  enrollmentRateOverall ? 'Overall scope.' : 'Selected month (enrolled_at).'
                }`
          }
        />
        <StatsCard
          title="Reserved Students"
          value={reservedStudents}
          iconName="clipboardList"
          accent="bg-gradient-to-br from-indigo-400 to-indigo-500"
          description="Current reserved rows from program_enrollment_status."
        />
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
        <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-lg font-semibold text-gray-900">Enrollment Rate by Phase</h3>
              <OverallToggle
                checked={enrollmentRateOverall}
                onChange={handleEnrollmentRateOverallToggle}
                disabled={enrollmentRateLoading}
              />
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Enrolled students (new, re_enrolled, upsell, rejoin, or completed) divided by total students with a row for each phase.
              {enrollmentRateOverall ? (
                <span className="mt-1 block text-xs text-gray-600">Showing all current enrollment rows (not limited by month).</span>
              ) : (
                <span className="mt-1 block text-xs text-gray-600">
                  Filtered by selected month using enrolled_at (Manila).
                </span>
              )}
              {selectedCurriculum ? (
                <span className="mt-1 block text-xs text-gray-600">
                  {selectedCurriculum.curriculum_name}: {selectedCurriculum.number_of_phase || 0} phase(s),{' '}
                  {selectedCurriculum.number_of_session_per_phase || 0} session(s) per phase.
                </span>
              ) : null}
            </p>
          </div>
          <label className="inline-flex w-full flex-col gap-1 sm:w-auto sm:min-w-[240px]">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Curriculum</span>
            <select
              value={selectedCurriculumId}
              onChange={(e) => setSelectedCurriculumId(e.target.value)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-[#F7C844] focus:outline-none focus:ring-2 focus:ring-[#F7C844]/40"
            >
              <option value="">Overall</option>
              {curricula.map((curriculum) => (
                <option key={curriculum.curriculum_id} value={String(curriculum.curriculum_id)}>
                  {curriculum.curriculum_name}
                  {curriculum.number_of_phase || curriculum.number_of_session_per_phase
                    ? ` (${curriculum.number_of_phase || 0} phases · ${curriculum.number_of_session_per_phase || 0} sessions)`
                    : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
        {enrollmentRateError ? (
          <p className="mb-3 text-sm text-red-600">{enrollmentRateError}</p>
        ) : null}
        <div className="relative min-h-[120px]">
          {enrollmentRateLoading ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/70">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#F7C844] border-t-transparent" />
            </div>
          ) : null}
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
                <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                  <th className="px-4 py-3">Phase</th>
                  <th className="px-4 py-3 text-right">Enrolled</th>
                  <th className="px-4 py-3 text-right">Students</th>
                  <th className="px-4 py-3 text-right">Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-sm text-gray-800">
                {enrollmentRateByPhase.length > 0 ? (
                  enrollmentRateByPhase.map((row) => (
                    <tr key={row.phase_number} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">Phase {row.phase_number}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{Number(row.enrolled_count || 0).toLocaleString()}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{Number(row.student_count ?? row.cohort_count ?? 0).toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-gray-900">
                        {Number(row.enrollment_rate || 0).toFixed(2)}%
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-500">
                      {enrollmentRateLoading ? 'Loading…' : 'No phase enrollment data for the selected scope.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartCard
          title="New Enrollee vs Re-enrolled"
          subtitle="Distinct students in the selected month (program_enrollment_status, enrolled_at Manila)."
        >
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={2}
                  dataKey="value"
                  nameKey="name"
                  label={({ name, value }) => `${name}: ${value}`}
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => [value, '']} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-gray-500">
              No new enrollee or re-enrollment data for the selected month.
            </div>
          )}
        </ChartCard>

        <ChartCard
          title="Enrollment Rate by Month"
           >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthlyEnrollmentRate} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis
                tick={{ fontSize: 12 }}
                domain={[0, 100]}
                tickFormatter={(value) => `${value}%`}
              />
              <Tooltip
                formatter={(value, name, props) => {
                  if (name === 'Enrollment rate') {
                    const row = props?.payload;
                    return [
                      `${Number(value).toFixed(2)}% (${Number(row?.enrolled_count || 0).toLocaleString()} / ${Number(row?.student_count || 0).toLocaleString()})`,
                      name,
                    ];
                  }
                  return [value, name];
                }}
              />
              <Bar dataKey="enrollment_rate" name="Enrollment rate" fill="#F7C844" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {byBranch.length > 0 && (
        <ChartCard
          title="Active vs Inactive by Branch"
          subtitle="Student counts per branch (all branches view)."
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={byBranch}
              margin={{ top: 8, right: 8, left: 8, bottom: 8 }}
              layout="vertical"
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
              <YAxis type="category" dataKey="branch_name" width={120} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="active" name="Active" stackId="a" fill={COLORS[0]} radius={[0, 0, 0, 0]} />
              <Bar dataKey="inactive" name="Inactive" stackId="a" fill={COLORS[1]} radius={[0, 0, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}
    </div>
  );
};

export default EnrollmentDashboard;
