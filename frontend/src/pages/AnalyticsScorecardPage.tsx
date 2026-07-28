import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getSiteScorecard } from '../api/analytics';
import type { SiteScorecard } from '../types';
import { bandStyle, formatPct } from '../components/analytics/bands';
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

  const overallBand = useMemo(() => {
    const avg = data?.summary.overall_avg_utilization;
    if (avg === null || avg === undefined) return null;
    if (avg >= 90) return 'HIGH' as const;
    if (avg >= 70) return 'MID' as const;
    return 'LOW' as const;
  }, [data]);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">ביצועי אתרים</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            ניצולת שעות מול יעד של {data ? formatNumber(236) : '236'} שעות לחודש
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
          {/* Headline metric tiles — scoped to the sites the user can see */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-white dark:bg-[#1a2a35] rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
              <p className="text-xs text-slate-500 dark:text-slate-400">אתרים העומדים ביעד</p>
              <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1 tabular-nums">
                {formatNumber(data.summary.sites_meeting_criteria)}
                <span className="text-base font-medium text-slate-400"> / {formatNumber(data.summary.total_sites)}</span>
              </p>
              <p className="text-[11px] text-slate-400 mt-1">ניצולת 70% ומעלה</p>
            </div>
            <div className="bg-white dark:bg-[#1a2a35] rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
              <p className="text-xs text-slate-500 dark:text-slate-400">עובדים מתחת לממוצע</p>
              <p className="text-2xl font-bold text-red-600 dark:text-red-400 mt-1 tabular-nums">
                {formatNumber(data.summary.employees_below_average)}
              </p>
              <p className="text-[11px] text-slate-400 mt-1">מתוך {formatNumber(data.summary.total_employees)} עובדים</p>
            </div>
            <div className="bg-white dark:bg-[#1a2a35] rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
              <p className="text-xs text-slate-500 dark:text-slate-400">עובדים מעל הממוצע</p>
              <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1 tabular-nums">
                {formatNumber(data.summary.employees_above_average)}
              </p>
              <p className="text-[11px] text-slate-400 mt-1">מתוך {formatNumber(data.summary.total_employees)} עובדים</p>
            </div>
            <div className="bg-white dark:bg-[#1a2a35] rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-500 dark:text-slate-400">ממוצע מימוש שעות</p>
                <BandBadge band={overallBand} />
              </div>
              <p className="text-2xl font-bold mt-1 tabular-nums" style={{ color: bandStyle(overallBand).hex }}>
                {formatPct(data.summary.overall_avg_utilization)}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
                {data.summary.overall_avg_hours !== null
                  ? `${formatNumber(Math.round(data.summary.overall_avg_hours))} ש' בממוצע · יעד ${formatNumber(236 * (data.months.length || 1))}`
                  : `יעד ${formatNumber(236 * (data.months.length || 1))} ש'`}
              </p>
            </div>
          </div>

          {/* Site cards, worst-first */}
          {data.sites.length === 0 ? (
            <div className="text-center text-slate-500 dark:text-slate-400 py-10">אין אתרים להצגה</div>
          ) : (
            <div className="flex flex-col gap-3">
              {data.sites.map((site) => {
                const style = bandStyle(site.band);
                return (
                  <button
                    key={site.site_id}
                    type="button"
                    onClick={() => navigate(`/${businessCode}/analytics/sites/${site.site_id}`)}
                    className="w-full text-start bg-white dark:bg-[#1a2a35] rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700 hover:border-primary/50 hover:shadow-md transition-all"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-slate-900 dark:text-white truncate">
                          {site.site_name || '—'}
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {formatNumber(site.employee_count)} עובדים
                        </p>
                      </div>
                      <div className="text-end shrink-0">
                        <div className="text-2xl font-bold tabular-nums" style={{ color: style.hex }}>
                          {formatPct(site.avg_utilization)}
                        </div>
                        {site.avg_hours !== null && (
                          <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">
                            {formatNumber(Math.round(site.avg_hours))} ש' בממוצע
                          </div>
                        )}
                        <BandBadge band={site.band} className="mt-1" />
                      </div>
                    </div>

                    <div className="mt-3">
                      <BandDistributionBar distribution={site.band_distribution} />
                    </div>

                    {site.trend.length > 1 && (
                      <div className="mt-2">
                        <Sparkline trend={site.trend} color={style.hex} />
                      </div>
                    )}

                    {site.low_performer_count > 0 && (
                      <div className="mt-3 flex items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/40 px-2 py-0.5 rounded-md">
                          <span className="material-symbols-outlined text-[14px]">trending_down</span>
                          {formatNumber(site.low_performer_count)} עובדים בניצולת נמוכה
                        </span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
