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
import MatrixInfoTooltip from './MatrixInfoTooltip';
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

const formatCurrency = (amount) =>
  `Php ${(Number(amount) || 0).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const formatNumber = (value) => (Number(value) || 0).toLocaleString('en-PH');

const FOCUS_KPI_CARDS = [
  { key: 'composite_score', label: 'Overall score', format: (v) => formatNumber(v) },
  { key: 'total_sales', label: 'Invoice Sales', format: (v) => formatCurrency(v) },
  { key: 'new_enrollees', label: 'New Enrollees', format: (v) => formatNumber(v) },
  { key: 're_enrollment_count', label: 'Re-enrolled', format: (v) => formatNumber(v) },
  { key: 'rejoin_count', label: 'Rejoin', format: (v) => formatNumber(v) },
  { key: 'upsell_count', label: 'Upsell', format: (v) => formatNumber(v) },
  { key: 'active_completed_count', label: 'Completed', format: (v) => formatNumber(v) },
  { key: 'active_students', label: 'Active Students', format: (v) => formatNumber(v) },
];

const WEIGHT_ORDER = [
  'total_sales',
  'new_enrollees',
  're_enrollment_count',
  'rejoin_count',
  'upsell_count',
];

const WEIGHT_PERCENT = {
  total_sales: '40%',
  new_enrollees: '20%',
  re_enrollment_count: '20%',
  rejoin_count: '10%',
  upsell_count: '10%',
};

const rankTone = (rank) => {
  if (rank === 1) return 'amber';
  if (rank === 2) return 'slate';
  if (rank === 3) return 'orange';
  return 'gray';
};

const standingCopy = (rank, total, branchLabel) => {
  const name = branchLabel || 'This branch';
  if (!rank || !total) {
    return {
      headline: 'Selected branch standing',
      detail: 'Choose a month to see where this branch stands in the network.',
    };
  }
  if (rank === 1) {
    return {
      headline: `${name} leads the network`,
      detail: `Rank #1 of ${total} — top overall for the selected month.`,
    };
  }
  if (rank === 2) {
    return {
      headline: 'One place from the top',
      detail: `Rank #${rank} of ${total} — chasing the leader. Compare metrics on the right.`,
    };
  }
  if (rank === 3) {
    return {
      headline: 'On the podium',
      detail: `Rank #${rank} of ${total} — bronze place. Use the network board to spot gaps.`,
    };
  }
  if (rank <= Math.ceil(total / 2)) {
    return {
      headline: 'In the top half',
      detail: `Rank #${rank} of ${total} — solid footing among peer branches.`,
    };
  }
  return {
    headline: 'Room to climb',
    detail: `Rank #${rank} of ${total} — compare peers on the right to see where to improve.`,
  };
};

const RankMedal = ({ rank }) => {
  const tone = rankTone(rank);
  const styles = {
    amber: 'bg-amber-400 text-amber-950 ring-amber-200',
    slate: 'bg-slate-300 text-slate-800 ring-slate-200',
    orange: 'bg-orange-300 text-orange-950 ring-orange-200',
    gray: 'bg-gray-100 text-gray-700 ring-gray-200',
  };
  return (
    <span
      className={`inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold ring-2 ${styles[tone]}`}
    >
      {rank}
    </span>
  );
};

/**
 * Superadmin / Superfinance focused compare when a global branch filter is set.
 * Left: selected branch detail. Right: full network ranking with numbers.
 */
const BranchFocusStandingView = ({
  data,
  selectedMonth,
  setSelectedMonth,
  maxMonth,
  branchName,
}) => {
  const focus =
    data?.top_branch ||
    data?.branches?.find((b) => b.is_focus_branch) ||
    null;
  const networkTop = data?.network_top_branch || null;
  const branches = [...(data?.branches || [])].sort(
    (a, b) => (Number(a.rank) || 0) - (Number(b.rank) || 0)
  );
  const total = data?.total_branch_count || branches.length;
  const rank = Number(focus?.rank) || 0;
  const focusLabel = focus?.branch_name || branchName;
  const story = standingCopy(rank, total, focusLabel);
  const monthLabel = data?.month_label || selectedMonth;
  const salesTrendRows = data?.sales_trend?.rows || [];
  const trendNames = (data?.sales_trend?.branch_keys || []).map((b) => b.branch_name);

  const breakdownRows = WEIGHT_ORDER.map((field) => {
    const entry = focus?.weight_breakdown?.[field];
    return {
      field,
      label: entry?.label || field,
      weightLabel: WEIGHT_PERCENT[field],
      normalized: entry?.normalized ?? 0,
      contribution: entry?.contribution ?? 0,
      barPct: Math.round((entry?.contribution || 0) * 1000) / 10,
    };
  });

  const weakest = [...breakdownRows].sort((a, b) => a.contribution - b.contribution)[0];
  const strongest = [...breakdownRows].sort((a, b) => b.contribution - a.contribution)[0];

  const donutData = branches
    .map((b) => ({
      name: b.branch_name,
      value: Number(b.composite_score) || 0,
      branch_id: b.branch_id,
    }))
    .filter((row) => row.value > 0);
  const donutTotal = donutData.reduce((sum, row) => sum + row.value, 0);

  return (
    <div className="w-full min-w-0 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Leadershipboard</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            {LEADERSHIPBOARD.focusPageIntro}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            Viewing: <span className="font-medium text-gray-600">{branchName}</span>
            {` · Comparing among ${total} branches`}
          </p>
        </div>
        <label className="inline-flex w-full items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm sm:w-auto">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Month</span>
          <input
            type="month"
            value={selectedMonth}
            max={maxMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm font-medium text-gray-900 focus:outline-none focus:ring-0 sm:flex-none"
          />
        </label>
      </div>

      <LeadershipboardHeroShell>
        <div className="grid gap-6 lg:grid-cols-[auto_1fr]">
          <div className="flex items-center gap-4 sm:gap-5">
            <div className="flex h-24 w-24 flex-col items-center justify-center rounded-2xl bg-black/20 backdrop-blur-md ring-1 ring-white/10 sm:h-28 sm:w-28">
              <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-indigo-100">
                Place
              </span>
              <span className="mt-1 text-4xl font-bold tabular-nums sm:text-5xl">
                {rank || '—'}
              </span>
              <span className="text-xs text-indigo-100">of {total || '—'}</span>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-200">
                Selected branch · {monthLabel}
              </p>
              <h2 className="mt-1 truncate text-2xl font-bold tracking-tight sm:text-3xl">
                {focusLabel}
              </h2>
              <p className="mt-2 text-base font-semibold text-white">{story.headline}</p>
              <p className="mt-1 max-w-md text-sm text-indigo-100/90">{story.detail}</p>
              {networkTop && Number(networkTop.branch_id) !== Number(focus?.branch_id) ? (
                <p className="mt-3 inline-flex items-center rounded-full bg-black/20 px-3 py-1 text-xs font-medium backdrop-blur-md ring-1 ring-white/10">
                  Network leader: {networkTop.branch_name}
                </p>
              ) : networkTop && Number(networkTop.branch_id) === Number(focus?.branch_id) ? (
                <p className="mt-3 inline-flex items-center rounded-full bg-amber-300/90 px-3 py-1 text-xs font-semibold text-amber-950">
                  Selected branch holds Network #1
                </p>
              ) : null}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:content-center">
            <div className="rounded-xl bg-black/20 px-3 py-3 backdrop-blur-md ring-1 ring-white/10 sm:px-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-indigo-100">
                Overall
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums">
                {focus?.composite_score != null ? formatNumber(focus.composite_score) : '—'}
              </p>
            </div>
            <div className="col-span-1 rounded-xl bg-black/20 px-3 py-3 backdrop-blur-md ring-1 ring-white/10 sm:col-span-2 sm:px-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-indigo-100">
                Invoice Sales
              </p>
              <p className="mt-1 text-lg font-bold leading-tight tabular-nums sm:text-xl">
                {focus?.total_sales != null ? formatCurrency(focus.total_sales) : '—'}
              </p>
            </div>
            <div className="rounded-xl bg-black/20 px-3 py-3 backdrop-blur-md ring-1 ring-white/10 sm:px-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-indigo-100">
                Active
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums">
                {focus?.active_students != null ? formatNumber(focus.active_students) : '—'}
              </p>
            </div>
          </div>
        </div>
      </LeadershipboardHeroShell>

      {/* Stacked landscape: selected branch on top, all branches below */}
      <div className="space-y-6">
        {/* Selected branch — full-width landscape */}
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100 sm:p-6">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-gray-900 sm:text-lg">
                  Selected branch
                </h3>
                <MatrixInfoTooltip label="About selected branch">
                  {LEADERSHIPBOARD.focusSelectedPanel}
                </MatrixInfoTooltip>
              </div>
              <p className="mt-1 text-sm text-gray-500">
                Deep dive for <span className="font-medium text-gray-700">{focusLabel}</span> —
                same metrics as Monthly Operational.
              </p>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50/80 px-3 py-2.5 sm:px-4">
              <RankMedal rank={rank || 0} />
              <div className="min-w-0">
                <p className="truncate font-semibold text-indigo-950">{focusLabel}</p>
                <p className="text-xs text-indigo-700">
                  Rank #{rank} of {total}
                  {focus?.composite_score != null
                    ? ` · Score ${formatNumber(focus.composite_score)}`
                    : ''}
                </p>
              </div>
              <span className="flex-shrink-0 rounded-full bg-indigo-600 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
                Focus
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {FOCUS_KPI_CARDS.map((card) => (
              <div
                key={card.key}
                className="rounded-xl border border-gray-100 bg-gradient-to-b from-white to-gray-50 px-3 py-3"
              >
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  {card.label}
                </p>
                <p className="mt-1.5 text-base font-bold tabular-nums text-gray-900 sm:text-lg">
                  {focus ? card.format(focus[card.key]) : '—'}
                </p>
              </div>
            ))}
          </div>

          {strongest && weakest ? (
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/80 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                  Strongest vs peers
                </p>
                <p className="mt-1 text-sm font-semibold text-emerald-950">
                  {strongest.label}
                  <span className="ml-1 font-normal text-emerald-800">
                    (weight {strongest.weightLabel})
                  </span>
                </p>
              </div>
              <div className="rounded-xl border border-amber-100 bg-amber-50/80 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                  Climb opportunity
                </p>
                <p className="mt-1 text-sm font-semibold text-amber-950">
                  {weakest.label}
                  <span className="ml-1 font-normal text-amber-900">
                    (weight {weakest.weightLabel})
                  </span>
                </p>
              </div>
            </div>
          ) : null}

          <div className="mt-5 border-t border-gray-100 pt-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
              How Overall is built
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {breakdownRows.map((row) => (
                <div key={row.field}>
                  <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-1 text-xs">
                    <span className="font-medium text-gray-700">
                      {row.label}{' '}
                      <span className="font-normal text-gray-400">{row.weightLabel}</span>
                    </span>
                    <span className="tabular-nums text-gray-500">
                      {Math.round((row.normalized || 0) * 100)}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                    <div
                      className="h-full rounded-full bg-indigo-500"
                      style={{ width: `${Math.min(100, Math.max(0, row.normalized * 100))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* All branches — full-width landscape */}
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-gray-900 sm:text-lg">All branches</h3>
            <MatrixInfoTooltip label="About network compare">
              {LEADERSHIPBOARD.focusNetworkPanel}
            </MatrixInfoTooltip>
            <span className="text-xs text-gray-400">·</span>
            <p className="text-xs text-gray-500 sm:text-sm">{LEADERSHIPBOARD.focusNetworkHint}</p>
          </div>

          {branches.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">No branches to show.</p>
          ) : (
            <>
              <div className="space-y-2 md:hidden">
                {branches.map((branch) => {
                  const isFocus = Boolean(branch.is_focus_branch);
                  const place = Number(branch.rank) || 0;
                  return (
                    <div
                      key={branch.branch_id}
                      className={`rounded-xl border px-3 py-3 ${
                        isFocus
                          ? 'border-indigo-300 bg-indigo-50 shadow-sm'
                          : 'border-gray-100 bg-gray-50/80'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <RankMedal rank={place} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className="truncate font-semibold text-gray-900">
                              {branch.branch_name}
                            </p>
                            <span className="flex-shrink-0 text-sm font-bold tabular-nums text-indigo-600">
                              {formatNumber(branch.composite_score)}
                            </span>
                          </div>
                          <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px] text-gray-600 sm:grid-cols-4">
                            <span>Sales {formatCurrency(branch.total_sales)}</span>
                            <span>New {formatNumber(branch.new_enrollees)}</span>
                            <span>Re-enr {formatNumber(branch.re_enrollment_count)}</span>
                            <span>Active {formatNumber(branch.active_students)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div
                className="hidden overflow-x-auto rounded-lg md:block"
                style={{
                  scrollbarWidth: 'thin',
                  scrollbarColor: '#cbd5e0 #f7fafc',
                  WebkitOverflowScrolling: 'touch',
                }}
              >
                <table style={{ width: '100%', minWidth: '860px' }} className="border-collapse text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                        Rank
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                        Branch
                      </th>
                      <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">
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
                    {branches.map((branch) => {
                      const isFocus = Boolean(branch.is_focus_branch);
                      return (
                        <tr
                          key={branch.branch_id}
                          className={isFocus ? 'bg-indigo-50/80' : 'hover:bg-gray-50'}
                        >
                          <td className="px-3 py-3">
                            <RankMedal rank={Number(branch.rank) || 0} />
                          </td>
                          <td className="px-3 py-3 font-medium text-gray-900">
                            <span className="inline-flex flex-wrap items-center gap-1.5">
                              {branch.branch_name}
                              {isFocus ? (
                                <span className="rounded-full bg-indigo-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                                  Focus
                                </span>
                              ) : null}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right font-semibold tabular-nums text-indigo-700">
                            {formatNumber(branch.composite_score)}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-gray-700">
                            {formatCurrency(branch.total_sales)}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-gray-700">
                            {formatNumber(branch.new_enrollees)}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-gray-700">
                            {formatNumber(branch.re_enrollment_count)}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-gray-700">
                            {formatNumber(branch.rejoin_count)}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-gray-700">
                            {formatNumber(branch.upsell_count)}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-gray-700">
                            {formatNumber(branch.active_students)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-100 sm:p-6">
          <div className="mb-4">
            <h3 className="text-base font-semibold text-gray-900 sm:text-lg">
              Invoice Sales Trend by Branch
            </h3>
            <p className="mt-1 text-sm text-gray-500">{LEADERSHIPBOARD.chartSalesTrend}</p>
          </div>
          <div className="h-72 sm:h-80">
            {salesTrendRows.length > 0 && trendNames.length > 0 ? (
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
                  {trendNames.map((name, index) => {
                    const isFocus = name === focusLabel;
                    return (
                      <Line
                        key={name}
                        type="monotone"
                        dataKey={name}
                        stroke={COLORS[index % COLORS.length]}
                        strokeWidth={isFocus ? 3.25 : 1.75}
                        strokeOpacity={isFocus ? 1 : 0.55}
                        dot={isFocus ? { r: 3.5 } : false}
                        activeDot={{ r: 5 }}
                      />
                    );
                  })}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 text-sm text-gray-500">
                No sales trend data for this period.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-100 sm:p-6">
          <div className="mb-4">
            <h3 className="text-base font-semibold text-gray-900 sm:text-lg">
              Branch Share — Overall
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              {donutTotal > 0
                ? `${LEADERSHIPBOARD.chartBranchShare} Total score mass: ${formatNumber(donutTotal)}.`
                : LEADERSHIPBOARD.chartBranchShare}
            </p>
          </div>
          <div className="h-72 sm:h-80">
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
                    label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                    labelLine={{ stroke: '#9ca3af' }}
                  >
                    {donutData.map((entry, index) => (
                      <Cell
                        key={`${entry.branch_id}-${index}`}
                        fill={COLORS[index % COLORS.length]}
                        stroke={
                          Number(entry.branch_id) === Number(focus?.branch_id)
                            ? '#312e81'
                            : undefined
                        }
                        strokeWidth={
                          Number(entry.branch_id) === Number(focus?.branch_id) ? 3 : 0
                        }
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) => [formatNumber(value), 'Overall']}
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
              <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 text-sm text-gray-500">
                No Overall data to show for this month.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BranchFocusStandingView;
