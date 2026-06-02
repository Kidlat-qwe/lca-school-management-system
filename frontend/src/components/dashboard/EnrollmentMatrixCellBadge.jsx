import {
  enrollmentMatrixCellTitle,
  enrollmentMatrixCellTone,
} from '../../utils/programEnrollmentStatus';

const EnrollmentMatrixCellBadge = ({ cell }) => {
  const mark = cell?.mark ?? '-';
  const label = cell?.label ?? '';
  const tone = enrollmentMatrixCellTone(cell);

  return (
    <div className="flex flex-col items-center gap-0.5">
      <span
        className={`inline-flex min-w-[2rem] items-center justify-center rounded-md px-2 py-1 text-xs font-semibold tabular-nums ${tone}`}
        title={enrollmentMatrixCellTitle(cell)}
      >
        {mark === '1' ? '1' : '-'}
      </span>
      {label ? (
        <span className="max-w-[4.5rem] truncate text-center text-[10px] leading-3 text-gray-600" title={label}>
          {label}
        </span>
      ) : null}
    </div>
  );
};

export default EnrollmentMatrixCellBadge;
