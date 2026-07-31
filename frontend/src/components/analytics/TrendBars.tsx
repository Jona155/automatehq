import type { TrendPoint } from '../../types';
import { BAND_STYLES } from './bands';

interface TrendBarsProps {
  trend: TrendPoint[];
  height?: number;
  className?: string;
}

// Small multi-month trend as band-colored vertical bars with a target baseline —
// the hero "מגמת X חודשים" chart. Each bar is colored by that month's band, so a
// climbing red→green series reads at a glance. Renders nothing for < 2 points.
const DEN = 110; // % headroom above target so an over-target bar clears the line

function classify(pct: number): keyof typeof BAND_STYLES {
  if (pct >= 90) return 'HIGH';
  if (pct >= 70) return 'MID';
  return 'LOW';
}

function shortMonth(month: string): string {
  try {
    return new Date(`${month}-01`).toLocaleDateString('he-IL', { month: 'short' });
  } catch {
    return month;
  }
}

export default function TrendBars({ trend, height = 46, className = '' }: TrendBarsProps) {
  if (!trend || trend.length < 2) return null;
  const markerBottom = (100 / DEN) * height;

  return (
    <div className={className} dir="ltr">
      <div className="relative flex items-end gap-1.5" style={{ height }}>
        {/* target baseline */}
        <div
          className="absolute inset-x-0 h-px bg-slate-400/40 dark:bg-slate-400/25"
          style={{ bottom: `${markerBottom}px` }}
        />
        {trend.map((t, i) => {
          const v = t.utilization;
          const barHeight = v === null ? 3 : Math.max(3, (Math.min(v, DEN) / DEN) * height);
          const color = v === null ? '#cbd5e1' : BAND_STYLES[classify(v)].hex;
          return (
            <div key={`${t.month}-${i}`} className="flex-1 flex justify-center">
              <div
                className="w-full rounded-t"
                style={{
                  maxWidth: 26,
                  height: `${barHeight}px`,
                  backgroundColor: color,
                  opacity: v === null ? 0.45 : 1,
                }}
                title={v === null ? '—' : `${Math.round(v)}%`}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-1.5 mt-1">
        {trend.map((t, i) => (
          <span
            key={`${t.month}-${i}-lbl`}
            className="flex-1 text-center text-[10px] text-slate-400 dark:text-slate-500"
          >
            {shortMonth(t.month)}
          </span>
        ))}
      </div>
    </div>
  );
}
