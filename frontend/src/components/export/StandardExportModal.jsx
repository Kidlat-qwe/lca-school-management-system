import { createPortal } from 'react-dom';

/**
 * Shared shell for Export-to-Excel flows (matches Superadmin Invoice export UX):
 * title, description, close (X), scrollable body slot, Cancel + Export.
 */
export default function StandardExportModal({
  open,
  onClose,
  title,
  description = null,
  children = null,
  exportLoading = false,
  onExport,
  exportDisabled = false,
  maxWidthClass = 'max-w-lg',
  overlayZClass = 'z-[120]',
  /** When true, clicking the dimmed backdrop calls onClose (payment logs legacy behavior). */
  closeOnOverlayClick = false,
  /** When true, inner card scrolls (e.g. long branch lists). */
  scrollable = false,
  exportButtonLabel = 'Export to Excel',
}) {
  if (!open) return null;

  return createPortal(
    <div
      className={`fixed inset-0 ${overlayZClass} flex items-center justify-center bg-black/40 p-4`}
      onClick={closeOnOverlayClick && !exportLoading ? () => onClose?.() : undefined}
      role="presentation"
    >
      <div
        className={`w-full ${maxWidthClass} rounded-xl bg-white shadow-2xl ${scrollable ? 'max-h-[85vh] flex flex-col overflow-hidden' : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="standard-export-modal-title"
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 flex-shrink-0">
          <div className="min-w-0 pr-2">
            <h2 id="standard-export-modal-title" className="text-lg font-semibold text-gray-900">
              {title}
            </h2>
            {description != null && description !== '' ? (
              <div className="mt-1 text-sm text-gray-500">{description}</div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => {
              if (exportLoading) return;
              onClose?.();
            }}
            className="flex-shrink-0 text-gray-400 hover:text-gray-600"
            aria-label="Close export modal"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {children != null ? (
          <div className={`space-y-4 px-6 py-5 ${scrollable ? 'overflow-y-auto min-h-0 flex-1' : ''}`}>{children}</div>
        ) : null}

        <div className="flex items-center justify-end gap-3 border-t border-gray-100 px-6 py-4 flex-shrink-0">
          <button
            type="button"
            onClick={() => {
              if (exportLoading) return;
              onClose?.();
            }}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onExport}
            disabled={exportLoading || exportDisabled}
            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {exportLoading ? 'Exporting...' : exportButtonLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
