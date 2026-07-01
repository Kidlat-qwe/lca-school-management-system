import { useEffect, useMemo, useState } from 'react';
import {
  filterPhaseMatrixStudentsByStatus,
  hasMatrixStatusFilters,
  resolveMatrixCellForStatusFilter,
  sortMatrixStudentsByEnrollmentDate,
  sortPhaseMatrixStudentsByStatus,
} from '../../utils/enrollmentMatrixSort';
import { useEnrollmentMatrixStudentHistory } from '../../utils/enrollmentMatrixStudentHistory';
import { computeMatrixColumnSequences } from '../../utils/enrollmentMatrixStatusSequence';
import EnrollmentMatrixCellBadge from './EnrollmentMatrixCellBadge';
import EnrollmentMatrixStatusLegend from './EnrollmentMatrixStatusLegend';
import EnrollmentMatrixStudentColumnHeader from './EnrollmentMatrixStudentColumnHeader';
import EnrollmentMatrixStudentNameCell from './EnrollmentMatrixStudentNameCell';
import MatrixInfoTooltip from './MatrixInfoTooltip';
import ReEnrollmentRateMatrixCell from './ReEnrollmentRateMatrixCell';
import StudentHistoryModal from '../student/StudentHistoryModal';
import { PHASE_ENROLLMENT_DASHBOARD } from '../../constants/dashboardDescriptions';
import { formatReEnrollmentRateRowHeaderTooltip } from '../../utils/enrollmentMatrixRateTooltip';

const RATE_HEADER_HEIGHT_PX = 44;
const COLUMN_HEADER_HEIGHT_PX = 44;
/** Viewport cap so tbody scrolls inside the table and thead sticky rows stay visible. */
const MATRIX_TABLE_MAX_HEIGHT = 'calc(100vh - 14rem)';

const matrixTableScrollStyle = {
  maxHeight: MATRIX_TABLE_MAX_HEIGHT,
  scrollbarWidth: 'thin',
  scrollbarColor: '#cbd5e0 #f7fafc',
  WebkitOverflowScrolling: 'touch',
};

/**
 * Student × phase enrollment matrix.
 */
const StudentPhaseEnrollmentMatrixChart = ({ matrix, className = '' }) => {
  const [studentSortMode, setStudentSortMode] = useState('status');
  const [studentSortDirection, setStudentSortDirection] = useState('asc');
  const [statusFilters, setStatusFilters] = useState([]);
  const { historyStudent, isHistoryOpen, openHistory, closeHistory } =
    useEnrollmentMatrixStudentHistory();
  const phases = matrix?.phases ?? [];
  const students = useMemo(() => {
    const rows = matrix?.students ?? [];
    const filtered = filterPhaseMatrixStudentsByStatus(rows, phases, statusFilters);
    if (studentSortMode === 'enrollment_date') {
      return sortMatrixStudentsByEnrollmentDate(filtered, studentSortDirection);
    }
    return sortPhaseMatrixStudentsByStatus(filtered, phases);
  }, [matrix?.students, phases, statusFilters, studentSortMode, studentSortDirection]);

  useEffect(() => {
    setStatusFilters([]);
  }, [phases.length]);

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
    () =>
      computeMatrixColumnSequences(
        students,
        phases,
        hasMatrixStatusFilters(statusFilters)
          ? (student, phaseKey) =>
              resolveMatrixCellForStatusFilter(student.phases?.[phaseKey], statusFilters)
          : (student, phaseKey) => student.phases?.[phaseKey]
      ),
    [students, phases, statusFilters]
  );
  const phaseStats = matrix?.phase_stats ?? [];
  const cohortSize = students.length;
  const showPhaseRateHeader = cohortSize > 0 && phaseStats.length > 0;
  const columnHeaderTop = showPhaseRateHeader ? RATE_HEADER_HEIGHT_PX : 0;

  if (!phases.length) {
    return (
      <div className={`flex h-72 items-center justify-center text-sm text-gray-500 ${className}`}>
        No enrollment data for the selected scope.
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${className}`}>
      <EnrollmentMatrixStatusLegend
        activeStatusFilters={statusFilters}
        onStatusFilterChange={setStatusFilters}
      />

      <div
        className="relative isolate overflow-x-auto overflow-y-auto rounded-lg border border-gray-200 bg-white"
        style={matrixTableScrollStyle}
      >
        <table
          className="border-separate border-spacing-0"
          style={{ width: '100%', minWidth: `${Math.max(520, 200 + phases.length * 88)}px` }}
        >
          <thead className="[&_th]:align-middle">
            {showPhaseRateHeader && (
              <tr className="text-left text-xs font-semibold tracking-wide text-gray-700">
                <th
                  className="sticky left-0 top-0 z-[70] border-b border-gray-200 bg-amber-50 px-4 py-2.5 shadow-[2px_0_4px_rgba(0,0,0,0.08)]"
                  style={{ minWidth: '200px', height: RATE_HEADER_HEIGHT_PX }}
                >
                  <span className="inline-flex items-center gap-0.5">
                    Re-enrollment rate
                    <MatrixInfoTooltip label="How re-enrollment rate is calculated">
                      {formatReEnrollmentRateRowHeaderTooltip('phase')}
                    </MatrixInfoTooltip>
                  </span>
                </th>
                {phaseStats.map((row) => (
                  <th
                    key={`stat-top-${row.phase_number}`}
                    className="sticky top-0 z-[60] border-b border-gray-200 bg-amber-50 px-3 py-2.5 text-center whitespace-nowrap"
                    style={{ height: RATE_HEADER_HEIGHT_PX }}
                  >
                    <ReEnrollmentRateMatrixCell row={row} />
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
                  focusPeriodLabel="latest phase"
                  onToggleSort={handleToggleStudentSort}
                />
              </th>
              {phases.map((phase) => (
                <th
                  key={phase.key}
                  className="sticky z-[55] border-b-2 border-gray-300 bg-gray-50 px-3 py-3 text-center whitespace-nowrap shadow-[0_2px_4px_rgba(0,0,0,0.04)]"
                  style={{ top: columnHeaderTop, height: COLUMN_HEADER_HEIGHT_PX }}
                >
                  {phase.label}
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
                    {phases.map((phase) => {
                      const rawCell = student.phases?.[phase.key];
                      const displayCell = resolveMatrixCellForStatusFilter(rawCell, statusFilters);
                      return (
                      <td
                        key={`${trackKey}-${phase.key}`}
                        className="bg-white px-3 py-2.5 text-center group-hover:bg-gray-50"
                      >
                        <EnrollmentMatrixCellBadge
                          cell={displayCell}
                          sequence={statusSequences[phase.key]}
                          periodKey={phase.key}
                        />
                      </td>
                      );
                    })}
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={phases.length + 1} className="px-4 py-8 text-center text-sm text-gray-500">
                  {hasMatrixStatusFilters(statusFilters)
                    ? 'No students have the selected status in this matrix. Click the status again or use Clear filter.'
                    : 'No students with enrollments in this scope.'}
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

export default StudentPhaseEnrollmentMatrixChart;
