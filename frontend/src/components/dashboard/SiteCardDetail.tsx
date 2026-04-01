import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getEmployeeUploadStatus } from '../../api/workCards';
import type { EmployeeUploadStatus } from '../../types';

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  APPROVED: { label: 'מאושר', color: 'text-emerald-700 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-900/30' },
  EXTRACTED: { label: 'חולץ', color: 'text-sky-700 dark:text-sky-400', bg: 'bg-sky-50 dark:bg-sky-900/30' },
  PENDING: { label: 'ממתין', color: 'text-purple-700 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-900/30' },
  FAILED: { label: 'נכשל', color: 'text-red-700 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/30' },
  NO_UPLOAD: { label: 'חסר', color: 'text-slate-500 dark:text-slate-400', bg: 'bg-slate-100 dark:bg-slate-800' },
};

interface Props {
  siteId: string;
  month: string;
  businessCode: string;
}

export default function SiteCardDetail({ siteId, month, businessCode }: Props) {
  const navigate = useNavigate();
  const [employees, setEmployees] = useState<EmployeeUploadStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(false);
      try {
        const data = await getEmployeeUploadStatus(siteId, month);
        if (!cancelled) setEmployees(data);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [siteId, month]);

  const sorted = [...employees].sort((a, b) => {
    const order = ['NO_UPLOAD', 'FAILED', 'PENDING', 'EXTRACTED', 'APPROVED'];
    return order.indexOf(a.status) - order.indexOf(b.status) || a.employee.full_name.localeCompare(b.employee.full_name, 'he');
  });

  return (
    <div className="border-t border-slate-100 dark:border-slate-700/40 bg-slate-50/40 dark:bg-slate-800/10">
      {loading && (
        <div className="px-3.5 py-4 flex items-center justify-center">
          <span className="material-symbols-outlined text-slate-300 animate-spin text-base">progress_activity</span>
        </div>
      )}

      {error && (
        <div className="px-3.5 py-3 text-[11px] text-red-500 text-center">שגיאה בטעינה</div>
      )}

      {!loading && !error && (
        <div className="px-3 py-2.5">
          {sorted.length > 0 && (
            <div className="max-h-40 overflow-y-auto space-y-px mb-2.5">
              {sorted.map((emp) => {
                const cfg = STATUS_CONFIG[emp.status] ?? STATUS_CONFIG.NO_UPLOAD;
                return (
                  <div
                    key={emp.employee.id}
                    className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-white dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <span className="text-[11px] text-slate-700 dark:text-slate-200 truncate">{emp.employee.full_name}</span>
                    <span className={`${cfg.color} ${cfg.bg} px-1.5 py-px rounded text-[9px] font-medium shrink-0 mr-1.5`}>
                      {cfg.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {sorted.length === 0 && (
            <p className="text-[11px] text-slate-400 text-center py-2 mb-2.5">אין עובדים</p>
          )}

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => navigate(`/${businessCode}/sites/${siteId}/review?selectedMonth=${month}`)}
              className="flex-1 flex items-center justify-center gap-1 text-[11px] font-medium text-white bg-sky-500 hover:bg-sky-600 active:bg-sky-700 rounded-lg py-1.5 transition-colors"
            >
              <span className="material-symbols-outlined text-[13px]">rate_review</span>
              סקירה
            </button>
            <button
              onClick={() => navigate(`/${businessCode}/sites/${siteId}`)}
              className="flex-1 flex items-center justify-center gap-1 text-[11px] font-medium text-slate-500 dark:text-slate-300 bg-slate-100 dark:bg-slate-700/60 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg py-1.5 transition-colors"
            >
              <span className="material-symbols-outlined text-[13px]">open_in_new</span>
              אתר
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
