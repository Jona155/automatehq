import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getSiteAnalytics } from '../api/analytics';
import type { BandDistribution, LeaderboardEmployee, SiteAnalyticsDetail } from '../types';
import { rowStyle, formatPct, perMonthHours } from '../components/analytics/bands';
import UtilizationBar from '../components/analytics/UtilizationBar';
import BandBadge from '../components/analytics/BandBadge';
import BandDistributionBar from '../components/analytics/BandDistributionBar';
import HoursHeadline from '../components/analytics/HoursHeadline';
import GapLabel from '../components/analytics/GapLabel';
import CollapsibleGroup from '../components/analytics/CollapsibleGroup';
import AnalyticsFilterBar from '../components/analytics/AnalyticsFilterBar';
import { useUtilizationFilters } from '../components/analytics/useUtilizationFilters';
import PeriodToggle, { usePersistedPeriod } from '../components/analytics/PeriodToggle';
import Sparkline from '../components/analytics/Sparkline';
import TrendBars from '../components/analytics/TrendBars';
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

function EmployeeRow({ emp, target, onOpen }: { emp: LeaderboardEmployee; target: number; onOpen: () => void }) {
  const [showSites, setShowSites] = useState(false);
  const style = rowStyle(emp.band, emp.total_hours);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen();
      }}
      className="w-full text-start bg-white dark:bg-[#1a2a35] rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700 hover:border-primary/50 hover:shadow-md transition-all cursor-pointer"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 flex items-start gap-2">
          <span className="w-2.5 h-2.5 rounded-sm mt-1.5 shrink-0" style={{ backgroundColor: style.hex }} />
          <div className="min-w-0 flex items-center gap-2 flex-wrap">
            <span className="font-medium text-slate-900 dark:text-white truncate">{emp.full_name}</span>
            {emp.is_multi_site && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowSites((s) => !s);
                }}
                className="inline-flex items-center gap-1 text-[10px] font-medium text-sky-700 dark:text-sky-300 bg-sky-100 dark:bg-sky-900/40 px-1.5 py-0.5 rounded-md shrink-0"
                title="עבד ביותר מאתר אחד החודש"
              >
                <span className="material-symbols-outlined text-[13px]">alt_route</span>
                רב-אתרי
              </button>
            )}
          </div>
        </div>
        <HoursHeadline
          hours={emp.total_hours}
          target={target}
          pct={emp.utilization_pct}
          band={emp.band}
          className="shrink-0 justify-end"
        />
      </div>

      <div className="mt-2">
        <UtilizationBar pct={emp.utilization_pct} band={emp.band} hours={emp.total_hours} showValue={false} showMarker />
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <GapLabel hours={emp.total_hours} target={target} />
        <HoursDelta delta={perMonthHours(emp.delta_hours_vs_site_avg, target)} />
      </div>

      {emp.trend.length > 1 && (
        <div className="mt-1">
          <Sparkline trend={emp.trend} color={style.hex} height={32} />
        </div>
      )}

      {emp.is_multi_site && showSites && (
        <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-700/60 space-y-1">
          {emp.sites_worked.map((s) => (
            <div key={s.site_id} className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
              <span className="truncate">{s.site_name || '—'}</span>
              <span className="tabular-nums shrink-0 ps-2">
                {formatNumber(Math.round(perMonthHours(s.hours, target) ?? 0))} ש'
              </span>
            </div>
          ))}
          <div className="flex items-center justify-between text-xs font-medium text-slate-800 dark:text-slate-100 pt-1">
            <span>ממוצע חודשי</span>
            <span className="tabular-nums">{formatNumber(Math.round(perMonthHours(emp.total_hours, target) ?? 0))} ש'</span>
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

  const employees = useMemo(() => data?.employees ?? [], [data]);
  const target = data?.target_hours ?? 0;

  const filters = useUtilizationFilters(employees, {
    name: (e) => e.full_name,
    searchText: (e) => e.full_name,
    band: (e) => e.band,
    hours: (e) => e.total_hours,
    multi: (e) => e.is_multi_site,
  });

  // Distribution computed from the roster so "no report" (0h) is separated from
  // genuine LOW — the API's band_distribution lumps them together.
  const heroDist: BandDistribution = useMemo(() => {
    const d: BandDistribution = { HIGH: 0, MID: 0, LOW: 0 };
    employees.forEach((e) => {
      if (e.total_hours > 0) d[e.band] += 1;
    });
    return d;
  }, [employees]);

  const health = data?.site_health;
  const spreadMin = health?.spread.min ?? null;
  const spreadMax = health?.spread.max ?? null;
  const noReportCount = filters.noReport.length;

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
          {/* Header */}
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{data.site_name || '—'}</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">{monthLabel(data.months)}</p>
            </div>
            <PeriodToggle value={period} onChange={setPeriod} />
          </div>

          {/* Hero: average worked hours per employee (hours-first) */}
          <div className="bg-white dark:bg-[#1a2a35] rounded-xl p-5 shadow-sm border border-slate-200 dark:border-slate-700">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm text-slate-500 dark:text-slate-400">ממוצע שעות לעובד</p>
                  <BandBadge band={health.band} />
                </div>
                <HoursHeadline
                  hours={health.avg_hours}
                  target={target}
                  pct={health.avg_utilization}
                  band={health.band}
                  size="lg"
                />
                <GapLabel hours={health.avg_hours} target={target} className="mt-0.5" />
              </div>
              {data.trend.length > 1 && (
                <div className="flex flex-col gap-1.5 min-w-[200px] flex-1 max-w-[320px]">
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    מגמת {data.trend.length} חודשים
                  </span>
                  <TrendBars trend={data.trend} />
                </div>
              )}
            </div>

            <div className="mt-4">
              <BandDistributionBar
                distribution={heroDist}
                activeBand={filters.band === 'NO_REPORT' ? 'all' : filters.band}
                onSelect={(b) => filters.setBand(filters.band === b ? 'all' : b)}
              />
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                <span>{formatNumber(health.employee_count)} עובדים</span>
                {health.low_performer_count > 0 && (
                  <span className="text-red-600 dark:text-red-400">
                    {formatNumber(health.low_performer_count)} בניצולת נמוכה
                  </span>
                )}
                {noReportCount > 0 && <span>{formatNumber(noReportCount)} ללא דיווח</span>}
                {spreadMin !== null && spreadMax !== null && (
                  <span>
                    טווח {formatPct(spreadMin)}–{formatPct(spreadMax)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Toolbar + leaderboard */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">עובדים לפי ניצולת</h2>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                מציג {formatNumber(filters.filtered.length)} מתוך {formatNumber(filters.total)}
              </span>
            </div>

            <AnalyticsFilterBar
              query={filters.query}
              onQuery={filters.setQuery}
              searchPlaceholder="חיפוש עובד באתר"
              total={filters.total}
              bandChips={filters.bandChips}
              activeBand={filters.band}
              onBand={filters.setBand}
              sort={filters.sort}
              onSort={filters.cycleSort}
              multiOnly={filters.hasMulti ? filters.multiOnly : undefined}
              onToggleMulti={filters.hasMulti ? filters.toggleMulti : undefined}
            />

            {filters.filtered.length === 0 ? (
              <div className="text-center text-slate-500 dark:text-slate-400 py-8">
                {employees.length === 0 ? 'אין עובדים להצגה' : 'אין תוצאות לסינון הזה'}
              </div>
            ) : (
              filters.filtered.map((emp) => (
                <EmployeeRow
                  key={emp.employee_id}
                  emp={emp}
                  target={target}
                  onOpen={() => navigate(`/${businessCode}/analytics/sites/${siteId}/employees/${emp.employee_id}`)}
                />
              ))
            )}

            {/* No-report group */}
            <CollapsibleGroup
              title="לא דווחו שעות"
              count={noReportCount}
              hint="עובדים שלא נרשמו להם שעות בתקופה"
            >
              <div className="flex flex-col">
                {filters.noReport.map((emp) => (
                  <button
                    key={emp.employee_id}
                    type="button"
                    onClick={() => navigate(`/${businessCode}/analytics/sites/${siteId}/employees/${emp.employee_id}`)}
                    className="flex items-center justify-between gap-3 px-4 py-3 text-start bg-white dark:bg-[#1a2a35] border-b border-slate-100 dark:border-slate-700/60 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
                      {emp.full_name}
                    </span>
                    <span className="text-xs font-semibold text-red-600 dark:text-red-400 shrink-0">0 ש'</span>
                  </button>
                ))}
              </div>
            </CollapsibleGroup>
          </div>
        </>
      )}
    </div>
  );
}
