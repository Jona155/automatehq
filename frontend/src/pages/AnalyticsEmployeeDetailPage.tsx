import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getEmployeeAnalytics } from '../api/analytics';
import type { EmployeeAnalyticsDetail } from '../types';
import { bandStyle, formatPct, perMonthHours } from '../components/analytics/bands';
import UtilizationBar from '../components/analytics/UtilizationBar';
import BandBadge from '../components/analytics/BandBadge';
import HoursHeadline from '../components/analytics/HoursHeadline';
import GapLabel from '../components/analytics/GapLabel';
import PeriodToggle, { usePersistedPeriod } from '../components/analytics/PeriodToggle';
import Sparkline from '../components/analytics/Sparkline';
import LoadingIndicator from '../components/LoadingIndicator';
import { formatNumber } from '../utils/formatNumber';

function monthLabel(months: string[]): string {
  if (!months.length) return '';
  const fmt = (m: string) => {
    try {
      return new Date(m).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
    } catch {
      return m;
    }
  };
  return months.length === 1 ? fmt(months[0]) : `${fmt(months[0])} – ${fmt(months[months.length - 1])}`;
}

function ComparisonRow({ label, avg, mine }: { label: string; avg: number | null; mine: number }) {
  if (avg === null) return null;
  const delta = Math.round(mine - avg);
  const positive = delta > 0;
  const neutral = delta === 0;
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-700/60 last:border-0">
      <span className="text-sm text-slate-600 dark:text-slate-300">{label}</span>
      <div className="flex items-center gap-3">
        <span className="text-sm text-slate-500 dark:text-slate-400 tabular-nums">{formatPct(avg)}</span>
        <span
          className={`text-sm font-semibold tabular-nums min-w-[3.5ch] text-end ${
            neutral
              ? 'text-slate-400'
              : positive
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-red-600 dark:text-red-400'
          }`}
        >
          {neutral ? '±0' : `${positive ? '+' : ''}${delta}`}
        </span>
      </div>
    </div>
  );
}

export default function AnalyticsEmployeeDetailPage() {
  const { businessCode, siteId, employeeId } = useParams<{ businessCode: string; siteId: string; employeeId: string }>();

  const [data, setData] = useState<EmployeeAnalyticsDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = usePersistedPeriod();

  useEffect(() => {
    if (!siteId || !employeeId) return;
    let isMounted = true;
    (async () => {
      setIsLoading(true);
      try {
        const result = await getEmployeeAnalytics(siteId, employeeId, period);
        if (!isMounted) return;
        setData(result);
        setError(null);
      } catch (err) {
        console.error('Failed to load employee analytics:', err);
        if (isMounted) setError('לא הצלחנו לטעון את נתוני העובד');
      } finally {
        if (isMounted) setIsLoading(false);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [siteId, employeeId, period]);

  return (
    <div className="flex flex-col gap-6">
      <Link
        to={`/${businessCode}/analytics/sites/${siteId}`}
        className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-primary self-start"
      >
        <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
        חזרה לאתר
      </Link>

      {isLoading && <LoadingIndicator title="טוען נתוני עובד..." />}

      {!isLoading && error && (
        <div className="bg-red-50 border border-red-100 text-red-600 rounded-xl p-6 dark:bg-red-900/20 dark:border-red-900/40 dark:text-red-300">
          {error}
        </div>
      )}

      {!isLoading && !error && data && (
        <>
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{data.full_name}</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {data.site_name || '—'} · {monthLabel(data.months)}
              </p>
            </div>
            <PeriodToggle value={period} onChange={setPeriod} />
          </div>

          {/* Hero: worked hours vs target (hours-first) */}
          <div className="bg-white dark:bg-[#1a2a35] rounded-xl p-5 shadow-sm border border-slate-200 dark:border-slate-700">
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <p className="text-sm text-slate-500 dark:text-slate-400">שעות בפועל</p>
                <HoursHeadline
                  hours={data.total_hours}
                  target={data.target_hours}
                  pct={data.utilization_pct}
                  band={data.band}
                  size="lg"
                />
              </div>
              <BandBadge band={data.band} />
            </div>
            <div className="mt-3">
              <UtilizationBar
                pct={data.utilization_pct}
                band={data.band}
                hours={data.total_hours}
                showValue={false}
                showMarker
              />
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <GapLabel hours={data.total_hours} target={data.target_hours} />
              {data.n_months > 1 && (
                <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                  {data.n_months} חודשים
                </span>
              )}
            </div>
          </div>

          {/* Comparisons */}
          <div className="bg-white dark:bg-[#1a2a35] rounded-xl p-5 shadow-sm border border-slate-200 dark:border-slate-700">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">השוואה</h2>
            <ComparisonRow label="מול ממוצע האתר" avg={data.site_avg_utilization} mine={data.utilization_pct} />
            <ComparisonRow label="מול ממוצע העסק" avg={data.company_avg_utilization} mine={data.utilization_pct} />
          </div>

          {/* Trend */}
          {data.trend.length > 1 && (
            <div className="bg-white dark:bg-[#1a2a35] rounded-xl p-5 shadow-sm border border-slate-200 dark:border-slate-700">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">מגמה חודשית</h2>
              <Sparkline trend={data.trend} color={bandStyle(data.band).hex} height={90} showTooltip />
            </div>
          )}

          {/* Sites worked */}
          {data.sites_worked.length > 0 && (
            <div className="bg-white dark:bg-[#1a2a35] rounded-xl p-5 shadow-sm border border-slate-200 dark:border-slate-700">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">
                {data.n_months > 1 ? 'ממוצע חודשי לפי אתר' : 'שעות לפי אתר'}
                {data.sites_worked.length > 1 ? ' (רב-אתרי)' : ''}
              </h2>
              <div className="space-y-1">
                {data.sites_worked.map((s) => (
                  <div key={s.site_id} className="flex items-center justify-between text-sm text-slate-600 dark:text-slate-300">
                    <span className="truncate">{s.site_name || '—'}</span>
                    <span className="tabular-nums shrink-0 ps-2">
                      {formatNumber(Math.round(perMonthHours(s.hours, data.target_hours) ?? 0))} ש'
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
