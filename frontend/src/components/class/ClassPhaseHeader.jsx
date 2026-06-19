/**
 * Collapsible phase header with attendance summary "View" action.
 */
const ClassPhaseHeader = ({
  phaseNumber,
  isExpanded,
  isActivePhase,
  sessionCount,
  onToggleExpand,
  onViewAttendance,
}) => {
  const shellClass = isActivePhase
    ? 'bg-primary-50 border-primary-500'
    : 'bg-white border-gray-200 hover:bg-gray-50';

  return (
    <div
      className={`flex items-center gap-2 border-b-0 px-4 py-3 sm:px-6 sm:py-4 transition-colors ${shellClass}`}
    >
      <button
        type="button"
        onClick={onToggleExpand}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <svg
          className={`h-5 w-5 shrink-0 transition-transform ${
            isExpanded ? 'rotate-90' : ''
          } ${isActivePhase ? 'text-primary-600' : 'text-gray-500'}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <h3
          className={`text-base font-semibold sm:text-lg ${
            isActivePhase ? 'text-primary-700' : 'text-gray-900'
          }`}
        >
          Phase {phaseNumber}
          {isActivePhase && (
            <span className="ml-2 inline-flex items-center rounded-full bg-primary-100 px-1.5 py-0.5 text-xs font-medium text-primary-800">
              Current
            </span>
          )}
        </h3>
        <span
          className={`text-sm ${isActivePhase ? 'text-primary-600' : 'text-gray-500'}`}
        >
          ({sessionCount} session{sessionCount !== 1 ? 's' : ''})
        </span>
      </button>
      <button
        type="button"
        onClick={onViewAttendance}
        className="shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#F7C844]/50 sm:text-sm"
      >
        View
      </button>
    </div>
  );
};

export default ClassPhaseHeader;
