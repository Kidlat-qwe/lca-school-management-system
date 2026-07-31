import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import MatrixInfoTooltip from './MatrixInfoTooltip';
import LeadershipboardHeroShell from './LeadershipboardHeroShell';
import { LEADERSHIPBOARD } from '../../constants/dashboardDescriptions';

const formatCurrency = (amount) =>
  `Php ${(Number(amount) || 0).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const formatNumber = (value) => (Number(value) || 0).toLocaleString('en-PH');

const OWN_KPI_CARDS = [
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

const standingCopy = (rank, total) => {
  if (!rank || !total) {
    return {
      headline: 'Your place this month',
      detail: 'Choose a month to see where your branch stands in the network.',
    };
  }
  if (rank === 1) {
    return {
      headline: "You're leading the network",
      detail: `Rank #1 of ${total} — keep defending the top spot with sales and retention.`,
    };
  }
  if (rank === 2) {
    return {
      headline: 'One place from the top',
      detail: `Rank #${rank} of ${total} — you're chasing the leader. Strengthen your weakest Overall criteria.`,
    };
  }
  if (rank === 3) {
    return {
      headline: "You're on the podium",
      detail: `Rank #${rank} of ${total} — bronze is locked. Push growth and re-enrollment to climb.`,
    };
  }
  if (rank <= Math.ceil(total / 2)) {
    return {
      headline: "You're in the top half",
      detail: `Rank #${rank} of ${total} — solid footing. Focus on the criteria that weigh most: Invoice Sales and New.`,
    };
  }
  return {
    headline: 'Room to climb',
    detail: `Rank #${rank} of ${total} — use your snapshot below to raise the metrics that build Overall.`,
  };
};

const RankMedal = ({ rank, large = false }) => {
  const tone = rankTone(rank);
  const size = large ? 'h-14 w-14 text-xl sm:h-16 sm:w-16 sm:text-2xl' : 'h-9 w-9 text-sm';
  const styles = {
    amber: 'bg-amber-400 text-amber-950 ring-amber-200',
    slate: 'bg-slate-300 text-slate-800 ring-slate-200',
    orange: 'bg-orange-300 text-orange-950 ring-orange-200',
    gray: 'bg-gray-100 text-gray-700 ring-gray-200',
  };
  return (
    <span
      className={`inline-flex flex-shrink-0 items-center justify-center rounded-full font-bold ring-2 ${size} ${styles[tone]}`}
    >
      {rank}
    </span>
  );
};

/**
 * Branch Admin Leadershipboard — competitive standing without peer metrics.
 * Network order stays visible as names + place only; numbers are own-branch.
 */
const AdminStandingView = ({
  data,
  selectedMonth,
  setSelectedMonth,
  maxMonth,
  branchName,
}) => {
  const own = data?.top_branch || data?.branches?.find((b) => b.is_own_branch) || null;
  const networkTop = data?.network_top_branch || null;
  const branches = [...(data?.branches || [])].sort(
    (a, b) => (Number(a.rank) || 0) - (Number(b.rank) || 0)
  );
  const total = data?.total_branch_count || branches.length;
  const rank = Number(own?.rank) || 0;
  const story = standingCopy(rank, total);
  const monthLabel = data?.month_label || selectedMonth;
  const salesTrendRows = data?.sales_trend?.rows || [];
  const trendName =
    data?.sales_trend?.branch_keys?.[0]?.branch_name || own?.branch_name || '';

  const breakdownRows = WEIGHT_ORDER.map((field) => {
    const entry = own?.weight_breakdown?.[field];
    return {
      field,
      label: entry?.label || field,
      weightLabel: WEIGHT_PERCENT[field],
      weight: entry?.weight ?? 0,
      normalized: entry?.normalized ?? 0,
      contribution: entry?.contribution ?? 0,
      // Contribution is already weight×normalized (0–1 scale of Overall before ×100).
      barPct: Math.round((entry?.contribution || 0) * 1000) / 10,
    };
  });

  const weakest = [...breakdownRows].sort((a, b) => a.contribution - b.contribution)[0];
  const strongest = [...breakdownRows].sort((a, b) => b.contribution - a.contribution)[0];

  return (
    <div className="w-full min-w-0 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Leadershipboard</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">{LEADERSHIPBOARD.adminPageIntro}</p>
          <p className="mt-1 text-xs text-gray-400">
            Viewing: <span className="font-medium text-gray-600">{branchName}</span>
            {` · Your place among ${total} branches`}
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

      {/* Standing hero — rank-first, not a blank peer mirror */}
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
                Your branch · {monthLabel}
              </p>
              <h2 className="mt-1 truncate text-2xl font-bold tracking-tight sm:text-3xl">
                {own?.branch_name || branchName}
              </h2>
              <p className="mt-2 text-base font-semibold text-white">{story.headline}</p>
              <p className="mt-1 max-w-md text-sm text-indigo-100/90">{story.detail}</p>
              {networkTop && Number(networkTop.branch_id) !== Number(own?.branch_id) ? (
                <p className="mt-3 inline-flex items-center rounded-full bg-black/20 px-3 py-1 text-xs font-medium backdrop-blur-md ring-1 ring-white/10">
                  Network leader: {networkTop.branch_name}
                </p>
              ) : networkTop && Number(networkTop.branch_id) === Number(own?.branch_id) ? (
                <p className="mt-3 inline-flex items-center rounded-full bg-amber-300/90 px-3 py-1 text-xs font-semibold text-amber-950">
                  You hold Network #1
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
                {own?.composite_score != null ? formatNumber(own.composite_score) : '—'}
              </p>
            </div>
            <div className="col-span-1 rounded-xl bg-black/20 px-3 py-3 backdrop-blur-md ring-1 ring-white/10 sm:col-span-2 sm:px-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-indigo-100">
                Invoice Sales
              </p>
              <p className="mt-1 text-lg font-bold leading-tight tabular-nums sm:text-xl">
                {own?.total_sales != null ? formatCurrency(own.total_sales) : '—'}
              </p>
            </div>
            <div className="rounded-xl bg-black/20 px-3 py-3 backdrop-blur-md ring-1 ring-white/10 sm:px-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-indigo-100">
                Active
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums">
                {own?.active_students != null ? formatNumber(own.active_students) : '—'}
              </p>
            </div>
          </div>
        </div>
      </LeadershipboardHeroShell>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        {/* Network race — names + place only */}
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100 sm:p-5 xl:col-span-2">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-gray-900">Network race</h3>
            <MatrixInfoTooltip label="About network race">
              {LEADERSHIPBOARD.adminNetworkRace}
            </MatrixInfoTooltip>
          </div>
          <p className="mb-4 text-sm text-gray-500">{LEADERSHIPBOARD.adminNetworkRaceHint}</p>
          {branches.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">No branches to show.</p>
          ) : (
            <ol className="space-y-2">
              {branches.map((branch) => {
                const isOwn = Boolean(branch.is_own_branch);
                const place = Number(branch.rank) || 0;
                return (
                  <li
                    key={branch.branch_id}
                    className={`flex items-center gap-3 rounded-xl border px-3 py-3 transition-colors ${
                      isOwn
                        ? 'border-indigo-300 bg-indigo-50 shadow-sm'
                        : 'border-gray-100 bg-gray-50/80'
                    }`}
                  >
                    <RankMedal rank={place} />
                    <div className="min-w-0 flex-1">
                      <p
                        className={`truncate font-semibold ${
                          isOwn ? 'text-indigo-950' : 'text-gray-800'
                        }`}
                      >
                        {branch.branch_name}
                      </p>
                      <p className="text-xs text-gray-500">
                        {isOwn
                          ? `Your branch · Score ${formatNumber(own?.composite_score)}`
                          : place === 1
                            ? 'Leading the board'
                            : `Place #${place}`}
                      </p>
                    </div>
                    {isOwn ? (
                      <span className="flex-shrink-0 rounded-full bg-indigo-600 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
                        You
                      </span>
                    ) : place <= 3 ? (
                      <span className="flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                        {place === 1 ? 'Gold' : place === 2 ? 'Silver' : 'Bronze'}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        {/* Own month snapshot */}
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100 sm:p-5 xl:col-span-3">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-gray-900">Your month snapshot</h3>
            <MatrixInfoTooltip label="About your snapshot">
              {LEADERSHIPBOARD.adminOwnSnapshot}
            </MatrixInfoTooltip>
          </div>
          <p className="mb-4 text-sm text-gray-500">
            Same definitions as Monthly Operational — only your branch numbers are shown.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {OWN_KPI_CARDS.map((card) => (
              <div
                key={card.key}
                className="rounded-xl border border-gray-100 bg-gradient-to-b from-white to-gray-50 px-3 py-3"
              >
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  {card.label}
                </p>
                <p className="mt-1.5 text-lg font-bold tabular-nums text-gray-900 sm:text-xl">
                  {own ? card.format(own[card.key]) : '—'}
                </p>
              </div>
            ))}
          </div>

          {/* Focus callout */}
          {strongest && weakest ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/80 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
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
                <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">
                  Biggest climb opportunity
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
        </div>
      </div>

      {/* How Overall is built — own normalized contributions only */}
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100 sm:p-6">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold text-gray-900">How your Overall is built</h3>
          <MatrixInfoTooltip label="About Overall weighting">
            {LEADERSHIPBOARD.compositeScore}
          </MatrixInfoTooltip>
        </div>
        <p className="mb-5 text-sm text-gray-500">{LEADERSHIPBOARD.adminWeightStory}</p>
        <div className="space-y-4">
          {breakdownRows.map((row) => (
            <div key={row.field}>
              <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-gray-800">
                  {row.label}
                  <span className="ml-2 text-xs font-normal text-gray-400">
                    Weight {row.weightLabel}
                  </span>
                </p>
                <p className="text-xs tabular-nums text-gray-500">
                  vs peers {Math.round((row.normalized || 0) * 100)}% · contrib{' '}
                  {row.barPct.toFixed(1)} pts
                </p>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-gray-100">
                <div
                  className="h-full rounded-full bg-indigo-500 transition-all"
                  style={{ width: `${Math.min(100, Math.max(0, row.normalized * 100))}%` }}
                />
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-gray-400">
          Bars show how you score on each criterion relative to other branches (0% = lowest,
          100% = highest that month). Peer raw numbers stay private.
        </p>
      </div>

      {/* Own sales trend — full width */}
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-100 sm:p-6">
        <div className="mb-4">
          <h3 className="text-base font-semibold text-gray-900 sm:text-lg">
            Your invoice sales trend
          </h3>
          <p className="mt-1 text-sm text-gray-500">{LEADERSHIPBOARD.adminChartSalesTrend}</p>
        </div>
        <div className="h-72 sm:h-80">
          {salesTrendRows.length > 0 && trendName ? (
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
                  formatter={(value) => [formatCurrency(value), trendName]}
                  contentStyle={{
                    borderRadius: '12px',
                    border: '1px solid #e5e7eb',
                    fontSize: '12px',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Line
                  type="monotone"
                  dataKey={trendName}
                  stroke="#4F46E5"
                  strokeWidth={2.5}
                  dot={{ r: 3.5 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 text-center text-sm text-gray-500">
              No sales trend data for this period.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminStandingView;
