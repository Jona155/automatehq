import { useEffect, useMemo, useState } from 'react';
import { getDashboardSummary } from '../api/dashboard';
import type { DashboardSummary } from '../types';

const STATUS_META: Record<string, { label: string; color: string }> = {
  NEEDS_ASSIGNMENT: { label: 'צריך שיוך', color: '#f97316' },
  NEEDS_REVIEW: { label: 'צריך בדיקה', color: '#0ea5e9' },
  APPROVED: { label: 'מאושר', color: '#22c55e' },
  REJECTED: { label: 'נדחה', color: '#ef4444' },
};

const TREND_SERIES = [
  { key: 'employees', label: 'עובדים', color: '#0ea5e9' },
  { key: 'work_cards', label: 'כרטיסי עבודה', color: '#8b5cf6' },
  { key: 'sites', label: 'אתרים', color: '#f59e0b' },
] as const;

const formatMonthTitle = (isoDate: string) => {
  const date = new Date(isoDate);
  return new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric' }).format(date);
};

const formatShortMonth = (month: string) => {
  const [year, monthNum] = month.split('-').map(Number);
  const date = new Date(year, (monthNum || 1) - 1, 1);
  return new Intl.DateTimeFormat('he-IL', { month: 'short' }).format(date);
};

const formatNumber = (value: number) => new Intl.NumberFormat('he-IL').format(value);

const buildLinePoints = (values: number[], width: number, height: number, padding: number, maxValue: number) => {
  if (values.length === 0) return '';
  if (values.length === 1) {
    const x = width / 2;
    const y = padding + (height - padding * 2);
    return `${x},${y}`;
  }
  const step = (width - padding * 2) / (values.length - 1);
  return values
    .map((value, index) => {
      const x = padding + index * step;
      const normalized = maxValue === 0 ? 0 : value / maxValue;
      const y = padding + (1 - normalized) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(' ');
};

export default function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      setIsLoading(true);
      try {
        const data = await getDashboardSummary();
        if (isMounted) {
          setSummary(data);
          setError(null);
        }
      } catch (err) {
        console.error('Failed to load dashboard summary', err);
        if (isMounted) {
          setError('לא הצלחנו לטעון את נתוני הדשבורד');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };
    load();
    return () => {
      isMounted = false;
    };
  }, []);

  const statusData = useMemo(() => {
    const base = Object.keys(STATUS_META).map((key) => ({
      status: key,
      count: 0,
      label: STATUS_META[key].label,
      color: STATUS_META[key].color,
    }));
    if (!summary) return base;
    const map = new Map(summary.work_card_status.map((item) => [item.status, item.count]));
    return base.map((item) => ({ ...item, count: map.get(item.status) ?? 0 }));
  }, [summary]);

  const trendMax = useMemo(() => {
    if (!summary) return 0;
    return Math.max(
      ...summary.trends.employees,
      ...summary.trends.work_cards,
      ...summary.trends.sites,
      1
    );
  }, [summary]);

  const donut = useMemo(() => {
    const total = statusData.reduce((sum, item) => sum + item.count, 0);
    const radius = 56;
    const circumference = 2 * Math.PI * radius;
    let offset = 0;
    const slices = statusData.map((item) => {
      const length = total === 0 ? 0 : (item.count / total) * circumference;
      const dash = `${length} ${circumference - length}`;
      const slice = {
        ...item,
        dash,
        offset: -offset,
      };
      offset += length;
      return slice;
    });
    return { total, radius, circumference, slices };
  }, [statusData]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white">לוח בקרה</h1>
        <p className="text-slate-500 dark:text-slate-400">
          מצב עדכני וטרנדים של הארגון {summary ? `• ${formatMonthTitle(summary.month)}` : ''}
        </p>
      </header>

      {isLoading && (
        <div className="bg-white dark:bg-[#1a2a35] rounded-xl p-8 shadow-sm border border-slate-200 dark:border-slate-700">
          <p className="text-slate-500">טוען נתונים...</p>
        </div>
      )}

      {error && !isLoading && (
        <div className="bg-red-50 border border-red-100 text-red-600 rounded-xl p-6">
          {error}
        </div>
      )}

      {!isLoading && !error && summary && (
        <>
          <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-[#1a2a35] rounded-xl p-6 shadow-sm border border-slate-200 dark:border-slate-700">
              <p className="text-sm text-slate-500">אתרים פעילים</p>
              <p className="text-3xl font-bold text-slate-900 dark:text-white mt-2">
                {formatNumber(summary.metrics.sites)}
              </p>
              <p className="text-xs text-slate-400 mt-2">נספר לפי סטטוס פעיל</p>
            </div>
            <div className="bg-white dark:bg-[#1a2a35] rounded-xl p-6 shadow-sm border border-slate-200 dark:border-slate-700">
              <p className="text-sm text-slate-500">עובדים פעילים</p>
              <p className="text-3xl font-bold text-slate-900 dark:text-white mt-2">
                {formatNumber(summary.metrics.employees)}
              </p>
              <p className="text-xs text-slate-400 mt-2">כולל שיבוץ לאתר</p>
            </div>
            <div className="bg-gradient-to-br from-[#eef6ff] to-[#fef9f0] dark:from-[#15232d] dark:to-[#1a2a35] rounded-xl p-6 shadow-sm border border-slate-200/60 dark:border-slate-700">
              <p className="text-sm text-slate-500">כרטיסי עבודה החודש</p>
              <p className="text-3xl font-bold text-slate-900 dark:text-white mt-2">
                {formatNumber(summary.metrics.work_cards)}
              </p>
              <p className="text-xs text-slate-400 mt-2">לפי חודש עבודה נוכחי</p>
            </div>
          </section>

          <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="bg-white dark:bg-[#1a2a35] rounded-xl p-6 shadow-sm border border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">סטטוסים בכרטיסי עבודה</h2>
                <span className="text-xs text-slate-400">חודש נוכחי</span>
              </div>
              <div className="flex flex-col md:flex-row items-center gap-6">
                <svg width="160" height="160" viewBox="0 0 160 160">
                  <g transform="translate(80 80) rotate(-90)">
                    {donut.slices.map((slice) => (
                      <circle
                        key={slice.status}
                        r={donut.radius}
                        cx="0"
                        cy="0"
                        fill="transparent"
                        stroke={slice.color}
                        strokeWidth="18"
                        strokeDasharray={slice.dash}
                        strokeDashoffset={slice.offset}
                        strokeLinecap="round"
                      />
                    ))}
                  </g>
                  <circle cx="80" cy="80" r="38" fill="white" className="dark:fill-[#1a2a35]" />
                  <text x="80" y="78" textAnchor="middle" className="fill-slate-700 dark:fill-slate-200" fontSize="16" fontWeight="700">
                    {formatNumber(donut.total)}
                  </text>
                  <text x="80" y="98" textAnchor="middle" className="fill-slate-400" fontSize="10">
                    סה״כ
                  </text>
                </svg>

                <div className="flex flex-col gap-3 w-full">
                  {statusData.map((item) => (
                    <div key={item.status} className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                        <span className="text-sm text-slate-700 dark:text-slate-200">{item.label}</span>
                      </div>
                      <span className="text-sm font-semibold text-slate-900 dark:text-white">
                        {formatNumber(item.count)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-[#1a2a35] rounded-xl p-6 shadow-sm border border-slate-200 dark:border-slate-700 xl:col-span-2">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">טרנדים 12 חודשים אחרונים</h2>
                  <p className="text-xs text-slate-400 mt-1">כמות פעולות חודשית</p>
                </div>
                <div className="flex items-center gap-4 text-xs text-slate-500">
                  {TREND_SERIES.map((series) => (
                    <span key={series.key} className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: series.color }} />
                      {series.label}
                    </span>
                  ))}
                </div>
              </div>
              <div className="w-full overflow-x-auto">
                <svg viewBox="0 0 720 240" className="w-full min-w-[520px]">
                  <defs>
                    <linearGradient id="trendGrid" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="#e2e8f0" />
                      <stop offset="100%" stopColor="#f8fafc" />
                    </linearGradient>
                  </defs>
                  <rect x="0" y="0" width="720" height="240" rx="16" fill="url(#trendGrid)" className="dark:fill-[#16232d]" />
                  {[0.25, 0.5, 0.75].map((ratio) => (
                    <line
                      key={ratio}
                      x1="40"
                      x2="680"
                      y1={40 + ratio * 140}
                      y2={40 + ratio * 140}
                      stroke="#e2e8f0"
                      strokeDasharray="4 6"
                    />
                  ))}
                  {TREND_SERIES.map((series) => {
                    const values = summary.trends[series.key];
                    return (
                      <polyline
                        key={series.key}
                        points={buildLinePoints(values, 720, 220, 40, trendMax)}
                        fill="none"
                        stroke={series.color}
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    );
                  })}
                  {summary.trends.months.map((month, index) => {
                    const show = index === 0 || index === summary.trends.months.length - 1 || index % 2 === 1;
                    if (!show) return null;
                    const step = (720 - 80) / (summary.trends.months.length - 1);
                    const x = 40 + index * step;
                    return (
                      <text key={month} x={x} y="228" textAnchor="middle" className="fill-slate-500" fontSize="10">
                        {formatShortMonth(month)}
                      </text>
                    );
                  })}
                </svg>
              </div>
            </div>
          </section>

          <section className="bg-white dark:bg-[#1a2a35] rounded-xl shadow-xl border border-slate-200/50 dark:border-slate-700/50 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">אתרים פעילים ועובדים</h2>
                <p className="text-xs text-slate-400 mt-1">מספר עובדים לפי אתר</p>
              </div>
              <span className="text-xs text-slate-400">{formatMonthTitle(summary.month)}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                    <th className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200">שם אתר</th>
                    <th className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200">מספר עובדים</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                  {summary.sites_table.map((site) => (
                    <tr key={site.site_id}>
                      <td className="px-6 py-5 text-[#111518] dark:text-white font-medium">{site.site_name}</td>
                      <td className="px-6 py-5 text-[#111518] dark:text-white font-medium">
                        {formatNumber(site.employee_count)}
                      </td>
                    </tr>
                  ))}
                  {summary.sites_table.length === 0 && (
                    <tr>
                      <td colSpan={2} className="p-8 text-center text-slate-500">
                        אין אתרים פעילים להצגה
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
