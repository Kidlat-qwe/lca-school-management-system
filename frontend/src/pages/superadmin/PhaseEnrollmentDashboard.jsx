import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../../config/api';
import { useAuth } from '../../contexts/AuthContext';
import { useGlobalBranchFilter } from '../../contexts/GlobalBranchFilterContext';
import {
  EnrollmentCombinedStatsCard,
  EnrollmentStatsCard,
} from '../../components/dashboard/EnrollmentDashboardKpiCards';
import EnrollmentRatePhaseVerifyModal from '../../components/dashboard/EnrollmentRatePhaseVerifyModal';
import StudentPhaseEnrollmentMatrixChart from '../../components/dashboard/StudentPhaseEnrollmentMatrixChart';
import {
  ENROLLMENT_DASHBOARD,
  MONTHLY_ENROLLMENT_DASHBOARD,
  PHASE_ENROLLMENT_DASHBOARD,
} from '../../constants/dashboardDescriptions';
import {
  aggregateMonthMatrixKpiTotals,
  matrixCohortStats,
  reEnrollmentRateFromMatrixStats,
  sumMonthStatsReEnrolledNumerators,
} from '../../utils/enrollmentMatrixRate';
import { issueDateRangeFromManilaYear } from '../../utils/dateUtils';

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

const PhaseEnrollmentDashboard = () => {
  const navigate = useNavigate();
  const { userInfo } = useAuth();
  const { selectedBranchId } = useGlobalBranchFilter();
  const userType = userInfo?.userType || userInfo?.user_type;
  const branchId = userInfo?.branchId ?? userInfo?.branch_id;
  const reportBasePath = userType === 'Admin' ? '/admin' : '/superadmin';
  const showBranchFilter = userType === 'Superadmin' || (userType === 'Finance' && (branchId === null || branchId === undefined));

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedYear, setSelectedYear] = useState(String(CURRENT_YEAR));
  const [selectedProgramId, setSelectedProgramId] = useState('');
  const [selectedClassId, setSelectedClassId] = useState('');
  const [verifyPhase, setVerifyPhase] = useState(null);

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

  const displayYear = data?.selected_year ?? selectedYear;

  const buildEnrollmentParams = () => {
    const params = new URLSearchParams();
    if (selectedBranchId) params.set('branch_id', selectedBranchId);
    if (selectedYear) params.set('year', selectedYear);
    if (selectedProgramId) params.set('program_id', selectedProgramId);
    if (selectedClassId) params.set('class_id', selectedClassId);
    params.set('enrollment_rate_scope', 'month');
    params.set('phase_matrix_scope', 'month');
    return params;
  };

  const openEnrollmentReport = ({ phaseNumber, enrolledOnly }) => {
    const params = new URLSearchParams();
    params.set('tab', 'program_enrollment_status');
    if (selectedBranchId) params.set('branch_id', String(selectedBranchId));
    if (phaseNumber) params.set('phase_number', String(phaseNumber));
    if (selectedYear) {
      const range = issueDateRangeFromManilaYear(selectedYear);
      if (range.from) params.set('enrolled_date_from', range.from);
      if (range.to) params.set('enrolled_date_to', range.to);
    }
    if (enrolledOnly) params.set('enrolled_only', '1');
    navigate(`${reportBasePath}/report?${params.toString()}`);
  };

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await apiRequest(`/dashboard/enrollment?${buildEnrollmentParams().toString()}`);
      setData(res.data);
    } catch (err) {
      setError(err?.message || 'Failed to load phase enrollment dashboard.');
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

  const studentPhaseMatrix = useMemo(() => data?.student_phase_enrollment_matrix ?? null, [data]);
  /** Year KPI cards use the month billing matrix (same as Month Re-enrollment dashboard). */
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

  const selectedProgramName = useMemo(() => {
    if (!selectedProgramId) return 'All programs';
    const row = programs.find((p) => String(p.program_id) === String(selectedProgramId));
    return row?.program_name ?? 'Selected program';
  }, [programs, selectedProgramId]);

  const selectedClassName = useMemo(() => {
    if (!selectedClassId) return 'All classes';
    const row = classes.find((c) => String(c.class_id) === String(selectedClassId));
    return row?.class_name ?? 'Selected class';
  }, [classes, selectedClassId]);

  const selectedBranchName = useMemo(() => {
    if (!selectedBranchId) return 'All Branches';
    const b = branches.find((x) => String(x.branch_id) === String(selectedBranchId));
    return b?.branch_name ?? 'All Branches';
  }, [selectedBranchId, branches]);

  const phaseMatrixScopeLabel = useMemo(
    () => ENROLLMENT_DASHBOARD.phaseMatrixScopeYear(displayYear),
    [displayYear]
  );

  const enrollmentVerifyScopeLabel = useMemo(() => {
    const parts = [selectedBranchName, `Year: ${displayYear}`];
    return parts.filter(Boolean).join(' · ');
  }, [selectedBranchName, displayYear]);

  const matrixKpiTotals = useMemo(
    () => aggregateMonthMatrixKpiTotals(studentMonthMatrix),
    [studentMonthMatrix]
  );

  const matrixCohort = useMemo(() => matrixCohortStats(studentMonthMatrix), [studentMonthMatrix]);

  const reEnrollmentFromRateNumerators = useMemo(
    () => sumMonthStatsReEnrolledNumerators(studentMonthMatrix?.month_stats ?? []),
    [studentMonthMatrix?.month_stats]
  );

  const totalReEnrollmentRate = useMemo(
    () =>
      reEnrollmentRateFromMatrixStats(studentMonthMatrix?.month_stats ?? [], {
        total_re_enrolled_count: studentMonthMatrix?.total_re_enrolled_count,
        total_prior_month_enrolled_count: studentMonthMatrix?.total_prior_month_enrolled_count,
        total_re_enrollment_rate: studentMonthMatrix?.total_re_enrollment_rate,
      }),
    [studentMonthMatrix]
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

  const newEnrolleesCount = matrixKpiTotals.new_enrollees_count;
  /** Sum of month-matrix rate-header numerators — matches Month Re-enrollment dashboard. */
  const reEnrollmentCount = reEnrollmentFromRateNumerators;
  const droppedCount = matrixKpiTotals.dropped_count;
  const rejoinCount = matrixKpiTotals.rejoin_count;
  const upsellCount = matrixKpiTotals.upsell_count;
  const reservedStudents = matrixKpiTotals.reserved_count;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Phase Re-enrollment</h1>
          <p className="mt-1 text-sm text-gray-500">{PHASE_ENROLLMENT_DASHBOARD.pageIntro(displayYear)}</p>
          {selectedYear ? (
            <p className="mt-1 text-xs font-medium text-amber-700">{ENROLLMENT_DASHBOARD.yearFilterNote}</p>
          ) : null}
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

      <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-2 text-sm text-amber-900">
        {PHASE_ENROLLMENT_DASHBOARD.kpiCardsAlignWithMonthYear(displayYear)}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <EnrollmentCombinedStatsCard
          title="Matrix Cohort"
          iconName="users"
          accent="bg-gradient-to-br from-emerald-400 to-slate-500"
          metrics={[
            { label: 'Retention base', value: totalReEnrollmentRate.priorEnrolledCount },
            { label: 'Students', value: matrixCohort.uniqueStudentCount },
          ]}
          tooltip={MONTHLY_ENROLLMENT_DASHBOARD.matrixCohortYear(displayYear)}
        />
        <EnrollmentCombinedStatsCard
          title="New Enrollees / Re-enrollment"
          iconName="users"
          accent="bg-gradient-to-br from-teal-400 to-cyan-500"
          metrics={[
            { label: 'New enrollees', value: newEnrolleesCount },
            { label: 'Re-enrollment', value: reEnrollmentCount },
          ]}
          tooltip={MONTHLY_ENROLLMENT_DASHBOARD.newReenrollYear(displayYear)}
        />
        <EnrollmentCombinedStatsCard
          title="Dropped / Rejoin"
          iconName="userMinus"
          accent="bg-gradient-to-br from-rose-500 to-orange-500"
          metrics={[
            { label: 'Dropped', value: droppedCount },
            { label: 'Rejoin', value: rejoinCount },
          ]}
          tooltip={MONTHLY_ENROLLMENT_DASHBOARD.droppedRejoinYear(displayYear)}
        />
        <EnrollmentCombinedStatsCard
          title="Reserved / Upsell"
          iconName="clipboardList"
          accent="bg-gradient-to-br from-indigo-400 to-violet-500"
          metrics={[
            { label: 'Reserved', value: reservedStudents },
            { label: 'Upsell', value: upsellCount },
          ]}
          tooltip={MONTHLY_ENROLLMENT_DASHBOARD.reservedUpsellYear(displayYear)}
        />
        <EnrollmentStatsCard
          title="Total Re-enrollment Rate"
          value={`${totalReEnrollmentRate.reEnrollmentRate.toFixed(2)}%`}
          iconName="chartBar"
          accent="bg-gradient-to-br from-blue-400 to-cyan-500"
          tooltip={MONTHLY_ENROLLMENT_DASHBOARD.reEnrollmentRate(
            totalReEnrollmentRate.reEnrolledCount,
            totalReEnrollmentRate.priorEnrolledCount,
            displayYear
          )}
        />
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-semibold text-gray-900">
              Student Phase Re-enrollment Matrix — {displayYear}
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              {PHASE_ENROLLMENT_DASHBOARD.matrixLegend} {PHASE_ENROLLMENT_DASHBOARD.matrixRateTooltip}
            </p>
            <p className="mt-1 text-xs font-medium text-amber-800">{phaseMatrixScopeLabel}</p>
          </div>
          <div className="flex w-full flex-shrink-0 flex-col gap-3 sm:w-auto sm:flex-row">
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
              <span className="sr-only">Selected: {selectedProgramName}</span>
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
              <span className="sr-only">Selected: {selectedClassName}</span>
            </label>
          </div>
        </div>

        <div className="mt-4 min-h-0">
          <StudentPhaseEnrollmentMatrixChart matrix={studentPhaseMatrix} />
        </div>
      </div>

      <EnrollmentRatePhaseVerifyModal
        open={Boolean(verifyPhase)}
        phaseNumber={verifyPhase?.phase_number}
        phaseRow={verifyPhase}
        queryParams={buildEnrollmentParams().toString()}
        scopeLabel={enrollmentVerifyScopeLabel}
        onClose={() => setVerifyPhase(null)}
        onOpenReport={openEnrollmentReport}
      />
    </div>
  );
};

export default PhaseEnrollmentDashboard;
