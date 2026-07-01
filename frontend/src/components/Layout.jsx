import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Header from './Header';
import Sidebar from './Sidebar';
import NavigationActivityLogger from './NavigationActivityLogger';
import HighPriorityAnnouncementModal from './HighPriorityAnnouncementModal';
import BranchCashHoldingAlertModal from './BranchCashHoldingAlertModal';
import BranchAdminHelpFloatingButton from './branchAdmin/BranchAdminHelpFloatingButton';
import { GlobalBranchFilterProvider } from '../contexts/GlobalBranchFilterContext';

const LayoutBody = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
      <div className="min-h-screen bg-gray-50 overflow-x-hidden">
        <NavigationActivityLogger />
        <Header onMenuClick={() => setSidebarOpen(!sidebarOpen)} />
        <div className="flex pt-16">
          <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
          <main className="flex-1 lg:ml-64 pt-0 min-w-0">
            <div className="p-4 sm:p-6 lg:p-8 min-w-0">
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
        {/* Branch Admin: floating link to frontdesk user manual */}
        <BranchAdminHelpFloatingButton />
      </div>
  );
};

const Layout = () => (
  <GlobalBranchFilterProvider>
    <LayoutBody />
  </GlobalBranchFilterProvider>
);

export default Layout;

