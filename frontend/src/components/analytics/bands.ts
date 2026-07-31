import type { Band } from '../../types';
import { formatNumber } from '../../utils/formatNumber';

// Single source of truth for performance-band presentation (🟢 HIGH / 🟡 MID /
// 🔴 LOW). Thresholds live in the backend (constants.py); the frontend only
// maps the band the API returns to colors + Hebrew labels. Keep this the ONLY
// place band colors are defined so every view stays consistent.

export interface BandStyle {
  label: string;      // Hebrew label
  barFill: string;    // Tailwind bg-* for a filled utilization bar
  badgeBg: string;    // Tailwind bg for a pill
  badgeText: string;  // Tailwind text for a pill
  hex: string;        // raw hex (for inline styles / charts)
}

export const BAND_STYLES: Record<Band, BandStyle> = {
  HIGH: {
    label: 'גבוה',
    barFill: 'bg-emerald-500',
    badgeBg: 'bg-emerald-100 dark:bg-emerald-900/40',
    badgeText: 'text-emerald-800 dark:text-emerald-300',
    hex: '#10b981',
  },
  MID: {
    label: 'בינוני',
    barFill: 'bg-amber-500',
    badgeBg: 'bg-amber-100 dark:bg-amber-900/40',
    badgeText: 'text-amber-800 dark:text-amber-300',
    hex: '#f59e0b',
  },
  LOW: {
    label: 'נמוך',
    barFill: 'bg-red-500',
    badgeBg: 'bg-red-100 dark:bg-red-900/40',
    badgeText: 'text-red-700 dark:text-red-300',
    hex: '#ef4444',
  },
};

// Neutral fallback for a null band (e.g. an empty site with no employees).
export const EMPTY_BAND_STYLE: BandStyle = {
  label: '—',
  barFill: 'bg-slate-300 dark:bg-slate-600',
  badgeBg: 'bg-slate-100 dark:bg-slate-800',
  badgeText: 'text-slate-500 dark:text-slate-400',
  hex: '#cbd5e1',
};

export const bandStyle = (band: Band | null | undefined): BandStyle =>
  band ? BAND_STYLES[band] : EMPTY_BAND_STYLE;

// Format a utilization percentage for display (no decimals, with %). Null → '—'.
export const formatPct = (pct: number | null | undefined): string =>
  pct === null || pct === undefined ? '—' : `${Math.round(pct)}%`;

// ─── Hours-first display refinements (frontend-only) ────────────────────────
// The API returns the 3 canonical bands, and zero-hour employees land in LOW.
// The hours-first views additionally surface "no report" (0 worked hours) as a
// neutral, non-punitive state kept separate from genuinely low utilization —
// derived on the frontend from the worked hours, no API change.

export type DisplayBand = Band | 'NO_REPORT';

// Worst-first order used for chips/sorting; NO_REPORT is handled separately.
export const DISPLAY_BAND_ORDER: Band[] = ['LOW', 'MID', 'HIGH'];

export const NO_REPORT_STYLE: BandStyle = {
  label: 'ללא דיווח',
  barFill: 'bg-slate-300 dark:bg-slate-600',
  badgeBg: 'bg-slate-100 dark:bg-slate-800',
  badgeText: 'text-slate-500 dark:text-slate-400',
  hex: '#94a3b8',
};

// True when there are no worked hours to report — display neutral, not red.
export const isNoReport = (hours: number | null | undefined): boolean =>
  hours === null || hours === undefined || hours <= 0;

// Refine the API band into a display band, folding zero-hour rows into NO_REPORT.
export const displayBandOf = (band: Band | null, hours: number | null | undefined): DisplayBand =>
  isNoReport(hours) ? 'NO_REPORT' : band ?? 'LOW';

// Presentation style for a row given its band + worked hours (neutral if no report).
export const rowStyle = (band: Band | null, hours: number | null | undefined): BandStyle =>
  isNoReport(hours) ? NO_REPORT_STYLE : bandStyle(band);

export const displayBandStyle = (db: DisplayBand): BandStyle =>
  db === 'NO_REPORT' ? NO_REPORT_STYLE : BAND_STYLES[db];

// Human-readable gap to target, expressed in hours (the headline metric). Tone
// drives the color so a big shortfall reads red, a small one amber, met green.
export type GapTone = 'over' | 'near' | 'far' | 'none';
export interface HoursGap {
  text: string;
  tone: GapTone;
}

export function hoursGap(hours: number | null | undefined, target: number): HoursGap {
  if (isNoReport(hours)) return { text: 'לא דווחו שעות בתקופה', tone: 'none' };
  const delta = Math.round((hours as number) - target);
  if (delta === 0) return { text: 'עומד ביעד במדויק', tone: 'over' };
  if (delta > 0) return { text: `עומד ביעד · ${formatNumber(delta)} ש׳ מעל`, tone: 'over' };
  const missing = Math.abs(delta);
  return { text: `חסרות ${formatNumber(missing)} ש׳ להשלמת היעד`, tone: missing > 70 ? 'far' : 'near' };
}

export const GAP_TONE_CLASS: Record<GapTone, string> = {
  over: 'text-emerald-600 dark:text-emerald-400',
  near: 'text-amber-600 dark:text-amber-400',
  far: 'text-red-600 dark:text-red-400',
  none: 'text-slate-400 dark:text-slate-500',
};

// Soft translucent tint of a band hex — used for the % pill background so it
// reads on both light and dark surfaces without a second color token.
export const softHex = (hex: string): string => `${hex}1f`; // ~12% alpha

// The flat monthly worked-hours target (mirrors backend constants.py). Every
// hours-first view compares against THIS single monthly figure.
export const MONTHLY_TARGET_HOURS = 236;

// Convert a period-accumulated hours figure to its per-month equivalent, so a
// 3/6-month view shows an average month (~236-scale) rather than an accumulated
// total (~708-scale). `periodTarget` is the API's target_hours (236 × n_months).
export const perMonthHours = (hours: number | null | undefined, periodTarget: number): number | null => {
  if (hours === null || hours === undefined) return null;
  if (!periodTarget || periodTarget <= 0) return hours;
  return (hours * MONTHLY_TARGET_HOURS) / periodTarget;
};
