import { ENROLLMENT_MATRIX_STATUS_ITEMS } from '../../utils/programEnrollmentStatus';

/**
 * Status legend for phase/month enrollment matrix tables.
 */
const EnrollmentMatrixStatusLegend = ({ className = '' }) => (
  <div
    className={`rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 sm:px-4 sm:py-3 ${className}`}
  >
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Legend</span>
      {ENROLLMENT_MATRIX_STATUS_ITEMS.map((item) => (
        <div key={item.key} className="flex items-center gap-1.5" title={item.description}>
          <span
            className={`inline-flex min-w-[1.75rem] items-center justify-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${item.tone}`}
          >
            {item.key === 'not_enrolled' ? '—' : 'n'}
          </span>
          <span className="text-xs font-medium text-gray-700">{item.label}</span>
        </div>
      ))}
    </div>
  </div>
);

export default EnrollmentMatrixStatusLegend;
