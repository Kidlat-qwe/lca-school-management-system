import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../config/api';
import { useAuth } from '../contexts/AuthContext';

/**
 * BranchCashHoldingAlertModal
 *
 * Login-time urgent alert shown to a Branch Admin (user_type === 'Admin')
 * whenever the branch is currently holding more than the configured
 * `cash_holding_alert_threshold_php` of unreconciled physical Cash. Mirrors
 * the visual language of HighPriorityAnnouncementModal so that the gravity
 * is unambiguous.
 *
 * Behavior — must fire on EVERY login:
 *   - Fresh login (logout -> login)            => fires (Layout remounts; ref starts null)
 *   - Page refresh while logged in             => fires (Layout remounts; ref starts null)
 *   - Re-login without remount (defensive)     => fires (ref reset when userInfo -> null)
 *   - In-app navigation (same logged-in user)  => DOES NOT fire (ref guards the same userId)
 *
 *   Will re-appear on the next login until the branch deposits enough Cash to
 *   fall below the configured threshold. Acknowledge button closes the modal
 *   AND routes the user straight to /admin/payment-logs so they can submit a
 *   Cash Deposit immediately. Silent no-op for any non-Admin role.
 *
 * Backend contract:
 *   GET /cash-deposit-summaries/cash-holding-status
 *   -> { success, data: { pending_cash_amount, threshold_php,
 *                         is_over_threshold, branch_name, ... } }
 */
const formatPHP = (amount) => {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '\u20B10.00';
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
};

const BranchCashHoldingAlertModal = () => {
  const { userInfo } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState(null);
  const [isVisible, setIsVisible] = useState(false);
  // Tracks the userId we've already checked in this mount so navigating
  // around the app doesn't re-fire the alert. Reset to null whenever
  // userInfo transitions to null (logout) so the very next login fires
  // the check again, even if the Layout somehow stays mounted.
  const lastCheckedUserIdRef = useRef(null);

  const checkCashHolding = async () => {
    try {
      const response = await apiRequest('/cash-deposit-summaries/cash-holding-status');
      if (response && response.success && response.data) {
        const d = response.data;
        // Diagnostic log so an admin can verify in DevTools that the check ran
        // and see exactly why the modal did or did not appear.
        console.info(
          `[CashHoldingAlert] Branch: ${d.branch_name || '?'} | Pending Cash: \u20B1${Number(d.pending_cash_amount || 0).toLocaleString('en-PH')} (${d.pending_cash_count} payments) | Threshold: \u20B1${Number(d.threshold_php || 0).toLocaleString('en-PH')} | Over threshold: ${d.is_over_threshold}`
        );
        if (d.is_over_threshold) {
          setStatus(d);
          setIsVisible(true);
        }
      }
    } catch (error) {
      // Surface the failure in the console so we can diagnose 404/401/etc.
      // without showing the user a confusing error toast on login.
      console.error('[CashHoldingAlert] Check failed:', error?.message || error);
    }
  };

  useEffect(() => {
    // Logout / not yet authenticated: clear any visible modal AND reset the
    // dedup ref so the next login is detected as a fresh check, even if the
    // Layout component stays mounted across the auth transition.
    if (!userInfo) {
      lastCheckedUserIdRef.current = null;
      setIsVisible(false);
      setStatus(null);
      return undefined;
    }

    // Accept both camelCase and snake_case shapes — `/auth/verify` returns
    // both, but `refreshUserInfo` may emit slightly different shapes.
    const userType = userInfo.userType || userInfo.user_type;
    const userId = userInfo.userId || userInfo.user_id;

    if (userType !== 'Admin' || !userId) {
      return undefined;
    }
    if (lastCheckedUserIdRef.current === userId) {
      return undefined;
    }

    // Small delay so this doesn't race the HighPriorityAnnouncementModal.
    // IMPORTANT: the dedup ref is assigned INSIDE the callback so React 18
    // StrictMode's intentional mount->cleanup->remount cycle in dev doesn't
    // mark the userId as "already checked" before the API call ever runs.
    const timer = setTimeout(() => {
      lastCheckedUserIdRef.current = userId;
      checkCashHolding();
    }, 700);

    return () => clearTimeout(timer);
  }, [userInfo]);

  const handleAcknowledge = () => {
    setIsVisible(false);
    setStatus(null);
    navigate('/admin/payment-logs');
  };

  if (!isVisible || !status) {
    return null;
  }

  const pendingAmount = formatPHP(status.pending_cash_amount);
  const thresholdAmount = formatPHP(status.threshold_php);
  const branchName = status.branch_name || 'your branch';

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 backdrop-blur-sm bg-black/5">
      <div className="bg-white rounded-lg shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
        <div className="bg-red-600 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <svg
              className="w-6 h-6 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <h2 className="text-xl font-bold text-white">Cash Holding Alert</h2>
          </div>
          <span className="px-3 py-1 text-sm font-semibold bg-white text-red-600 rounded-full">
            URGENT
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-4">
            <div>
              <h3 className="text-2xl font-bold text-gray-900 mb-2">
                Action required: deposit pending cash
              </h3>
              <p className="text-sm text-gray-600">
                Your branch is currently holding more cash than the safe operating limit. Please
                submit a Cash Deposit as soon as possible.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-red-700">
                  Cash on hand
                </p>
                <p className="mt-1 text-2xl font-bold text-red-700">{pendingAmount}</p>
                <p className="mt-1 text-xs text-red-700/80">
                  Across {status.pending_cash_count || 0} undeposited cash payment
                  {status.pending_cash_count === 1 ? '' : 's'}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-600">
                  Alert threshold
                </p>
                <p className="mt-1 text-2xl font-bold text-gray-900">{thresholdAmount}</p>
                <p className="mt-1 text-xs text-gray-500">Branch: {branchName}</p>
              </div>
            </div>

            <div className="pt-4 border-t border-gray-200">
              <p className="text-gray-700 leading-relaxed">
                Holding large amounts of physical cash on-site increases security and audit risk.
                Please head over to the <span className="font-semibold">Payment Logs</span> page and
                submit a Cash Deposit covering the unreconciled cash payments.
              </p>
              <p className="mt-2 text-xs text-gray-500">
                You will see this reminder every time you sign in until the pending cash falls
                below the configured threshold.
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-end space-x-3">
          <button
            onClick={handleAcknowledge}
            className="px-6 py-2 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
          >
            Acknowledge & go to Payment Logs
          </button>
        </div>
      </div>
    </div>
  );
};

export default BranchCashHoldingAlertModal;
