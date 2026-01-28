import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useState } from 'react';

export default function Sidebar() {
  const { logout, business } = useAuth();
  const [isAdminOpen, setIsAdminOpen] = useState(true);

  // Use business code from auth context - this is the single source of truth
  const base = `/${business?.code || 'default'}`;

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-4 py-3 rounded-lg transition-colors text-sm font-medium ${
      isActive
        ? 'bg-primary/10 text-primary dark:bg-primary/20'
        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
    }`;

  return (
    <aside className="w-64 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col h-screen sticky top-0">
      <div className="p-6 flex items-center gap-3 border-b border-slate-100 dark:border-slate-800/50">
        <div className="size-8 text-primary">
            <svg fill="none" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
              <path clipRule="evenodd" d="M24 18.4228L42 11.475V34.3663C42 34.7796 41.7457 35.1504 41.3601 35.2992L24 42V18.4228Z" fill="currentColor" fillRule="evenodd"></path>
              <path clipRule="evenodd" d="M24 8.18819L33.4123 11.574L24 15.2071L14.5877 11.574L24 8.18819ZM9 15.8487L21 20.4805V37.6263L9 32.9945V15.8487ZM27 37.6263V20.4805L39 15.8487V32.9945L27 37.6263ZM25.354 2.29885C24.4788 1.98402 23.5212 1.98402 22.646 2.29885L4.98454 8.65208C3.7939 9.08038 3 10.2097 3 11.475V34.3663C3 36.0196 4.01719 37.5026 5.55962 38.098L22.9197 44.7987C23.6149 45.0671 24.3851 45.0671 25.0803 44.7987L42.4404 38.098C43.9828 37.5026 45 36.0196 45 34.3663V11.475C45 10.2097 44.2061 9.08038 43.0155 8.65208L25.354 2.29885Z" fill="currentColor" fillRule="evenodd"></path>
            </svg>
        </div>
        <span className="font-bold text-lg tracking-tight text-slate-900 dark:text-white">AutomateHQ</span>
      </div>

      <nav className="flex-1 overflow-y-auto p-4 space-y-1">
        <NavLink to={`${base}/dashboard`} className={linkClass}>
          <span className="material-symbols-outlined text-[20px]">dashboard</span>
          לוח בקרה
        </NavLink>

        <NavLink to={`${base}/employees`} className={linkClass}>
          <span className="material-symbols-outlined text-[20px]">group</span>
          עובדים
        </NavLink>

        <NavLink to={`${base}/sites`} className={linkClass}>
          <span className="material-symbols-outlined text-[20px]">apartment</span>
          אתרים
        </NavLink>

        <div className="pt-4 pb-2">
          <button 
            onClick={() => setIsAdminOpen(!isAdminOpen)}
            className="flex items-center justify-between w-full px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
          >
            <span>ניהול</span>
            <span className={`material-symbols-outlined text-[16px] transition-transform ${isAdminOpen ? 'rotate-180' : ''}`}>expand_more</span>
          </button>
        </div>

        {isAdminOpen && (
          <div className="space-y-1">
            <NavLink to={`${base}/users`} className={linkClass}>
              <span className="material-symbols-outlined text-[20px]">person</span>
              משתמשים
            </NavLink>
          </div>
        )}
      </nav>

      <div className="p-4 border-t border-slate-200 dark:border-slate-800">
        <button
          onClick={logout}
          className="flex items-center gap-3 px-4 py-3 w-full text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors text-sm font-medium"
        >
          <span className="material-symbols-outlined text-[20px] transform rotate-180">logout</span>
          התנתק
        </button>
      </div>
    </aside>
  );
}
