import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../config/api';
import { formatDateManila } from '../../utils/dateUtils';
import {
  ATTENDANCE_MATRIX_LEGEND,
  getAttendanceMatrixSymbol,
} from '../../utils/attendanceMatrixDisplay';

const tableScrollStyle = {
  scrollbarWidth: 'thin',
  scrollbarColor: '#cbd5e0 #f7fafc',
  WebkitOverflowScrolling: 'touch',
};

const formatShortSessionDate = (dateStr) => {
  if (!dateStr) return '—';
  const parts = String(dateStr).split('-');
  if (parts.length !== 3) return dateStr;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[parseInt(parts[1], 10) - 1] || parts[1];
  return `${month} ${parseInt(parts[2], 10)}`;
};

const SummaryPill = ({ label, value, accent = 'text-gray-900' }) => (
  <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 sm:px-4 sm:py-2.5">
    <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500 sm:text-[11px]">
      {label}
    </p>
    <p className={`mt-0.5 text-base font-semibold sm:text-lg ${accent}`}>{value}</p>
  </div>
);

/**
 * Phase attendance matrix for class details (students × sessions + totals).
 */
export default function ClassPhaseAttendanceSummaryModal({
  open,
  onClose,
  classId,
  phaseNumber,
  classTitle = '',
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!open || classId == null || phaseNumber == null) return undefined;
    let cancelled = false;
    setLoading(true);
    setError('');
    setData(null);

    apiRequest(`/attendance/class/${classId}/phase/${phaseNumber}/summary`)
      .then((res) => {
        if (!cancelled) setData(res?.data || null);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err?.message || 'Failed to load attendance summary.');
          setData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, classId, phaseNumber]);

  const sessions = data?.sessions ?? [];
  const students = data?.students ?? [];
  const summary = data?.summary;

  const minTableWidth = useMemo(() => {
    const sessionCols = Math.max(sessions.length, 1) * 44;
    const totalCols = 5 * 52;
    return 220 + sessionCols + totalCols;
  }, [sessions.length]);

  if (!open) return null;

  const subtitle = [
    classTitle || data?.program_name || 'Class',
    `Phase ${phaseNumber ?? data?.phase_number ?? '—'}`,
  ].join(' · ');

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-2 sm:p-6">
      <button
        type="button"
        className="absolute inset-0 bg-black/50 backdrop-blur-[1px]"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="phase-attendance-summary-title"
        className="relative flex max-h-[min(92vh,900px)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-gray-200"
      >
        <div className="flex-shrink-0 border-b border-gray-100 px-4 py-4 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2
                id="phase-attendance-summary-title"
                className="text-lg font-semibold text-gray-900"
              >
                Attendance summary
              </h2>
              <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
              <p className="mt-1 text-xs text-gray-500">
                Students enrolled in this phase. Cancelled sessions are excluded.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex-shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100"
            >
              Close
            </button>
          </div>

          {summary && !loading && !error && (
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <SummaryPill label="Enrolled" value={data?.enrolled_students ?? 0} />
              <SummaryPill
                label="Sessions"
                value={`${summary.completed_sessions}/${summary.total_sessions}`}
                accent="text-indigo-700"
              />
              <SummaryPill
                label="Present rate"
                value={summary.attendance_rate != null ? `${summary.attendance_rate}%` : '—'}
                accent="text-green-700"
              />
              <SummaryPill label="Absent" value={summary.absent ?? 0} accent="text-red-700" />
              <SummaryPill label="Late" value={summary.late ?? 0} accent="text-amber-700" />
              <SummaryPill
                label="Not marked"
                value={summary.not_marked ?? 0}
                accent="text-gray-600"
              />
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            {ATTENDANCE_MATRIX_LEGEND.map((item) => (
              <div
                key={item.label}
                className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1"
              >
                <span
                  className={`inline-flex h-6 w-6 items-center justify-center rounded text-xs font-bold ${item.className}`}
                >
                  {item.symbol}
                </span>
                <span className="text-xs font-medium text-gray-700">{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6" style={tableScrollStyle}>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#F7C844] border-t-transparent" />
            </div>
          ) : error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : students.length === 0 ? (
            <p className="text-sm text-gray-500">No students enrolled in this phase.</p>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-gray-500">No sessions scheduled for this phase yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg ring-1 ring-gray-100" style={tableScrollStyle}>
              <table
                className="border-collapse text-xs sm:text-sm"
                style={{ width: '100%', minWidth: `${minTableWidth}px` }}
              >
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 text-left text-[10px] font-semibold uppercase tracking-wide text-gray-500 sm:text-xs">
                    <th
                      className="sticky left-0 z-20 min-w-[180px] border-r border-gray-200 bg-gray-50 px-3 py-2.5 sm:min-w-[220px]"
                      rowSpan={2}
                    >
                      Student
                    </th>
                    {sessions.map((session) => (
                      <th
                        key={session.classsession_id}
                        className="min-w-[40px] px-1 py-2 text-center"
                        title={[
                          session.topic,
                          session.scheduled_date
                            ? formatDateManila(session.scheduled_date)
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      >
                        S{session.display_session_number}
                      </th>
                    ))}
                    <th
                      className="border-l border-gray-200 px-2 py-2 text-center text-green-700"
                      rowSpan={2}
                    >
                      P
                    </th>
                    <th
                      className="px-2 py-2 text-center text-red-700"
                      rowSpan={2}
                    >
                      A
                    </th>
                    <th
                      className="px-2 py-2 text-center text-amber-700"
                      rowSpan={2}
                    >
                      L
                    </th>
                    <th
                      className="px-2 py-2 text-center text-blue-700"
                      rowSpan={2}
                    >
                      E
                    </th>
                    <th
                      className="px-2 py-2 text-center text-purple-700"
                      rowSpan={2}
                    >
                      LE
                    </th>
                  </tr>
                  <tr className="border-b border-gray-200 bg-gray-50 text-[10px] text-gray-500">
                    {sessions.map((session) => (
                      <th
                        key={`date-${session.classsession_id}`}
                        className="px-1 py-1 text-center font-normal"
                      >
                        {session.scheduled_date
                          ? formatShortSessionDate(session.scheduled_date)
                          : '—'}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {students.map((student) => (
                    <tr
                      key={student.student_id}
                      className="border-b border-gray-100 hover:bg-gray-50/80"
                    >
                      <td className="sticky left-0 z-10 border-r border-gray-100 bg-white px-3 py-2 font-medium text-gray-900">
                        {student.full_name}
                      </td>
                      {sessions.map((session) => {
                        const cell = student.sessions?.[String(session.classsession_id)];
                        const display = getAttendanceMatrixSymbol(cell?.status || null);
                        return (
                          <td
                            key={`${student.student_id}-${session.classsession_id}`}
                            className="px-1 py-2 text-center"
                            title={
                              cell?.status
                                ? `${cell.status}${cell.notes ? ` — ${cell.notes}` : ''}`
                                : 'Not marked'
                            }
                          >
                            <span
                              className={`inline-flex h-7 w-7 items-center justify-center rounded font-bold ${display.className}`}
                            >
                              {display.symbol}
                            </span>
                          </td>
                        );
                      })}
                      <td className="border-l border-gray-100 px-2 py-2 text-center font-semibold text-green-700">
                        {student.totals?.Present ?? 0}
                      </td>
                      <td className="px-2 py-2 text-center font-semibold text-red-700">
                        {student.totals?.Absent ?? 0}
                      </td>
                      <td className="px-2 py-2 text-center font-semibold text-amber-700">
                        {student.totals?.Late ?? 0}
                      </td>
                      <td className="px-2 py-2 text-center font-semibold text-blue-700">
                        {student.totals?.Excused ?? 0}
                      </td>
                      <td className="px-2 py-2 text-center font-semibold text-purple-700">
                        {student.totals?.['Leave Early'] ?? 0}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
