import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  CartesianGrid,
} from 'recharts';
import { getDashboardSummary } from '../api/dashboard';
import MonthPicker from '../components/MonthPicker';
import type { DashboardSummary } from '../types';

const STATUS_META: Record<string, { label: string; color: string }> = {
  NEEDS_ASSIGNMENT: { label: 'צריך שיוך', color: '#f97316' },
  NEEDS_REVIEW: { label: 'צריך בדיקה', color: '#0ea5e9' },
  APPROVED: { label: 'מאושר', color: '#22c55e' },
  REJECTED: { label: 'נדחה', color: '#ef4444' },
};

const SERIES_META = [
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

const buildMonthOptions = (count: number) => {
  const now = new Date();
  const options: Array<{ value: string; label: string }> = [];
  for (let i = 0; i < count; i += 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const label = new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric' }).format(date);
    options.push({ value, label });
  }
  return options;
};

export default function DashboardPage() {
  const { businessCode } = useParams<{ businessCode: string }>();
  const navigate = useNavigate();
  const monthOptions = useMemo(() => buildMonthOptions(12), []);
  const [selectedMonth, setSelectedMonth] = useState(monthOptions[0]?.value ?? '');
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const REVIEW_PAGE_SIZE = 5;
  const [reviewPage, setReviewPage] = useState(0);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      setIsLoading(true);
      setReviewPage(0);
      try {
        const data = await getDashboardSummary(selectedMonth);
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
    if (selectedMonth) {
      load();
    }
    return () => {
      isMounted = false;
    };
  }, [selectedMonth]);

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

  const statusTotal = useMemo(() => statusData.reduce((sum, item) => sum + item.count, 0), [statusData]);
  const statusChartData = useMemo(() => statusData.filter((item) => item.count > 0), [statusData]);
  const statusDonutData = useMemo(
    () =>
      statusChartData.length > 0
        ? statusChartData
        : [{ status: 'EMPTY', label: 'ללא נתונים', count: 1, color: '#e2e8f0' }],
    [statusChartData]
  );

  const reviewTablePage = useMemo(() => {
    if (!summary?.sites_review_table) return [];
    const start = reviewPage * REVIEW_PAGE_SIZE;
    return summary.sites_review_table.slice(start, start + REVIEW_PAGE_SIZE);
  }, [summary, reviewPage]);

  const reviewTotalPages = useMemo(() => {
    if (!summary?.sites_review_table) return 0;
    return Math.ceil(summary.sites_review_table.length / REVIEW_PAGE_SIZE);
  }, [summary]);

  const trendData = useMemo(() => {
    if (!summary) return [];
    return summary.trends.months.map((month, index) => ({
      month,
      label: formatShortMonth(month),
      employees: summary.trends.employees[index] ?? 0,
      work_cards: summary.trends.work_cards[index] ?? 0,
      sites: summary.trends.sites[index] ?? 0,
    }));
  }, [summary]);

  const lastUpdated = summary?.generated_at
    ? new Intl.DateTimeFormat('he-IL', {
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: 'short',
      }).format(new Date(summary.generated_at))
    : '';

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white">לוח בקרה</h1>
          <p className="text-slate-500 dark:text-slate-400">
            נראות מלאה של הפעילות והסטטוסים בארגון
          </p>
        </div>
        <div className="flex flex-col gap-2 md:items-end">
          <label className="text-xs text-slate-500">בחר חודש</label>
          <MonthPicker value={selectedMonth} onChange={setSelectedMonth} storageKey="dashboard_month" />
          {lastUpdated && (
            <span className="text-[11px] text-slate-400">עודכן לאחרונה: {lastUpdated}</span>
          )}
        </div>
      </header>

      {isLoading && (
        <div className="flex flex-col gap-6 animate-pulse">
          <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[1, 2, 3].map((key) => (
              <div
                key={key}
                className="bg-white dark:bg-[#1a2a35] rounded-xl p-6 shadow-sm border border-slate-200 dark:border-slate-700"
              >
                <div className="h-3 w-20 bg-slate-200 dark:bg-slate-700 rounded" />
                <div className="h-8 w-24 bg-slate-200 dark:bg-slate-700 rounded mt-4" />
                <div className="h-3 w-32 bg-slate-200 dark:bg-slate-700 rounded mt-3" />
              </div>
            ))}
          </section>

          <section className="bg-white dark:bg-[#1a2a35] rounded-xl shadow-xl border border-slate-200/50 dark:border-slate-700/50 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700">
              <div className="h-4 w-52 bg-slate-200 dark:bg-slate-700 rounded" />
            </div>
            <div className="px-6 py-6 space-y-4">
              {[1, 2, 3, 4, 5].map((row) => (
                <div key={row} className="h-4 w-full bg-slate-200 dark:bg-slate-700 rounded" />
              ))}
            </div>
          </section>

          <section className="grid grid-cols-1 xl:grid-cols-3 gap-6 xl:items-start">
            <div className="bg-white dark:bg-[#1a2a35] rounded-xl p-6 shadow-sm border border-slate-200 dark:border-slate-700">
              <div className="h-4 w-40 bg-slate-200 dark:bg-slate-700 rounded" />
              <div className="h-52 w-full bg-slate-200 dark:bg-slate-700 rounded-xl mt-6" />
            </div>
            <div className="bg-white dark:bg-[#1a2a35] rounded-xl p-6 shadow-sm border border-slate-200 dark:border-slate-700 xl:col-span-2">
              <div className="h-4 w-48 bg-slate-200 dark:bg-slate-700 rounded" />
              <div className="h-60 w-full bg-slate-200 dark:bg-slate-700 rounded-xl mt-6" />
            </div>
          </section>

          <section className="bg-white dark:bg-[#1a2a35] rounded-xl shadow-xl border border-slate-200/50 dark:border-slate-700/50 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700">
              <div className="h-4 w-44 bg-slate-200 dark:bg-slate-700 rounded" />
            </div>
            <div className="px-6 py-6 space-y-4">
              {[1, 2, 3, 4].map((row) => (
                <div key={row} className="h-4 w-full bg-slate-200 dark:bg-slate-700 rounded" />
              ))}
            </div>
          </section>
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
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-500">אתרים פעילים</p>
                <span className="material-symbols-outlined text-slate-400">business</span>
              </div>
              <p className="text-3xl font-bold text-slate-900 dark:text-white mt-3">
                {formatNumber(summary.metrics.sites)}
              </p>
              <p className="text-xs text-slate-400 mt-3">נספר לפי סטטוס פעיל</p>
            </div>
            <div className="bg-white dark:bg-[#1a2a35] rounded-xl p-6 shadow-sm border border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-500">עובדים פעילים</p>
                <span className="material-symbols-outlined text-slate-400">group</span>
              </div>
              <p className="text-3xl font-bold text-slate-900 dark:text-white mt-3">
                {formatNumber(summary.metrics.employees)}
              </p>
              <p className="text-xs text-slate-400 mt-3">כולל שיבוץ לאתר</p>
            </div>
            <div className="bg-gradient-to-br from-[#eef6ff] to-[#fef9f0] dark:from-[#15232d] dark:to-[#1a2a35] rounded-xl p-6 shadow-sm border border-slate-200/60 dark:border-slate-700">
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-600 dark:text-slate-400">כרטיסי עבודה החודש</p>
                <span className="material-symbols-outlined text-slate-400">assignment</span>
              </div>
              <p className="text-3xl font-bold text-slate-900 dark:text-white mt-3">
                {formatNumber(summary.metrics.work_cards)}
              </p>
              <p className="text-xs text-slate-400 mt-3">לפי חודש עבודה נוכחי</p>
            </div>
          </section>

          {(summary.sites_review_table?.length ?? 0) > 0 && (
            <section className="bg-white dark:bg-[#1a2a35] rounded-xl shadow-xl border border-slate-200/50 dark:border-slate-700/50 overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">אתרים הדורשים טיפול</h2>
                  <p className="text-xs text-slate-400 mt-1">אתרים עם כרטיסי עבודה שממתינים לבדיקה או שיוך לחודש הנבחר</p>
                </div>
                <span className="text-xs text-slate-400">{formatMonthTitle(summary.month)}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-right border-collapse">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                      <th className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200">שם אתר</th>
                      <th className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200">עובדים פעילים</th>
                      <th className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200">סה"כ כרטיסים</th>
                      <th className="px-6 py-4 text-sm font-bold text-green-600 dark:text-green-400">מאושר</th>
                      <th className="px-6 py-4 text-sm font-bold text-sky-600 dark:text-sky-400">צריך בדיקה</th>
                      <th className="px-6 py-4 text-sm font-bold text-orange-500 dark:text-orange-400">צריך שיוך</th>
                      <th className="px-6 py-4 text-sm font-bold text-red-500 dark:text-red-400">נדחה</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                    {reviewTablePage.map((site) => (
                      <tr
                        key={site.site_id}
                        className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors cursor-pointer"
                        onClick={() => { if (businessCode) navigate(`/${businessCode}/sites/${site.site_id}`); }}
                      >
                        <td className="px-6 py-5 text-[#111518] dark:text-white font-medium">{site.site_name}</td>
                        <td className="px-6 py-5 text-[#111518] dark:text-white">{formatNumber(site.active_employee_count)}</td>
                        <td className="px-6 py-5 text-[#111518] dark:text-white">{formatNumber(site.total_work_cards)}</td>
                        <td className="px-6 py-5 text-green-600 dark:text-green-400 font-medium">{site.approved > 0 ? formatNumber(site.approved) : '—'}</td>
                        <td className="px-6 py-5 text-sky-600 dark:text-sky-400 font-medium">{site.needs_review > 0 ? formatNumber(site.needs_review) : '—'}</td>
                        <td className="px-6 py-5 text-orange-500 dark:text-orange-400 font-medium">{site.needs_assignment > 0 ? formatNumber(site.needs_assignment) : '—'}</td>
                        <td className="px-6 py-5 text-red-500 dark:text-red-400 font-medium">{site.rejected > 0 ? formatNumber(site.rejected) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {reviewTotalPages > 1 && (
                <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between text-sm text-slate-500">
                  <span>עמוד {reviewPage + 1} מתוך {reviewTotalPages} ({summary.sites_review_table?.length ?? 0} אתרים)</span>
                  <div className="flex items-center gap-2">
                    <button
                      className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      onClick={() => setReviewPage((p) => p - 1)}
                      disabled={reviewPage === 0}
                    >
                      הקודם
                    </button>
                    <button
                      className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      onClick={() => setReviewPage((p) => p + 1)}
                      disabled={reviewPage >= reviewTotalPages - 1}
                    >
                      הבא
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="bg-white dark:bg-[#1a2a35] rounded-xl p-6 shadow-sm border border-slate-200 dark:border-slate-700 xl:self-start">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">התפלגות סטטוסים בכרטיסי עבודה</h2>
                  <p className="text-xs text-slate-400 mt-1">חלוקה לפי מצב טיפול בכרטיסים לחודש הנבחר</p>
                </div>
                <span className="text-[11px] font-medium text-slate-500 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-full shrink-0">
                  {formatMonthTitle(summary.month)}
                </span>
              </div>

              <div className="mt-5 rounded-xl bg-slate-50/80 dark:bg-slate-800/30 border border-slate-200/80 dark:border-slate-700/60 p-4">
                <div className="relative h-[190px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={statusDonutData}
                        dataKey="count"
                        nameKey="label"
                        innerRadius={52}
                        outerRadius={76}
                        paddingAngle={1}
                        cornerRadius={6}
                        stroke="none"
                      >
                        {statusDonutData.map((entry) => (
                          <Cell key={entry.status} fill={entry.color} />
                        ))}
                      </Pie>
                      {statusTotal > 0 && (
                        <Tooltip
                          formatter={(value, _name, item) => {
                            const count = Number(value);
                            const percent = statusTotal > 0 ? Math.round((count / statusTotal) * 100) : 0;
                            return [`${formatNumber(count)} (${percent}%)`, item?.payload?.label ?? 'סטטוס'];
                          }}
                          contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 12px 24px rgba(15,23,42,0.12)' }}
                        />
                      )}
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">סה"כ כרטיסים</span>
                    <span className="text-3xl font-bold text-slate-900 dark:text-white leading-none mt-1">{formatNumber(statusTotal)}</span>
                  </div>
                </div>
                <p className="mt-3 text-center text-[11px] text-slate-500 dark:text-slate-400">
                  העבר עכבר על כל פלח להצגת סטטוס, כמות ואחוז
                </p>
              </div>
            </div>

            <div className="bg-white dark:bg-[#1a2a35] rounded-xl p-6 shadow-sm border border-slate-200 dark:border-slate-700 xl:col-span-2">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">טרנדים 12 חודשים אחרונים</h2>
                  <p className="text-xs text-slate-400 mt-1">כמות פעולות חודשית</p>
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  {SERIES_META.map((series) => (
                    <span key={series.key} className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: series.color }} />
                      {series.label}
                    </span>
                  ))}
                </div>
              </div>
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData} margin={{ top: 10, right: 24, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="4 6" stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} width={36} />
                    <Tooltip
                      formatter={(value) => formatNumber(Number(value))}
                      labelFormatter={(label) => `חודש: ${label}`}
                      contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 12px 24px rgba(15,23,42,0.12)' }}
                    />
                    {SERIES_META.map((series) => (
                      <Line
                        key={series.key}
                        type="monotone"
                        dataKey={series.key}
                        stroke={series.color}
                        strokeWidth={3}
                        dot={{ r: 3, strokeWidth: 2 }}
                        activeDot={{ r: 6 }}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>

          <section className="bg-white dark:bg-[#1a2a35] rounded-xl shadow-xl border border-slate-200/50 dark:border-slate-700/50 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">5 האתרים המובילים לפי עובדים פעילים</h2>
                <p className="text-xs text-slate-400 mt-1">מוצגים רק חמשת האתרים עם מספר העובדים הפעילים הגבוה ביותר</p>
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
                    <tr key={site.site_id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
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
