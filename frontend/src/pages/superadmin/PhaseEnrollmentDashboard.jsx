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
import { ENROLLMENT_DASHBOARD, PHASE_ENROLLMENT_DASHBOARD } from '../../constants/dashboardDescriptions';
import { reEnrollmentRateFromMatrixStats } from '../../utils/enrollmentMatrixRate';
import { issueDateRangeFromManilaMonth } from '../../utils/dateUtils';

const CURRENT_MONTH = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }).slice(0, 7);

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
  // Default to the current Manila month so the "Enrollments by Month" trend defaults to
  // "this month" on first paint. Users can still pick another month from the picker.
  const [selectedMonth, setSelectedMonth] = useState(CURRENT_MONTH);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [enrollmentRateOverall, setEnrollmentRateOverall] = useState(false);
  const [phaseMatrixOverall, setPhaseMatrixOverall] = useState(false);
  const [enrollmentRateByPhase, setEnrollmentRateByPhase] = useState([]);
  const [enrollmentRateLoading, setEnrollmentRateLoading] = useState(false);
  const [enrollmentRateError, setEnrollmentRateError] = useState('');
  const [verifyPhase, setVerifyPhase] = useState(null);

  const buildEnrollmentParams = (scope, matrixScope) => {
    const params = new URLSearchParams();
    if (selectedBranchId) params.set('branch_id', selectedBranchId);
    if (selectedMonth) params.set('month', selectedMonth);
    if (selectedClassId) params.set('class_id', selectedClassId);
    params.set('enrollment_rate_scope', scope);
    params.set('phase_matrix_scope', matrixScope ?? (phaseMatrixOverall ? 'overall' : 'month'));
    return params;
  };

  const openVerifyPhase = (row) => {
    if (!row?.phase_number) return;
    setVerifyPhase(row);
  };

  const openEnrollmentReport = ({ phaseNumber, enrolledOnly }) => {
    const params = new URLSearchParams();
    params.set('tab', 'program_enrollment_status');
    if (selectedBranchId) params.set('branch_id', String(selectedBranchId));
    if (phaseNumber) params.set('phase_number', String(phaseNumber));
    if (!enrollmentRateOverall && selectedMonth) {
      const range = issueDateRangeFromManilaMonth(selectedMonth);
      if (range.from) params.set('enrolled_date_from', range.from);
      if (range.to) params.set('enrolled_date_to', range.to);
    }
    if (enrolledOnly) params.set('enrolled_only', '1');
    navigate(`${reportBasePath}/report?${params.toString()}`);
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

  const fetchData = async (scopeOverride) => {
    try {
      setLoading(true);
      setError('');
      const scope = scopeOverride ?? (enrollmentRateOverall ? 'overall' : 'month');
      const params = buildEnrollmentParams(scope);
      const res = await apiRequest(`/dashboard/enrollment?${params.toString()}`);
      setData(res.data);
      setEnrollmentRateByPhase(res.data?.enrollment_rate_by_phase ?? []);
      setEnrollmentRateError('');
    } catch (err) {
      setError(err?.message || 'Failed to load phase enrollment dashboard.');
    } finally {
      setLoading(false);
    }
  };

  const handleEnrollmentRateOverallToggle = () => {
    const nextOverall = !enrollmentRateOverall;
    setEnrollmentRateOverall(nextOverall);
    fetchData(nextOverall ? 'overall' : 'month');
  };

  const handlePhaseMatrixOverallToggle = () => {
    setPhaseMatrixOverall((prev) => !prev);
  };

  useEffect(() => {
    fetchData();
  }, [selectedBranchId, selectedMonth, selectedClassId, phaseMatrixOverall]);

  const studentPhaseMatrix = useMemo(() => data?.student_phase_enrollment_matrix ?? null, [data]);
  const classes = useMemo(() => data?.classes ?? [], [data]);
  const branches = useMemo(() => data?.branches ?? [], [data]);
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

  const phaseMatrixScopeLabel = useMemo(() => {
    const scope = data?.phase_matrix_scope ?? (phaseMatrixOverall ? 'overall' : 'month');
    if (scope === 'overall') return ENROLLMENT_DASHBOARD.phaseMatrixScopeOverall;
    const monthLabel = selectedMonth
      ? new Date(`${selectedMonth}-01T12:00:00`).toLocaleDateString('en-US', {
          month: 'long',
          year: 'numeric',
          timeZone: 'UTC',
        })
      : 'selected month';
    return ENROLLMENT_DASHBOARD.phaseMatrixScopeMonth(monthLabel);
  }, [data?.phase_matrix_scope, phaseMatrixOverall, selectedMonth]);

  const enrollmentVerifyScopeLabel = useMemo(() => {
    const parts = [selectedBranchName];
    parts.push(enrollmentRateOverall ? 'Overall scope' : `Month: ${selectedMonth}`);
    return parts.filter(Boolean).join(' · ');
  }, [selectedBranchName, enrollmentRateOverall, selectedMonth]);

  const totalReEnrollmentRate = useMemo(
    () => reEnrollmentRateFromMatrixStats(studentPhaseMatrix?.phase_stats ?? []),
    [studentPhaseMatrix]
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
          <h1 className="text-2xl font-bold text-gray-900">Phase Enrollment Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">{ENROLLMENT_DASHBOARD.pageIntro}</p>
          {selectedMonth ? (
            <p className="mt-1 text-xs font-medium text-amber-700">{ENROLLMENT_DASHBOARD.monthFilterNote}</p>
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
          title="Total Re-enrollment Rate"
          value={`${totalReEnrollmentRate.reEnrollmentRate.toFixed(2)}%`}
          iconName="chartBar"
          accent="bg-gradient-to-br from-blue-400 to-cyan-500"
          tooltip={
            enrollmentRateLoading
              ? ENROLLMENT_DASHBOARD.enrollmentRateLoading
              : PHASE_ENROLLMENT_DASHBOARD.reEnrollmentRate(
                  totalReEnrollmentRate.reEnrolledCount,
                  totalReEnrollmentRate.priorEnrolledCount,
                  phaseMatrixOverall ? 'all phases' : 'the selected month'
                )
          }
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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-lg font-semibold text-gray-900">Student Phase Enrollment Matrix</h3>
              <OverallToggle
                checked={phaseMatrixOverall}
                onChange={handlePhaseMatrixOverallToggle}
                disabled={loading}
              />
            </div>
            <p className="mt-1 text-sm text-gray-500">
              {PHASE_ENROLLMENT_DASHBOARD.matrixLegend} {PHASE_ENROLLMENT_DASHBOARD.matrixRateTooltip}
            </p>
            <p className="mt-1 text-xs font-medium text-amber-800">{phaseMatrixScopeLabel}</p>
          </div>
          <div className="flex flex-shrink-0">
            <label className="inline-flex w-full flex-col gap-1 sm:w-auto sm:min-w-[240px] sm:max-w-[300px]">
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
        queryParams={buildEnrollmentParams(enrollmentRateOverall ? 'overall' : 'month').toString()}
        scopeLabel={enrollmentVerifyScopeLabel}
        onClose={() => setVerifyPhase(null)}
        onOpenReport={openEnrollmentReport}
      />
    </div>
  );
};

export default PhaseEnrollmentDashboard;
