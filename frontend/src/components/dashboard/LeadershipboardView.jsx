import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiRequest } from '../../config/api';
import { manilaMonthYYYYMM } from '../../utils/dateUtils';
import MatrixInfoTooltip from './MatrixInfoTooltip';
import AdminStandingView from './AdminStandingView';
import BranchFocusStandingView from './BranchFocusStandingView';
import LeadershipboardHeroShell from './LeadershipboardHeroShell';
import { LEADERSHIPBOARD } from '../../constants/dashboardDescriptions';

const COLORS = [
  '#4F46E5',
  '#22C55E',
  '#F97316',
  '#14B8A6',
  '#F7C844',
  '#DC2626',
  '#8B5CF6',
  '#0EA5E9',
  '#EC4899',
  '#64748B',
];

/** Compare toggles — Overall = composite score; others re-sort by that field. */
const METRIC_OPTIONS = [
  { key: 'overall', label: 'Overall', short: 'Overall', field: 'composite_score' },
  { key: 'total_sales', label: 'Invoice Sales', short: 'Sales', field: 'total_sales' },
  { key: 'new_enrollees', label: 'New Enrollees', short: 'New', field: 'new_enrollees' },
  { key: 're_enrollment_count', label: 'Re-enrolled', short: 'Re-enrolled', field: 're_enrollment_count' },
  { key: 'rejoin_count', label: 'Rejoin', short: 'Rejoin', field: 'rejoin_count' },
  { key: 'upsell_count', label: 'Upsell', short: 'Upsell', field: 'upsell_count' },
  { key: 'active_students', label: 'Active Students', short: 'Active', field: 'active_students' },
];

/** Stat chips / table columns (excludes Overall). */
const DATA_METRICS = METRIC_OPTIONS.filter((m) => m.key !== 'overall');

const formatCurrency = (amount) =>
  `Php ${(Number(amount) || 0).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const formatNumber = (value) => (Number(value) || 0).toLocaleString('en-PH');

const formatMetricValue = (key, value) => {
  if (key === 'total_sales') return formatCurrency(value);
  if (key === 'overall') return formatNumber(value);
  return formatNumber(value);
};

const maxSummaryMonth = () => manilaMonthYYYYMM();

const getMetricField = (metricKey) =>
  METRIC_OPTIONS.find((m) => m.key === metricKey)?.field || 'composite_score';

const sortBranchesByMetric = (list, metricKey) => {
  const field = getMetricField(metricKey);
  return [...list].sort((a, b) => {
    const av = Number(a[field]) || 0;
    const bv = Number(b[field]) || 0;
    if (bv !== av) return bv - av;
    const salesA = Number(a.total_sales) || 0;
    const salesB = Number(b.total_sales) || 0;
    if (salesB !== salesA) return salesB - salesA;
    return String(a.branch_name || '').localeCompare(String(b.branch_name || ''));
  });
};

const ChartCard = ({ title, subtitle, children, className = '' }) => (
  <div className={`rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-100 sm:p-6 ${className}`}>
    <div className="mb-4">
      <h3 className="text-base font-semibold text-gray-900 sm:text-lg">{title}</h3>
      {subtitle ? <p className="mt-1 text-sm text-gray-500">{subtitle}</p> : null}
    </div>
    <div className="h-72 sm:h-80">{children}</div>
  </div>
);

const EmptyChartState = ({ message }) => (
  <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 text-center text-sm text-gray-500">
    {message}
  </div>
);

const RankBadge = ({ rank }) => {
  const styles =
    rank === 1
      ? 'bg-amber-400 text-amber-950 ring-amber-300'
      : rank === 2
        ? 'bg-slate-300 text-slate-800 ring-slate-200'
        : rank === 3
          ? 'bg-orange-300 text-orange-950 ring-orange-200'
          : 'bg-gray-100 text-gray-700 ring-gray-200';
  return (
    <span
      className={`inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ring-1 ${styles}`}
    >
      {rank}
    </span>
  );
};

const LeadershipboardView = ({
  branchId = '',
  branchName = 'All Branches',
  privacyMode = false,
}) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedMonth, setSelectedMonth] = useState(maxSummaryMonth());
  const [activeMetric, setActiveMetric] = useState('overall');

  const fetchDashboard = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const params = new URLSearchParams();
      // Admin privacy mode: never send branch_id — API returns full ranks with peers redacted.
      if (branchId && !privacyMode) params.set('branch_id', branchId);
      if (selectedMonth) params.set('summary_month', selectedMonth);
      const queryString = params.toString();
      const response = await apiRequest(
        `/dashboard/leadershipboard${queryString ? `?${queryString}` : ''}`
      );
      setData(response.data);
    } catch (err) {
      setError(err?.message || 'Failed to load the Leadershipboard.');
    } finally {
      setLoading(false);
    }
  }, [branchId, privacyMode, selectedMonth]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  const privacyActive = privacyMode || Boolean(data?.privacy_mode);
  const branches = useMemo(() => data?.branches || [], [data]);
  const isBranchFiltered = Boolean(branchId) && !privacyActive;
  const totalBranchCount = data?.total_branch_count || branches.length;
  const salesTrendRows = useMemo(() => data?.sales_trend?.rows || [], [data]);
  const branchKeys = useMemo(() => data?.sales_trend?.branch_keys || [], [data]);

  const activeMetricMeta = useMemo(
    () => METRIC_OPTIONS.find((m) => m.key === activeMetric) || METRIC_OPTIONS[0],
    [activeMetric]
  );

  const rankedBranches = useMemo(() => {
    const sorted = sortBranchesByMetric(branches, activeMetric);
    return sorted.map((branch, index) => ({
      ...branch,
      display_rank: index + 1,
    }));
  }, [branches, activeMetric]);

  const spotlightBranch = useMemo(() => {
    if (isBranchFiltered) {
      return rankedBranches[0] || data?.top_branch || null;
    }
    return rankedBranches[0] || null;
  }, [isBranchFiltered, rankedBranches, data?.top_branch]);

  const donutData = useMemo(() => {
    const field = getMetricField(activeMetric);
    return rankedBranches
      .map((b) => ({
        name: b.branch_name,
        value: Number(b[field]) || 0,
        branch_id: b.branch_id,
      }))
      .filter((row) => row.value > 0);
  }, [rankedBranches, activeMetric]);

  const donutTotal = useMemo(
    () => donutData.reduce((sum, row) => sum + row.value, 0),
    [donutData]
  );

  const trendBranchNames = useMemo(() => {
    if (branchKeys.length > 0) return branchKeys.map((b) => b.branch_name);
    if (salesTrendRows.length === 0) return [];
    return Object.keys(salesTrendRows[0] || {}).filter((k) => k !== 'label' && k !== 'key');
  }, [branchKeys, salesTrendRows]);

  if (loading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
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

  // Admin: competitive standing UX (no encrypted peer-number table).
  if (privacyActive) {
    return (
      <AdminStandingView
        data={data}
        selectedMonth={selectedMonth}
        setSelectedMonth={setSelectedMonth}
        maxMonth={maxSummaryMonth()}
        branchName={branchName}
      />
    );
  }

  // Superadmin / Superfinance global branch filter: side-by-side compare.
  if (isBranchFiltered || data?.focus_mode) {
    return (
      <BranchFocusStandingView
        data={data}
        selectedMonth={selectedMonth}
        setSelectedMonth={setSelectedMonth}
        maxMonth={maxSummaryMonth()}
        branchName={branchName}
      />
    );
  }

  return (
    <div className="w-full min-w-0 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Leadershipboard</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">{LEADERSHIPBOARD.pageIntro}</p>
          <p className="mt-1 text-xs text-gray-400">
            Viewing: <span className="font-medium text-gray-600">{branchName}</span>
            {isBranchFiltered
              ? ` · Rank among ${totalBranchCount} branches`
              : ` · ${totalBranchCount} branches`}
          </p>
        </div>
        <label className="inline-flex w-full items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm sm:w-auto">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Month</span>
          <input
            type="month"
            value={selectedMonth}
            max={maxSummaryMonth()}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm font-medium text-gray-900 focus:outline-none focus:ring-0 sm:flex-none"
          />
        </label>
      </div>

      {spotlightBranch ? (
        <LeadershipboardHeroShell>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide backdrop-blur-sm">
                  <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M10 2a1 1 0 01.894.553l1.382 2.8 3.09.45a1 1 0 01.554 1.705l-2.236 2.18.528 3.077a1 1 0 01-1.451 1.054L10 12.347l-2.761 1.472a1 1 0 01-1.451-1.054l.528-3.077-2.236-2.18a1 1 0 01.554-1.705l3.09-.45 1.382-2.8A1 1 0 0110 2z" />
                  </svg>
                  {isBranchFiltered
                    ? 'Selected Branch'
                    : `Leading — ${activeMetricMeta.label}`}
                </span>
                {!isBranchFiltered ? (
                  <span className="inline-flex items-center rounded-full bg-amber-300/90 px-2.5 py-1 text-xs font-semibold text-amber-950">
                    #{spotlightBranch.display_rank} in {activeMetricMeta.label}
                  </span>
                ) : null}
                <MatrixInfoTooltip label="About top branch ranking">
                  {LEADERSHIPBOARD.topBranch}
                </MatrixInfoTooltip>
              </div>
              <h2 className="mt-3 truncate text-2xl font-bold tracking-tight sm:text-3xl">
                {spotlightBranch.branch_name}
              </h2>
              <p className="mt-1 text-sm text-indigo-100/90">
                {data?.month_label || selectedMonth} · Rank #{spotlightBranch.display_rank}
                {activeMetric !== 'overall'
                  ? ` · ${formatMetricValue(activeMetric, spotlightBranch[getMetricField(activeMetric)])}`
                  : ` · Score ${spotlightBranch.composite_score}`}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
              <div className="rounded-xl bg-black/20 px-4 py-3 backdrop-blur-md ring-1 ring-white/10">
                <p className="text-[11px] font-medium uppercase tracking-wide text-indigo-100">
                  Overall
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums">
                  {spotlightBranch.composite_score}
                </p>
              </div>
              <div className="rounded-xl bg-black/20 px-4 py-3 backdrop-blur-md ring-1 ring-white/10">
                <p className="text-[11px] font-medium uppercase tracking-wide text-indigo-100">
                  Invoice Sales
                </p>
                <p className="mt-1 text-lg font-bold tabular-nums leading-tight">
                  {formatCurrency(spotlightBranch.total_sales)}
                </p>
              </div>
              <div className="rounded-xl bg-black/20 px-4 py-3 backdrop-blur-md ring-1 ring-white/10">
                <p className="text-[11px] font-medium uppercase tracking-wide text-indigo-100">
                  Re-enrolled
                </p>
                <p className="mt-1 text-xl font-bold tabular-nums">
                  {formatNumber(spotlightBranch.re_enrollment_count)}
                </p>
              </div>
              <div className="rounded-xl bg-black/20 px-4 py-3 backdrop-blur-md ring-1 ring-white/10">
                <p className="text-[11px] font-medium uppercase tracking-wide text-indigo-100">
                  Rejoin
                </p>
                <p className="mt-1 text-xl font-bold tabular-nums">
                  {formatNumber(spotlightBranch.rejoin_count)}
                </p>
              </div>
              <div className="rounded-xl bg-black/20 px-4 py-3 backdrop-blur-md ring-1 ring-white/10">
                <p className="text-[11px] font-medium uppercase tracking-wide text-indigo-100">
                  Upsell
                </p>
                <p className="mt-1 text-xl font-bold tabular-nums">
                  {formatNumber(spotlightBranch.upsell_count)}
                </p>
              </div>
              <div className="rounded-xl bg-black/20 px-4 py-3 backdrop-blur-md ring-1 ring-white/10">
                <p className="text-[11px] font-medium uppercase tracking-wide text-indigo-100">
                  Active
                </p>
                <p className="mt-1 text-xl font-bold tabular-nums">
                  {formatNumber(spotlightBranch.active_students)}
                </p>
              </div>
            </div>
          </div>
        </LeadershipboardHeroShell>
      ) : (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
          No branch data available for this month.
        </div>
      )}

      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-900">Compare by metric</h3>
          <MatrixInfoTooltip label="About compare by metric">{LEADERSHIPBOARD.metricToggle}</MatrixInfoTooltip>
        </div>
        <div className="flex flex-wrap gap-2">
          {METRIC_OPTIONS.map((opt) => {
            const isActive = activeMetric === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setActiveMetric(opt.key)}
                className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold text-gray-900 sm:text-lg">
            Branch Ranking
            <span className="ml-2 text-sm font-normal text-gray-500">
              by {activeMetricMeta.label}
            </span>
          </h3>
          <MatrixInfoTooltip label="About composite score">{LEADERSHIPBOARD.compositeScore}</MatrixInfoTooltip>
          <span className="text-xs text-gray-400">·</span>
          <p className="text-xs text-gray-500 sm:text-sm">{LEADERSHIPBOARD.rankingTable}</p>
        </div>

        {rankedBranches.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500">No branches to rank.</p>
        ) : (
          <>
            <div className="space-y-3 md:hidden">
              {rankedBranches.map((branch) => (
                <div
                  key={branch.branch_id}
                  className={`rounded-xl border p-4 ${
                    branch.display_rank === 1
                      ? 'border-indigo-200 bg-indigo-50/50'
                      : 'border-gray-100 bg-white'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <RankBadge rank={branch.display_rank} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate font-semibold text-gray-900">{branch.branch_name}</p>
                        <span className="flex-shrink-0 text-sm font-bold tabular-nums text-indigo-600">
                          {branch.composite_score}
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100">
                        <div
                          className="h-full rounded-full bg-indigo-500 transition-all"
                          style={{
                            width: `${Math.min(100, Math.max(0, branch.composite_score))}%`,
                          }}
                        />
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        {DATA_METRICS.map((opt) => (
                          <div
                            key={opt.key}
                            className={`rounded-lg px-2 py-1.5 ${
                              activeMetric === opt.key
                                ? 'bg-indigo-100 text-indigo-900'
                                : 'bg-gray-50 text-gray-600'
                            }`}
                          >
                            <p className="font-medium opacity-70">{opt.short}</p>
                            <p className="mt-0.5 font-semibold tabular-nums">
                              {formatMetricValue(opt.key, branch[opt.field])}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div
              className="hidden overflow-x-auto rounded-lg md:block"
              style={{
                scrollbarWidth: 'thin',
                scrollbarColor: '#cbd5e0 #f7fafc',
                WebkitOverflowScrolling: 'touch',
              }}
            >
              <table style={{ width: '100%', minWidth: '900px' }} className="border-collapse text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                      Rank
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                      Branch
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                      Overall
                    </th>
                    <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">
                      Invoice Sales
                    </th>
                    <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">
                      New
                    </th>
                    <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">
                      Re-enrolled
                    </th>
                    <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">
                      Rejoin
                    </th>
                    <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">
                      Upsell
                    </th>
                    <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">
                      Active
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rankedBranches.map((branch) => (
                    <tr
                      key={branch.branch_id}
                      className={`transition-colors hover:bg-gray-50 ${
                        branch.display_rank === 1 ? 'bg-indigo-50/40' : ''
                      }`}
                    >
                      <td className="px-3 py-3">
                        <RankBadge rank={branch.display_rank} />
                      </td>
                      <td className="px-3 py-3 font-medium text-gray-900">{branch.branch_name}</td>
                      <td
                        className={`px-3 py-3 ${
                          activeMetric === 'overall' ? 'font-semibold' : ''
                        }`}
                      >
                        <div className="flex min-w-[120px] items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                            <div
                              className="h-full rounded-full bg-indigo-500"
                              style={{
                                width: `${Math.min(100, Math.max(0, branch.composite_score))}%`,
                              }}
                            />
                          </div>
                          <span
                            className={`w-10 text-right text-xs font-bold tabular-nums ${
                              activeMetric === 'overall' ? 'text-indigo-700' : 'text-gray-600'
                            }`}
                          >
                            {branch.composite_score}
                          </span>
                        </div>
                      </td>
                      <td
                        className={`px-3 py-3 text-right tabular-nums ${
                          activeMetric === 'total_sales'
                            ? 'font-semibold text-indigo-700'
                            : 'text-gray-700'
                        }`}
                      >
                        {formatCurrency(branch.total_sales)}
                      </td>
                      <td
                        className={`px-3 py-3 text-right tabular-nums ${
                          activeMetric === 'new_enrollees'
                            ? 'font-semibold text-indigo-700'
                            : 'text-gray-700'
                        }`}
                      >
                        {formatNumber(branch.new_enrollees)}
                      </td>
                      <td
                        className={`px-3 py-3 text-right tabular-nums ${
                          activeMetric === 're_enrollment_count'
                            ? 'font-semibold text-indigo-700'
                            : 'text-gray-700'
                        }`}
                      >
                        {formatNumber(branch.re_enrollment_count)}
                      </td>
                      <td
                        className={`px-3 py-3 text-right tabular-nums ${
                          activeMetric === 'rejoin_count'
                            ? 'font-semibold text-indigo-700'
                            : 'text-gray-700'
                        }`}
                      >
                        {formatNumber(branch.rejoin_count)}
                      </td>
                      <td
                        className={`px-3 py-3 text-right tabular-nums ${
                          activeMetric === 'upsell_count'
                            ? 'font-semibold text-indigo-700'
                            : 'text-gray-700'
                        }`}
                      >
                        {formatNumber(branch.upsell_count)}
                      </td>
                      <td
                        className={`px-3 py-3 text-right tabular-nums ${
                          activeMetric === 'active_students'
                            ? 'font-semibold text-indigo-700'
                            : 'text-gray-700'
                        }`}
                      >
                        {formatNumber(branch.active_students)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ChartCard
          title="Invoice Sales Trend by Branch"
          subtitle={LEADERSHIPBOARD.chartSalesTrend}
          className="xl:col-span-1"
        >
          {salesTrendRows.length > 0 && trendBranchNames.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={salesTrendRows} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(value) =>
                    `Php ${Number(value || 0).toLocaleString('en-PH', { notation: 'compact' })}`
                  }
                  width={72}
                />
                <Tooltip
                  formatter={(value, name) => [formatCurrency(value), name]}
                  contentStyle={{
                    borderRadius: '12px',
                    border: '1px solid #e5e7eb',
                    fontSize: '12px',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                {trendBranchNames.map((name, index) => (
                  <Line
                    key={name}
                    type="monotone"
                    dataKey={name}
                    stroke={COLORS[index % COLORS.length]}
                    strokeWidth={2.25}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChartState message="No sales trend data for this period." />
          )}
        </ChartCard>

        <ChartCard
          title={`Branch Share — ${activeMetricMeta.label}`}
          subtitle={
            donutTotal > 0
              ? `${LEADERSHIPBOARD.chartBranchShare} Total: ${formatMetricValue(activeMetric, donutTotal)}.`
              : LEADERSHIPBOARD.chartBranchShare
          }
        >
          {donutData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={donutData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={58}
                  outerRadius={92}
                  paddingAngle={2}
                  label={({ name, percent }) =>
                    `${name}: ${(percent * 100).toFixed(0)}%`
                  }
                  labelLine={{ stroke: '#9ca3af' }}
                >
                  {donutData.map((entry, index) => (
                    <Cell
                      key={`${entry.branch_id}-${index}`}
                      fill={COLORS[index % COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value) => [
                    formatMetricValue(activeMetric, value),
                    activeMetricMeta.label,
                  ]}
                  contentStyle={{
                    borderRadius: '12px',
                    border: '1px solid #e5e7eb',
                    fontSize: '12px',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChartState
              message={`No ${activeMetricMeta.label.toLowerCase()} data to show for this month.`}
            />
          )}
        </ChartCard>
      </div>
    </div>
  );
};

export default LeadershipboardView;
