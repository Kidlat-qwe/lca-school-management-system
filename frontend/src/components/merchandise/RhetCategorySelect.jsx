/**
 * Dropdown of RHET Inventory categoryName values for Add Merchandise Type.
 * Categories come from CMS proxy GET /merchandise-requests/inventory/catalog.
 * Options must be catalog-driven — never a hard-coded category name array.
 */

export default function RhetCategorySelect({
  id = 'rhet_category',
  value = '',
  options = [],
  onChange,
  onRetry,
  loading = false,
  error = '',
  disabled = false,
  className = '',
  required = true,
}) {
  return (
    <div>
      <label htmlFor={id} className="label-field">
        Merchandise category (RHET Inventory) <span className="text-red-500">*</span>
      </label>
      <select
        id={id}
        name={id}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        disabled={disabled || loading || Boolean(error) || options.length === 0}
        required={required}
        className={`input-field ${className}`}
      >
        <option value="">
          {loading
            ? 'Loading RHET categories…'
            : error
              ? 'RHET categories unavailable'
              : 'Select a category from RHET Inventory…'}
        </option>
        {options.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      {error ? (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <p className="text-sm text-red-600">{error}</p>
          {typeof onRetry === 'function' && (
            <button
              type="button"
              onClick={onRetry}
              disabled={loading}
              className="text-sm font-medium text-[#1a5f4a] underline disabled:opacity-50"
            >
              Retry catalog
            </button>
          )}
        </div>
      ) : (
        <p className="mt-1 text-xs text-gray-500">
          Exact RHET Inventory category names from live catalog (not a hard-coded CMS list).
        </p>
      )}
    </div>
  );
}
