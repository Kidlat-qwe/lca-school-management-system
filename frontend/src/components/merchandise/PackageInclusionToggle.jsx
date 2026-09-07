/**
 * Toggle: Included in package vs Not included (manual deduct only).
 */
export default function PackageInclusionToggle({
  included = true,
  onChange,
  disabled = false,
  id = 'is_package_included',
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900">Package inclusion</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {included
              ? 'Can be added to packages and issued on enroll / first payment.'
              : 'Not for packages — stock is reduced only via Manual deduct with a required reason.'}
          </p>
        </div>
        <button
          type="button"
          id={id}
          role="switch"
          aria-checked={included}
          disabled={disabled}
          onClick={() => onChange?.(!included)}
          className={`relative inline-flex h-7 w-12 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-[#F7C844] focus:ring-offset-2 disabled:opacity-50 ${
            included ? 'bg-[#F7C844]' : 'bg-gray-300'
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow ring-0 transition ${
              included ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
      <p className="text-xs font-semibold text-gray-700">
        {included ? 'Included in package' : 'Not included in package'}
      </p>
    </div>
  );
}
