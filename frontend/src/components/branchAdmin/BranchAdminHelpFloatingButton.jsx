import { useAuth } from '../../contexts/AuthContext';
import {
  BRANCH_ADMIN_FRONTDESK_MANUAL_TITLE,
  BRANCH_ADMIN_FRONTDESK_MANUAL_URL,
} from '../../constants/branchAdminHelp';

/**
 * Mini floating help control for Branch Admin accounts.
 * Opens the frontdesk manual PDF in a new browser tab.
 */
const BranchAdminHelpFloatingButton = () => {
  const { userInfo } = useAuth();
  const userType = userInfo?.user_type || userInfo?.userType || '';

  if (userType !== 'Admin') return null;

  const openManual = () => {
    window.open(BRANCH_ADMIN_FRONTDESK_MANUAL_URL, '_blank', 'noopener,noreferrer');
  };

  return (
    <button
      type="button"
      onClick={openManual}
      className="fixed right-6 bottom-24 z-40 inline-flex items-center gap-1.5 rounded-xl border border-[#E5B82E] bg-white/95 px-3.5 py-2 text-xs sm:text-sm font-semibold text-gray-900 shadow-md backdrop-blur-sm hover:bg-[#FFF8E1] hover:border-[#D4A820] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F7C844] focus-visible:ring-offset-2 transition-colors lg:bottom-6"
      aria-label={`${BRANCH_ADMIN_FRONTDESK_MANUAL_TITLE}. Opens in a new tab.`}
      title={BRANCH_ADMIN_FRONTDESK_MANUAL_TITLE}
    >
      <svg
        className="h-4 w-4 shrink-0 text-[#B8860B]"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <span>Need help?</span>
    </button>
  );
};

export default BranchAdminHelpFloatingButton;
