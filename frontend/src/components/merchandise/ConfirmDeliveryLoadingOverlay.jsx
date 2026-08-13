import { createPortal } from 'react-dom';

/**
 * Full-page loading overlay while Branch Admin confirms Shipped receipt.
 * Covers the merchandise page (and track modal) so confirm-delivery cannot be double-submitted.
 */
export default function ConfirmDeliveryLoadingOverlay({
  open = false,
  title = 'Confirming receipt…',
  description = 'Updating RHET Inventory and adding stock to your branch. Please wait.',
}) {
  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[10050] flex items-center justify-center backdrop-blur-sm bg-black/30 p-4"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={title}
    >
      <div className="bg-white rounded-xl shadow-xl px-5 py-5 sm:px-6 sm:py-6 w-full max-w-sm flex items-center gap-4">
        <div
          className="h-10 w-10 shrink-0 rounded-full border-2 border-blue-200 border-t-blue-600 animate-spin"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">{title}</p>
          <p className="text-xs text-gray-500 mt-1">{description}</p>
        </div>
      </div>
    </div>,
    document.body
  );
}
