import { Outlet, useMatch, useNavigate } from 'react-router-dom';
import { SidebarProvider } from '../context/SidebarContext';
import { useAuth } from '../context/AuthContext';
import Sidebar from './Sidebar';

function ImpersonationBanner() {
  const { user, selectedBusiness, clearSelectedBusiness } = useAuth();
  const navigate = useNavigate();

  if (user?.role !== 'APPLICATION_MANAGER' || !selectedBusiness) return null;

  const handleBack = () => {
    clearSelectedBusiness();
    navigate('/starter/businesses');
  };

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-700 text-sm">
      <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300">
        <span className="material-symbols-outlined text-base">admin_panel_settings</span>
        <span className="font-semibold">מנהל מערכת</span>
        <span>|</span>
        <span>{selectedBusiness.name}</span>
      </div>
      <button
        onClick={handleBack}
        className="flex items-center gap-1 px-3 py-1 text-xs font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-800/40 rounded-md transition-colors"
      >
        <span className="material-symbols-outlined text-sm">arrow_back</span>
        חזור לפאנל ניהול
      </button>
    </div>
  );
}

function LayoutContent() {
  const isReviewRoute = Boolean(useMatch('/:businessCode/sites/:siteId/review'));

  return (
    <div className="h-screen bg-background-light dark:bg-background-dark flex flex-col font-display text-slate-900 dark:text-white overflow-hidden">
      <ImpersonationBanner />
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <main className="flex-1 min-w-0 min-h-0 overflow-auto transition-[margin] duration-200 ease-in-out">
          <div className={isReviewRoute ? 'w-full min-h-full p-0' : 'max-w-7xl mx-auto p-8'}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

export default function Layout() {
  return (
    <SidebarProvider>
      <LayoutContent />
    </SidebarProvider>
  );
}
