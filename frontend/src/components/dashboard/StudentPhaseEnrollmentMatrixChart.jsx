const CellBadge = ({ cell }) => {
  const mark = cell?.mark ?? '-';
  const label = cell?.label ?? '';
  const isEnrolled = mark === '1';

  return (
    <div className="flex flex-col items-center gap-0.5">
      <span
        className={`inline-flex min-w-[2rem] items-center justify-center rounded-md px-2 py-1 text-xs font-semibold tabular-nums ${
          isEnrolled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'
        }`}
        title={label || (isEnrolled ? 'Enrolled' : 'Not enrolled')}
      >
        {isEnrolled ? '1' : '-'}
      </span>
      {label ? <span className="text-[10px] leading-3 text-gray-500">{label}</span> : null}
    </div>
  );
};

/**
 * Student × phase enrollment matrix.
 */
const StudentPhaseEnrollmentMatrixChart = ({ matrix, className = '' }) => {
  const phases = matrix?.phases ?? [];
  const students = matrix?.students ?? [];
  const phaseStats = matrix?.phase_stats ?? [];
  const cohortSize = students.length;
  const showPhaseRateHeader = cohortSize > 0 && phaseStats.length > 0;

  if (!phases.length) {
    return (
      <div className={`flex h-72 items-center justify-center text-sm text-gray-500 ${className}`}>
        No enrollment data for the selected scope.
      </div>
    );
  }

  return (
    <div className={className}>
      <div
        className="overflow-x-auto overflow-y-auto rounded-lg border border-gray-200"
        style={{
          maxHeight: '720px',
          scrollbarWidth: 'thin',
          scrollbarColor: '#cbd5e0 #f7fafc',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        <table style={{ width: '100%', minWidth: `${Math.max(480, 160 + phases.length * 88)}px` }}>
          <thead>
            {showPhaseRateHeader && (
              <tr className="border-b border-gray-200 bg-amber-50 text-left text-xs font-semibold tracking-wide text-gray-700">
                <th
                  className="sticky left-0 top-0 z-50 h-11 bg-amber-50 px-4 py-2.5"
                  style={{ minWidth: '160px' }}
                >
                  Phase rate
                </th>
                {phaseStats.map((row) => (
                  <th
                    key={`stat-top-${row.phase_number}`}
                    className="sticky top-0 z-40 h-11 bg-amber-50 px-3 py-2.5 text-center whitespace-nowrap"
                  >
                    <div className="text-[11px] font-semibold tabular-nums text-gray-900">
                      {row.enrolled_count}/{row.student_count}
                    </div>
                    <div className="text-[11px] tabular-nums text-amber-800">
                      {row.enrollment_rate.toFixed(0)}%
                    </div>
                  </th>
                ))}
              </tr>
            )}

            <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
              <th
                className={`sticky left-0 ${showPhaseRateHeader ? 'top-11' : 'top-0'} z-40 bg-gray-50 px-4 py-3`}
                style={{ minWidth: '160px' }}
              >
                Student
              </th>
              {phases.map((phase) => (
                <th
                  key={phase.key}
                  className={`sticky ${showPhaseRateHeader ? 'top-11' : 'top-0'} z-30 bg-gray-50 px-3 py-3 text-center whitespace-nowrap`}
                >
                  {phase.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-sm">
            {students.length > 0 ? (
              students.map((student) => (
                <tr key={student.student_id} className="hover:bg-gray-50/80">
                  <td
                    className="sticky left-0 z-20 bg-white px-4 py-2.5 font-medium text-gray-900"
                    style={{ minWidth: '160px', maxWidth: '220px' }}
                    title={student.full_name}
                  >
                    <span className="block truncate">{student.full_name}</span>
                  </td>
                  {phases.map((phase) => (
                    <td key={`${student.student_id}-${phase.key}`} className="px-3 py-2.5 text-center">
                      <CellBadge cell={student.phases?.[phase.key]} />
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={phases.length + 1} className="px-4 py-8 text-center text-sm text-gray-500">
                  No students with enrollments in this scope.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default StudentPhaseEnrollmentMatrixChart;
