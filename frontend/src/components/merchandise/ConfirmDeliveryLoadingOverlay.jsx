import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const DEFAULT_MINIMIZE_MESSAGE =
  'Please wait for the receipt confirmation to be completed before enrolling the student.';

/**
 * Full-page loading overlay while Branch Admin confirms Shipped receipt.
 * Covers the merchandise page (and track modal) so confirm-delivery cannot be double-submitted.
 * Minimize shows a notice, then a mini spinner above the Branch Admin "Need help?" FAB
 * so the user can navigate while the request continues.
 */
export default function ConfirmDeliveryLoadingOverlay({
  open = false,
  title = 'Confirming receipt…',
  description = 'Updating RHET Inventory and adding stock to your branch. Please wait.',
  minimizeMessage = DEFAULT_MINIMIZE_MESSAGE,
}) {
  const [minimized, setMinimized] = useState(false);
  const [showMinimizeNotice, setShowMinimizeNotice] = useState(false);

  useEffect(() => {
    if (!open) {
      setMinimized(false);
      setShowMinimizeNotice(false);
    }
  }, [open]);

  if (!open) return null;

  if (minimized) {
    return createPortal(
      <button
        type="button"
        onClick={() => setMinimized(false)}
        className="fixed z-[45] inline-flex h-11 w-11 items-center justify-center rounded-full border border-[#E5B82E] bg-white shadow-md hover:bg-[#FFF8E1] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F7C844] focus-visible:ring-offset-2 right-4 bottom-[8.75rem] sm:right-6 sm:bottom-[4.75rem]"
        aria-label="Receipt confirmation in progress. Click to show details."
        title="Confirming receipt… Click to expand"
      >
        <span
          className="h-6 w-6 rounded-full border-2 border-[#F7C844]/40 border-t-[#F7C844] animate-spin"
          aria-hidden="true"
        />
      </button>,
      document.body
    );
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[10050] flex items-center justify-center backdrop-blur-sm bg-black/30 p-4"
      role="status"
      aria-live="polite"
      aria-busy={!showMinimizeNotice}
      aria-label={title}
    >
      {!showMinimizeNotice ? (
        <div className="relative w-full max-w-sm rounded-xl bg-white px-5 py-5 shadow-xl sm:px-6 sm:py-6">
          <button
            type="button"
            onClick={() => setShowMinimizeNotice(true)}
            className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1"
            aria-label="Minimize"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            </svg>
            Minimize
          </button>

          <div className="flex items-center gap-4 pr-16">
            <div
              className="h-10 w-10 shrink-0 rounded-full border-2 border-blue-200 border-t-blue-600 animate-spin"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900">{title}</p>
              <p className="mt-1 text-xs text-gray-500">{description}</p>
            </div>
          </div>
        </div>
      ) : (
        <div
          className="w-full max-w-md rounded-xl bg-white px-5 py-5 shadow-xl sm:px-6 sm:py-6"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-delivery-minimize-title"
          aria-describedby="confirm-delivery-minimize-message"
        >
          <h3
            id="confirm-delivery-minimize-title"
            className="text-base font-semibold text-gray-900"
          >
            Notice
          </h3>
          <p
            id="confirm-delivery-minimize-message"
            className="mt-2 text-sm text-gray-600"
          >
            {minimizeMessage}
          </p>
          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={() => {
                setShowMinimizeNotice(false);
                setMinimized(true);
              }}
              className="inline-flex items-center justify-center rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
