import { Outlet, useMatch } from 'react-router-dom';
import { SidebarProvider } from '../context/SidebarContext';
import Sidebar from './Sidebar';

function LayoutContent() {
  const isReviewRoute = Boolean(useMatch('/:businessCode/sites/:siteId/review'));

  return (
    <div className="h-screen bg-background-light dark:bg-background-dark flex font-display text-slate-900 dark:text-white overflow-hidden">
      <Sidebar />
      <main className="flex-1 min-w-0 min-h-0 overflow-auto transition-[margin] duration-200 ease-in-out">
        <div className={isReviewRoute ? 'w-full min-h-full p-0' : 'max-w-7xl mx-auto p-8'}>
          <Outlet />
        </div>
      </main>
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
