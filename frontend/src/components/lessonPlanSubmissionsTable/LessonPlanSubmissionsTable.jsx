/**
 * Teacher / verifier lesson plan submissions table (My Classes–style layout).
 * Headers always render, including when there is no data.
 */
import { formatLessonPlanDateDisplay } from '../../utils/lessonPlanPhaseSession';
import { formatDateManila, formatTimeManila } from '../../utils/dateUtils';

function formatStatus(status) {
  if (status === 'awaiting_reflection') return 'Awaiting Reflection';
  if (status === 'completed') return 'Completed';
  if (status === 'revision_requested') return 'Revision requested';
  return (status || 'draft').replace(/_/g, ' ');
}

function statusBadgeClass(status) {
  if (status === 'completed') return 'bg-green-100 text-green-800';
  if (status === 'awaiting_reflection') return 'bg-amber-100 text-amber-800';
  if (status === 'submitted') return 'bg-blue-100 text-blue-800';
  if (status === 'revision_requested') return 'bg-amber-100 text-amber-800';
  return 'bg-gray-100 text-gray-700';
}

function EyeIcon({ className = 'h-5 w-5' }) {
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
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
      />
    </svg>
  );
}

function formatPhaseSession(plan) {
  const phase = String(plan.phase || '').trim();
  const session = String(plan.session || '').trim();
  if (phase && session) return `${phase} · ${session}`;
  return phase || session || '—';
}

function formatTimestampParts(value) {
  if (!value) return null;
  const datePart = formatDateManila(value);
  const timePart = formatTimeManila(value, { hour12: true });
  if (!datePart || datePart === '-' || !timePart || timePart === '-') return null;
  return { datePart, timePart };
}

/**
 * @param {{
 *   plans: object[],
 *   loading?: boolean,
 *   emptyMessage?: string,
 *   showingLabel?: string,
 *   activePlanId?: number|string|null,
 *   onView: (plan: object) => void,
 *   onSelect?: (plan: object) => void,
 *   timestampMode?: 'submitted' | 'verified',
 *   showTeacher?: boolean,
 * }} props
 */
export default function LessonPlanSubmissionsTable({
  plans = [],
  loading = false,
  emptyMessage = 'No lesson plans submitted yet.',
  showingLabel = '',
  activePlanId = null,
  onView,
  onSelect,
  timestampMode = 'submitted',
  showTeacher = false,
}) {
  const timestampLabel = timestampMode === 'verified' ? 'Verified At' : 'Submitted At';
  const timestampKey = timestampMode === 'verified' ? 'verified_at' : 'submitted_at';
  const colCount = showTeacher ? 9 : 8;
  const tableMinWidth = showTeacher ? '1400px' : '1280px';
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
                Lesson Date
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
                Status
              </th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                {timestampLabel}
              </th>
              <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Action
              </th>
            </tr>
          </thead>
          <tbody className="bg-[#ffffff] divide-y divide-gray-200">
            {loading ? (
              <tr>
                <td colSpan={colCount} className="px-6 py-12 text-center">
                  <p className="text-gray-500">Loading lesson plans...</p>
                </td>
              </tr>
            ) : plans.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="px-6 py-12 text-center">
                  <p className="text-gray-500">{emptyMessage}</p>
                </td>
              </tr>
            ) : (
              plans.map((plan) => {
                const active = String(activePlanId) === String(plan.lesson_plan_id);
                const classCode =
                  plan.class_code || plan.class_label || plan.subject || '—';
                const phaseSession = formatPhaseSession(plan);
                const timestampParts = formatTimestampParts(plan[timestampKey]);
                return (
                  <tr
                    key={plan.lesson_plan_id}
                    className={active ? 'bg-amber-50' : undefined}
                  >
                    <td className="px-3 py-4">
                      <div className="text-sm text-gray-900">
                        {plan.lesson_date
                          ? formatLessonPlanDateDisplay(plan.lesson_date)
                          : '—'}
                      </div>
                    </td>
                    {showTeacher ? (
                      <td className="px-3 py-4">
                        <div
                          className="truncate text-sm font-medium text-gray-900"
                          title={plan.teacher_name || ''}
                        >
                          {plan.teacher_name || '—'}
                        </div>
                      </td>
                    ) : null}
                    <td className="px-3 py-4">
                      {onSelect ? (
                        <button
                          type="button"
                          onClick={() => onSelect(plan)}
                          className="block max-w-full truncate text-left text-sm font-medium text-gray-900 hover:text-amber-700 hover:underline"
                          title={plan.topic || 'Untitled topic'}
                        >
                          {plan.topic || 'Untitled topic'}
                        </button>
                      ) : (
                        <div
                          className="truncate text-sm font-medium text-gray-900"
                          title={plan.topic || ''}
                        >
                          {plan.topic || 'Untitled topic'}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-4">
                      <div
                        className="truncate text-sm text-gray-900"
                        title={classCode}
                      >
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
                      <div className="text-sm text-gray-900">
                        {plan.grade_level || '—'}
                      </div>
                    </td>
                    <td className="px-3 py-4">
                      <span
                        className={`inline-block rounded-full px-2.5 py-1 text-xs font-bold capitalize ${statusBadgeClass(
                          plan.status
                        )}`}
                      >
                        {formatStatus(plan.status)}
                      </span>
                    </td>
                    <td className="px-3 py-4">
                      {timestampParts ? (
                        <div
                          className="text-sm text-gray-900"
                          title={`${timestampParts.datePart} ${timestampParts.timePart}`}
                        >
                          <div className="whitespace-nowrap">{timestampParts.datePart}</div>
                          <div className="whitespace-nowrap text-gray-600">
                            {timestampParts.timePart}
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm text-gray-900">—</div>
                      )}
                    </td>
                    <td className="px-3 py-4 text-right text-sm font-medium">
                      <button
                        type="button"
                        onClick={() => onView?.(plan)}
                        className="inline-flex rounded-full p-2 text-gray-600 transition-colors hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F7C844]"
                        aria-label={`View lesson plan ${plan.topic || plan.lesson_plan_id}`}
                        title="View lesson plan"
                      >
                        <EyeIcon />
                      </button>
                    </td>
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
