import type { Band } from '../../types';

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
