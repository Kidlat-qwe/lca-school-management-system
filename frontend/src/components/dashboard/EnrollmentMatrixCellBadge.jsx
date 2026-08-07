import {
  enrollmentMatrixCellHoverTitle,
  enrollmentMatrixCellShowsSequence,
  enrollmentMatrixCellTone,
  enrollmentMatrixLifecycleMark,
} from '../../utils/programEnrollmentStatus';

const EnrollmentMatrixCellBadge = ({ cell, sequence = null, periodKey = null }) => {
  const isSinglePhaseCompleted = Boolean(cell?.single_phase_completed);
  const label = isSinglePhaseCompleted
    ? 'completed (1-phase)'
    : (cell?.label ?? '');
  const tone = enrollmentMatrixCellTone(cell);
  const cellTitle = enrollmentMatrixCellHoverTitle(cell, { periodKey });
  const showsSequence = enrollmentMatrixCellShowsSequence(cell);
  const lifecycleMark = enrollmentMatrixLifecycleMark(cell);
  const displayValue = showsSequence
    ? String(sequence != null && sequence > 0 ? sequence : 1)
    : '-';

  return (
    <div className="flex flex-col items-center gap-0.5">
      <span
        className={`inline-flex min-w-[2rem] flex-col items-center justify-center rounded-md px-2 text-xs font-semibold tabular-nums ${
          lifecycleMark ? 'gap-0 pb-1 pt-0.5' : 'py-1'
        } ${tone}`}
        title={cellTitle}
      >
        {lifecycleMark ? (
          <span
            className={`text-[8px] font-bold leading-none ${
              lifecycleMark === '✓' ? 'text-sky-700' : 'text-slate-700'
            }`}
            aria-hidden="true"
          >
            {lifecycleMark}
          </span>
        ) : null}
        <span className="leading-tight">{displayValue}</span>
      </span>
      {label ? (
        <span
          className={`max-w-[4.5rem] truncate text-center text-[10px] leading-3 ${
            isSinglePhaseCompleted ? 'text-fuchsia-800 font-medium' : 'text-gray-600'
          }`}
          title={cellTitle}
        >
          {label}
        </span>
      ) : null}
    </div>
  );
};

export default EnrollmentMatrixCellBadge;
