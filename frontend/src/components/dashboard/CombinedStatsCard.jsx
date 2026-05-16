import { DashboardStatIcon } from './DashboardStatIcons';

/**
 * Single card showing multiple enrollment metrics (e.g. New + Re-enrollment).
 */
const CombinedStatsCard = ({ title, iconName, accent, subtitle, metrics = [] }) => (
  <div className="group relative h-full w-full overflow-hidden rounded-2xl bg-white p-5 text-left shadow-sm ring-1 ring-gray-100 transition-all duration-300 hover:shadow-lg hover:ring-gray-200">
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold leading-tight text-gray-700">{title}</p>
        <div
          className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg ${accent} shadow-sm transition-transform duration-300 group-hover:scale-110`}
        >
          <DashboardStatIcon name={iconName} className="h-5 w-5 text-white drop-shadow-sm" />
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {metrics.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium text-gray-600">{row.label}</span>
            <span className="text-lg font-bold tabular-nums text-gray-900">{row.value}</span>
          </div>
        ))}
      </div>
      {subtitle ? <p className="mt-2 text-[11px] font-medium leading-4 text-gray-500">{subtitle}</p> : null}
    </div>
    <div
      className={`absolute inset-x-0 bottom-0 h-1 ${accent.replace('bg-', 'bg-gradient-to-r from-').replace('/80', ' to-transparent')}`}
    />
  </div>
);

export default CombinedStatsCard;
