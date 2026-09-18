/**
 * Missed lesson plan log — overdue scheduled sessions without a submitted plan.
 * Headers always render, including when there is no data.
 */
import { formatLessonPlanDateDisplay } from '../../utils/lessonPlanPhaseSession';

function formatPhaseSession(row) {
  const phase = String(row.phase || '').trim();
  const session = String(row.session || '').trim();
  if (phase && session) return `${phase} · ${session}`;
  return phase || session || '—';
}

function PencilIcon({ className = 'h-5 w-5' }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
      />
    </svg>
  );
}

/**
 * @param {{
 *   rows?: object[],
 *   loading?: boolean,
 *   emptyMessage?: string,
 *   showingLabel?: string,
 *   showTeacher?: boolean,
 *   onCreate?: (row: object) => void,
 * }} props
 */
export default function LessonPlanMissedTable({
  rows = [],
  loading = false,
  emptyMessage = 'No missed lesson plans.',
  showingLabel = '',
  showTeacher = true,
  onCreate,
}) {
  const colCount = showTeacher ? (onCreate ? 8 : 7) : onCreate ? 7 : 6;
  const tableMinWidth = showTeacher ? '1180px' : '1020px';

  return (
    <div className="bg-white rounded-lg shadow">
      {showingLabel ? (
        <p className="px-4 pt-4 pb-2 text-sm text-gray-600">{showingLabel}</p>
      ) : null}

      <div
        className="overflow-x-auto rounded-lg"
        style={{
          scrollbarWidth: 'thin',
          scrollbarColor: '#cbd5e0 #f7fafc',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        <table
          className="divide-y divide-gray-200"
          style={{ width: '100%', minWidth: tableMinWidth }}
        >
          <thead className="bg-white">
            <tr>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Scheduled Date
              </th>
              {showTeacher ? (
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Teacher
                </th>
              ) : null}
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Topic
              </th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Class Code
              </th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Phase and Session
              </th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Grade Level
              </th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Days Overdue
              </th>
              {onCreate ? (
                <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Action
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody className="bg-[#ffffff] divide-y divide-gray-200">
            {loading ? (
              <tr>
                <td colSpan={colCount} className="px-6 py-12 text-center">
                  <p className="text-gray-500">Loading missed lesson plans...</p>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="px-6 py-12 text-center">
                  <p className="text-gray-500">{emptyMessage}</p>
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const classCode = row.class_code || row.class_label || '—';
                const phaseSession = formatPhaseSession(row);
                const days = Number(row.days_overdue) || 0;
                return (
                  <tr key={row.miss_key || `${row.classsession_id}-${row.teacher_user_id}`}>
                    <td className="px-3 py-4">
                      <div className="text-sm text-gray-900">
                        {row.scheduled_date || row.lesson_date
                          ? formatLessonPlanDateDisplay(row.scheduled_date || row.lesson_date)
                          : '—'}
                      </div>
                    </td>
                    {showTeacher ? (
                      <td className="px-3 py-4">
                        <div
                          className="truncate text-sm font-medium text-gray-900"
                          title={row.teacher_name || ''}
                        >
                          {row.teacher_name || '—'}
                        </div>
                      </td>
                    ) : null}
                    <td className="px-3 py-4">
                      <div
                        className="truncate text-sm text-gray-900"
                        title={row.topic || ''}
                      >
                        {row.topic || '—'}
                      </div>
                    </td>
                    <td className="px-3 py-4">
                      <div className="truncate text-sm text-gray-900" title={classCode}>
                        {classCode}
                      </div>
                    </td>
                    <td className="px-3 py-4">
                      <div
                        className="truncate text-sm text-gray-900"
                        title={phaseSession}
                      >
                        {phaseSession}
                      </div>
                    </td>
                    <td className="px-3 py-4">
                      <div className="text-sm text-gray-900">{row.grade_level || '—'}</div>
                    </td>
                    <td className="px-3 py-4">
                      <span className="inline-block rounded-full bg-red-100 px-2.5 py-1 text-xs font-bold text-red-800">
                        {days} day{days === 1 ? '' : 's'}
                      </span>
                    </td>
                    {onCreate ? (
                      <td className="px-3 py-4 text-right text-sm font-medium">
                        <button
                          type="button"
                          onClick={() => onCreate(row)}
                          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold text-amber-800 transition-colors hover:bg-amber-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F7C844]"
                          aria-label={`Create lesson plan for ${row.topic || phaseSession}`}
                          title="Create lesson plan"
                        >
                          <PencilIcon className="h-4 w-4" />
                          Create
                        </button>
                      </td>
                    ) : null}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
