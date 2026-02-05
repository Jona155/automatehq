import { useEffect, useMemo, useState } from 'react';
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
  Legend,
  CartesianGrid,
} from 'recharts';
import { getDashboardSummary } from '../api/dashboard';
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
  const monthOptions = useMemo(() => buildMonthOptions(12), []);
  const [selectedMonth, setSelectedMonth] = useState(monthOptions[0]?.value ?? '');
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      setIsLoading(true);
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
          <select
            className="min-w-[210px] px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1a2a35] text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all"
            value={selectedMonth}
            onChange={(event) => setSelectedMonth(event.target.value)}
          >
            {monthOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
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

          <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
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

          <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="bg-white dark:bg-[#1a2a35] rounded-xl p-6 shadow-sm border border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">סטטוסים בכרטיסי עבודה</h2>
                <span className="text-xs text-slate-400">{formatMonthTitle(summary.month)}</span>
              </div>
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusData} dataKey="count" nameKey="label" innerRadius={60} outerRadius={90}>
                      {statusData.map((entry) => (
                        <Cell key={entry.status} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value) => formatNumber(Number(value))}
                      contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 12px 24px rgba(15,23,42,0.12)' }}
                    />
                    <Legend verticalAlign="bottom" height={48} formatter={(value) => <span className="text-xs text-slate-500">{value}</span>} />
                  </PieChart>
                </ResponsiveContainer>
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
