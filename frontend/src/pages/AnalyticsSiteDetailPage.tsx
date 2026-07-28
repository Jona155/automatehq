import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getSiteAnalytics } from '../api/analytics';
import type { LeaderboardEmployee, SiteAnalyticsDetail } from '../types';
import { bandStyle, formatPct } from '../components/analytics/bands';
import UtilizationBar from '../components/analytics/UtilizationBar';
import BandBadge from '../components/analytics/BandBadge';
import BandDistributionBar from '../components/analytics/BandDistributionBar';
import PeriodToggle, { usePersistedPeriod } from '../components/analytics/PeriodToggle';
import Sparkline from '../components/analytics/Sparkline';
import LoadingIndicator from '../components/LoadingIndicator';
import { formatNumber } from '../utils/formatNumber';

function monthLabel(months: string[]): string {
  if (!months.length) return '';
  try {
    return new Date(months[0]).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
  } catch {
    return months[0];
  }
}

function HoursDelta({ delta }: { delta: number | null }) {
  if (delta === null) return null;
  const rounded = Math.round(delta);
  if (rounded === 0) {
    return <span className="text-xs text-slate-400">בממוצע האתר</span>;
  }
  const below = rounded < 0;
  const abs = formatNumber(Math.abs(rounded));
  return (
    <span
      className={`text-xs font-medium ${
        below ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'
      }`}
    >
      {below ? `${abs} שעות מתחת לממוצע האתר` : `${abs} שעות מעל ממוצע האתר`}
    </span>
  );
}

function EmployeeRow({ emp, onOpen }: { emp: LeaderboardEmployee; onOpen: () => void }) {
  const [showSites, setShowSites] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
      className="w-full text-start bg-white dark:bg-[#1a2a35] rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700 hover:border-primary/50 hover:shadow-md transition-all cursor-pointer"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1 flex items-center gap-2">
          <span className="font-medium text-slate-900 dark:text-white truncate">{emp.full_name}</span>
          {emp.is_multi_site && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowSites((s) => !s); }}
              className="inline-flex items-center gap-1 text-[10px] font-medium text-sky-700 dark:text-sky-300 bg-sky-100 dark:bg-sky-900/40 px-1.5 py-0.5 rounded-md shrink-0"
              title="עבד ביותר מאתר אחד החודש"
            >
              <span className="material-symbols-outlined text-[13px]">alt_route</span>
              רב-אתרי
            </button>
          )}
        </div>
        <BandBadge band={emp.band} />
      </div>

      <div className="mt-2">
        <UtilizationBar pct={emp.utilization_pct} band={emp.band} />
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <HoursDelta delta={emp.delta_hours_vs_site_avg} />
        <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
          {formatNumber(Math.round(emp.total_hours))} ש' סה"כ
        </span>
      </div>

      {emp.trend.length > 1 && (
        <div className="mt-1">
          <Sparkline trend={emp.trend} color={bandStyle(emp.band).hex} height={32} />
        </div>
      )}

      {emp.is_multi_site && showSites && (
        <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-700/60 space-y-1">
          {emp.sites_worked.map((s) => (
            <div key={s.site_id} className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
              <span className="truncate">{s.site_name || '—'}</span>
              <span className="tabular-nums shrink-0 ps-2">{formatNumber(Math.round(s.hours))} ש'</span>
            </div>
          ))}
          <div className="flex items-center justify-between text-xs font-medium text-slate-800 dark:text-slate-100 pt-1">
            <span>סה"כ</span>
            <span className="tabular-nums">{formatNumber(Math.round(emp.total_hours))} ש'</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AnalyticsSiteDetailPage() {
  const { businessCode, siteId } = useParams<{ businessCode: string; siteId: string }>();
  const navigate = useNavigate();

  const [data, setData] = useState<SiteAnalyticsDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = usePersistedPeriod();

  useEffect(() => {
    if (!siteId) return;
    let isMounted = true;
    (async () => {
      setIsLoading(true);
      try {
        const result = await getSiteAnalytics(siteId, period);
        if (!isMounted) return;
        setData(result);
        setError(null);
      } catch (err) {
        console.error('Failed to load site analytics:', err);
        if (isMounted) setError('לא הצלחנו לטעון את נתוני האתר');
      } finally {
        if (isMounted) setIsLoading(false);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [siteId, period]);

  const health = data?.site_health;
  const spreadMin = health?.spread.min;
  const spreadMax = health?.spread.max;

  return (
    <div className="flex flex-col gap-6">
      {/* Back link */}
      <Link
        to={`/${businessCode}/analytics`}
        className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-primary self-start"
      >
        <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
        חזרה לביצועי אתרים
      </Link>

      {isLoading && <LoadingIndicator title="טוען נתוני אתר..." />}

      {!isLoading && error && (
        <div className="bg-red-50 border border-red-100 text-red-600 rounded-xl p-6 dark:bg-red-900/20 dark:border-red-900/40 dark:text-red-300">
          {error}
        </div>
      )}

      {!isLoading && !error && data && health && (
        <>
          {/* Header + health strip */}
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{data.site_name || '—'}</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">{monthLabel(data.months)}</p>
            </div>
            <PeriodToggle value={period} onChange={setPeriod} />
          </div>

          <div className="bg-white dark:bg-[#1a2a35] rounded-xl p-5 shadow-sm border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm text-slate-500 dark:text-slate-400">ממוצע ניצולת באתר</p>
                <p
                  className="text-3xl font-bold mt-1 tabular-nums"
                  style={{ color: bandStyle(health.band).hex }}
                >
                  {formatPct(health.avg_utilization)}
                </p>
                {health.avg_hours !== null && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
                    {formatNumber(Math.round(health.avg_hours))} ש' בממוצע מתוך {formatNumber(data.target_hours)}
                  </p>
                )}
              </div>
              <BandBadge band={health.band} />
            </div>

            <div className="mt-4">
              <BandDistributionBar distribution={health.band_distribution} />
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                <span>{formatNumber(health.employee_count)} עובדים</span>
                <span className="text-red-600 dark:text-red-400">
                  {formatNumber(health.low_performer_count)} בניצולת נמוכה
                </span>
                {spreadMin !== null && spreadMax !== null && (
                  <span>טווח {formatPct(spreadMin)}–{formatPct(spreadMax)}</span>
                )}
              </div>
              {health.trend.length > 1 && (
                <div className="mt-3">
                  <Sparkline trend={health.trend} color={bandStyle(health.band).hex} height={44} />
                </div>
              )}
            </div>
          </div>

          {/* Leaderboard, worst-first */}
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              עובדים לפי ניצולת
            </h2>
            {data.employees.length === 0 ? (
              <div className="text-center text-slate-500 dark:text-slate-400 py-8">אין עובדים להצגה</div>
            ) : (
              data.employees.map((emp) => (
                <EmployeeRow
                  key={emp.employee_id}
                  emp={emp}
                  onOpen={() => navigate(`/${businessCode}/analytics/sites/${siteId}/employees/${emp.employee_id}`)}
                />
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
