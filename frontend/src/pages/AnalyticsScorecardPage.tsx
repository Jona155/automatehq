import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getSiteScorecard } from '../api/analytics';
import type { Band, BandDistribution, ScorecardSite, SiteScorecard } from '../types';
import { rowStyle } from '../components/analytics/bands';
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

function StatCard({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: string }) {
  return (
    <div className="bg-white dark:bg-[#1a2a35] rounded-xl p-3.5 shadow-sm border border-slate-200 dark:border-slate-700">
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`text-xl font-bold mt-1 tabular-nums ${tone}`}>{value}</p>
      <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>
    </div>
  );
}

function SiteCard({ site, target, onOpen }: { site: ScorecardSite; target: number; onOpen: () => void }) {
  const style = rowStyle(site.band, site.avg_hours);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full text-start bg-white dark:bg-[#1a2a35] rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700 hover:border-primary/50 hover:shadow-md transition-all cursor-pointer"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 flex items-start gap-2">
          <span className="w-2.5 h-2.5 rounded-sm mt-1.5 shrink-0" style={{ backgroundColor: style.hex }} />
          <div className="min-w-0">
            <h3 className="font-semibold text-slate-900 dark:text-white truncate">{site.site_name || '—'}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {formatNumber(site.employee_count)} עובדים
            </p>
          </div>
        </div>
        <HoursHeadline
          hours={site.avg_hours}
          target={target}
          pct={site.avg_utilization}
          band={site.band}
          className="shrink-0 justify-end"
        />
      </div>

      <div className="mt-3">
        <BandDistributionBar distribution={site.band_distribution} />
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <GapLabel hours={site.avg_hours} target={target} />
        {site.low_performer_count > 0 && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/40 px-2 py-0.5 rounded-md shrink-0">
            <span className="material-symbols-outlined text-[14px]">trending_down</span>
            {formatNumber(site.low_performer_count)} בניצולת נמוכה
          </span>
        )}
      </div>

      {site.trend.length > 1 && (
        <div className="mt-2">
          <Sparkline trend={site.trend} color={style.hex} />
        </div>
      )}
    </button>
  );
}

export default function AnalyticsScorecardPage() {
  const { businessCode } = useParams<{ businessCode: string }>();
  const navigate = useNavigate();

  const [data, setData] = useState<SiteScorecard | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = usePersistedPeriod();

  useEffect(() => {
    let isMounted = true;
    (async () => {
      setIsLoading(true);
      try {
        const result = await getSiteScorecard(period);
        if (!isMounted) return;
        setData(result);
        setError(null);
      } catch (err) {
        console.error('Failed to load site scorecard:', err);
        if (isMounted) setError('לא הצלחנו לטעון את נתוני הביצועים');
      } finally {
        if (isMounted) setIsLoading(false);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [period]);

  const overallBand = useMemo<Band | null>(() => {
    const avg = data?.summary.overall_avg_utilization;
    if (avg === null || avg === undefined) return null;
    if (avg >= 90) return 'HIGH';
    if (avg >= 70) return 'MID';
    return 'LOW';
  }, [data]);

  const sites = useMemo(() => data?.sites ?? [], [data]);
  const target = data?.target_hours ?? 0;

  const filters = useUtilizationFilters(sites, {
    name: (s) => s.site_name || '',
    searchText: (s) => s.site_name || '',
    band: (s) => s.band,
    hours: (s) => s.avg_hours,
  });

  // Distribution of SITES by band (each site carries a single band → no
  // multi-site double-counting). Drives the clickable hero filter.
  const siteDist: BandDistribution = useMemo(() => {
    const d: BandDistribution = { HIGH: 0, MID: 0, LOW: 0 };
    sites.forEach((s) => {
      if (s.band && s.avg_hours !== null && s.avg_hours > 0) d[s.band] += 1;
    });
    return d;
  }, [sites]);

  const noReportCount = filters.noReport.length;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">ביצועי אתרים</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            ממוצע שעות לעובד מול יעד של 236 ש' לחודש
            {data && ` · ${monthLabel(data.months)}`}
          </p>
        </div>
        <PeriodToggle value={period} onChange={setPeriod} />
      </div>

      {isLoading && <LoadingIndicator title="טוען ביצועים..." />}

      {!isLoading && error && (
        <div className="bg-red-50 border border-red-100 text-red-600 rounded-xl p-6 dark:bg-red-900/20 dark:border-red-900/40 dark:text-red-300">
          {error}
        </div>
      )}

      {!isLoading && !error && data && (
        <>
          {/* Hero: average worked hours per employee across in-scope sites */}
          <div className="bg-white dark:bg-[#1a2a35] rounded-xl p-5 shadow-sm border border-slate-200 dark:border-slate-700">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm text-slate-500 dark:text-slate-400">ממוצע שעות לעובד</p>
                  <BandBadge band={overallBand} />
                </div>
                <HoursHeadline
                  hours={data.summary.overall_avg_hours}
                  target={target}
                  pct={data.summary.overall_avg_utilization}
                  band={overallBand}
                  size="lg"
                />
                <GapLabel hours={data.summary.overall_avg_hours} target={target} className="mt-0.5" />
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
                distribution={siteDist}
                activeBand={filters.band === 'NO_REPORT' ? 'all' : filters.band}
                onSelect={(b) => filters.setBand(filters.band === b ? 'all' : b)}
              />
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                <span>{formatNumber(data.summary.total_sites)} אתרים</span>
                <span className="text-emerald-600 dark:text-emerald-400">
                  {formatNumber(data.summary.sites_meeting_criteria)} עומדים ביעד
                </span>
                {noReportCount > 0 && <span>{formatNumber(noReportCount)} ללא דיווח</span>}
              </div>
            </div>
          </div>

          {/* Compact summary stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              label="עובדים מתחת לממוצע"
              value={formatNumber(data.summary.employees_below_average)}
              sub={`מתוך ${formatNumber(data.summary.total_employees)} עובדים`}
              tone="text-red-600 dark:text-red-400"
            />
            <StatCard
              label="עובדים מעל הממוצע"
              value={formatNumber(data.summary.employees_above_average)}
              sub={`מתוך ${formatNumber(data.summary.total_employees)} עובדים`}
              tone="text-emerald-600 dark:text-emerald-400"
            />
            <StatCard
              label="אתרים העומדים ביעד"
              value={`${formatNumber(data.summary.sites_meeting_criteria)} / ${formatNumber(data.summary.total_sites)}`}
              sub="ניצולת 70% ומעלה"
              tone="text-slate-900 dark:text-white"
            />
            <StatCard
              label="אתרים ללא דיווח"
              value={formatNumber(noReportCount)}
              sub="ללא שעות בתקופה"
              tone="text-slate-900 dark:text-white"
            />
          </div>

          {/* Toolbar */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">אתרים לפי ניצולת</h2>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              מציג {formatNumber(filters.filtered.length)} מתוך {formatNumber(filters.total)}
            </span>
          </div>

          <AnalyticsFilterBar
            query={filters.query}
            onQuery={filters.setQuery}
            searchPlaceholder="חיפוש אתר"
            total={filters.total}
            bandChips={filters.bandChips}
            activeBand={filters.band}
            onBand={filters.setBand}
            sort={filters.sort}
            onSort={filters.cycleSort}
          />

          {/* Site cards, worst-first */}
          {filters.filtered.length === 0 ? (
            <div className="text-center text-slate-500 dark:text-slate-400 py-10">
              {sites.length === 0 ? 'אין אתרים להצגה' : 'אין תוצאות לסינון הזה'}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {filters.filtered.map((site) => (
                <SiteCard
                  key={site.site_id}
                  site={site}
                  target={target}
                  onOpen={() => navigate(`/${businessCode}/analytics/sites/${site.site_id}`)}
                />
              ))}
            </div>
          )}

          {/* No-report site group */}
          <CollapsibleGroup title="אתרים ללא דיווח" count={noReportCount} hint="אתרים ללא דיווח שעות בתקופה">
            <div className="flex flex-col">
              {filters.noReport.map((site) => (
                <button
                  key={site.site_id}
                  type="button"
                  onClick={() => navigate(`/${businessCode}/analytics/sites/${site.site_id}`)}
                  className="flex items-center justify-between gap-3 px-4 py-3 text-start bg-white dark:bg-[#1a2a35] border-b border-slate-100 dark:border-slate-700/60 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate block">
                      {site.site_name || '—'}
                    </span>
                    <span className="text-[11px] text-slate-400">{formatNumber(site.employee_count)} עובדים</span>
                  </div>
                  <span className="text-xs font-semibold text-red-600 dark:text-red-400 shrink-0">0 ש'</span>
                </button>
              ))}
            </div>
          </CollapsibleGroup>
        </>
      )}
    </div>
  );
}
