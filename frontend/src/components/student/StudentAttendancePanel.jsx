import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../config/api';
import { formatDateManila } from '../../utils/dateUtils';

const tableScrollStyle = {
  scrollbarWidth: 'thin',
  scrollbarColor: '#cbd5e0 #f7fafc',
  WebkitOverflowScrolling: 'touch',
};

const formatSessionTime = (timeString) => {
  if (!timeString) return '—';
  const [hours, minutes] = String(timeString).split(':');
  const hour = parseInt(hours, 10);
  if (Number.isNaN(hour)) return timeString;
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  const minutesFormatted = (minutes || '00').padStart(2, '0');
  return `${hour12}:${minutesFormatted} ${ampm}`;
};

const ATTENDANCE_STATUS_STYLES = {
  Present: 'bg-green-100 text-green-800 border-green-200',
  Absent: 'bg-red-100 text-red-800 border-red-200',
  Late: 'bg-amber-100 text-amber-800 border-amber-200',
  Excused: 'bg-blue-100 text-blue-800 border-blue-200',
  'Leave Early': 'bg-purple-100 text-purple-800 border-purple-200',
};

const SummaryPill = ({ label, value, accent = 'text-gray-900' }) => (
  <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 sm:px-4 sm:py-3">
    <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</p>
    <p className={`mt-0.5 text-lg font-semibold ${accent}`}>{value}</p>
  </div>
);

/**
 * Read-only attendance history for one student (Student History modal).
 * Uses GET /attendance/student/:id — same session eligibility as class attendance.
 */
const StudentAttendancePanel = ({ studentId, classRows = [] }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [data, setData] = useState(null);

  const classOptions = useMemo(() => {
    const seen = new Map();
    (classRows || []).forEach((row) => {
      if (row?.class_id == null || seen.has(row.class_id)) return;
      const label = [row.program_name, row.class_name || row.level_tag].filter(Boolean).join(' — ');
      seen.set(row.class_id, label || `Class ${row.class_id}`);
    });
    return [...seen.entries()].map(([value, label]) => ({ value: String(value), label }));
  }, [classRows]);

  const fetchAttendance = useCallback(async () => {
    if (!studentId) return;
    setLoading(true);
    setError('');
    try {
      const qs = classFilter ? `?class_id=${encodeURIComponent(classFilter)}` : '';
      const res = await apiRequest(`/attendance/student/${studentId}${qs}`);
      setData(res?.data || null);
    } catch (err) {
      console.error('Student attendance fetch failed:', err);
      setError(err?.message || 'Failed to load attendance records.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [studentId, classFilter]);

  useEffect(() => {
    fetchAttendance();
  }, [fetchAttendance]);

  const summary = data?.summary;
  const records = data?.records ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900">Attendance history</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            Sessions where this student was enrolled in the matching phase — same data as class
            attendance.
          </p>
        </div>
        {classOptions.length > 0 && (
          <label className="inline-flex w-full flex-col gap-1 sm:w-auto sm:min-w-[220px] sm:max-w-[320px]">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Filter by class
            </span>
            <select
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
              disabled={loading}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-[#F7C844] focus:outline-none focus:ring-2 focus:ring-[#F7C844]/40"
            >
              <option value="">All enrolled classes</option>
              {classOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#F7C844] border-t-transparent" />
        </div>
      )}

      {!loading && error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && !error && summary && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <SummaryPill label="Sessions" value={summary.total_sessions ?? 0} />
          <SummaryPill label="Marked" value={summary.marked ?? 0} />
          <SummaryPill label="Not marked" value={summary.not_marked ?? 0} accent="text-gray-600" />
          <SummaryPill label="Present" value={summary.Present ?? 0} accent="text-green-700" />
          <SummaryPill label="Absent" value={summary.Absent ?? 0} accent="text-red-700" />
          <SummaryPill
            label="Late / Excused / Left"
            value={
              (summary.Late ?? 0) + (summary.Excused ?? 0) + (summary['Leave Early'] ?? 0)
            }
            accent="text-amber-700"
          />
        </div>
      )}

      {!loading && !error && records.length === 0 && (
        <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50/80 py-12 text-center text-sm text-gray-500">
          No class sessions found for this student&apos;s enrollments.
        </p>
      )}

      {!loading && !error && records.length > 0 && (
        <div
          className="overflow-x-auto rounded-lg border border-gray-200"
          style={tableScrollStyle}
        >
          <table className="divide-y divide-gray-200" style={{ width: '100%', minWidth: '980px' }}>
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Date
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Time
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Class
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Phase / Session
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Topic
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Status
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Notes
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Marked by
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white text-sm">
              {records.map((row) => {
                const s = row.session || {};
                const status = row.status;
                const statusClass = status
                  ? ATTENDANCE_STATUS_STYLES[status] || 'bg-gray-100 text-gray-700 border-gray-200'
                  : 'bg-gray-50 text-gray-500 border-gray-200';
                const rowKey = `${s.classsession_id}-${row.attendance_id ?? 'none'}`;

                return (
                  <tr key={rowKey} className="hover:bg-gray-50/80">
                    <td className="whitespace-nowrap px-3 py-2.5 text-gray-900">
                      {s.scheduled_date ? formatDateManila(s.scheduled_date) : '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-gray-700">
                      {s.scheduled_start_time && s.scheduled_end_time
                        ? `${formatSessionTime(s.scheduled_start_time)} – ${formatSessionTime(s.scheduled_end_time)}`
                        : s.scheduled_start_time
                          ? formatSessionTime(s.scheduled_start_time)
                          : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-gray-900">
                      <span className="font-medium">{s.class_name || s.level_tag || '—'}</span>
                      {s.program_name ? (
                        <span className="mt-0.5 block text-xs text-gray-500">{s.program_name}</span>
                      ) : null}
                      {s.class_code ? (
                        <span className="mt-0.5 block text-xs text-gray-400">{s.class_code}</span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-gray-900">
                      {s.phase_number != null && s.phase_session_number != null
                        ? `Phase ${s.phase_number} · Session ${s.phase_session_number}`
                        : '—'}
                    </td>
                    <td className="max-w-[200px] px-3 py-2.5 text-gray-700">
                      <span className="line-clamp-2" title={s.topic || undefined}>
                        {s.topic || '—'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <span
                        className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${statusClass}`}
                      >
                        {status || 'Not marked'}
                      </span>
                    </td>
                    <td className="max-w-[180px] px-3 py-2.5 text-gray-600">
                      <span className="line-clamp-2" title={row.notes || undefined}>
                        {row.notes || '—'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-gray-600">
                      {row.marked_by_name || '—'}
                      {row.marked_at ? (
                        <span className="mt-0.5 block text-xs text-gray-400">
                          {formatDateManila(row.marked_at)}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default StudentAttendancePanel;
