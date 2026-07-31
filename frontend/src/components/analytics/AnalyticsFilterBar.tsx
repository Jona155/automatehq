import type { Band } from '../../types';
import { displayBandStyle, type DisplayBand } from './bands';
import { formatNumber } from '../../utils/formatNumber';

export type SortKey = 'worst' | 'best' | 'name';

export const SORT_LABELS: Record<SortKey, string> = {
  worst: 'הנמוכים קודם',
  best: 'הגבוהים קודם',
  name: 'לפי שם',
};

export const nextSort = (s: SortKey): SortKey => (s === 'worst' ? 'best' : s === 'best' ? 'name' : 'worst');

export interface BandChip {
  key: Band;
  count: number;
}

interface AnalyticsFilterBarProps {
  query: string;
  onQuery: (v: string) => void;
  searchPlaceholder: string;
  total: number;                          // count for the "all" chip
  bandChips: BandChip[];                  // only bands present (excludes NO_REPORT)
  activeBand: DisplayBand | 'all';
  onBand: (b: DisplayBand | 'all') => void;
  sort: SortKey;
  onSort: () => void;
  multiOnly?: boolean;
  onToggleMulti?: () => void;
  multiLabel?: string;
}

const chipBase =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12.5px] font-medium transition-colors whitespace-nowrap';

// Search + band-filter chips + sort (+ optional multi-site toggle) toolbar,
// shared by the scorecard (sites) and site-detail (employees) lists.
export default function AnalyticsFilterBar({
  query,
  onQuery,
  searchPlaceholder,
  total,
  bandChips,
  activeBand,
  onBand,
  sort,
  onSort,
  multiOnly,
  onToggleMulti,
  multiLabel = 'רב-אתריים בלבד',
}: AnalyticsFilterBarProps) {
  const chip = (key: DisplayBand | 'all', label: string, count: number, hex?: string) => {
    const active = activeBand === key;
    return (
      <button
        key={key}
        type="button"
        onClick={() => onBand(active ? 'all' : key)}
        className={`${chipBase} ${
          active
            ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900 shadow-sm'
            : 'bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:text-slate-700 dark:hover:text-slate-200'
        }`}
      >
        {hex && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: hex }} />}
        <span>{label}</span>
        <span className={`tabular-nums ${active ? 'opacity-70' : 'text-slate-400 dark:text-slate-500'}`}>
          {formatNumber(count)}
        </span>
      </button>
    );
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Search */}
      <div className="relative flex-1 min-w-[180px] max-w-[320px]">
        <span className="material-symbols-outlined absolute start-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 text-base pointer-events-none">
          search
        </span>
        <input
          type="text"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={searchPlaceholder}
          className="w-full h-9 ps-10 pe-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[13px] text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
        />
      </div>

      {/* Band filter chips */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {chip('all', 'הכל', total)}
        {bandChips.map((c) => chip(c.key, displayBandStyle(c.key).label, c.count, displayBandStyle(c.key).hex))}
      </div>

      {/* Multi-site toggle (optional) */}
      {onToggleMulti && (
        <button
          type="button"
          onClick={onToggleMulti}
          className={`${chipBase} ${
            multiOnly
              ? 'bg-primary text-white shadow-sm'
              : 'bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:text-slate-700 dark:hover:text-slate-200'
          }`}
        >
          <span className="material-symbols-outlined text-[15px]">alt_route</span>
          {multiLabel}
        </button>
      )}

      {/* Sort cycle */}
      <button
        type="button"
        onClick={onSort}
        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-[12.5px] font-medium whitespace-nowrap bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:text-slate-700 dark:hover:text-slate-200 transition-colors ms-auto"
        title="שינוי מיון"
      >
        <span className="material-symbols-outlined text-[16px]">unfold_more</span>
        {SORT_LABELS[sort]}
      </button>
    </div>
  );
}
