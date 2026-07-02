import { useMemo, useState } from 'react';
import { ATTENDANCE_DASHBOARD } from '../../constants/dashboardDescriptions';

const tableScrollStyle = {
  scrollbarWidth: 'thin',
  scrollbarColor: '#cbd5e0 #f7fafc',
  WebkitOverflowScrolling: 'touch',
};

const formatNumber = (value) => (Number(value) || 0).toLocaleString('en-PH');
const formatRate = (value) => (value == null || Number.isNaN(Number(value)) ? '—' : `${Number(value).toFixed(1)}%`);

const SUMMARY_TABS = [
  { id: 'teacher', label: 'By teacher' },
  { id: 'program', label: 'By program' },
  { id: 'class', label: 'By class' },
];

const RateCell = ({ value, tone = 'neutral' }) => {
  const toneClass =
    tone === 'present'
      ? 'text-green-700'
      : tone === 'absent'
        ? 'text-red-700'
        : 'text-gray-900';

  return <span className={`font-semibold tabular-nums ${toneClass}`}>{formatRate(value)}</span>;
};

const AttendanceRateSummarySection = ({
  mode = 'daily',
  rateSummaries = null,
  loading = false,
}) => {
  const [activeTab, setActiveTab] = useState('teacher');

  const rows = useMemo(() => {
    if (!rateSummaries) return [];
    if (activeTab === 'program') return rateSummaries.by_program || [];
    if (activeTab === 'class') return rateSummaries.by_class || [];
    return rateSummaries.by_teacher || [];
  }, [activeTab, rateSummaries]);

  const periodLabel = mode === 'monthly' ? 'month' : 'day';

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-100 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-gray-900">Attendance rate summary</h2>
          <p className="mt-1 text-sm text-gray-500">
            {mode === 'monthly'
              ? ATTENDANCE_DASHBOARD.monthlyRateSummaryIntro
              : ATTENDANCE_DASHBOARD.dailyRateSummaryIntro}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {SUMMARY_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                activeTab === tab.id
                  ? 'bg-[#F7C844] text-gray-900 shadow-sm'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="mt-5 flex min-h-[160px] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#F7C844] border-t-transparent" />
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
          No attendance marks recorded for this {periodLabel} in the selected scope.
        </div>
      ) : (
        <div className="mt-5 overflow-x-auto rounded-lg" style={tableScrollStyle}>
          <table style={{ width: '100%', minWidth: activeTab === 'class' ? '980px' : '760px' }}>
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                {activeTab === 'teacher' ? (
                  <th className="px-3 py-3">Teacher</th>
                ) : null}
                {activeTab === 'program' ? (
                  <th className="px-3 py-3">Program</th>
                ) : null}
                {activeTab === 'class' ? (
                  <>
                    <th className="px-3 py-3">Class</th>
                    <th className="px-3 py-3">Program</th>
                    <th className="px-3 py-3">Teacher</th>
                  </>
                ) : null}
                <th className="px-3 py-3 text-right">Total marks</th>
                <th className="px-3 py-3 text-right">Present</th>
                <th className="px-3 py-3 text-right">Present rate</th>
                <th className="px-3 py-3 text-right">Absent</th>
                <th className="px-3 py-3 text-right">Absences rate</th>
                <th className="px-3 py-3 text-right">Late</th>
                <th className="px-3 py-3 text-right">Excused</th>
                <th className="px-3 py-3 text-right">Leave early</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-sm text-gray-700">
              {rows.map((row) => {
                const rowKey =
                  activeTab === 'teacher'
                    ? `teacher-${row.teacher_id ?? row.teacher_name}`
                    : activeTab === 'program'
                      ? `program-${row.program_id ?? row.program_name}`
                      : `class-${row.class_id}`;

                return (
                  <tr key={rowKey} className="hover:bg-gray-50/80">
                    {activeTab === 'teacher' ? (
                      <td className="px-3 py-3 font-medium text-gray-900">{row.teacher_name}</td>
                    ) : null}
                    {activeTab === 'program' ? (
                      <td className="px-3 py-3 font-medium text-gray-900">{row.program_name}</td>
                    ) : null}
                    {activeTab === 'class' ? (
                      <>
                        <td className="px-3 py-3 font-medium text-gray-900">{row.class_name}</td>
                        <td className="px-3 py-3 text-gray-600">{row.program_name}</td>
                        <td className="px-3 py-3 text-gray-600">{row.teacher_name}</td>
                      </>
                    ) : null}
                    <td className="px-3 py-3 text-right tabular-nums">{formatNumber(row.total_marks)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-green-700">
                      {formatNumber(row.present_count)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <RateCell value={row.present_rate} tone="present" />
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-red-700">
                      {formatNumber(row.absent_count)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <RateCell value={row.absent_rate} tone="absent" />
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatNumber(row.late_count)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatNumber(row.excused_count)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatNumber(row.leave_early_count)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

export default AttendanceRateSummarySection;
