import { DashboardStatIcon } from './DashboardStatIcons';
import MatrixInfoTooltip from './MatrixInfoTooltip';

const resolveBottomAccent = (accent = '') => {
  const match = String(accent).match(/from-([a-z]+-\d+)/);
  return match ? `bg-${match[1]}` : 'bg-gray-300';
};

/**
 * Single card showing multiple metrics (e.g. New + Re-enrollment, or Invoice + AR sales).
 * @param {'inline'|'stacked'} metricsLayout - inline: label left, value right; stacked: label then amount on separate lines
 */
const CombinedStatsCard = ({
  title,
  iconName,
  accent,
  tooltip,
  subtitle,
  metrics = [],
  metricsLayout = 'inline',
  onClick,
  ariaLabel,
  size = 'default',
  hideTitle = false,
}) => {
  const helpText = tooltip ?? subtitle;
  const isFinancial = size === 'financial';
  const Wrapper = onClick ? 'button' : 'div';
  const showHeader = Boolean(!hideTitle && (title || iconName));

  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      aria-label={ariaLabel || (onClick ? title : undefined)}
      className={`group relative h-full w-full overflow-visible rounded-2xl bg-white text-left shadow-sm ring-1 ring-gray-100 transition-all duration-300 hover:shadow-lg hover:ring-gray-200 ${
        isFinancial ? 'p-6' : 'p-5'
      } ${onClick ? 'cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#F7C844] focus:ring-offset-2' : ''}`}
    >
      <div className="flex h-full flex-col">
        {showHeader ? (
          <div className="flex items-start justify-between gap-3">
            <p className="flex min-w-0 flex-wrap items-center gap-0.5 text-sm font-semibold leading-tight text-gray-700">
              {title ? <span>{title}</span> : null}
              {helpText && title ? (
                <MatrixInfoTooltip label={`About ${title}`}>{helpText}</MatrixInfoTooltip>
              ) : null}
            </p>
            {iconName ? (
              <div
                className={`flex flex-shrink-0 items-center justify-center rounded-xl shadow-sm transition-transform duration-300 group-hover:scale-110 ${accent} ${
                  isFinancial ? 'h-14 w-14' : 'h-11 w-11 rounded-lg'
                }`}
              >
                <DashboardStatIcon
                  name={iconName}
                  className={`text-white drop-shadow-sm ${isFinancial ? 'h-7 w-7' : 'h-5 w-5'}`}
                />
              </div>
            ) : null}
          </div>
        ) : iconName ? (
          <div className="flex justify-end">
            <div
              className={`flex flex-shrink-0 items-center justify-center rounded-xl shadow-sm transition-transform duration-300 group-hover:scale-110 ${accent} h-11 w-11 rounded-lg`}
            >
              <DashboardStatIcon name={iconName} className="h-5 w-5 text-white drop-shadow-sm" />
            </div>
          </div>
        ) : null}
        <div className={`${showHeader || iconName ? 'mt-3' : ''} ${metricsLayout === 'stacked' ? 'space-y-4' : 'space-y-2'}`}>
          {metrics.map((row, index) =>
            metricsLayout === 'stacked' ? (
              <div
                key={row.label}
                className={index > 0 ? 'border-t border-gray-100 pt-4' : undefined}
              >
                <p className="flex items-center text-xs font-semibold text-gray-600">
                  <span>{row.label}</span>
                  {row.tooltip ? (
                    <MatrixInfoTooltip label={`About ${row.label}`}>{row.tooltip}</MatrixInfoTooltip>
                  ) : null}
                </p>
                <p
                  className={`mt-0.5 font-bold tabular-nums leading-tight text-gray-900 break-words ${
                    isFinancial ? 'text-2xl tracking-tight' : 'text-[1.65rem]'
                  }`}
                >
                  {row.value}
                </p>
              </div>
            ) : (
              <div key={row.label} className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium text-gray-600">{row.label}</span>
                <span className="text-lg font-bold tabular-nums text-gray-900">{row.value}</span>
              </div>
            )
          )}
        </div>
      </div>
      <div className={`absolute inset-x-0 bottom-0 h-1 ${resolveBottomAccent(accent)}`} />
    </Wrapper>
  );
};

export default CombinedStatsCard;
