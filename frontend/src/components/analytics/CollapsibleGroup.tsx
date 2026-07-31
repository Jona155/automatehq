import { useState, type ReactNode } from 'react';
import { formatNumber } from '../../utils/formatNumber';

interface CollapsibleGroupProps {
  title: string;
  count: number;
  hint?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

// Collapsed-by-default section used to corral "no report" (zero-hours) rows out
// of the ranked list so they don't read as red under-performers. Renders nothing
// when empty. Matches the app's inline-accordion idiom (rotating chevron).
export default function CollapsibleGroup({
  title,
  count,
  hint,
  defaultOpen = false,
  children,
}: CollapsibleGroupProps) {
  const [open, setOpen] = useState(defaultOpen);
  if (count === 0) return null;

  return (
    <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 p-4 text-start"
      >
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="w-2.5 h-2.5 rounded-sm bg-slate-400 dark:bg-slate-500 shrink-0" />
          <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{title}</span>
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-200/70 dark:bg-slate-700 px-2 py-0.5 rounded-full tabular-nums">
            {formatNumber(count)}
          </span>
          {hint && <span className="text-xs text-slate-400 dark:text-slate-500 truncate">{hint}</span>}
        </div>
        <span
          className={`material-symbols-outlined text-slate-400 dark:text-slate-500 transition-transform shrink-0 ${
            open ? 'rotate-90' : ''
          }`}
        >
          chevron_left
        </span>
      </button>
      {open && <div className="border-t border-slate-200 dark:border-slate-700">{children}</div>}
    </div>
  );
}
