import type { Band } from '../../types';
import { bandStyle, rowStyle, formatPct } from './bands';

interface UtilizationBarProps {
  pct: number | null;
  band: Band | null;
  hours?: number | null;   // when provided, zero hours renders neutral (no report)
  showValue?: boolean;     // render the % label beside the bar
  showMarker?: boolean;    // draw the full-target reference line
  className?: string;
}

// Headroom above 100% so an over-target bar visibly extends past the target
// marker instead of pinning flush to the end.
const OVER_HEADROOM = 1.15;
const MARKER_POS = 100 / OVER_HEADROOM; // % position of the target line

// Horizontal utilization bar: track + band-colored fill. Without a marker the
// fill caps at 100% (legacy behavior). With a marker the scale runs to 115% so
// over-target reads as overflowing the target line; the label shows the true %.
export default function UtilizationBar({
  pct,
  band,
  hours,
  showValue = true,
  showMarker = false,
  className = '',
}: UtilizationBarProps) {
  const value = pct ?? 0;
  const style = hours !== undefined ? rowStyle(band, hours) : bandStyle(band);
  const denom = showMarker ? 100 * OVER_HEADROOM : 100;
  const width = (Math.max(0, Math.min(value, denom)) / denom) * 100;

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="relative flex-1 h-2.5">
        <div className="absolute inset-0 rounded-full bg-slate-100 dark:bg-slate-700/60" />
        <div
          className={`absolute inset-y-0 rounded-full transition-all duration-300 ${style.barFill}`}
          style={{ insetInlineStart: 0, width: `${width}%` }}
        />
        {showMarker && (
          <div
            className="absolute -top-1 -bottom-1 w-0.5 rounded bg-slate-500/70 dark:bg-slate-200/60"
            style={{ insetInlineStart: `${MARKER_POS}%` }}
            title="יעד"
          />
        )}
      </div>
      {showValue && (
        <span className="text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200 min-w-[3ch] text-start">
          {formatPct(pct)}
        </span>
      )}
    </div>
  );
}
