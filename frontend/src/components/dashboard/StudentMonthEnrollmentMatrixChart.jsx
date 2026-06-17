import { useMemo, useState } from 'react';
import { MONTHLY_ENROLLMENT_DASHBOARD } from '../../constants/dashboardDescriptions';
import {
  sortMatrixStudentsByEnrollmentDate,
  sortMonthMatrixStudentsByStatus,
} from '../../utils/enrollmentMatrixSort';
import { useEnrollmentMatrixStudentHistory } from '../../utils/enrollmentMatrixStudentHistory';
import { computeMonthMatrixColumnSequences } from '../../utils/enrollmentMatrixStatusSequence';
import EnrollmentMatrixCellBadge from './EnrollmentMatrixCellBadge';
import EnrollmentMatrixStatusLegend from './EnrollmentMatrixStatusLegend';
import EnrollmentMatrixStudentColumnHeader from './EnrollmentMatrixStudentColumnHeader';
import EnrollmentMatrixStudentNameCell from './EnrollmentMatrixStudentNameCell';
import MatrixInfoTooltip from './MatrixInfoTooltip';
import StudentHistoryModal from '../student/StudentHistoryModal';

const RATE_HEADER_HEIGHT_PX = 44;
const COLUMN_HEADER_HEIGHT_PX = 44;

/**
 * Student × month enrollment matrix (Jan–Dec for selected year).
 */
const StudentMonthEnrollmentMatrixChart = ({ matrix, displayYear, className = '' }) => {
  const [studentSortMode, setStudentSortMode] = useState('status');
  const [studentSortDirection, setStudentSortDirection] = useState('asc');
  const { historyStudent, isHistoryOpen, openHistory, closeHistory } =
    useEnrollmentMatrixStudentHistory();
  const months = matrix?.months ?? [];
  const students = useMemo(() => {
    const rows = matrix?.students ?? [];
    if (studentSortMode === 'enrollment_date') {
      return sortMatrixStudentsByEnrollmentDate(rows, studentSortDirection);
    }
    return sortMonthMatrixStudentsByStatus(rows, months, displayYear);
  }, [matrix?.students, months, displayYear, studentSortMode, studentSortDirection]);

  const handleToggleStudentSort = () => {
    if (studentSortMode === 'status') {
      setStudentSortMode('enrollment_date');
      setStudentSortDirection('asc');
      return;
    }
    if (studentSortDirection === 'asc') {
      setStudentSortDirection('desc');
      return;
    }
    setStudentSortMode('status');
    setStudentSortDirection('asc');
  };
  const statusSequencesByTrack = useMemo(
    () => computeMonthMatrixColumnSequences(students, months),
    [students, months]
  );
  const monthStats = matrix?.month_stats ?? [];
  const cohortSize = students.length;
  const showRateHeader = cohortSize > 0 && monthStats.length > 0;
  const columnHeaderTop = showRateHeader ? RATE_HEADER_HEIGHT_PX : 0;

  if (!months.length) {
    return (
      <div className={`flex h-72 items-center justify-center text-sm text-gray-500 ${className}`}>
        No monthly enrollment data for the selected scope.
      </div>
    );
  }

  const tooltipText = MONTHLY_ENROLLMENT_DASHBOARD.matrixTitleTooltip(displayYear || '');

  return (
    <div className={`space-y-4 ${className}`}>
      <p className="text-xs text-gray-500">
        {MONTHLY_ENROLLMENT_DASHBOARD.matrixLegend}
        <MatrixInfoTooltip label="Monthly matrix guide">
          {tooltipText}
        </MatrixInfoTooltip>
      </p>

      <EnrollmentMatrixStatusLegend />

      {/* Horizontal scroll only — full table height flows with the page (no inner vertical scrollbar). */}
      <div
        className="relative isolate overflow-x-auto rounded-lg border border-gray-200 bg-white"
        style={{
          scrollbarWidth: 'thin',
          scrollbarColor: '#cbd5e0 #f7fafc',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        <table
          className="border-separate border-spacing-0"
          style={{ width: '100%', minWidth: `${Math.max(680, 200 + months.length * 88)}px` }}
        >
          <thead className="[&_th]:align-middle">
            {showRateHeader && (
              <tr className="text-left text-xs font-semibold tracking-wide text-gray-700">
                <th
                  className="sticky left-0 top-0 z-[70] border-b border-gray-200 bg-amber-50 px-4 py-2.5 shadow-[2px_0_4px_rgba(0,0,0,0.08)]"
                  style={{ minWidth: '200px', height: RATE_HEADER_HEIGHT_PX }}
                >
                  Re-enrollment rate
                </th>
                {monthStats.map((row) => (
                  <th
                    key={`stat-${row.month_key}`}
                    className="sticky top-0 z-[60] border-b border-gray-200 bg-amber-50 px-3 py-2.5 text-center whitespace-nowrap"
                    style={{ height: RATE_HEADER_HEIGHT_PX }}
                  >
                    {row.has_prior_month && row.prior_month_enrolled_count > 0 ? (
                      <>
                        <div className="text-[11px] font-semibold tabular-nums text-gray-900">
                          {row.re_enrolled_count}/{row.prior_month_enrolled_count}
                        </div>
                        <div className="text-[11px] tabular-nums text-amber-800">
                          {Number(row.re_enrollment_rate ?? 0).toFixed(2)}%
                        </div>
                      </>
                    ) : row.has_prior_month && Number(row.re_enrolled_count) > 0 ? (
                      <div className="text-[11px] font-semibold tabular-nums text-gray-900">
                        {row.re_enrolled_count}/—
                      </div>
                    ) : (
                      <div className="text-[11px] tabular-nums text-gray-500">—</div>
                    )}
                  </th>
                ))}
              </tr>
            )}

            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
              <th
                className="sticky left-0 z-[65] border-b-2 border-gray-300 bg-gray-50 px-4 py-3 shadow-[2px_2px_4px_rgba(0,0,0,0.06)]"
                style={{
                  minWidth: '200px',
                  top: columnHeaderTop,
                  height: COLUMN_HEADER_HEIGHT_PX,
                }}
              >
                <EnrollmentMatrixStudentColumnHeader
                  sortMode={studentSortMode}
                  sortDirection={studentSortDirection}
                  onToggleSort={handleToggleStudentSort}
                />
              </th>
              {months.map((m) => (
                <th
                  key={m.key}
                  className="sticky z-[55] border-b-2 border-gray-300 bg-gray-50 px-3 py-3 text-center whitespace-nowrap shadow-[0_2px_4px_rgba(0,0,0,0.04)]"
                  style={{ top: columnHeaderTop, height: COLUMN_HEADER_HEIGHT_PX }}
                >
                  {m.label}
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-100 text-sm">
            {students.length > 0 ? (
              students.map((student) => {
                const trackKey =
                  student.enrollment_track_key || `${student.student_id}-${student.class_id}`;
                const statusSequences = statusSequencesByTrack[trackKey] || {};

                return (
                  <tr key={trackKey} className="group bg-white hover:bg-gray-50">
                    <td
                      className="sticky left-0 z-[1] bg-white px-4 py-2.5 shadow-[2px_0_4px_rgba(0,0,0,0.04)] group-hover:bg-gray-50"
                      style={{ minWidth: '200px', maxWidth: '280px' }}
                    >
                      <EnrollmentMatrixStudentNameCell track={student} onOpenHistory={openHistory} />
                    </td>
                    {months.map((m) => (
                      <td
                        key={`${trackKey}-${m.key}`}
                        className="bg-white px-3 py-2.5 text-center group-hover:bg-gray-50"
                      >
                        <EnrollmentMatrixCellBadge
                          cell={student.months?.[m.key]}
                          sequence={statusSequences[m.key]}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })
            ) : (
              <tr>
                <td
                  colSpan={months.length + 1}
                  className="px-4 py-8 text-center text-sm text-gray-500"
                >
                  No students with monthly enrollment data in this scope.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <StudentHistoryModal isOpen={isHistoryOpen} student={historyStudent} onClose={closeHistory} />
    </div>
  );
};

export default StudentMonthEnrollmentMatrixChart;
