import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';

const STORAGE_KEY = 'automatehq-sidebar-collapsed';

interface SidebarContextType {
  collapsed: boolean;
  toggle: () => void;
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

function readStored(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === 'true';
  } catch {
    return false;
  }
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(readStored);

  useEffect(() => {
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
    <SidebarContext.Provider value={{ collapsed, toggle }}>
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
