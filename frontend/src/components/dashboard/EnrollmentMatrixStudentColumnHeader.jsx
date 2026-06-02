import { formatMatrixEnrollmentDate } from '../../utils/enrollmentMatrixSort';
import { SortIcon } from '../table/SortableHeader';

/**
 * Sortable Student column header — toggles enrollment date order (matches invoice table sort UI).
 */
const EnrollmentMatrixStudentColumnHeader = ({
  sortDirection = 'asc',
  onToggleSort,
  className = '',
  style = {},
}) => (
  <button
    type="button"
    onClick={onToggleSort}
    className={`inline-flex w-full items-center gap-1 text-left text-xs font-medium uppercase tracking-wider text-gray-500 transition-colors hover:text-gray-700 focus:outline-none ${className}`}
    style={style}
    title={
      sortDirection === 'asc'
        ? 'Sorted by enrollment date (oldest first). Click for newest first.'
        : 'Sorted by enrollment date (newest first). Click for oldest first.'
    }
    aria-label={`Student column sorted by enrollment date, ${sortDirection === 'asc' ? 'oldest first' : 'newest first'}. Click to reverse.`}
    aria-sort={sortDirection === 'asc' ? 'ascending' : 'descending'}
  >
    <span>Student</span>
    <SortIcon active direction={sortDirection} />
  </button>
);

export const enrollmentMatrixStudentNameTitle = (student) => {
  const dateLabel = formatMatrixEnrollmentDate(student?.first_enrolled_at);
  if (dateLabel) return `${student.full_name} · Enrolled ${dateLabel}`;
  return student?.full_name || '';
};

export default EnrollmentMatrixStudentColumnHeader;
