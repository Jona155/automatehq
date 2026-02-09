import { useMemo, useState } from 'react';
import type { EmployeeImportRow, EmployeeStatus } from '../types';
import { applyEmployeeImport, previewEmployeeImport } from '../api/employeeImports';
import { useToast } from '../hooks/useToast';

const STATUS_LABELS: Record<EmployeeStatus, string> = {
  ACTIVE: 'פעיל',
  REPORTED_IN_SPARK: 'דווח בהברקה',
  REPORTED_RETURNED_FROM_ESCAPE: 'דווח כחזר מבריחה',
};

const fieldLabels: Record<string, string> = {
  full_name: 'שם מלא',
  phone_number: 'טלפון',
  site_id: 'אתר',
  status: 'סטטוס',
};

export default function EmployeeImportPage() {
  const { showToast, ToastContainer } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [previewRows, setPreviewRows] = useState<EmployeeImportRow[]>([]);
  const [summary, setSummary] = useState<{ create: number; update: number; no_change: number; error: number; total: number } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<'create' | 'update' | 'error' | 'all'>('create');

  const handlePreview = async () => {
    if (!file) {
      setError('נא לבחור קובץ');
      return;
    }
    setError(null);
    setIsLoading(true);
    try {
      const data = await previewEmployeeImport(file);
      setPreviewRows(data.rows);
      setSummary(data.summary);
      showToast('הקובץ נותח בהצלחה', 'success');
    } catch (err: any) {
      console.error('Failed to preview import:', err);
      setError(err.response?.data?.error || err.response?.data?.message || 'שגיאה בניתוח הקובץ');
    } finally {
      setIsLoading(false);
    }
  };

  const handleApply = async () => {
    if (!previewRows.length) return;
    setIsApplying(true);
    try {
      const data = await applyEmployeeImport(previewRows);
      setPreviewRows(data.rows);
      setSummary(data.summary);
      showToast('העדכון בוצע בהצלחה', 'success');
    } catch (err: any) {
      console.error('Failed to apply import:', err);
      showToast(err.response?.data?.error || err.response?.data?.message || 'שגיאה בהחלת העדכון', 'error');
    } finally {
      setIsApplying(false);
    }
  };

  const filteredRows = useMemo(() => {
    if (activeFilter === 'all') {
      return previewRows.filter((row) => row.action !== 'no_change');
    }
    return previewRows.filter((row) => row.action === activeFilter);
  }, [previewRows, activeFilter]);

  const formattedRows = useMemo(() => {
    return filteredRows.map((row) => {
      const changesText = row.changes
        .map((change) => {
          const label = fieldLabels[change.field] || change.field;
          if (change.field === 'site_id') {
            const from = row.current?.site_name || '—';
            const to = row.site_name || '—';
            return `${label}: ${from} → ${to}`;
          }
          if (change.field === 'status') {
            const from = row.current?.status ? STATUS_LABELS[row.current.status] : '—';
            const to = row.status ? STATUS_LABELS[row.status] : '—';
            return `${label}: ${from} → ${to}`;
          }
          const from = change.from ?? '—';
          const to = change.to ?? '—';
          return `${label}: ${from} → ${to}`;
        })
        .join(', ');
      return { ...row, changesText };
    });
  }, [filteredRows]);

  const actionBadge = (action: EmployeeImportRow['action']) => {
    switch (action) {
      case 'create':
        return 'bg-emerald-100 text-emerald-700 border border-emerald-200';
      case 'update':
        return 'bg-amber-100 text-amber-700 border border-amber-200';
      case 'error':
        return 'bg-red-100 text-red-700 border border-red-200';
      default:
        return 'bg-slate-100 text-slate-600 border border-slate-200';
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <ToastContainer />
      <div className="relative overflow-hidden rounded-2xl border border-slate-200/60 dark:border-slate-700/60 bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-900 dark:via-slate-900/80 dark:to-slate-800 shadow-xl">
        <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-emerald-200/40 blur-3xl dark:bg-emerald-500/20" />
        <div className="absolute -left-10 -bottom-10 h-40 w-40 rounded-full bg-primary/20 blur-3xl" />
        <div className="relative p-8 md:p-10">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-slate-200/70 bg-white/70 px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm dark:border-slate-700/70 dark:bg-slate-900/60 dark:text-slate-300">
                קליטת דיווח חודשי
              </span>
              <h2 className="mt-4 text-[#111518] dark:text-white text-3xl md:text-4xl font-bold tracking-tight">
                עדכון עובדים ואתרים
              </h2>
              <p className="text-[#617989] dark:text-slate-300 mt-2 text-base md:text-lg max-w-2xl">
                העלו קובץ Excel, קבלו תצוגת שינויים מלאה ואז אשרו עדכון מדויק לבסיס הנתונים.
              </p>
            </div>
            <div className="flex flex-col items-start gap-3 text-sm text-slate-600 dark:text-slate-300">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-emerald-600">verified</span>
                התאמת עובדים לפי דרכון
              </div>
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-emerald-600">dataset</span>
                תצוגת דיפ לפני החלה
              </div>
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-emerald-600">history</span>
                ניתן להריץ שוב בבטחה
              </div>
            </div>
          </div>
          <div className="mt-8 grid grid-cols-1 lg:grid-cols-[1.4fr_0.9fr] gap-6">
            <div className="bg-white/80 dark:bg-slate-900/60 rounded-2xl border border-slate-200/60 dark:border-slate-700/60 p-6 shadow-lg">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">שלב 1</div>
                  <div className="text-lg font-bold text-slate-900 dark:text-white">בחרו קובץ</div>
                </div>
                <span className="material-symbols-outlined text-[28px] text-primary">upload_file</span>
              </div>
              <input
                type="file"
                accept=".xlsx"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="block w-full text-sm text-slate-600 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200"
              />
              {file && (
                <div className="mt-3 text-xs text-slate-500">
                  קובץ שנבחר: <span className="font-semibold text-slate-700">{file.name}</span>
                </div>
              )}
            </div>
            <div className="bg-white/80 dark:bg-slate-900/60 rounded-2xl border border-slate-200/60 dark:border-slate-700/60 p-6 shadow-lg">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">שלב 2</div>
                  <div className="text-lg font-bold text-slate-900 dark:text-white">אשרו והחילו</div>
                </div>
                <span className="material-symbols-outlined text-[28px] text-emerald-600">fact_check</span>
              </div>
              <div className="flex flex-col gap-3">
                <button
                  onClick={handlePreview}
                  disabled={isLoading}
                  className="w-full px-6 py-3 bg-primary hover:bg-primary/90 text-white rounded-xl transition-colors font-bold shadow-lg shadow-primary/30 disabled:opacity-50"
                >
                  {isLoading ? 'מנתח...' : 'נתח קובץ'}
                </button>
                <button
                  onClick={handleApply}
                  disabled={!summary || isApplying}
                  className="w-full px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition-colors font-bold shadow-lg shadow-emerald-500/30 disabled:opacity-50"
                >
                  {isApplying ? 'מעדכן...' : 'החל שינויים'}
                </button>
              </div>
              {error && (
                <div className="mt-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100">
                  {error}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { label: 'סה"כ', value: summary.total, color: 'text-slate-700', bg: 'from-slate-50 to-slate-100' },
            { label: 'יצירה', value: summary.create, color: 'text-emerald-700', bg: 'from-emerald-50 to-emerald-100' },
            { label: 'עדכון', value: summary.update, color: 'text-amber-700', bg: 'from-amber-50 to-amber-100' },
            { label: 'ללא שינוי', value: summary.no_change, color: 'text-slate-500', bg: 'from-slate-50 to-slate-100' },
            { label: 'שגיאות', value: summary.error, color: 'text-red-700', bg: 'from-red-50 to-red-100' },
          ].map((item) => (
            <div key={item.label} className={`rounded-2xl border border-slate-200/60 dark:border-slate-700/60 p-4 shadow-lg bg-gradient-to-br ${item.bg}`}>
              <div className="text-xs uppercase tracking-wider text-slate-500">{item.label}</div>
              <div className={`text-3xl font-bold ${item.color}`}>{item.value}</div>
            </div>
          ))}
        </div>
      )}

      {previewRows.length > 0 && (
        <div className="bg-white dark:bg-[#1a2a35] rounded-2xl shadow-xl border border-slate-200/50 dark:border-slate-700/50 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200/60 dark:border-slate-700/60 bg-slate-50/70 dark:bg-slate-800/40">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">תצוגת שינויים</div>
                <div className="text-xs text-slate-500 mt-1">ברירת מחדל מסתירה שורות ללא שינוי</div>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full bg-white/80 dark:bg-slate-900/70 border border-slate-200/60 dark:border-slate-700/60 p-1">
                <button
                  type="button"
                  onClick={() => setActiveFilter('create')}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                    activeFilter === 'create'
                      ? 'bg-emerald-600 text-white shadow'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  יצירה ({summary?.create ?? 0})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveFilter('update')}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                    activeFilter === 'update'
                      ? 'bg-amber-600 text-white shadow'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  עדכון ({summary?.update ?? 0})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveFilter('error')}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                    activeFilter === 'error'
                      ? 'bg-red-600 text-white shadow'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  שגיאות ({summary?.error ?? 0})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveFilter('all')}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                    activeFilter === 'all'
                      ? 'bg-slate-700 text-white shadow'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  הכל ללא שינוי
                </button>
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                  <th className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200">שורה</th>
                  <th className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200">דרכון</th>
                  <th className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200">שם</th>
                  <th className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200">אתר</th>
                  <th className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200">סטטוס</th>
                  <th className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200">פעולה</th>
                  <th className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200">שינויים</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                {formattedRows.map((row) => (
                  <tr key={`${row.passport_id}-${row.row_number}`} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-6 py-4 text-slate-600">{row.row_number ?? '—'}</td>
                    <td className="px-6 py-4 text-slate-900 dark:text-white">{row.passport_id ?? '—'}</td>
                    <td className="px-6 py-4 text-slate-700 dark:text-slate-300">{row.full_name ?? '—'}</td>
                    <td className="px-6 py-4 text-slate-700 dark:text-slate-300">{row.site_name ?? '—'}</td>
                    <td className="px-6 py-4 text-slate-700 dark:text-slate-300">
                      {row.status ? STATUS_LABELS[row.status] : row.status_raw || '—'}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${actionBadge(row.action)}`}>
                        {row.action === 'create' && 'יצירה'}
                        {row.action === 'update' && 'עדכון'}
                        {row.action === 'no_change' && 'ללא שינוי'}
                        {row.action === 'error' && 'שגיאה'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-slate-600 dark:text-slate-400">
                      {row.changesText || '—'}
                      {row.errors.length > 0 && (
                        <div className="text-xs text-red-600 mt-1">שגיאות: {row.errors.length}</div>
                      )}
                      {row.warnings.length > 0 && (
                        <div className="text-xs text-amber-600 mt-1">אזהרות: {row.warnings.length}</div>
                      )}
                    </td>
                  </tr>
                ))}
                {formattedRows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-500">
                      לא נמצאו רשומות להצגה עבור הסינון הנוכחי
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
