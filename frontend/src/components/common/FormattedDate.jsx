import { formatDateManila, formatDateTimeManila } from '../../utils/dateUtils';

/**
 * Global date display for tables, cards, and detail views.
 * Uses system format: "June 06, 2026" (Asia/Manila).
 *
 * @param {object} props
 * @param {string|Date|null|undefined} props.value - Date from API or state
 * @param {boolean} [props.includeTime=false] - Append time after the date
 * @param {boolean} [props.hour12=false] - 12-hour clock when includeTime is true
 * @param {string} [props.fallback='-'] - Shown when value is empty or invalid
 * @param {string} [props.className] - Optional wrapper class
 * @param {string} [props.title] - Optional native tooltip
 */
const FormattedDate = ({
  value,
  includeTime = false,
  hour12 = false,
  fallback = '-',
  className,
  title,
}) => {
  const formatted = includeTime
    ? formatDateTimeManila(value, { hour12 })
    : formatDateManila(value);

  const display =
    formatted === '-' && fallback != null && fallback !== '-'
      ? fallback
      : formatted;

  return (
    <span className={className} title={title}>
      {display}
    </span>
  );
};

export default FormattedDate;
