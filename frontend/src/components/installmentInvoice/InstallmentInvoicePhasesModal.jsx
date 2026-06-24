import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import InstallmentPlanDetails from './InstallmentPlanDetails';

/**
 * Shared read-only modal used by every "Installment Invoice Logs"
 * page (Superadmin, Admin, Finance, Superfinance) for the
 * "View Details" action.
 *
 * Wraps `InstallmentPlanDetails` (the actual presentation) in a
 * dialog shell so it can be opened over a list page.
 *
 * Props:
 *   open      (bool)              whether the modal is shown
 *   profileId (number|string|null) installmentinvoiceprofiles_id
 *   onClose   (fn)                invoked when the modal is closed
 */
const InstallmentInvoicePhasesModal = ({ open, profileId, onClose }) => {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[10050] flex items-stretch justify-center backdrop-blur-sm bg-black/30 p-2 sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="installment-phases-modal-title"
    >
      <div
        className="bg-white rounded-t-xl sm:rounded-lg shadow-xl max-w-[min(98vw,1520px)] w-full max-h-[95vh] sm:max-h-[92vh] my-auto sm:my-0 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200 flex-shrink-0">
          <div className="min-w-0">
            <h2
              id="installment-phases-modal-title"
              className="text-lg sm:text-xl font-bold text-gray-900"
            >
              Installment Plan Details
            </h2>
            <p className="text-xs sm:text-sm text-gray-500 mt-1">
              View every phase, paid or unpaid, and the total student
              payment for this installment plan.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors shrink-0"
            aria-label="Close"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 sm:px-5 py-3 sm:py-4">
          <InstallmentPlanDetails profileId={profileId} />
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 sm:gap-3 p-4 sm:p-6 border-t border-gray-200 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default InstallmentInvoicePhasesModal;
