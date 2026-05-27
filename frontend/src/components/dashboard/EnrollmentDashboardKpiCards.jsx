import { DashboardStatIcon } from './DashboardStatIcons';
import MatrixInfoTooltip from './MatrixInfoTooltip';

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
