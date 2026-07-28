import type { Band } from '../../types';
import { bandStyle, formatPct } from './bands';

interface UtilizationBarProps {
  pct: number | null;
  band: Band | null;
  showValue?: boolean;   // render the % label beside the bar
  className?: string;
}

// Horizontal utilization bar: track + band-colored fill. The fill width caps at
// 100% (over-target still reads as full) while the label shows the true value.
export default function UtilizationBar({ pct, band, showValue = true, className = '' }: UtilizationBarProps) {
  const value = pct ?? 0;
  const width = Math.max(0, Math.min(value, 100));
  const style = bandStyle(band);

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="flex-1 h-2.5 bg-slate-100 dark:bg-slate-700/60 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${style.barFill}`}
          style={{ width: `${width}%` }}
        />
      </div>
      {showValue && (
        <span className="text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200 min-w-[3ch] text-start">
          {formatPct(pct)}
        </span>
      )}
    </div>
  );
}
