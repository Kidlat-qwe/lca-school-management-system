import { DashboardStatIcon } from './DashboardStatIcons';
import MatrixInfoTooltip from './MatrixInfoTooltip';

const formatMetricValue = (value) =>
  typeof value === 'number' ? value.toLocaleString() : value;

/** Keeps divider + month row aligned across single- and dual-metric cards. */
const PERIOD_BLOCK_MIN_HEIGHT = 'min-h-[5.5rem]';
const PERIOD_METRICS_MIN_HEIGHT = 'min-h-[3.375rem]';

const PeriodMetricsSection = ({ periodLabel, metrics = [], valueClassName = 'text-2xl' }) => (
  <div className={PERIOD_BLOCK_MIN_HEIGHT}>
    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{periodLabel}</p>
    <div className={`mt-2 space-y-1.5 ${PERIOD_METRICS_MIN_HEIGHT}`}>
      {metrics.map((metric) => (
        <div key={metric.label} className="flex items-baseline justify-between gap-3">
          <span className="text-xs font-medium text-gray-500">{metric.label}</span>
          <span
            className={`font-bold tabular-nums tracking-tight text-gray-900 ${valueClassName}`}
          >
            {formatMetricValue(metric.value)}
          </span>
        </div>
      ))}
    </div>
  </div>
);

const PeriodSingleValueSection = ({ periodLabel, value, valueClassName = 'text-2xl' }) => (
  <div className={PERIOD_BLOCK_MIN_HEIGHT}>
    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{periodLabel}</p>
    <div className={`mt-2 flex items-start justify-end ${PERIOD_METRICS_MIN_HEIGHT}`}>
      <span className={`font-bold tabular-nums tracking-tight text-gray-900 ${valueClassName}`}>
        {formatMetricValue(value)}
      </span>
    </div>
  </div>
);

export const EnrollmentYearMonthCombinedStatsCard = ({
  title,
  iconName,
  accent,
  tooltip,
  yearLabel,
  monthLabel,
  yearMetrics = [],
  monthMetrics = [],
}) => (
  <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100 transition-all hover:shadow-md">
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-0.5 text-sm font-medium text-gray-600">
          <span>{title}</span>
          {tooltip ? (
            <MatrixInfoTooltip label={`About ${title}`}>{tooltip}</MatrixInfoTooltip>
          ) : null}
        </p>
        <div className="mt-3 flex flex-col gap-3">
          <PeriodMetricsSection periodLabel={yearLabel} metrics={yearMetrics} />
          <hr className="border-gray-200" />
          <PeriodMetricsSection periodLabel={monthLabel} metrics={monthMetrics} />
        </div>
      </div>
      <div className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl ${accent}`}>
        <DashboardStatIcon name={iconName} className="h-6 w-6 text-white drop-shadow-sm" />
      </div>
    </div>
  </div>
);

export const EnrollmentYearMonthStatsCard = ({
  title,
  yearLabel,
  monthLabel,
  yearValue,
  monthValue,
  iconName,
  accent,
  tooltip,
}) => (
  <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100 transition-all hover:shadow-md">
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-0.5 text-sm font-medium text-gray-600">
          <span>{title}</span>
          {tooltip ? (
            <MatrixInfoTooltip label={`About ${title}`}>{tooltip}</MatrixInfoTooltip>
          ) : null}
        </p>
        <div className="mt-3 flex flex-col gap-3">
          <PeriodSingleValueSection periodLabel={yearLabel} value={yearValue} />
          <hr className="border-gray-200" />
          <PeriodSingleValueSection periodLabel={monthLabel} value={monthValue} />
        </div>
      </div>
      <div className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl ${accent}`}>
        <DashboardStatIcon name={iconName} className="h-6 w-6 text-white drop-shadow-sm" />
      </div>
    </div>
  </div>
);

export const EnrollmentStatsCard = ({ title, value, iconName, accent, tooltip }) => (
  <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100 transition-all hover:shadow-md">
    <div className="flex items-start justify-between">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-0.5 text-sm font-medium text-gray-600">
          <span>{title}</span>
          {tooltip ? (
            <MatrixInfoTooltip label={`About ${title}`}>{tooltip}</MatrixInfoTooltip>
          ) : null}
        </p>
        <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900">
          {typeof value === 'number' ? value.toLocaleString() : value}
        </p>
      </div>
      <div className={`ml-4 flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl ${accent}`}>
        <DashboardStatIcon name={iconName} className="h-6 w-6 text-white drop-shadow-sm" />
      </div>
    </div>
  </div>
);

export const EnrollmentCombinedStatsCard = ({ title, iconName, accent, tooltip, metrics = [] }) => (
  <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100 transition-all hover:shadow-md">
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-0.5 text-sm font-medium text-gray-600">
          <span>{title}</span>
          {tooltip ? (
            <MatrixInfoTooltip label={`About ${title}`}>{tooltip}</MatrixInfoTooltip>
          ) : null}
        </p>
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
      </div>
      <div className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl ${accent}`}>
        <DashboardStatIcon name={iconName} className="h-6 w-6 text-white drop-shadow-sm" />
      </div>
    </div>
  </div>
);
