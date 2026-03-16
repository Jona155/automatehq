import { useState, useMemo } from 'react';
import type { SiteTariffImportRow, SiteTariffImportSummary } from '../types';
import { previewSiteTariffImport, applySiteTariffImport } from '../api/siteTariffImport';
import Modal from './Modal';

interface SiteTariffImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplied: () => void;
}

type FilterTab = 'all' | 'update' | 'no_change' | 'error';

export default function SiteTariffImportModal({ isOpen, onClose, onApplied }: SiteTariffImportModalProps) {
  const [phase, setPhase] = useState<'upload' | 'preview' | 'applying'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<SiteTariffImportRow[]>([]);
  const [summary, setSummary] = useState<SiteTariffImportSummary | null>(null);
  const [filterTab, setFilterTab] = useState<FilterTab>('all');

  const handleClose = () => {
    setPhase('upload');
    setFile(null);
    setIsLoading(false);
    setError(null);
    setRows([]);
    setSummary(null);
    setFilterTab('all');
    onClose();
  };

  const handlePreview = async () => {
    if (!file) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await previewSiteTariffImport(file);
      setRows(result.rows);
      setSummary(result.summary);
      setPhase('preview');
    } catch (err: any) {
      setError(err?.response?.data?.message || 'שגיאה בניתוח הקובץ');
    } finally {
      setIsLoading(false);
    }
  };

  const handleApply = async () => {
    const updateRows = rows.filter((r) => r.action === 'update');
    if (updateRows.length === 0) return;
    setPhase('applying');
    setError(null);
    try {
      await applySiteTariffImport(updateRows);
      onApplied();
      handleClose();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'שגיאה בעדכון תעריפים');
      setPhase('preview');
    }
  };

  const filteredRows = useMemo(() => {
    if (filterTab === 'all') return rows;
    return rows.filter((r) => r.action === filterTab);
  }, [rows, filterTab]);

  const actionLabel = (action: string) => {
    switch (action) {
      case 'update': return 'עדכון';
      case 'no_change': return 'ללא שינוי';
      case 'error': return 'שגיאה';
      default: return action;
    }
  };

  const actionColor = (action: string) => {
    switch (action) {
      case 'update': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
      case 'no_change': return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400';
      case 'error': return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
      default: return 'bg-slate-100 text-slate-600';
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="ייבוא תעריפים מקובץ" maxWidth="4xl">
      <div className="flex flex-col gap-4" dir="rtl">
        {error && (
          <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100">
            {error}
          </div>
        )}

        {phase === 'upload' && (
          <>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              העלה קובץ Excel עם עמודות שם אתר ותעריף שעתי. המערכת תתאים אוטומטית את האתרים הקיימים.
            </p>
            <div>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="block w-full text-sm text-slate-500 file:ml-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700 rounded-lg transition-colors font-medium"
              >
                ביטול
              </button>
              <button
                type="button"
                onClick={handlePreview}
                disabled={!file || isLoading}
                className="px-6 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg transition-colors font-bold shadow-lg shadow-primary/30 disabled:opacity-50"
              >
                {isLoading ? 'מנתח...' : 'נתח קובץ'}
              </button>
            </div>
          </>
        )}

        {phase === 'preview' && summary && (
          <>
            {/* Summary badges */}
            <div className="flex flex-wrap gap-3">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                <span className="text-sm font-bold text-green-700 dark:text-green-400">{summary.update}</span>
                <span className="text-xs text-green-600 dark:text-green-500">עדכון</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg">
                <span className="text-sm font-bold text-slate-700 dark:text-slate-300">{summary.no_change}</span>
                <span className="text-xs text-slate-500">ללא שינוי</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <span className="text-sm font-bold text-red-700 dark:text-red-400">{summary.error}</span>
                <span className="text-xs text-red-600 dark:text-red-500">שגיאות</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                <span className="text-sm font-bold text-blue-700 dark:text-blue-400">{summary.total}</span>
                <span className="text-xs text-blue-600 dark:text-blue-500">סה״כ</span>
              </div>
            </div>

            {/* Filter tabs */}
            <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700">
              {(['all', 'update', 'no_change', 'error'] as FilterTab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setFilterTab(tab)}
                  className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                    filterTab === tab
                      ? 'border-primary text-primary'
                      : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                  }`}
                >
                  {tab === 'all' ? 'הכל' : actionLabel(tab)}
                </button>
              ))}
            </div>

            {/* Table */}
            <div className="overflow-x-auto max-h-96 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-lg">
              <table className="w-full text-right text-sm border-collapse">
                <thead className="bg-slate-50 dark:bg-slate-800/50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-300">#</th>
                    <th className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-300">שם אתר (קובץ)</th>
                    <th className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-300">אתר מותאם</th>
                    <th className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-300">תעריף נוכחי</th>
                    <th className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-300">תעריף חדש</th>
                    <th className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-300">סטטוס</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                  {filteredRows.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                      <td className="px-3 py-2 text-slate-500">{row.row_number}</td>
                      <td className="px-3 py-2 text-slate-900 dark:text-white">{row.site_name_from_file}</td>
                      <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                        {row.matched_site_name || <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                        {row.current_tariff != null ? `${row.current_tariff}₪` : '—'}
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-900 dark:text-white">
                        {row.new_tariff != null ? `${row.new_tariff}₪` : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${actionColor(row.action)}`}>
                          {actionLabel(row.action)}
                        </span>
                        {row.errors.length > 0 && (
                          <div className="text-xs text-red-500 mt-1">{row.errors.join(', ')}</div>
                        )}
                        {row.warnings.length > 0 && (
                          <div className="text-xs text-amber-500 mt-1">{row.warnings.join(', ')}</div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filteredRows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                        אין שורות להצגה
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700 rounded-lg transition-colors font-medium"
              >
                ביטול
              </button>
              <button
                type="button"
                onClick={handleApply}
                disabled={summary.update === 0}
                className="px-6 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg transition-colors font-bold shadow-lg shadow-primary/30 disabled:opacity-50"
              >
                החל שינויים ({summary.update})
              </button>
            </div>
          </>
        )}

        {phase === 'applying' && (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            <p className="text-sm text-slate-600 dark:text-slate-400">מעדכן תעריפים...</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
