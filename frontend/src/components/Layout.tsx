import { Outlet } from 'react-router-dom';
import { SidebarProvider } from '../context/SidebarContext';
import Sidebar from './Sidebar';

export default function Layout() {
  return (
    <SidebarProvider>
      <div className="min-h-screen bg-background-light dark:bg-background-dark flex font-display text-slate-900 dark:text-white">
        <Sidebar />
        <main className="flex-1 min-w-0 overflow-auto transition-[margin] duration-200 ease-in-out">
          <div className="max-w-7xl mx-auto p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
