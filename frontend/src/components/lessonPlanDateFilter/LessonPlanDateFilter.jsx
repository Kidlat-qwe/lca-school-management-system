/**
 * Lesson plan list date filter — native date input (browser calendar UI).
 * Default is off (empty value); Clear in the picker turns it off again.
 */
/**
 * @param {{
 *   value?: string,
 *   onChange: (ymd: string) => void,
 *   label?: string,
 *   id?: string,
 *   className?: string,
 * }} props
 * `value` is YYYY-MM-DD when active, or empty string when filter is off.
 */
export default function LessonPlanDateFilter({
  value = '',
  onChange,
  label = 'Lesson Date',
  id = 'lesson-plan-date-filter',
  className = '',
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-gray-700">
        {label}
      </label>
      <input
        type="date"
        id={id}
        value={value || ''}
        onChange={(e) => onChange?.(e.target.value || '')}
        className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
      />
    </div>
  );
}
