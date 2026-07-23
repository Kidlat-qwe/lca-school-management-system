/**
 * Dropdown of RHET Inventory categoryName values for Add Merchandise Type.
 * Categories come from CMS proxy GET /merchandise-requests/inventory/catalog.
 */

export default function RhetCategorySelect({
  id = 'rhet_category',
  value = '',
  options = [],
  onChange,
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
        <p className="mt-1 text-sm text-red-600">{error}</p>
      ) : (
        <p className="mt-1 text-xs text-gray-500">
          Exact RHET Inventory category names only (e.g. Backpack, School Uniform).
          Learning Kit is not available here yet.
        </p>
      )}
    </div>
  );
}
