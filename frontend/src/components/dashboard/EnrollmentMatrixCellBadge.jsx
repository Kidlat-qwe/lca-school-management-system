import {
  enrollmentMatrixCellHoverTitle,
  enrollmentMatrixCellShowsSequence,
  enrollmentMatrixCellTone,
} from '../../utils/programEnrollmentStatus';

const EnrollmentMatrixCellBadge = ({ cell, sequence = null, periodKey = null }) => {
  const label = cell?.label ?? '';
  const tone = enrollmentMatrixCellTone(cell);
  const cellTitle = enrollmentMatrixCellHoverTitle(cell, { periodKey });
  const showsSequence = enrollmentMatrixCellShowsSequence(cell);
  const displayValue = showsSequence
    ? String(sequence != null && sequence > 0 ? sequence : 1)
    : '-';

  return (
    <div className="flex flex-col items-center gap-0.5">
      <span
        className={`inline-flex min-w-[2rem] items-center justify-center rounded-md px-2 py-1 text-xs font-semibold tabular-nums ${tone}`}
        title={cellTitle}
      >
        {displayValue}
      </span>
      {label ? (
        <span
          className="max-w-[4.5rem] truncate text-center text-[10px] leading-3 text-gray-600"
          title={cellTitle}
        >
          {label}
        </span>
      ) : null}
    </div>
  );
};

export default EnrollmentMatrixCellBadge;
