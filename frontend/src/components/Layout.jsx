import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Header from './Header';
import Sidebar from './Sidebar';
import NavigationActivityLogger from './NavigationActivityLogger';
import HighPriorityAnnouncementModal from './HighPriorityAnnouncementModal';
import BranchCashHoldingAlertModal from './BranchCashHoldingAlertModal';
import BranchAdminUpcomingDropAlertModal from './branchAdmin/BranchAdminUpcomingDropAlertModal';
import BranchAdminHelpFloatingButton from './branchAdmin/BranchAdminHelpFloatingButton';
import { GlobalBranchFilterProvider } from '../contexts/GlobalBranchFilterContext';
import { ConfirmDeliveryProvider } from '../contexts/confirmDelivery';
import { useAuth } from '../contexts/AuthContext';

const LayoutBody = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { userInfo } = useAuth();
  const userType = userInfo?.user_type || userInfo?.userType || '';
  // Branch Admin FAB ("Need help?") sits fixed bottom-right — reserve page space so
  // pagination / primary actions are not covered when scrolled to the end.
  const isBranchAdmin = userType === 'Admin';

  return (
      <div className="min-h-screen bg-gray-50 overflow-x-hidden">
        <NavigationActivityLogger />
        <Header onMenuClick={() => setSidebarOpen(!sidebarOpen)} />
        <div className="flex pt-16">
          <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
          <main className="flex-1 lg:ml-64 pt-0 min-w-0">
            <div
              className={`p-4 sm:p-6 lg:p-8 min-w-0 ${
                isBranchAdmin ? 'pb-28 sm:pb-28 lg:pb-28' : ''
              }`}
            >
              <Outlet />
            </div>
          </main>
        </div>
        {/* Overlay for mobile - same semi-blur as modals */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 backdrop-blur-sm bg-black/5 z-40 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        {/* High Priority Announcement Modal */}
        <HighPriorityAnnouncementModal />
        {/* Branch Admin: urgent login-time alert when undeposited cash exceeds threshold */}
        <BranchCashHoldingAlertModal />
        {/* Branch Admin: urgent login-time list of students due to drop within 7 days */}
        <BranchAdminUpcomingDropAlertModal />
        {/* Branch Admin: floating link to frontdesk user manual */}
        <BranchAdminHelpFloatingButton />
      </div>
  );
};

const Layout = () => (
  <GlobalBranchFilterProvider>
    <ConfirmDeliveryProvider>
      <LayoutBody />
    </ConfirmDeliveryProvider>
  </GlobalBranchFilterProvider>
);

export default Layout;
