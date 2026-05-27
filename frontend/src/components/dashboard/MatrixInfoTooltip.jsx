/**
 * Small info icon with hover/focus tooltip for matrix dashboards.
 */
const MatrixInfoTooltip = ({ label = 'How to read this matrix', children }) => (
  <span className="group relative ml-1.5 inline-flex align-middle">
    <button
      type="button"
      aria-label={label}
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-gray-300 bg-white text-[11px] font-semibold leading-none text-gray-500 hover:border-[#F7C844] hover:bg-amber-50 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#F7C844]/50"
    >
      i
    </button>
    <span
      role="tooltip"
      className="pointer-events-none invisible absolute left-1/2 top-full z-[100] mt-2 w-72 max-w-[min(18rem,calc(100vw-2rem))] -translate-x-1/2 whitespace-pre-line rounded-lg bg-gray-900 px-3 py-2.5 text-left text-[11px] font-normal leading-relaxed text-gray-100 opacity-0 shadow-lg transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
    >
      {children}
    </span>
  </span>
);

export default MatrixInfoTooltip;
