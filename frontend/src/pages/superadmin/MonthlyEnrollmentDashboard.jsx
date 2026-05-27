import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../config/api';
import { useAuth } from '../../contexts/AuthContext';
import { useGlobalBranchFilter } from '../../contexts/GlobalBranchFilterContext';
import StudentMonthEnrollmentMatrixChart from '../../components/dashboard/StudentMonthEnrollmentMatrixChart';
import MatrixInfoTooltip from '../../components/dashboard/MatrixInfoTooltip';
import {
  EnrollmentCombinedStatsCard,
  EnrollmentStatsCard,
} from '../../components/dashboard/EnrollmentDashboardKpiCards';
import { ENROLLMENT_DASHBOARD, MONTHLY_ENROLLMENT_DASHBOARD } from '../../constants/dashboardDescriptions';
import { enrollmentRateFromMatrixStats } from '../../utils/enrollmentMatrixRate';

const CURRENT_YEAR = parseInt(
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }).slice(0, 4),
  10
);

const DEFAULT_MIN_YEAR = 2023;

const buildYearOptions = (minYear, maxYear) => {
  const years = [];
  const safeMin = Math.min(minYear, maxYear);
  for (let y = maxYear; y >= safeMin; y -= 1) {
    years.push(y);
  }
  return years;
};

const MonthlyEnrollmentDashboard = () => {
  const { userInfo } = useAuth();
  const { selectedBranchId } = useGlobalBranchFilter();
  const userType = userInfo?.userType || userInfo?.user_type;
  const branchId = userInfo?.branchId ?? userInfo?.branch_id;
  const showBranchFilter =
    userType === 'Superadmin' ||
    (userType === 'Finance' && (branchId === null || branchId === undefined));

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedYear, setSelectedYear] = useState(String(CURRENT_YEAR));
  const [selectedClassId, setSelectedClassId] = useState('');

  const yearRange = useMemo(() => {
    const minYear = data?.year_range?.min_year ?? DEFAULT_MIN_YEAR;
    const maxYear = Math.max(data?.year_range?.max_year ?? CURRENT_YEAR, CURRENT_YEAR);
    return { minYear, maxYear };
  }, [data?.year_range]);

  const yearOptions = useMemo(
    () => buildYearOptions(yearRange.minYear, yearRange.maxYear),
    [yearRange.minYear, yearRange.maxYear]
  );

  const buildParams = () => {
    const params = new URLSearchParams();
    if (selectedBranchId) params.set('branch_id', selectedBranchId);
    if (selectedYear) params.set('year', selectedYear);
    if (selectedClassId) params.set('class_id', selectedClassId);
    params.set('enrollment_rate_scope', 'month');
    params.set('phase_matrix_scope', 'overall');
    return params;
  };

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await apiRequest(`/dashboard/enrollment?${buildParams().toString()}`);
      setData(res.data);
    } catch (err) {
      setError(err?.message || 'Failed to load monthly enrollment dashboard.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedBranchId, selectedYear, selectedClassId]);

  useEffect(() => {
    if (!data?.year_range) return;
    const { minYear, maxYear } = yearRange;
    const y = parseInt(selectedYear, 10);
    if (!Number.isFinite(y) || y < minYear || y > maxYear) {
      const clamped = Math.min(Math.max(Number.isFinite(y) ? y : CURRENT_YEAR, minYear), maxYear);
      setSelectedYear(String(clamped));
    }
  }, [data?.year_range, yearRange.minYear, yearRange.maxYear]);

  const studentMonthMatrix = useMemo(() => data?.student_month_enrollment_matrix ?? null, [data]);
  const classes = useMemo(() => data?.classes ?? [], [data]);
  const branches = useMemo(() => data?.branches ?? [], [data]);
  const displayYear = data?.selected_year ?? selectedYear;

  const totalEnrollmentRate = useMemo(
    () => enrollmentRateFromMatrixStats(studentMonthMatrix?.month_stats),
    [studentMonthMatrix]
  );

  const selectedBranchName = useMemo(() => {
    if (!selectedBranchId) return 'All Branches';
    const b = branches.find((x) => String(x.branch_id) === String(selectedBranchId));
    return b?.branch_name ?? 'All Branches';
  }, [selectedBranchId, branches]);

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
          <h1 className="text-2xl font-bold text-gray-900">Monthly Enrollment Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">
            {MONTHLY_ENROLLMENT_DASHBOARD.pageIntro(displayYear)}
            <MatrixInfoTooltip label="About this dashboard">
              {MONTHLY_ENROLLMENT_DASHBOARD.matrixTitleTooltip(displayYear)}
            </MatrixInfoTooltip>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Year</span>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-700 focus:border-[#F7C844] focus:outline-none focus:ring-2 focus:ring-[#F7C844]/40"
            >
              {yearOptions.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
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
        <EnrollmentCombinedStatsCard
          title="Active / Inactive Students"
          iconName="userMinus"
          accent="bg-gradient-to-br from-emerald-400 to-slate-500"
          metrics={[
            { label: 'Active', value: activeStudents },
            { label: 'Inactive', value: inactiveStudents },
          ]}
          tooltip={ENROLLMENT_DASHBOARD.activeInactive}
        />
        <EnrollmentCombinedStatsCard
          title="New Enrollees / Re-enrollment"
          iconName="users"
          accent="bg-gradient-to-br from-teal-400 to-cyan-500"
          metrics={[
            { label: 'New enrollees', value: newEnrolleesCount },
            { label: 'Re-enrollment', value: reEnrollmentCount },
          ]}
          tooltip={ENROLLMENT_DASHBOARD.newReenroll}
        />
        <EnrollmentCombinedStatsCard
          title="Dropped / Rejoin"
          iconName="userMinus"
          accent="bg-gradient-to-br from-rose-500 to-orange-500"
          metrics={[
            { label: 'Dropped', value: droppedCount },
            { label: 'Rejoin', value: rejoinCount },
          ]}
          tooltip={ENROLLMENT_DASHBOARD.droppedRejoin}
        />
        <EnrollmentStatsCard
          title="Total Enrollment Rate"
          value={`${totalEnrollmentRate.enrollmentRate.toFixed(2)}%`}
          iconName="chartBar"
          accent="bg-gradient-to-br from-blue-400 to-cyan-500"
          tooltip={MONTHLY_ENROLLMENT_DASHBOARD.enrollmentRate(
            totalEnrollmentRate.enrolledCount,
            totalEnrollmentRate.cohortSize,
            displayYear
          )}
        />
        <EnrollmentStatsCard
          title="Reserved Students"
          value={reservedStudents}
          iconName="clipboardList"
          accent="bg-gradient-to-br from-indigo-400 to-indigo-500"
          tooltip={ENROLLMENT_DASHBOARD.reserved}
        />
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0 flex-1">
            <h3 className="flex flex-wrap items-center gap-1 text-lg font-semibold text-gray-900">
              <span>Monthly Student Enrollment Matrix — {displayYear}</span>
              <MatrixInfoTooltip label="How to read this matrix">
                {MONTHLY_ENROLLMENT_DASHBOARD.matrixTitleTooltip(displayYear)}
              </MatrixInfoTooltip>
            </h3>
          </div>
          <label className="inline-flex w-full flex-col gap-1 sm:w-auto sm:min-w-[260px] sm:max-w-[320px]">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Class</span>
            <select
              value={selectedClassId}
              onChange={(e) => setSelectedClassId(e.target.value)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-[#F7C844] focus:outline-none focus:ring-2 focus:ring-[#F7C844]/40"
            >
              <option value="">All classes</option>
              {classes.map((c) => (
                <option key={c.class_id} value={String(c.class_id)}>
                  {c.class_name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-5 min-h-0">
          <StudentMonthEnrollmentMatrixChart matrix={studentMonthMatrix} displayYear={displayYear} />
        </div>
      </div>
    </div>
  );
};

export default MonthlyEnrollmentDashboard;
