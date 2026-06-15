import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSidebar } from '../context/SidebarContext';
import { usePermissions } from '../hooks/usePermissions';
import { useState, type ReactNode } from 'react';

const SIDEBAR_WIDTH_EXPANDED = 'w-64';
const SIDEBAR_WIDTH_COLLAPSED = 'w-16';

type SectionKey = 'ops' | 'integ' | 'admin';

const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'מנהל',
  OPERATOR_MANAGER: 'מנהל תפעול',
  APPLICATION_MANAGER: 'מנהל מערכת',
  EMPLOYEE: 'עובד',
  RESPONSIBLE_EMPLOYEE: 'עובד אחראי',
  FIELD_MANAGER: 'מנהל שטח',
};

interface NavRowProps {
  to?: string;
  onClick?: () => void;
  icon: string;
  iconSize?: number;
  label: string;
  collapsed: boolean;
  indent?: boolean;
  trailing?: ReactNode;
  isActive?: boolean;
}

function NavRow({ to, onClick, icon, iconSize = 20, label, collapsed, indent, trailing, isActive }: NavRowProps) {
  const rowClass = (active: boolean) =>
    `group flex items-center rounded-md transition-colors text-sm ${
      collapsed ? 'justify-center gap-0 px-0 py-2.5' : 'gap-3 py-2'
    } ${collapsed ? '' : indent ? 'ps-7 pe-2.5' : 'px-2.5'} ${
      active
        ? 'bg-primary/10 text-primary font-semibold'
        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium'
    }`;

  const body = (active: boolean) => (
    <>
      {active && !collapsed && (
        <span className="absolute -start-3 top-1.5 bottom-1.5 w-[3px] rounded bg-primary" aria-hidden />
      )}
      <span
        className={`material-symbols-outlined shrink-0 ${active ? 'text-primary' : 'text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300'}`}
        style={{ fontSize: iconSize }}
      >
        {icon}
      </span>
      {!collapsed && <span className="flex-1 text-start truncate">{label}</span>}
      {!collapsed && trailing}
    </>
  );

  if (to) {
    return (
      <NavLink to={to} title={collapsed ? label : undefined} className={({ isActive: a }) => `relative ${rowClass(a)}`}>
        {({ isActive: a }) => body(a)}
      </NavLink>
    );
  }

  return (
    <button type="button" onClick={onClick} title={collapsed ? label : undefined} className={`relative w-full ${rowClass(Boolean(isActive))}`}>
      {body(Boolean(isActive))}
    </button>
  );
}

interface SectionHeaderProps {
  title: string;
  open: boolean;
  onToggle: () => void;
}

function SectionHeader({ title, open, onToggle }: SectionHeaderProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center w-full px-2.5 pt-3 pb-1 text-[10.5px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-[0.08em] hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
    >
      <span
        className={`material-symbols-outlined text-[14px] me-1 transition-transform ${open ? 'rotate-0' : '-rotate-90'}`}
        aria-hidden
      >
        expand_more
      </span>
      <span className="text-start">{title}</span>
    </button>
  );
}

export default function Sidebar() {
  const { logout, business, selectedBusiness, user } = useAuth();
  const { collapsed, toggle } = useSidebar();
  const { isAdmin, isApplicationManager } = usePermissions();
  const location = useLocation();

  const base = `/${business?.code || selectedBusiness?.code || 'default'}`;

  const [sectionsOpen, setSectionsOpen] = useState<Record<SectionKey, boolean>>({
    ops: true,
    integ: true,
    admin: true,
  });

  const onWorkCardsRoute =
    location.pathname.includes('/missing-work-cards') ||
    location.pathname.includes('/unassigned-work-cards');
  const [cardsOpen, setCardsOpen] = useState<boolean>(true);

  const toggleSection = (k: SectionKey) =>
    setSectionsOpen((s) => ({ ...s, [k]: !s[k] }));

  const nameParts = (user?.full_name || '').trim().split(/\s+/).filter(Boolean);
  const initials = nameParts.length >= 2
    ? (nameParts[0][0] || '') + (nameParts[1][0] || '')
    : nameParts[0]?.slice(0, 2) || 'יר';
  const userName = user?.full_name || 'משתמש';
  const userRole = ROLE_LABEL[user?.role || ''] || '';
  const showAdminSection = isAdmin || isApplicationManager;

  return (
    <aside
      className={`${collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED} shrink-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col h-screen sticky top-0 transition-[width] duration-200 ease-in-out overflow-x-hidden`}
      aria-label="Sidebar navigation"
    >
      {/* Header / workspace */}
      <div className={`flex border-b border-slate-100 dark:border-slate-800/50 shrink-0 ${collapsed ? 'flex-col items-center gap-2 p-3' : 'items-center gap-3 p-4'}`}>
        <div className="size-8 text-primary shrink-0">
          <svg fill="none" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
            <path clipRule="evenodd" d="M24 18.4228L42 11.475V34.3663C42 34.7796 41.7457 35.1504 41.3601 35.2992L24 42V18.4228Z" fill="currentColor" fillRule="evenodd"></path>
            <path clipRule="evenodd" d="M24 8.18819L33.4123 11.574L24 15.2071L14.5877 11.574L24 8.18819ZM9 15.8487L21 20.4805V37.6263L9 32.9945V15.8487ZM27 37.6263V20.4805L39 15.8487V32.9945L27 37.6263ZM25.354 2.29885C24.4788 1.98402 23.5212 1.98402 22.646 2.29885L4.98454 8.65208C3.7939 9.08038 3 10.2097 3 11.475V34.3663C3 36.0196 4.01719 37.5026 5.55962 38.098L22.9197 44.7987C23.6149 45.0671 24.3851 45.0671 25.0803 44.7987L42.4404 38.098C43.9828 37.5026 45 36.0196 45 34.3663V11.475C45 10.2097 44.2061 9.08038 43.0155 8.65208L25.354 2.29885Z" fill="currentColor" fillRule="evenodd"></path>
          </svg>
        </div>
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <div className="font-bold text-sm tracking-tight text-slate-900 dark:text-white truncate leading-tight">AutomateHQ</div>
            {(selectedBusiness?.name || business?.name) && (
              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate leading-tight mt-0.5">
                {selectedBusiness?.name || business?.name}
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={toggle}
          className="shrink-0 flex items-center justify-center size-8 rounded-md text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'הרחב תפריט' : 'צמצם תפריט'}
        >
          <span className={`material-symbols-outlined text-[20px] ${collapsed ? '' : 'rotate-180'}`}>
            {collapsed ? 'chevron_right' : 'chevron_left'}
          </span>
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-3">
        {/* ─── תפעול ─── */}
        {!collapsed && (
          <SectionHeader title="תפעול" open={sectionsOpen.ops} onToggle={() => toggleSection('ops')} />
        )}
        {(collapsed || sectionsOpen.ops) && (
          <div className="space-y-0.5">
            <NavRow to={`${base}/dashboard`} icon="dashboard" label="לוח בקרה" collapsed={collapsed} />

            {/* Work cards parent + sub-items */}
            {collapsed ? (
              <>
                <NavRow to={`${base}/missing-work-cards`} icon="assignment_late" label="כרטיסי עבודה חסרים" collapsed={collapsed} />
                <NavRow to={`${base}/unassigned-work-cards`} icon="link_off" label="כרטיסים לא משויכים" collapsed={collapsed} />
              </>
            ) : (
              <>
                <NavRow
                  icon="content_paste"
                  label="כרטיסי עבודה"
                  collapsed={collapsed}
                  onClick={() => setCardsOpen((o) => !o)}
                  isActive={onWorkCardsRoute}
                  trailing={
                    <span
                      className={`material-symbols-outlined text-[16px] text-slate-400 transition-transform ${cardsOpen ? 'rotate-0' : '-rotate-90'}`}
                      aria-hidden
                    >
                      expand_more
                    </span>
                  }
                />
                {cardsOpen && (
                  <div className="ms-3 ps-1.5 border-s border-slate-200 dark:border-slate-800 space-y-0.5">
                    <NavRow
                      to={`${base}/missing-work-cards`}
                      icon="assignment_late"
                      iconSize={18}
                      label="חסרים"
                      collapsed={collapsed}
                      indent
                    />
                    <NavRow
                      to={`${base}/unassigned-work-cards`}
                      icon="link_off"
                      iconSize={18}
                      label="לא משויכים"
                      collapsed={collapsed}
                      indent
                    />
                  </div>
                )}
              </>
            )}

            <NavRow to={`${base}/employees`} icon="group" label="עובדים" collapsed={collapsed} />
            <NavRow to={`${base}/sites`} icon="apartment" label="אתרים" collapsed={collapsed} />
          </div>
        )}

        {/* ─── אינטגרציות ─── */}
        {!collapsed && (
          <SectionHeader title="אינטגרציות" open={sectionsOpen.integ} onToggle={() => toggleSection('integ')} />
        )}
        {(collapsed || sectionsOpen.integ) && (
          <div className="space-y-0.5">
            <NavRow to={`${base}/settings/whatsapp`} icon="chat" label="WhatsApp" collapsed={collapsed} />
            <NavRow to={`${base}/settings/telegram`} icon="send" label="Telegram" collapsed={collapsed} />
          </div>
        )}

        {/* ─── ניהול ─── */}
        {showAdminSection && (
          <>
            {!collapsed && (
              <SectionHeader title="ניהול" open={sectionsOpen.admin} onToggle={() => toggleSection('admin')} />
            )}
            {(collapsed || sectionsOpen.admin) && (
              <div className="space-y-0.5">
                <NavRow to={`${base}/users`} icon="manage_accounts" label="משתמשים" collapsed={collapsed} />
                <NavRow to={`${base}/employee-imports`} icon="sync" label="סנכרון עובדים ואתרים" collapsed={collapsed} />
              </div>
            )}
          </>
        )}
      </nav>

      {/* Footer — user row */}
      <div className="border-t border-slate-200 dark:border-slate-800 shrink-0 p-3">
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <div className="size-8 rounded-full bg-slate-200 dark:bg-slate-700 grid place-items-center text-slate-700 dark:text-slate-200 text-xs font-semibold">
              {initials}
            </div>
            <button
              type="button"
              onClick={logout}
              title="התנתק"
              className="flex items-center justify-center size-8 rounded-md text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              aria-label="Logout"
            >
              <span className="material-symbols-outlined text-[20px] rotate-180">logout</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-1">
            <div className="size-8 rounded-full bg-slate-200 dark:bg-slate-700 grid place-items-center text-slate-700 dark:text-slate-200 text-xs font-semibold shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium text-slate-900 dark:text-white truncate leading-tight">{userName}</div>
              {userRole && (
                <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate leading-tight mt-0.5">{userRole}</div>
              )}
            </div>
            <button
              type="button"
              onClick={logout}
              title="התנתק"
              className="shrink-0 flex items-center justify-center size-8 rounded-md text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              aria-label="Logout"
            >
              <span className="material-symbols-outlined text-[18px] rotate-180">logout</span>
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
