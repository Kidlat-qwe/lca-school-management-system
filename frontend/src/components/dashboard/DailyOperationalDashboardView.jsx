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
import { formatDateManila } from '../../utils/dateUtils';
import { DashboardStatIcon } from './DashboardStatIcons';
import CombinedStatsCard from './CombinedStatsCard';
import RecentInvoicePaymentsLog from './RecentInvoicePaymentsLog';
import RecentMerchandiseReleasesLog from './RecentMerchandiseReleasesLog';
import MatrixInfoTooltip from './MatrixInfoTooltip';
import { DAILY_OPERATIONAL } from '../../constants/dashboardDescriptions';
import MerchandiseReleasedDetailModal from './MerchandiseReleasedDetailModal';
import OperationalReEnrollmentRateTable from './OperationalReEnrollmentRateTable';

const COLORS = ['#F7C844', '#4F46E5', '#22C55E', '#F97316', '#14B8A6', '#DC2626'];

const formatCurrency = (amount) =>
  `Php ${(Number(amount) || 0).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const formatNumber = (value) => (Number(value) || 0).toLocaleString('en-PH');
const getTodayManila = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

const StatsCard = ({ title, value, iconName, accent, tooltip, subtitle, onClick, ariaLabel }) => {
  const helpText = tooltip ?? subtitle;
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      aria-label={ariaLabel || (onClick ? title : undefined)}
      className={`group relative h-full w-full overflow-visible rounded-2xl bg-white p-5 text-left shadow-sm ring-1 ring-gray-100 transition-all duration-300 hover:shadow-lg hover:ring-gray-200 ${onClick ? 'cursor-pointer' : ''}`}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-start justify-between gap-3">
          <p className="flex min-w-0 flex-wrap items-center gap-0.5 text-sm font-semibold leading-tight text-gray-700">
            <span>{title}</span>
            {helpText ? (
              <MatrixInfoTooltip label={`About ${title}`}>{helpText}</MatrixInfoTooltip>
            ) : null}
          </p>
          <div
            className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg ${accent} shadow-sm transition-transform duration-300 group-hover:scale-110`}
          >
            <DashboardStatIcon name={iconName} className="h-5 w-5 text-white drop-shadow-sm" />
          </div>
        </div>
        <p className="mt-3 text-[1.65rem] leading-none font-bold tracking-tight text-gray-900 break-words">{value}</p>
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
  const [merchReleasedModalOpen, setMerchReleasedModalOpen] = useState(false);
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
          (row.rejoin_count || 0) > 0 ||
          (row.reserved_count || 0) > 0 ||
          (row.upsell_count || 0) > 0 ||
          (row.completed_count || 0) > 0 ||
          (row.dropped_unenrolled_count || 0) > 0
      ),
    [branchMetrics]
  );
  const enrollmentDashboard = data?.enrollment_dashboard || {};
  const totalPaymentsAmount = useMemo(() => {
    const invoice = Number(data?.totals?.daily_sales_amount) || 0;
    const ar = Number(data?.totals?.ar_sales_amount) || 0;
    return invoice + ar;
  }, [data?.totals?.daily_sales_amount, data?.totals?.ar_sales_amount]);
  const totals = data?.totals || {
    new_enrollees: 0,
    daily_sales_amount: 0,
    ar_sales_amount: 0,
    ar_sales_count: 0,
    merchandise_released_count: 0,
    merchandise_released_quantity: 0,
    re_enrollment_count: 0,
    rejoin_count: 0,
    reserved_count: 0,
    upsell_count: 0,
    completed_count: 0,
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

  /** YYYY-MM-DD for the selected summary date (matches verification SQL issue_date window). */
  const verificationDayYmd = data?.verification_as_of || selectedDate || getTodayManila();
  const verificationAsOfDisplay =
    verificationDayYmd && /^\d{4}-\d{2}-\d{2}$/.test(verificationDayYmd)
      ? formatDateManila(`${verificationDayYmd}T12:00:00`)
      : verificationDayYmd || '-';

  const goPaymentLogsByVerify = useCallback(
    (kind) => {
      const p = new URLSearchParams();
      p.set('notificationTab', 'main');
      p.set('issue_date_from', verificationDayYmd);
      p.set('issue_date_to', verificationDayYmd);
      p.set('financeApproval', kind === 'verified' ? 'approved' : 'pending');
      navigate(`${basePath}/payment-logs?${p.toString()}`);
    },
    [basePath, navigate, verificationDayYmd]
  );

  const goPaymentLogsForPeriod = useCallback(() => {
    const p = new URLSearchParams();
    p.set('notificationTab', 'main');
    p.set('issue_date_from', verificationDayYmd);
    p.set('issue_date_to', verificationDayYmd);
    navigate(`${basePath}/payment-logs?${p.toString()}`);
  }, [basePath, navigate, verificationDayYmd]);

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
    <div className="w-full min-w-0 space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Daily Operational Dashboard
            </h1>
            <p className="text-sm text-gray-500">{DAILY_OPERATIONAL.pageIntro}</p>
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
                ? DAILY_OPERATIONAL.branchHintSuperadmin
                : DAILY_OPERATIONAL.branchHintAdmin}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <CombinedStatsCard
            title="New Enrollees & Re-enrollment"
            iconName="users"
            accent="bg-gradient-to-br from-emerald-400 to-emerald-500"
            metrics={[
              { label: 'New enrollees', value: formatNumber(totals.new_enrollees) },
              { label: 'Re-enrollment', value: formatNumber(totals.re_enrollment_count) },
            ]}
            tooltip={DAILY_OPERATIONAL.newEnrolleesReenroll}
          />
          <CombinedStatsCard
            title="Dropped / Unenrolled & Rejoin"
            iconName="userMinus"
            accent="bg-gradient-to-br from-rose-500 to-red-600"
            metrics={[
              { label: 'Dropped / unenrolled', value: formatNumber(totals.dropped_unenrolled_count) },
              { label: 'Rejoin', value: formatNumber(totals.rejoin_count || 0) },
            ]}
            tooltip={DAILY_OPERATIONAL.droppedRejoin}
          />
          <CombinedStatsCard
            title="Reserved & Upsell"
            iconName="clock"
            accent="bg-gradient-to-br from-sky-500 to-blue-600"
            metrics={[
              { label: 'Reserved', value: formatNumber(totals.reserved_count || 0) },
              { label: 'Upsell', value: formatNumber(totals.upsell_count || 0) },
            ]}
            tooltip={DAILY_OPERATIONAL.reservedUpsell}
          />
          <CombinedStatsCard
            title="Completed & Retention Base"
            iconName="checkCircle"
            accent="bg-gradient-to-br from-violet-500 to-purple-600"
            metrics={[
              { label: 'Completed', value: formatNumber(totals.completed_count || 0) },
              {
                label: 'Retention base',
                value: formatNumber(
                  enrollmentDashboard.retention_base_count ??
                    totals.retention_base_count ??
                    0
                ),
              },
            ]}
            tooltip={DAILY_OPERATIONAL.completedRetentionCombined}
          />
          <StatsCard
            title="Re-enrollment Rate"
            value={`${Number(enrollmentDashboard.re_enrollment_rate || 0).toFixed(2)}%`}
            iconName="chartBar"
            accent="bg-gradient-to-br from-blue-400 to-cyan-500"
            tooltip={DAILY_OPERATIONAL.reEnrollmentRate(
              formatNumber(enrollmentDashboard.re_enrollment_rate_retained_count || 0),
              formatNumber(enrollmentDashboard.re_enrollment_rate_prior_count || 0)
            )}
          />
        </div>

        <div className="space-y-3">
          <p className="text-sm font-medium text-gray-700">{DAILY_OPERATIONAL.financialSection}</p>
          <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-3">
            <div className="min-w-0 lg:col-span-1">
              <CombinedStatsCard
                title="Sales & Payments"
                iconName="currency"
                accent="bg-gradient-to-br from-indigo-500 to-violet-600"
                metricsLayout="inline"
                metrics={[
                  { label: 'Invoice sales', value: formatCurrency(totals.daily_sales_amount) },
                  { label: 'AR sales', value: formatCurrency(totals.ar_sales_amount) },
                  { label: 'Total payments', value: formatCurrency(totalPaymentsAmount) },
                ]}
                tooltip={DAILY_OPERATIONAL.salesPaymentsCard}
              />
            </div>
            <div className="min-w-0 lg:col-span-2">
              <RecentInvoicePaymentsLog
                payments={data?.recent_invoice_payments}
                tooltip={DAILY_OPERATIONAL.recentInvoicePayments}
                emptyMessage="No invoice payments on this date."
                onViewAll={goPaymentLogsForPeriod}
              />
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-sm font-medium text-gray-700">{DAILY_OPERATIONAL.merchandiseSection}</p>
          <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
            <CombinedStatsCard
              title="Merchandise Released"
              iconName="sparkles"
              accent="bg-gradient-to-br from-amber-400 to-orange-500"
              metricsLayout="inline"
              metrics={[
                { label: 'Units released', value: formatNumber(totals.merchandise_released_quantity) },
                { label: 'Release events', value: formatNumber(totals.merchandise_released_count) },
              ]}
              tooltip={`${DAILY_OPERATIONAL.merchandise(formatNumber(totals.merchandise_released_count))}\n\nClick to view release details.`}
              onClick={() => setMerchReleasedModalOpen(true)}
              ariaLabel={`View merchandise released details for ${selectedDate}`}
            />
            <RecentMerchandiseReleasesLog
              releases={data?.recent_merchandise_releases}
              tooltip={DAILY_OPERATIONAL.recentMerchandiseReleases}
              emptyMessage="No merchandise releases on this date."
              onViewAll={() => setMerchReleasedModalOpen(true)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700">
            {DAILY_OPERATIONAL.verificationSection} ({verificationAsOfDisplay})
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatsCard
              title="Payments (verified)"
              value={formatNumber(totals.pay_verified_count || 0)}
              iconName="currency"
              accent="bg-gradient-to-br from-cyan-500 to-teal-600"
              tooltip={DAILY_OPERATIONAL.payVerified(formatCurrency(totals.pay_verified_amount || 0), verificationAsOfDisplay)}
              onClick={() => goPaymentLogsByVerify('verified')}
              ariaLabel={`Open payment logs for verified completed payments on ${verificationAsOfDisplay} (Manila)`}
            />
            <StatsCard
              title="Payments (not verified yet)"
              value={formatNumber(totals.pay_unverified_count || 0)}
              iconName="chartBar"
              accent="bg-gradient-to-br from-slate-500 to-slate-600"
              tooltip={DAILY_OPERATIONAL.payNotVerifiedYet(formatCurrency(totals.pay_unverified_amount || 0), verificationAsOfDisplay)}
              onClick={() => goPaymentLogsByVerify('unverified')}
              ariaLabel={`Open payment logs for not-yet-verified completed payments on ${verificationAsOfDisplay} (Manila)`}
            />
            <StatsCard
              title="Acknowledgement Receipt (verified or applied)"
              value={formatNumber(totals.ar_verified_count || 0)}
              iconName="clipboardList"
              accent="bg-gradient-to-br from-fuchsia-500 to-purple-600"
              tooltip={DAILY_OPERATIONAL.arVerified(formatCurrency(totals.ar_verified_amount || 0), verificationAsOfDisplay)}
              onClick={() => goArByVerify('verified')}
              ariaLabel="Open acknowledgement receipt list filtered to verified and applied"
            />
            <StatsCard
              title="Acknowledgement Receipt (not verified yet)"
              value={formatNumber(totals.ar_unverified_count || 0)}
              iconName="academicCap"
              accent="bg-gradient-to-br from-amber-500 to-orange-600"
              tooltip={DAILY_OPERATIONAL.arUnverified(formatCurrency(totals.ar_unverified_amount || 0), verificationAsOfDisplay)}
              onClick={() => goArByVerify('unverified')}
              ariaLabel="Open acknowledgement receipt list filtered to unverified statuses"
            />
          </div>
        </div>

        <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3">
          <p className="text-xs font-medium text-indigo-800">{DAILY_OPERATIONAL.salesGuide}</p>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Branch Breakdown</h2>
              <p className="mt-1 text-sm text-gray-500">{DAILY_OPERATIONAL.branchTable}</p>
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
            <table style={{ width: '100%', minWidth: '1780px' }} className="border-collapse text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">Branch</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">New · Re-enroll</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">Dropped · Rejoin</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">Reserved · Upsell</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">Completed</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">Invoice Sales</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">Acknowledgement Receipt (float)</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold leading-tight text-gray-600">
                    <span className="block">Pay.</span>
                    <span className="block">verified</span>
                  </th>
                  <th className="px-3 py-3 text-right text-xs font-semibold leading-tight text-gray-600">
                    <span className="block">Pay.</span>
                    <span className="block">not verified</span>
                  </th>
                  <th className="px-3 py-3 text-right text-xs font-semibold leading-tight text-gray-600">
                    <span className="block">Package Acknowledgement Receipt</span>
                    <span className="block">verified+</span>
                  </th>
                  <th className="px-3 py-3 text-right text-xs font-semibold leading-tight text-gray-600">
                    <span className="block">Package Acknowledgement Receipt</span>
                    <span className="block">unverified</span>
                  </th>
                  <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">Merch. Qty</th>
                  <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">Merch. Txns</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {branchBreakdown.map((row) => (
                  <tr key={row.branch_id} className="hover:bg-gray-50">
                    <td className="px-3 py-3 font-medium text-gray-900">{row.branch_name}</td>
                    <td className="px-3 py-3 text-right text-gray-700">
                      <span className="block">{formatNumber(row.new_enrollees)}</span>
                      <span className="block text-xs text-teal-700">{formatNumber(row.re_enrollment_count)}</span>
                    </td>
                    <td className="px-3 py-3 text-right text-gray-700">
                      <span className="block">{formatNumber(row.dropped_unenrolled_count || 0)}</span>
                      <span className="block text-xs text-orange-700">{formatNumber(row.rejoin_count || 0)}</span>
                    </td>
                    <td className="px-3 py-3 text-right text-gray-700">
                      <span className="block">{formatNumber(row.reserved_count || 0)}</span>
                      <span className="block text-xs text-teal-700">{formatNumber(row.upsell_count || 0)}</span>
                    </td>
                    <td className="px-3 py-3 text-right text-gray-700">
                      {formatNumber(row.completed_count || 0)}
                    </td>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <OperationalReEnrollmentRateTable
          breakdown={data?.re_enrollment_rate_breakdown}
          tooltip={DAILY_OPERATIONAL.reEnrollmentRateBreakdown}
          emptyMessage="No re-enrollment rate breakdown for this date."
          periodMode="daily"
          summaryDate={selectedDate}
        />

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <ChartCard
            title="Branch Activity Comparison"
            subtitle={DAILY_OPERATIONAL.chartBranchActivity}
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
                  <Bar dataKey="re_enrollment_count" name="Re-enrollment" fill="#14B8A6" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="dropped_unenrolled_count" name="Dropped / unenrolled" fill="#DC2626" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="reserved_count" name="Reserved" fill="#0EA5E9" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="upsell_count" name="Upsell" fill="#2DD4BF" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="completed_count" name="Completed" fill="#8B5CF6" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="rejoin_count" name="Rejoin" fill="#F97316" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="merchandise_released_quantity" name="Merchandise released" fill="#F7C844" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChartState message="No branch activity found for today." />
            )}
          </ChartCard>

          <ChartCard
            title="Invoice Sales by Branch"
            subtitle={DAILY_OPERATIONAL.chartInvoiceByBranch}
          >
            {activeBranchMetrics.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={activeBranchMetrics} margin={{ top: 8, right: 12, left: 0, bottom: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="branch_name" tick={{ fontSize: 12 }} angle={activeBranchMetrics.length > 4 ? -18 : 0} textAnchor={activeBranchMetrics.length > 4 ? 'end' : 'middle'} height={activeBranchMetrics.length > 4 ? 64 : 36} interval={0} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={(value) => `Php ${Number(value || 0).toLocaleString('en-PH')}`} />
                  <Tooltip formatter={(value) => [formatCurrency(value), 'Amount']} />
                  <Legend />
                  <Bar dataKey="daily_sales_amount" name="Invoice sales" fill="#4F46E5" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="ar_sales_amount" name="Acknowledgement Receipt sales" fill="#8B5CF6" radius={[6, 6, 0, 0]} />
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
            subtitle={DAILY_OPERATIONAL.chartSalesTrend}
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
                  <Tooltip formatter={(value) => [formatCurrency(value), 'Invoice sales']} />
                  <Area type="monotone" dataKey="total_amount" stroke="#4F46E5" fill="url(#dailySalesTrendFill)" strokeWidth={2.5} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChartState message="No sales trend data available yet." />
            )}
          </ChartCard>

          <ChartCard
            title="Activity Mix"
            subtitle={DAILY_OPERATIONAL.chartActivityMix}
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

      <MerchandiseReleasedDetailModal
        open={merchReleasedModalOpen}
        onClose={() => setMerchReleasedModalOpen(false)}
        periodMode="daily"
        summaryDate={selectedDate}
        branchId={branchId}
        branchName={branchName}
        cardQuantity={totals.merchandise_released_quantity}
        cardEvents={totals.merchandise_released_count}
      />
    </div>
  );
};

export default DailyOperationalDashboardView;
