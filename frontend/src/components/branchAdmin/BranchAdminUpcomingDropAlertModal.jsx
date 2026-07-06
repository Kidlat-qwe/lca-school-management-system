import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  StudentDropOffListTable,
  fetchUpcomingDelinquencyDrops,
} from '../installmentInvoice/StudentDropOffListPanel';

/**
 * BranchAdminUpcomingDropAlertModal
 *
 * Login-time urgent alert for Branch Admin listing students whose unpaid
 * installment phase will auto-drop within the next 7 days.
 *
 * Landscape modal so the full table fits without a horizontal scrollbar on
 * typical desktop widths. Close / Continue / X / backdrop all dismiss it.
 * Continue routes to Installment Invoice → Student drop off list tab.
 *
 * Backend: GET /installment-invoices/upcoming-delinquency-drops
 */

const BranchAdminUpcomingDropAlertModal = () => {
  const { userInfo } = useAuth();
  const navigate = useNavigate();
  const [payload, setPayload] = useState(null);
  const [isVisible, setIsVisible] = useState(false);
  const lastCheckedUserIdRef = useRef(null);

  const checkUpcomingDrops = async () => {
    try {
      const data = await fetchUpcomingDelinquencyDrops();
      const students = Array.isArray(data.students) ? data.students : [];
      if (students.length > 0) {
        setPayload(data);
        setIsVisible(true);
      }
    } catch (error) {
      console.error('[UpcomingDropAlert] Check failed:', error?.message || error);
    }
  };

  useEffect(() => {
    if (!userInfo) {
      lastCheckedUserIdRef.current = null;
      setIsVisible(false);
      setPayload(null);
      return undefined;
    }

    const userType = userInfo.userType || userInfo.user_type;
    const userId = userInfo.userId || userInfo.user_id;

    if (userType !== 'Admin' || !userId) {
      return undefined;
    }
    if (lastCheckedUserIdRef.current === userId) {
      return undefined;
    }

    const timer = setTimeout(() => {
      lastCheckedUserIdRef.current = userId;
      checkUpcomingDrops();
    }, 900);

    return () => clearTimeout(timer);
  }, [userInfo]);

  const handleClose = () => {
    setIsVisible(false);
    setPayload(null);
  };

  const handleContinue = () => {
    handleClose();
    navigate('/admin/installment-invoice?tab=drop-off');
  };

  if (!isVisible || !payload) {
    return null;
  }

  const students = payload.students || [];
  const withinDays = payload.within_days ?? 7;
  const finalDropoffDays = payload.final_dropoff_days ?? 30;
  const branchName = payload.branch_name || 'your branch';

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center p-3 sm:p-4 backdrop-blur-sm bg-black/5"
      onClick={handleClose}
      role="presentation"
    >
      <div
        className="bg-white rounded-lg shadow-2xl w-full max-w-[min(72rem,96vw)] max-h-[90vh] overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="upcoming-drop-alert-title"
      >
        <div className="bg-red-600 px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3">
          <div className="flex items-center space-x-3 min-w-0">
            <svg
              className="w-6 h-6 text-white shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <h2
              id="upcoming-drop-alert-title"
              className="text-lg sm:text-xl font-bold text-white truncate"
            >
              Students at risk of drop
            </h2>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="px-3 py-1 text-sm font-semibold bg-white text-red-600 rounded-full">
              URGENT
            </span>
            <button
              type="button"
              onClick={handleClose}
              className="p-1.5 rounded-md text-white/90 hover:text-white hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/60"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 lg:p-6">
          <div className="space-y-4">
            <div>
              <h3 className="text-xl sm:text-2xl font-bold text-gray-900 mb-1">
                {students.length} student{students.length === 1 ? '' : 's'} will be dropped within{' '}
                {withinDays} days
              </h3>
              <p className="text-sm text-gray-600">
                These students have unpaid installment invoices. If payment is not completed, they
                will be auto-dropped {finalDropoffDays} days after the due date. Branch:{' '}
                <span className="font-medium text-gray-800">{branchName}</span>.
              </p>
            </div>

            <StudentDropOffListTable students={students} compact />

            <p className="text-xs text-gray-500">
              This reminder appears when you sign in. Use <span className="font-medium">Continue</span>{' '}
              to open the full Student drop off list on Installment Invoice, or close to keep working.
            </p>
          </div>
        </div>

        <div className="px-4 sm:px-6 py-3 sm:py-4 bg-gray-50 border-t border-gray-200 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 sm:gap-3">
          <button
            type="button"
            onClick={handleClose}
            className="px-6 py-2 bg-white text-gray-700 font-semibold rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-300 focus:ring-offset-2"
          >
            Close
          </button>
          <button
            type="button"
            onClick={handleContinue}
            className="px-6 py-2 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
};

export default BranchAdminUpcomingDropAlertModal;
