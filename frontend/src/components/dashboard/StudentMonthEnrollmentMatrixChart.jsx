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
import MatrixInfoTooltip from './MatrixInfoTooltip';

const RATE_HEADER_HEIGHT_PX = 44;
const COLUMN_HEADER_HEIGHT_PX = 44;

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
      {label ? (
        <span className="text-[10px] leading-3 text-gray-500">{label}</span>
      ) : null}
    </div>
  );
};

/**
 * Student × month enrollment matrix (Jan–Dec for selected year).
 */
const StudentMonthEnrollmentMatrixChart = ({ matrix, displayYear, className = '' }) => {
  const months = matrix?.months ?? [];
  const students = matrix?.students ?? [];
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

  const chartData = monthStats.map((row) => ({
    month: row.month,
    enrollment_rate: row.enrollment_rate,
    enrolled_count: row.enrolled_count,
    student_count: row.student_count,
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
          style={{ width: '100%', minWidth: `${Math.max(640, 160 + months.length * 88)}px` }}
        >
          <thead className="[&_th]:align-middle">
            {showRateHeader && (
              <tr className="text-left text-xs font-semibold tracking-wide text-gray-700">
                <th
                  className="sticky left-0 top-0 z-[70] border-b border-gray-200 bg-amber-50 px-4 py-2.5 shadow-[2px_0_4px_rgba(0,0,0,0.08)]"
                  style={{ minWidth: '160px', height: RATE_HEADER_HEIGHT_PX }}
                >
                  Month rate
                </th>
                {monthStats.map((row) => (
                  <th
                    key={`stat-${row.month_key}`}
                    className="sticky top-0 z-[60] border-b border-gray-200 bg-amber-50 px-3 py-2.5 text-center whitespace-nowrap"
                    style={{ height: RATE_HEADER_HEIGHT_PX }}
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

            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
              <th
                className="sticky left-0 z-[65] border-b-2 border-gray-300 bg-gray-50 px-4 py-3 shadow-[2px_2px_4px_rgba(0,0,0,0.06)]"
                style={{
                  minWidth: '160px',
                  top: columnHeaderTop,
                  height: COLUMN_HEADER_HEIGHT_PX,
                }}
              >
                Student
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
                <tr key={student.student_id} className="group bg-white hover:bg-gray-50">
                  <td
                    className="sticky left-0 z-[1] bg-white px-4 py-2.5 font-medium text-gray-900 shadow-[2px_0_4px_rgba(0,0,0,0.04)] group-hover:bg-gray-50"
                    style={{ minWidth: '160px', maxWidth: '220px' }}
                    title={student.full_name}
                  >
                    <span className="block truncate">{student.full_name}</span>
                  </td>
                  {months.map((m) => (
                    <td key={`${student.student_id}-${m.key}`} className="bg-white px-3 py-2.5 text-center group-hover:bg-gray-50">
                      <CellBadge cell={student.months?.[m.key]} />
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
                if (name === 'Enrollment rate') {
                  const row = props?.payload;
                  return [
                    `${Number(value).toFixed(2)}% (${Number(row?.enrolled_count || 0).toLocaleString()} / ${Number(row?.student_count || 0).toLocaleString()})`,
                    name,
                  ];
                }
                return [value, name];
              }}
            />
            <Bar dataKey="enrollment_rate" name="Enrollment rate" fill="#4F46E5" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default StudentMonthEnrollmentMatrixChart;
