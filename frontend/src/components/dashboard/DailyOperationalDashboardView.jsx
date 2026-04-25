import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Area,
  AreaChart,
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
import { DashboardStatIcon } from './DashboardStatIcons';

const COLORS = ['#F7C844', '#4F46E5', '#22C55E', '#F97316', '#14B8A6', '#DC2626'];

const formatCurrency = (amount) =>
  `Php ${(Number(amount) || 0).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const formatNumber = (value) => (Number(value) || 0).toLocaleString('en-PH');
const getTodayManila = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

const StatsCard = ({ title, value, iconName, accent, subtitle, onClick, ariaLabel }) => {
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      aria-label={ariaLabel || (onClick ? title : undefined)}
      className={`group relative h-full w-full overflow-hidden rounded-2xl bg-white p-5 text-left shadow-sm ring-1 ring-gray-100 transition-all duration-300 hover:shadow-lg hover:ring-gray-200 ${onClick ? 'cursor-pointer' : ''}`}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-semibold text-gray-700 leading-tight">{title}</p>
          <div
            className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg ${accent} shadow-sm transition-transform duration-300 group-hover:scale-110`}
          >
            <DashboardStatIcon name={iconName} className="h-5 w-5 text-white drop-shadow-sm" />
          </div>
        </div>
        <p className="mt-3 text-[1.65rem] leading-none font-bold tracking-tight text-gray-900 break-words">{value}</p>
        {subtitle ? <p className="mt-2 text-[11px] leading-4 font-medium text-gray-500">{subtitle}</p> : null}
      </div>
      <div
        className={`absolute inset-x-0 bottom-0 h-1 ${accent.replace('bg-', 'bg-gradient-to-r from-').replace('/80', ' to-transparent')}`}
      />
    </Wrapper>
  );
};

const ChartCard = ({ title, subtitle, children, className = '' }) => (
  <div className={`rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100 ${className}`}>
    <div className="mb-4">
      <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
      {subtitle ? <p className="mt-1 text-sm text-gray-500">{subtitle}</p> : null}
    </div>
    <div className="h-80">{children}</div>
  </div>
);

const EmptyChartState = ({ message }) => (
  <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 text-center text-sm text-gray-500">
    {message}
  </div>
);

const DailyOperationalDashboardView = ({
  branchId = '',
  branchName = '',
  canFilterAcrossBranches = false,
}) => {
  const navigate = useNavigate();
  const { userInfo } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedDate, setSelectedDate] = useState(getTodayManila());
  const userType = userInfo?.user_type || userInfo?.userType || '';
  const isAdmin = userType === 'Admin';
  const basePath = isAdmin ? '/admin' : '/superadmin';

  const fetchDashboard = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const params = new URLSearchParams();
      if (branchId) {
        params.set('branch_id', branchId);
      }
      if (selectedDate) {
        params.set('summary_date', selectedDate);
      }
      const queryString = params.toString();
      const response = await apiRequest(`/dashboard/daily-operational${queryString ? `?${queryString}` : ''}`);
      setData(response.data);
    } catch (err) {
      setError(err?.message || 'Failed to load the daily operational dashboard.');
    } finally {
      setLoading(false);
    }
  }, [branchId, selectedDate]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  const branchBreakdown = useMemo(() => data?.branch_breakdown || [], [data]);
  const branchMetrics = useMemo(() => data?.charts?.branch_metrics || [], [data]);
  const salesLast7Days = useMemo(() => data?.charts?.sales_last_7_days || [], [data]);
  const activityMix = useMemo(
    () => (data?.charts?.activity_mix || []).filter((item) => Number(item.value) > 0),
    [data]
  );
  const activeBranchMetrics = useMemo(
    () =>
      branchMetrics.filter(
        (row) =>
          row.new_enrollees > 0 ||
          row.daily_sales_amount > 0 ||
          row.ar_sales_amount > 0 ||
          row.merchandise_released_quantity > 0 ||
          row.re_enrollment_count > 0 ||
          (row.dropped_unenrolled_count || 0) > 0
      ),
    [branchMetrics]
  );
  const totals = data?.totals || {
    new_enrollees: 0,
    daily_sales_amount: 0,
    ar_sales_amount: 0,
    ar_sales_count: 0,
    merchandise_released_count: 0,
    merchandise_released_quantity: 0,
    re_enrollment_count: 0,
    dropped_unenrolled_count: 0,
    pay_verified_count: 0,
    pay_verified_amount: 0,
    pay_unverified_count: 0,
    pay_unverified_amount: 0,
    ar_verified_count: 0,
    ar_verified_amount: 0,
    ar_unverified_count: 0,
    ar_unverified_amount: 0,
    active_branches: 0,
  };

  const selectedBranchName = useMemo(() => {
    if (branchName) return branchName;
    if (!branchId) return 'All Branches';
    return (
      data?.branches?.find((branch) => String(branch.branch_id) === String(branchId))?.branch_name ||
      'Selected Branch'
    );
  }, [branchId, branchName, data]);

  const verificationAsOf = data?.verification_as_of || getTodayManila();

  const goPaymentLogsByVerify = useCallback(
    (kind) => {
      const p = new URLSearchParams();
      p.set('notificationTab', 'main');
      p.set('issue_date_from', verificationAsOf);
      p.set('issue_date_to', verificationAsOf);
      p.set('financeApproval', kind === 'verified' ? 'approved' : 'pending');
      navigate(`${basePath}/payment-logs?${p.toString()}`);
    },
    [basePath, navigate, verificationAsOf]
  );

  const goArByVerify = useCallback(
    (kind) => {
      const p = new URLSearchParams();
      p.set('page', '1');
      p.set('status', kind === 'verified' ? 'Verified,Applied' : 'Submitted,Pending,Paid');
      if (branchId && canFilterAcrossBranches) {
        p.set('branch_id', String(branchId));
      }
      navigate(`${basePath}/acknowledgement-receipts?${p.toString()}`);
    },
    [basePath, branchId, canFilterAcrossBranches, navigate]
  );
  const isHeadquartersView = canFilterAcrossBranches && !branchId;
  const headquarterSummary = useMemo(() => {
    if (!isHeadquartersView || branchBreakdown.length === 0) {
      return {
        topSalesBranch: null,
        topEnrollmentBranch: null,
        topReenrollmentBranch: null,
      };
    }

    const sortedBySales = [...branchBreakdown].sort(
      (a, b) => (Number(b.daily_sales_amount) || 0) - (Number(a.daily_sales_amount) || 0)
    );
    const sortedByEnrollment = [...branchBreakdown].sort(
      (a, b) => (Number(b.new_enrollees) || 0) - (Number(a.new_enrollees) || 0)
    );
    const sortedByReenrollment = [...branchBreakdown].sort(
      (a, b) => (Number(b.re_enrollment_count) || 0) - (Number(a.re_enrollment_count) || 0)
    );

    return {
      topSalesBranch: sortedBySales[0] || null,
      topEnrollmentBranch: sortedByEnrollment[0] || null,
      topReenrollmentBranch: sortedByReenrollment[0] || null,
    };
  }, [isHeadquartersView, branchBreakdown]);

  const visibleBranchCount = branchBreakdown.filter(
    (row) =>
      row.new_enrollees > 0 ||
      row.daily_sales_amount > 0 ||
      row.ar_sales_amount > 0 ||
      row.merchandise_released_count > 0 ||
      row.re_enrollment_count > 0 ||
      (row.dropped_unenrolled_count || 0) > 0
  ).length;

  if (loading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center">
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50">
      <div className="mx-auto max-w-7xl space-y-8 p-6 lg:p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
              Daily Operational Dashboard
            </h1>
            <p className="text-sm text-gray-500">
              Monitor today&apos;s enrollment activity, drops, collections, merchandise releases, and installment re-enrollment.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Date</span>
              <input
                type="date"
                value={selectedDate}
                max={getTodayManila()}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-700 focus:border-[#F7C844] focus:outline-none focus:ring-2 focus:ring-[#F7C844]/40"
              />
            </label>
            <button
              type="button"
              onClick={fetchDashboard}
              className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 transition-all hover:bg-gray-50 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#F7C844] focus:ring-offset-2"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 014 9m0 0h5m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H16" />
              </svg>
              Refresh
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 to-indigo-50 px-5 py-4 shadow-sm ring-1 ring-blue-100">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-semibold text-blue-900">
              Viewing: <span className="font-bold text-blue-700">{selectedBranchName}</span>
            </p>
            <p className="text-xs text-blue-700">
              {canFilterAcrossBranches
                ? 'Use the global branch selector to drill down into a specific branch.'
                : 'Branch-admin view is automatically scoped to your assigned branch.'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          <StatsCard
            title="New Enrollees"
            value={formatNumber(totals.new_enrollees)}
            iconName="users"
            accent="bg-gradient-to-br from-emerald-400 to-emerald-500"
            subtitle={`${visibleBranchCount || totals.active_branches || 0} branch(es) with activity today`}
          />
          <StatsCard
            title="Dropped / Unenrolled"
            value={formatNumber(totals.dropped_unenrolled_count)}
            iconName="userMinus"
            accent="bg-gradient-to-br from-rose-500 to-red-600"
            subtitle="Removed from class today (after prior enrollment)"
          />
          <StatsCard
            title="Daily Sales (Completed)"
            value={formatCurrency(totals.daily_sales_amount)}
            iconName="currency"
            accent="bg-gradient-to-br from-indigo-500 to-indigo-600"
            subtitle="Recognized posted payments only"
          />
          <StatsCard
            title="AR Sales"
            value={formatCurrency(totals.ar_sales_amount)}
            iconName="clipboardList"
            accent="bg-gradient-to-br from-violet-500 to-purple-600"
            subtitle={`${formatNumber(totals.ar_sales_count)} acknowledgement receipt(s)`}
          />
          <StatsCard
            title="Merchandise Released"
            value={formatNumber(totals.merchandise_released_quantity)}
            iconName="sparkles"
            accent="bg-gradient-to-br from-amber-400 to-orange-500"
            subtitle={`${formatNumber(totals.merchandise_released_count)} paid merchandise transaction(s)`}
          />
          <StatsCard
            title="Re-enrollment"
            value={formatNumber(totals.re_enrollment_count)}
            iconName="academicCap"
            accent="bg-gradient-to-br from-teal-400 to-cyan-500"
            subtitle="Installment monthly payments completed today"
          />
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700">
            Verification (today, Manila: <span className="font-semibold text-gray-900">{verificationAsOf}</span>)
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatsCard
              title="Payments (approved)"
              value={formatNumber(totals.pay_verified_count || 0)}
              iconName="currency"
              accent="bg-gradient-to-br from-cyan-500 to-teal-600"
              subtitle={`${formatCurrency(totals.pay_verified_amount || 0)} total · completed payments · today · approval=Approved`}
              onClick={() => goPaymentLogsByVerify('verified')}
              ariaLabel="Open payment logs for approved completed payments for today in Manila"
            />
            <StatsCard
              title="Payments (not approved yet)"
              value={formatNumber(totals.pay_unverified_count || 0)}
              iconName="chartBar"
              accent="bg-gradient-to-br from-slate-500 to-slate-600"
              subtitle={`${formatCurrency(totals.pay_unverified_amount || 0)} total · completed · pending approval`}
              onClick={() => goPaymentLogsByVerify('unverified')}
              ariaLabel="Open payment logs for not-yet-approved completed payments for today in Manila"
            />
            <StatsCard
              title="AR (verified or applied)"
              value={formatNumber(totals.ar_verified_count || 0)}
              iconName="clipboardList"
              accent="bg-gradient-to-br from-fuchsia-500 to-purple-600"
              subtitle={`${formatCurrency(totals.ar_verified_amount || 0)} total · Package AR · today issue date`}
              onClick={() => goArByVerify('verified')}
              ariaLabel="Open AR list filtered to verified and applied"
            />
            <StatsCard
              title="AR (not verified yet)"
              value={formatNumber(totals.ar_unverified_count || 0)}
              iconName="academicCap"
              accent="bg-gradient-to-br from-amber-500 to-orange-600"
              subtitle={`${formatCurrency(totals.ar_unverified_amount || 0)} total · not verified yet · today issue date`}
              onClick={() => goArByVerify('unverified')}
              ariaLabel="Open AR list filtered to unverified statuses"
            />
          </div>
        </div>

        <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3">
          <p className="text-xs font-medium text-indigo-800">
            Sales guide: <span className="font-semibold">Daily Sales (Completed)</span> sums completed rows in payments.
            <span className="font-semibold"> Acknowledgement Receipts</span> (top row) is unapplied AR float, not the same
            as verification <span className="font-semibold">Package AR</span> (verified+), which is Package ARs in Verified or
            Applied status.
          </p>
        </div>

        {isHeadquartersView && (
          <div className="rounded-2xl border border-violet-100 bg-gradient-to-r from-violet-50 via-indigo-50 to-blue-50 p-6 shadow-sm ring-1 ring-violet-100">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-indigo-900">Headquarters Summary</h2>
                <p className="mt-1 text-sm text-indigo-700">
                  Organization-wide snapshot across all branches for the selected date.
                </p>
              </div>
              <p className="text-xs font-medium text-indigo-700">
                Active branches: {formatNumber(totals.active_branches || visibleBranchCount || 0)}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="rounded-xl border border-white/70 bg-white/80 px-4 py-3 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Top Daily Sales Branch</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">
                  {headquarterSummary.topSalesBranch?.branch_name || 'No activity'}
                </p>
                <p className="mt-1 text-xs text-gray-600">
                  {formatCurrency(headquarterSummary.topSalesBranch?.daily_sales_amount || 0)}
                </p>
              </div>
              <div className="rounded-xl border border-white/70 bg-white/80 px-4 py-3 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Top New Enrollees Branch</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">
                  {headquarterSummary.topEnrollmentBranch?.branch_name || 'No activity'}
                </p>
                <p className="mt-1 text-xs text-gray-600">
                  {formatNumber(headquarterSummary.topEnrollmentBranch?.new_enrollees || 0)} new enrollees
                </p>
              </div>
              <div className="rounded-xl border border-white/70 bg-white/80 px-4 py-3 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Top Re-enrollment Branch</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">
                  {headquarterSummary.topReenrollmentBranch?.branch_name || 'No activity'}
                </p>
                <p className="mt-1 text-xs text-gray-600">
                  {formatNumber(headquarterSummary.topReenrollmentBranch?.re_enrollment_count || 0)} re-enrollments
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Branch Breakdown</h2>
              <p className="mt-1 text-sm text-gray-500">
                Most columns use the selected day; Pay. approved, Pay. pending, Pkg AR verified+, and Pkg AR unverified use
                today in Manila ({verificationAsOf}).
              </p>
            </div>
            <p className="text-xs text-gray-500">
              Updated: {data?.updated_at ? new Date(data.updated_at).toLocaleString() : 'Just now'}
            </p>
          </div>

          <div
            className="overflow-x-auto rounded-lg"
            style={{
              scrollbarWidth: 'thin',
              scrollbarColor: '#cbd5e0 #f7fafc',
              WebkitOverflowScrolling: 'touch',
            }}
          >
            <table style={{ width: '100%', minWidth: '1600px' }} className="border-collapse text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">Branch</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">New Enrollees</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">Dropped / Unenrolled</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">Daily Sales</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">AR (float)</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold leading-tight text-gray-600">
                    <span className="block">Pay.</span>
                    <span className="block">approved</span>
                  </th>
                  <th className="px-3 py-3 text-right text-xs font-semibold leading-tight text-gray-600">
                    <span className="block">Pay.</span>
                    <span className="block">pending</span>
                  </th>
                  <th className="px-3 py-3 text-right text-xs font-semibold leading-tight text-gray-600">
                    <span className="block">Pkg AR</span>
                    <span className="block">verified+</span>
                  </th>
                  <th className="px-3 py-3 text-right text-xs font-semibold leading-tight text-gray-600">
                    <span className="block">Pkg AR</span>
                    <span className="block">unverified</span>
                  </th>
                  <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">Merch. Qty</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">Merch. Txns</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">Re-enrollment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {branchBreakdown.map((row) => (
                  <tr key={row.branch_id} className="hover:bg-gray-50">
                    <td className="px-3 py-3 font-medium text-gray-900">{row.branch_name}</td>
                    <td className="px-3 py-3 text-right text-gray-700">{formatNumber(row.new_enrollees)}</td>
                    <td className="px-3 py-3 text-right text-gray-700">{formatNumber(row.dropped_unenrolled_count || 0)}</td>
                    <td className="px-3 py-3 text-right font-medium text-gray-900">{formatCurrency(row.daily_sales_amount)}</td>
                    <td className="px-3 py-3 text-right font-medium text-violet-700">
                      {formatCurrency(row.ar_sales_amount)}
                      <span className="ml-1 text-xs text-gray-500">({formatNumber(row.ar_sales_count)})</span>
                    </td>
                    <td className="px-3 py-3 text-right text-cyan-800 text-xs">
                      {formatCurrency(row.pay_verified_amount || 0)}
                    </td>
                    <td className="px-3 py-3 text-right text-slate-700 text-xs">
                      {formatCurrency(row.pay_unverified_amount || 0)}
                    </td>
                    <td className="px-3 py-3 text-right text-fuchsia-800 text-xs">
                      {formatCurrency(row.ar_verified_amount || 0)}
                    </td>
                    <td className="px-3 py-3 text-right text-amber-800 text-xs">
                      {formatCurrency(row.ar_unverified_amount || 0)}
                    </td>
                    <td className="px-3 py-3 text-right text-gray-700">{formatNumber(row.merchandise_released_quantity)}</td>
                    <td className="px-3 py-3 text-right text-gray-700">{formatNumber(row.merchandise_released_count)}</td>
                    <td className="px-3 py-3 text-right text-gray-700">{formatNumber(row.re_enrollment_count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <ChartCard
            title="Branch Activity Comparison"
            subtitle="Daily counts for new enrollees, drops, merchandise released, and re-enrollment."
          >
            {activeBranchMetrics.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={activeBranchMetrics} margin={{ top: 8, right: 12, left: 0, bottom: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="branch_name" tick={{ fontSize: 12 }} angle={activeBranchMetrics.length > 4 ? -18 : 0} textAnchor={activeBranchMetrics.length > 4 ? 'end' : 'middle'} height={activeBranchMetrics.length > 4 ? 64 : 36} interval={0} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="new_enrollees" name="New enrollees" fill="#22C55E" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="dropped_unenrolled_count" name="Dropped / Unenrolled" fill="#DC2626" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="merchandise_released_quantity" name="Merchandise released" fill="#F7C844" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="re_enrollment_count" name="Re-enrollment" fill="#14B8A6" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChartState message="No branch activity found for today." />
            )}
          </ChartCard>

          <ChartCard
            title="Daily Sales by Branch"
            subtitle="Completed payments and AR sales amounts recorded today."
          >
            {activeBranchMetrics.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={activeBranchMetrics} margin={{ top: 8, right: 12, left: 0, bottom: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="branch_name" tick={{ fontSize: 12 }} angle={activeBranchMetrics.length > 4 ? -18 : 0} textAnchor={activeBranchMetrics.length > 4 ? 'end' : 'middle'} height={activeBranchMetrics.length > 4 ? 64 : 36} interval={0} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={(value) => `Php ${Number(value || 0).toLocaleString('en-PH')}`} />
                  <Tooltip formatter={(value) => [formatCurrency(value), 'Amount']} />
                  <Legend />
                  <Bar dataKey="daily_sales_amount" name="Daily sales" fill="#4F46E5" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="ar_sales_amount" name="AR sales" fill="#8B5CF6" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChartState message="No completed payments found for today." />
            )}
          </ChartCard>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <ChartCard
            title="Sales Trend"
            subtitle="Completed payment totals for the last 7 days."
            className="xl:col-span-2"
          >
            {salesLast7Days.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={salesLast7Days} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                  <defs>
                    <linearGradient id="dailySalesTrendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#4F46E5" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={(value) => `Php ${Number(value || 0).toLocaleString('en-PH')}`} />
                  <Tooltip formatter={(value) => [formatCurrency(value), 'Daily sales']} />
                  <Area type="monotone" dataKey="total_amount" stroke="#4F46E5" fill="url(#dailySalesTrendFill)" strokeWidth={2.5} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChartState message="No sales trend data available yet." />
            )}
          </ChartCard>

          <ChartCard
            title="Activity Mix"
            subtitle="Share of selected day&apos;s non-cash operational activity."
          >
            {activityMix.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={activityMix}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={62}
                    outerRadius={98}
                    paddingAngle={2}
                    label={({ name, value }) => `${name}: ${formatNumber(value)}`}
                  >
                    {activityMix.map((entry, index) => (
                      <Cell key={`${entry.name}-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => [formatNumber(value), '']} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChartState message="No activity mix data available for today." />
            )}
          </ChartCard>
        </div>
      </div>
    </div>
  );
};

export default DailyOperationalDashboardView;
