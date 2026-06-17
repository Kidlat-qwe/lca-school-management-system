import { formatMatrixEnrollmentDate, matrixTrackDisplayName } from '../../utils/enrollmentMatrixSort';
import { SortIcon } from '../table/SortableHeader';

/**
 * Sortable Student column header — status (default) or enrollment date.
 */
const EnrollmentMatrixStudentColumnHeader = ({
  sortMode = 'status',
  sortDirection = 'asc',
  focusPeriodLabel = 'current month',
  onToggleSort,
  className = '',
  style = {},
}) => {
  const isStatus = sortMode === 'status';
  const title = isStatus
    ? `Sorted by status for the ${focusPeriodLabel} (New → Re-enrolled → … → Not enrolled). Click to sort by enrollment date.`
    : sortDirection === 'asc'
      ? 'Sorted by enrollment date (oldest first). Click for newest first.'
      : 'Sorted by enrollment date (newest first). Click for status order.';

  const ariaSort = isStatus ? 'other' : sortDirection === 'asc' ? 'ascending' : 'descending';

  return (
    <button
      type="button"
      onClick={onToggleSort}
      className={`inline-flex w-full items-center gap-1 text-left text-xs font-medium uppercase tracking-wider text-gray-500 transition-colors hover:text-gray-700 focus:outline-none ${className}`}
      style={style}
      title={title}
      aria-label={isStatus ? 'Student column sorted by status. Click to sort by enrollment date.' : `Student column sorted by enrollment date, ${sortDirection === 'asc' ? 'oldest first' : 'newest first'}.`}
      aria-sort={ariaSort}
    >
      <span>Student</span>
      {isStatus ? (
        <span className="text-[10px] font-semibold normal-case tracking-normal text-gray-400" aria-hidden>
          Status
        </span>
      ) : (
        <SortIcon active direction={sortDirection} />
      )}
    </button>
  );
};

export const enrollmentMatrixStudentNameTitle = (student) => {
  const displayName = matrixTrackDisplayName(student);
  const dateLabel = formatMatrixEnrollmentDate(student?.first_enrolled_at);
  if (dateLabel) return `${displayName} · Enrolled ${dateLabel}`;
  return displayName || '';
};

export default EnrollmentMatrixStudentColumnHeader;
