import { useEffect, useState } from 'react';

export type AnalyticsPeriod = 'prev_month' | 'last_3_months' | 'last_6_months';

const OPTIONS: Array<{ value: AnalyticsPeriod; label: string }> = [
  { value: 'prev_month', label: 'חודש קודם' },
  { value: 'last_3_months', label: '3 חודשים' },
  { value: 'last_6_months', label: '6 חודשים' },
];

const STORAGE_KEY = 'analyticsPeriod';

export function usePersistedPeriod(): [AnalyticsPeriod, (p: AnalyticsPeriod) => void] {
  const [period, setPeriod] = useState<AnalyticsPeriod>(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as AnalyticsPeriod | null;
    return saved && OPTIONS.some((o) => o.value === saved) ? saved : 'prev_month';
  });
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, period);
  }, [period]);
  return [period, setPeriod];
}

interface PeriodToggleProps {
  value: AnalyticsPeriod;
  onChange: (p: AnalyticsPeriod) => void;
  className?: string;
}

// Segmented control for the analytics period. Default is the previous complete
// month; the choice persists via usePersistedPeriod.
export default function PeriodToggle({ value, onChange, className = '' }: PeriodToggleProps) {
  return (
    <div className={`inline-flex rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5 ${className}`}>
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
            value === o.value
              ? 'bg-white dark:bg-slate-700 text-primary shadow-sm'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
