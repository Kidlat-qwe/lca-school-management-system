import { matrixTrackDisplayName } from '../../utils/enrollmentMatrixSort';
import { enrollmentMatrixStudentNameTitle } from './EnrollmentMatrixStudentColumnHeader';

/**
 * Clickable student name in phase/month re-enrollment matrix tables.
 */
const EnrollmentMatrixStudentNameCell = ({ track, onOpenHistory, className = '' }) => {
  const displayName = matrixTrackDisplayName(track);
  const title = enrollmentMatrixStudentNameTitle(track);
  const canOpen = track?.student_id != null;

  if (!canOpen) {
    return <span className={`block truncate ${className}`}>{displayName}</span>;
  }

  return (
    <button
      type="button"
      onClick={() => onOpenHistory(track)}
      className={`block w-full truncate text-left font-medium text-indigo-700 underline-offset-2 hover:text-indigo-900 hover:underline focus:outline-none focus:ring-2 focus:ring-[#F7C844]/50 rounded-sm ${className}`}
      title={`${title} · View student history`}
      aria-label={`View history for ${displayName}`}
    >
      {displayName}
    </button>
  );
};

export default EnrollmentMatrixStudentNameCell;
