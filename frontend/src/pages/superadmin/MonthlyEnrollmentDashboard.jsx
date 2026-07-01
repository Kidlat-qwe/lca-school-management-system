import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../config/api';
import { useAuth } from '../../contexts/AuthContext';
import { useGlobalBranchFilter } from '../../contexts/GlobalBranchFilterContext';
import StudentMonthEnrollmentMatrixChart from '../../components/dashboard/StudentMonthEnrollmentMatrixChart';
import MatrixInfoTooltip from '../../components/dashboard/MatrixInfoTooltip';
import {
  EnrollmentYearMonthCombinedStatsCard,
  EnrollmentYearMonthStatsCard,
} from '../../components/dashboard/EnrollmentDashboardKpiCards';
import { MONTHLY_ENROLLMENT_DASHBOARD } from '../../constants/dashboardDescriptions';
import { manilaMonthYYYYMM } from '../../utils/dateUtils';
import {
  aggregateMonthMatrixKpiTotalsForMonth,
  aggregateMonthMatrixKpiTotalsForMonthKeys,
  countUniqueMatrixStudentsForMonth,
  countUniqueMatrixStudentsForMonthKeys,
  filterMonthStatsByKeys,
  getYearToDateMonthKeys,
  reEnrollmentRateForMonth,
  reEnrollmentRateForMonthKeys,
  sumMonthStatsReEnrolledNumerators,
} from '../../utils/enrollmentMatrixRate';

const CURRENT_YEAR = parseInt(
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }).slice(0, 4),
  10
);

const DEFAULT_MIN_YEAR = 2023;
const FUTURE_YEAR_BUFFER = 5;

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
  const [selectedProgramId, setSelectedProgramId] = useState('');
  const [selectedClassId, setSelectedClassId] = useState('');

  const yearRange = useMemo(() => {
    const minYear = data?.year_range?.min_year ?? DEFAULT_MIN_YEAR;
    const selectedYearNum = parseInt(selectedYear, 10);
    const maxYear = Math.max(
      data?.year_range?.max_year ?? CURRENT_YEAR + FUTURE_YEAR_BUFFER,
      CURRENT_YEAR + FUTURE_YEAR_BUFFER,
      Number.isFinite(selectedYearNum) ? selectedYearNum : CURRENT_YEAR
    );
    return { minYear, maxYear };
  }, [data?.year_range, selectedYear]);

  const yearOptions = useMemo(
    () => buildYearOptions(yearRange.minYear, yearRange.maxYear),
    [yearRange.minYear, yearRange.maxYear]
  );

  const buildParams = () => {
    const params = new URLSearchParams();
    if (selectedBranchId) params.set('branch_id', selectedBranchId);
    if (selectedYear) params.set('year', selectedYear);
    if (selectedProgramId) params.set('program_id', selectedProgramId);
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
  }, [selectedBranchId, selectedYear, selectedProgramId, selectedClassId]);

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
  const programs = useMemo(() => data?.programs ?? [], [data]);
  const classes = useMemo(() => data?.classes ?? [], [data]);
  const branches = useMemo(() => data?.branches ?? [], [data]);

  useEffect(() => {
    if (!selectedProgramId) return;
    if (!programs.some((p) => String(p.program_id) === String(selectedProgramId))) {
      setSelectedProgramId('');
      setSelectedClassId('');
    }
  }, [programs, selectedBranchId]);

  useEffect(() => {
    if (!selectedClassId) return;
    if (!classes.some((c) => String(c.class_id) === String(selectedClassId))) {
      setSelectedClassId('');
    }
  }, [classes, selectedProgramId]);
  const displayYear = data?.selected_year ?? selectedYear;

  const currentMonthKey = manilaMonthYYYYMM();
  const currentMonthInSelectedYear = String(displayYear) === currentMonthKey.slice(0, 4);

  const yearToDateMonthKeys = useMemo(
    () => getYearToDateMonthKeys(studentMonthMatrix, displayYear, currentMonthKey),
    [studentMonthMatrix, displayYear, currentMonthKey]
  );

  const ytdKpiTotals = useMemo(
    () => aggregateMonthMatrixKpiTotalsForMonthKeys(studentMonthMatrix, yearToDateMonthKeys),
    [studentMonthMatrix, yearToDateMonthKeys]
  );

  const ytdUniqueStudentCount = useMemo(
    () => countUniqueMatrixStudentsForMonthKeys(studentMonthMatrix, yearToDateMonthKeys),
    [studentMonthMatrix, yearToDateMonthKeys]
  );

  const ytdReEnrollmentFromRateNumerators = useMemo(
    () =>
      sumMonthStatsReEnrolledNumerators(
        filterMonthStatsByKeys(studentMonthMatrix?.month_stats ?? [], yearToDateMonthKeys)
      ),
    [studentMonthMatrix?.month_stats, yearToDateMonthKeys]
  );

  const ytdReEnrollmentRate = useMemo(
    () => reEnrollmentRateForMonthKeys(studentMonthMatrix, yearToDateMonthKeys),
    [studentMonthMatrix, yearToDateMonthKeys]
  );

  const currentMonthLabel = useMemo(() => {
    const fromMatrix = studentMonthMatrix?.months?.find((m) => m.key === currentMonthKey);
    if (fromMatrix?.label) return fromMatrix.label;
    const [y, m] = currentMonthKey.split('-');
    const date = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'Asia/Manila' });
  }, [studentMonthMatrix?.months, currentMonthKey]);

  const monthKpiTotals = useMemo(() => {
    if (!currentMonthInSelectedYear) return null;
    return aggregateMonthMatrixKpiTotalsForMonth(studentMonthMatrix, currentMonthKey);
  }, [studentMonthMatrix, currentMonthKey, currentMonthInSelectedYear]);

  const monthMatrixCohort = useMemo(() => {
    if (!currentMonthInSelectedYear) return null;
    return {
      uniqueStudentCount: countUniqueMatrixStudentsForMonth(studentMonthMatrix, currentMonthKey),
    };
  }, [studentMonthMatrix, currentMonthKey, currentMonthInSelectedYear]);

  const monthReEnrollmentRate = useMemo(() => {
    if (!currentMonthInSelectedYear) return null;
    return reEnrollmentRateForMonth(studentMonthMatrix, currentMonthKey);
  }, [studentMonthMatrix, currentMonthKey, currentMonthInSelectedYear]);

  const monthReEnrollmentCount = useMemo(() => {
    if (!currentMonthInSelectedYear) return null;
    const row = (studentMonthMatrix?.month_stats ?? []).find((r) => r.month_key === currentMonthKey);
    return row ? Number(row.re_enrolled_count) || 0 : 0;
  }, [studentMonthMatrix?.month_stats, currentMonthKey, currentMonthInSelectedYear]);

  const yearPeriodLabel = `Year ${displayYear}`;
  const shortCurrentMonthLabel = useMemo(() => {
    const fromMatrix = studentMonthMatrix?.months?.find((m) => m.key === currentMonthKey);
    const raw = fromMatrix?.label || currentMonthLabel;
    return String(raw).split(' ')[0].toUpperCase();
  }, [studentMonthMatrix?.months, currentMonthKey, currentMonthLabel]);

  const monthPeriodLabel = shortCurrentMonthLabel;

  const monthMetricValue = (value) =>
    currentMonthInSelectedYear ? value : '—';

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

  const newEnrolleesCount = ytdKpiTotals.new_enrollees_count;
  /** Sum of rate-header numerators Jan–current month — matches matrix rate row sums in that range. */
  const reEnrollmentCount = ytdReEnrollmentFromRateNumerators;
  const droppedCount = ytdKpiTotals.dropped_count;
  const rejoinCount = ytdKpiTotals.rejoin_count;
  const upsellCount = ytdKpiTotals.upsell_count;
  /** Sum of amber "reserved" labeled cells Jan–current month. */
  const reservedStudents = ytdKpiTotals.reserved_count;
  const ytdRetentionBase = ytdReEnrollmentRate.priorEnrolledCount;
  const ytdUniqueStudents = ytdUniqueStudentCount;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Month Re-enrollment</h1>
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
        <EnrollmentYearMonthCombinedStatsCard
          title="Matrix Cohort"
          iconName="users"
          accent="bg-gradient-to-br from-emerald-400 to-slate-500"
          yearLabel={yearPeriodLabel}
          monthLabel={monthPeriodLabel}
          yearMetrics={[
            { label: 'Retention base', value: ytdRetentionBase },
            { label: 'Students', value: ytdUniqueStudents },
          ]}
          monthMetrics={[
            {
              label: 'Retention base',
              value: monthMetricValue(monthReEnrollmentRate?.priorEnrolledCount ?? 0),
            },
            {
              label: 'Students',
              value: monthMetricValue(monthMatrixCohort?.uniqueStudentCount ?? 0),
            },
          ]}
          tooltip={MONTHLY_ENROLLMENT_DASHBOARD.matrixCohortYear(displayYear)}
        />
        <EnrollmentYearMonthCombinedStatsCard
          title="New Enrollees / Re-enrollment"
          iconName="users"
          accent="bg-gradient-to-br from-teal-400 to-cyan-500"
          yearLabel={yearPeriodLabel}
          monthLabel={monthPeriodLabel}
          yearMetrics={[
            { label: 'New enrollees', value: newEnrolleesCount },
            { label: 'Re-enrollment', value: reEnrollmentCount },
          ]}
          monthMetrics={[
            {
              label: 'New enrollees',
              value: monthMetricValue(monthKpiTotals?.new_enrollees_count ?? 0),
            },
            {
              label: 'Re-enrollment',
              value: monthMetricValue(monthReEnrollmentCount ?? 0),
            },
          ]}
          tooltip={MONTHLY_ENROLLMENT_DASHBOARD.newReenrollYear(displayYear)}
        />
        <EnrollmentYearMonthCombinedStatsCard
          title="Dropped / Rejoin"
          iconName="userMinus"
          accent="bg-gradient-to-br from-rose-500 to-orange-500"
          yearLabel={yearPeriodLabel}
          monthLabel={monthPeriodLabel}
          yearMetrics={[
            { label: 'Dropped', value: droppedCount },
            { label: 'Rejoin', value: rejoinCount },
          ]}
          monthMetrics={[
            {
              label: 'Dropped',
              value: monthMetricValue(monthKpiTotals?.dropped_count ?? 0),
            },
            {
              label: 'Rejoin',
              value: monthMetricValue(monthKpiTotals?.rejoin_count ?? 0),
            },
          ]}
          tooltip={MONTHLY_ENROLLMENT_DASHBOARD.droppedRejoinYear(displayYear)}
        />
        <EnrollmentYearMonthCombinedStatsCard
          title="Reserved / Upsell"
          iconName="clipboardList"
          accent="bg-gradient-to-br from-indigo-400 to-violet-500"
          yearLabel={yearPeriodLabel}
          monthLabel={monthPeriodLabel}
          yearMetrics={[
            { label: 'Reserved', value: reservedStudents },
            { label: 'Upsell', value: upsellCount },
          ]}
          monthMetrics={[
            {
              label: 'Reserved',
              value: monthMetricValue(monthKpiTotals?.reserved_count ?? 0),
            },
            {
              label: 'Upsell',
              value: monthMetricValue(monthKpiTotals?.upsell_count ?? 0),
            },
          ]}
          tooltip={MONTHLY_ENROLLMENT_DASHBOARD.reservedUpsellYear(displayYear)}
        />
        <EnrollmentYearMonthStatsCard
          title="Total Re-enrollment Rate"
          yearLabel={yearPeriodLabel}
          monthLabel={monthPeriodLabel}
          yearValue={`${ytdReEnrollmentRate.reEnrollmentRate.toFixed(2)}%`}
          monthValue={
            currentMonthInSelectedYear && monthReEnrollmentRate
              ? `${monthReEnrollmentRate.reEnrollmentRate.toFixed(2)}%`
              : '—'
          }
          iconName="chartBar"
          accent="bg-gradient-to-br from-blue-400 to-cyan-500"
          tooltip={MONTHLY_ENROLLMENT_DASHBOARD.reEnrollmentRate(
            ytdReEnrollmentRate.reEnrolledCount,
            ytdReEnrollmentRate.priorMonthEnrolledCount,
            displayYear
          )}
        />
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0 flex-1">
            <h3 className="flex flex-wrap items-center gap-1 text-lg font-semibold text-gray-900">
              <span>Month Student Re-enrollment Matrix — {displayYear}</span>
              
            </h3>
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <label className="inline-flex w-full flex-col gap-1 sm:min-w-[200px] sm:max-w-[280px]">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Program</span>
              <select
                value={selectedProgramId}
                onChange={(e) => {
                  setSelectedProgramId(e.target.value);
                  setSelectedClassId('');
                }}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-[#F7C844] focus:outline-none focus:ring-2 focus:ring-[#F7C844]/40"
              >
                <option value="">All programs</option>
                {programs.map((p) => (
                  <option key={p.program_id} value={String(p.program_id)}>
                    {p.program_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="inline-flex w-full flex-col gap-1 sm:min-w-[200px] sm:max-w-[280px]">
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
        </div>

        <div className="mt-5 min-h-0">
          <StudentMonthEnrollmentMatrixChart matrix={studentMonthMatrix} displayYear={displayYear} />
        </div>
      </div>
    </div>
  );
};

export default MonthlyEnrollmentDashboard;
