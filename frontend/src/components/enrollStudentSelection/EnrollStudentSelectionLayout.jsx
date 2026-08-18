const COLUMN_SCROLL_STYLE = {
  scrollbarWidth: 'thin',
  scrollbarColor: '#cbd5e0 #f7fafc',
  WebkitOverflowScrolling: 'touch',
};

/**
 * Landscape enroll wizard: wide main pane + order-summary rail.
 * Stacks on small screens.
 */
export default function EnrollStudentSelectionLayout({ left, right, main, summary }) {
  const mainContent = main != null ? main : left;
  const summaryContent = summary != null ? summary : right;
  const hasSummary = summaryContent != null && summaryContent !== false;

  return (
    <div className="flex flex-col lg:flex-row gap-3 lg:gap-4 min-h-0 flex-1 lg:overflow-hidden">
      <div
        className={`space-y-3 min-h-0 lg:overflow-y-auto ${
          hasSummary ? 'lg:flex-1 min-w-0' : 'w-full'
        }`}
        style={COLUMN_SCROLL_STYLE}
      >
        {mainContent}
      </div>
      {hasSummary ? (
        <div
          className="min-h-0 lg:w-[320px] xl:w-[360px] lg:flex-shrink-0 lg:overflow-y-auto"
          style={COLUMN_SCROLL_STYLE}
        >
          {summaryContent}
        </div>
      ) : null}
    </div>
  );
}
