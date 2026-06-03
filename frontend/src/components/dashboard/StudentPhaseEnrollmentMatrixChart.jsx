import { useMemo, useState } from 'react';
import {
  sortMatrixStudentsByEnrollmentDate,
  toggleEnrollmentDateSort,
  matrixTrackDisplayName,
} from '../../utils/enrollmentMatrixSort';
import EnrollmentMatrixCellBadge from './EnrollmentMatrixCellBadge';
import EnrollmentMatrixStatusLegend from './EnrollmentMatrixStatusLegend';
import EnrollmentMatrixStudentColumnHeader, {
  enrollmentMatrixStudentNameTitle,
} from './EnrollmentMatrixStudentColumnHeader';

/**
 * Student × phase enrollment matrix.
 */
const StudentPhaseEnrollmentMatrixChart = ({ matrix, className = '' }) => {
  const [studentSortDirection, setStudentSortDirection] = useState('asc');
  const phases = matrix?.phases ?? [];
  const students = useMemo(
    () => sortMatrixStudentsByEnrollmentDate(matrix?.students ?? [], studentSortDirection),
    [matrix?.students, studentSortDirection]
  );
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
    <div className={`space-y-3 ${className}`}>
      <EnrollmentMatrixStatusLegend />

      <div
        className="overflow-x-auto overflow-y-auto rounded-lg border border-gray-200"
        style={{
          maxHeight: '720px',
          scrollbarWidth: 'thin',
          scrollbarColor: '#cbd5e0 #f7fafc',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        <table style={{ width: '100%', minWidth: `${Math.max(520, 200 + phases.length * 88)}px` }}>
          <thead>
            {showPhaseRateHeader && (
              <tr className="border-b border-gray-200 bg-amber-50 text-left text-xs font-semibold tracking-wide text-gray-700">
                <th
                  className="sticky left-0 top-0 z-50 h-11 bg-amber-50 px-4 py-2.5"
                  style={{ minWidth: '200px' }}
                >
                  Re-enrollment rate
                </th>
                {phaseStats.map((row) => (
                  <th
                    key={`stat-top-${row.phase_number}`}
                    className="sticky top-0 z-40 h-11 bg-amber-50 px-3 py-2.5 text-center whitespace-nowrap"
                  >
                    {row.has_prior_phase && row.prior_phase_enrolled_count > 0 ? (
                      <>
                        <div className="text-[11px] font-semibold tabular-nums text-gray-900">
                          {row.re_enrolled_count}/{row.prior_phase_enrolled_count}
                        </div>
                        <div className="text-[11px] tabular-nums text-amber-800">
                          {Number(row.re_enrollment_rate ?? 0).toFixed(0)}%
                        </div>
                      </>
                    ) : (
                      <div className="text-[11px] tabular-nums text-gray-500">—</div>
                    )}
                  </th>
                ))}
              </tr>
            )}

            <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
              <th
                className={`sticky left-0 ${showPhaseRateHeader ? 'top-11' : 'top-0'} z-40 bg-gray-50 px-4 py-3`}
                style={{ minWidth: '160px' }}
              >
                <EnrollmentMatrixStudentColumnHeader
                  sortDirection={studentSortDirection}
                  onToggleSort={() => setStudentSortDirection(toggleEnrollmentDateSort)}
                />
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
                <tr key={student.enrollment_track_key || `${student.student_id}-${student.class_id}`} className="hover:bg-gray-50/80">
                  <td
                    className="sticky left-0 z-20 bg-white px-4 py-2.5 font-medium text-gray-900"
                    style={{ minWidth: '200px', maxWidth: '280px' }}
                    title={enrollmentMatrixStudentNameTitle(student)}
                  >
                    <span className="block truncate">{matrixTrackDisplayName(student)}</span>
                  </td>
                  {phases.map((phase) => (
                    <td key={`${student.enrollment_track_key || student.student_id}-${phase.key}`} className="px-3 py-2.5 text-center">
                      <EnrollmentMatrixCellBadge cell={student.phases?.[phase.key]} />
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
