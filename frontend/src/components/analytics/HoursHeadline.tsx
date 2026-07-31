import type { Band } from '../../types';
import { rowStyle, softHex, formatPct, perMonthHours, MONTHLY_TARGET_HOURS } from './bands';
import { formatNumber } from '../../utils/formatNumber';

interface HoursHeadlineProps {
  hours: number | null;   // period-accumulated worked hours
  target: number;         // period target (236 × n_months) — used to normalize
  pct: number | null;
  band: Band | null;
  size?: 'lg' | 'md';
  className?: string;
}

// Hours-first metric cluster: the worked-hours number is the headline, the
// "/ target" and the % pill are secondary. Hours are normalized to a per-month
// figure so every period compares against the single monthly target (236).
// Color follows the band, degrading to neutral when there are no reported hours.
export default function HoursHeadline({
  hours,
  target,
  pct,
  band,
  size = 'md',
  className = '',
}: HoursHeadlineProps) {
  const monthly = perMonthHours(hours, target);
  const style = rowStyle(band, monthly);
  const shown = monthly === null ? 0 : Math.round(monthly);
  const bigClass = size === 'lg' ? 'text-4xl' : 'text-2xl';

  return (
    <div className={`flex items-baseline gap-2 flex-wrap ${className}`}>
      <span className={`${bigClass} font-extrabold leading-none tabular-nums`} style={{ color: style.hex }}>
        {formatNumber(shown)}
      </span>
      <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">
        / {formatNumber(MONTHLY_TARGET_HOURS)} ש׳
      </span>
      <span
        className="text-xs font-semibold px-2 py-0.5 rounded-full tabular-nums"
        style={{ color: style.hex, backgroundColor: softHex(style.hex) }}
      >
        {formatPct(pct)}
      </span>
    </div>
  );
}
