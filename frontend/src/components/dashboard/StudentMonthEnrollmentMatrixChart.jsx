import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { MONTHLY_ENROLLMENT_DASHBOARD } from '../../constants/dashboardDescriptions';
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
import MatrixInfoTooltip from './MatrixInfoTooltip';

const RATE_HEADER_HEIGHT_PX = 44;
const COLUMN_HEADER_HEIGHT_PX = 44;

/**
 * Student × month enrollment matrix (Jan–Dec for selected year).
 */
const StudentMonthEnrollmentMatrixChart = ({ matrix, displayYear, className = '' }) => {
  const [studentSortDirection, setStudentSortDirection] = useState('asc');
  const months = matrix?.months ?? [];
  const students = useMemo(
    () => sortMatrixStudentsByEnrollmentDate(matrix?.students ?? [], studentSortDirection),
    [matrix?.students, studentSortDirection]
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

  const chartData = monthStats
    .filter((row) => row.has_prior_month && row.prior_month_enrolled_count > 0)
    .map((row) => ({
      month: row.month,
      re_enrollment_rate: row.re_enrollment_rate,
      re_enrolled_count: row.re_enrolled_count,
      prior_month_enrolled_count: row.prior_month_enrolled_count,
    }));

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

      {/* Scroll container: vertical scroll stays inside this box so sticky headers work */}
      <div
        className="relative isolate max-h-[min(720px,calc(100vh-14rem))] overflow-auto rounded-lg border border-gray-200 bg-white"
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
                          {Number(row.re_enrollment_rate ?? 0).toFixed(0)}%
                        </div>
                      </>
                    ) : row.has_prior_month ? (
                      <div className="text-[11px] tabular-nums text-gray-500">—</div>
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
                  sortDirection={studentSortDirection}
                  onToggleSort={() => setStudentSortDirection(toggleEnrollmentDateSort)}
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
              students.map((student) => (
                <tr key={student.enrollment_track_key || `${student.student_id}-${student.class_id}`} className="group bg-white hover:bg-gray-50">
                  <td
                    className="sticky left-0 z-[1] bg-white px-4 py-2.5 font-medium text-gray-900 shadow-[2px_0_4px_rgba(0,0,0,0.04)] group-hover:bg-gray-50"
                    style={{ minWidth: '200px', maxWidth: '280px' }}
                    title={enrollmentMatrixStudentNameTitle(student)}
                  >
                    <span className="block truncate">{matrixTrackDisplayName(student)}</span>
                  </td>
                  {months.map((m) => (
                    <td key={`${student.enrollment_track_key || student.student_id}-${m.key}`} className="bg-white px-3 py-2.5 text-center group-hover:bg-gray-50">
                      <EnrollmentMatrixCellBadge cell={student.months?.[m.key]} />
                    </td>
                  ))}
                </tr>
              ))
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

      <div className="h-56 w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="month" tick={{ fontSize: 10 }} interval={0} />
            <YAxis tick={{ fontSize: 12 }} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
            <Tooltip
              formatter={(value, name, props) => {
                if (name === 'Re-enrollment rate') {
                  const row = props?.payload;
                  return [
                    `${Number(value).toFixed(2)}% (${Number(row?.re_enrolled_count || 0).toLocaleString()} / ${Number(row?.prior_month_enrolled_count || 0).toLocaleString()})`,
                    name,
                  ];
                }
                return [value, name];
              }}
            />
            <Bar dataKey="re_enrollment_rate" name="Re-enrollment rate" fill="#4F46E5" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default StudentMonthEnrollmentMatrixChart;
