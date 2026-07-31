import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';

const STORAGE_KEY = 'automatehq-sidebar-collapsed';

// Below this width the sidebar starts collapsed so it doesn't eat the narrow
// viewport. Matches Tailwind's `md` breakpoint.
const MOBILE_MAX_WIDTH = 767;

interface SidebarContextType {
  collapsed: boolean;
  toggle: () => void;
  setCollapsed: (value: boolean) => void;
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

function isMobileViewport(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`).matches;
}

function readStored(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === 'true';
  } catch {
    return false;
  }
}

// On phones the sidebar is minimized by default regardless of a saved desktop
// preference; on wider screens the persisted choice wins.
function initialCollapsed(): boolean {
  if (isMobileViewport()) return true;
  return readStored();
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  useEffect(() => {
    // Don't let a forced-collapsed mobile session overwrite the desktop
    // preference — only persist explicit choices made on wider screens.
    if (isMobileViewport()) return;
    try {
      localStorage.setItem(STORAGE_KEY, String(collapsed));
    } catch {
      // ignore
    }
  }, [collapsed]);

  const toggle = useCallback(() => {
    setCollapsed((c) => !c);
  }, []);

  return (
    <SidebarContext.Provider value={{ collapsed, toggle, setCollapsed }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (ctx === undefined) {
    throw new Error('useSidebar must be used within SidebarProvider');
  }
  return ctx;
}
