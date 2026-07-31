import { hoursGap, GAP_TONE_CLASS, perMonthHours, MONTHLY_TARGET_HOURS } from './bands';

interface GapLabelProps {
  hours: number | null | undefined;  // period-accumulated worked hours
  target: number;                    // period target (236 × n_months)
  className?: string;
}

// One-line, human-readable gap to the monthly hours target ("חסרות X ש׳ …" /
// "עומד ביעד …"), colored by severity. Hours are normalized to a per-month figure
// so the gap is always measured against the single monthly target (236).
export default function GapLabel({ hours, target, className = '' }: GapLabelProps) {
  const gap = hoursGap(perMonthHours(hours, target), MONTHLY_TARGET_HOURS);
  return <span className={`text-xs font-semibold ${GAP_TONE_CLASS[gap.tone]} ${className}`}>{gap.text}</span>;
}
