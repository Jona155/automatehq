import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import MonthPicker from '../components/MonthPicker';
import PageBanner from '../components/PageBanner';
import Modal from '../components/Modal';
import { useToast } from '../hooks/useToast';
import { getDefaultMonth } from '../utils/monthUtils';
import {
  getMissingCardsByManager,
  getMissingCardsBySite,
  sendManagerWhatsapp,
  broadcastWhatsapp,
  downloadManagerReport,
  type ManagerGroup,
  type SiteGroup,
  type MissingSummary,
  type MissingEmployeeRow,
  type BroadcastResult,
} from '../api/missingCards';

type PivotMode = 'field_manager' | 'site';

// Missing-cards reporting runs on a 10th-to-10th cycle: through the 10th of a
// month we still report the *previous* month (catch-up window), and from the
// 11th onward we switch to the current month. cutoffDay=11 => previous month
// while today's date < 11.
const REPORTING_CUTOFF_DAY = 11;

const EMPTY_SUMMARY: MissingSummary = {
  total_employees: 0,
  none: 0,
  partial: 0,
  complete: 0,
  missing: 0,
  sites_with_gaps: 0,
  managers_with_gaps: 0,
};

function StatusBadge({ row }: { row: MissingEmployeeRow }) {
  if (row.status === 'NONE') {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
        לא התקבל כרטיס
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
      כרטיס ראשון בלבד ({row.cards_count}/{row.expected})
    </span>
  );
}

function EmployeeTable({ rows }: { rows: MissingEmployeeRow[] }) {
  if (rows.length === 0) {
    return <div className="px-6 py-4 text-sm text-slate-500">אין עובדים חסרים</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-right border-collapse text-sm">
        <thead>
          <tr className="bg-slate-50 dark:bg-slate-800/50 border-y border-slate-200 dark:border-slate-700">
            <th className="px-4 py-2 font-bold text-[#111518] dark:text-slate-200">שם עובד</th>
            <th className="px-4 py-2 font-bold text-[#111518] dark:text-slate-200">ת.ז. / דרכון</th>
            <th className="px-4 py-2 font-bold text-[#111518] dark:text-slate-200">טלפון</th>
            <th className="px-4 py-2 font-bold text-[#111518] dark:text-slate-200">אתר</th>
            <th className="px-4 py-2 font-bold text-[#111518] dark:text-slate-200">סטטוס</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
          {rows.map((emp) => (
            <tr key={emp.employee_id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
              <td className="px-4 py-2.5 font-medium text-[#111518] dark:text-white">{emp.full_name}</td>
              <td className="px-4 py-2.5 text-[#111518] dark:text-white">{emp.passport_id || '—'}</td>
              <td className="px-4 py-2.5 text-[#617989] dark:text-slate-400">{emp.phone_number || '—'}</td>
              <td className="px-4 py-2.5 text-[#617989] dark:text-slate-400">{emp.site_name || '—'}</td>
              <td className="px-4 py-2.5"><StatusBadge row={emp} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function MissingWorkCardsPage() {
  const { isAuthenticated } = useAuth();
  const { showToast, ToastContainer } = useToast();

  const [mode, setMode] = useState<PivotMode>('field_manager');
  const [selectedMonth, setSelectedMonth] = useState<string>(() =>
    getDefaultMonth(REPORTING_CUTOFF_DAY),
  );
  const [searchQuery, setSearchQuery] = useState('');

  const [managerGroups, setManagerGroups] = useState<ManagerGroup[]>([]);
  const [siteGroups, setSiteGroups] = useState<SiteGroup[]>([]);
  const [summary, setSummary] = useState<MissingSummary>(EMPTY_SUMMARY);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [sendingId, setSendingId] = useState<string | null>(null);

  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcasting, setBroadcasting] = useState(false);
  const [broadcastResult, setBroadcastResult] = useState<BroadcastResult | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      if (mode === 'field_manager') {
        const data = await getMissingCardsByManager(selectedMonth);
        setManagerGroups(data.groups);
        setSummary(data.summary);
      } else {
        const data = await getMissingCardsBySite(selectedMonth);
        setSiteGroups(data.groups);
        setSummary(data.summary);
      }
    } catch (err) {
      console.error('Failed to fetch missing cards:', err);
      setError('שגיאה בטעינת הנתונים');
    } finally {
      setIsLoading(false);
    }
  }, [mode, selectedMonth]);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchData();
  }, [isAuthenticated, fetchData]);

  const toggle = (key: string) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  const matchesSearch = useCallback(
    (emp: MissingEmployeeRow) => {
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      return (
        (emp.full_name ?? '').toLowerCase().includes(q) ||
        (emp.passport_id ?? '').toLowerCase().includes(q) ||
        (emp.phone_number ?? '').includes(q)
      );
    },
    [searchQuery],
  );

  const filteredManagerGroups = useMemo(() => {
    if (!searchQuery.trim()) return managerGroups;
    return managerGroups
      .map((g) => ({ ...g, employees: g.employees.filter(matchesSearch) }))
      .filter((g) => g.employees.length > 0);
  }, [managerGroups, searchQuery, matchesSearch]);

  const filteredSiteGroups = useMemo(() => {
    if (!searchQuery.trim()) return siteGroups;
    return siteGroups
      .map((g) => ({ ...g, employees: g.employees.filter(matchesSearch) }))
      .filter((g) => g.employees.length > 0);
  }, [siteGroups, searchQuery, matchesSearch]);

  const handleSend = async (managerId: string, managerName: string | null) => {
    setSendingId(managerId);
    try {
      const res = await sendManagerWhatsapp(managerId, selectedMonth);
      showToast(`הדוח נשלח ל${managerName || 'מנהל השטח'} (${res.employee_count} עובדים)`, 'success');
    } catch (err: any) {
      showToast(err?.response?.data?.message || 'שגיאה בשליחת הוואטסאפ', 'error');
    } finally {
      setSendingId(null);
    }
  };

  const handleExport = async (managerId: string, managerName: string | null) => {
    try {
      const blob = await downloadManagerReport(managerId, selectedMonth);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `כרטיסים חסרים - ${managerName || managerId} - ${selectedMonth}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      showToast('שגיאה בייצוא הקובץ', 'error');
    }
  };

  const handleBroadcast = async () => {
    setBroadcasting(true);
    setBroadcastResult(null);
    try {
      const result = await broadcastWhatsapp(selectedMonth);
      setBroadcastResult(result);
      showToast(
        `נשלחו ${result.sent.length} דוחות, ${result.skipped.length} דולגו, ${result.failed.length} נכשלו`,
        result.failed.length > 0 ? 'info' : 'success',
      );
    } catch (err: any) {
      showToast(err?.response?.data?.message || 'שגיאה בשליחה המרוכזת', 'error');
    } finally {
      setBroadcasting(false);
    }
  };

  const summaryChips = (
    <div className="flex flex-wrap gap-3">
      <Chip
        label={`עומדים בדרישת התקופה (מתוך ${summary.total_employees})`}
        value={summary.complete}
        tone="green"
      />
      <Chip label="עובדים חסרים" value={summary.missing} tone="red" />
      <Chip label="כרטיס ראשון בלבד" value={summary.partial} tone="amber" />
      <Chip label="אתרים עם פערים" value={summary.sites_with_gaps} tone="slate" />
      <Chip label="מנהלים עם פערים" value={summary.managers_with_gaps} tone="slate" />
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <ToastContainer />

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-[#111518] dark:text-white text-3xl font-bold">כרטיסי עבודה חסרים</h2>
          <p className="text-[#617989] dark:text-slate-400 mt-1">
            עובדים פעילים שטרם הוגשו עבורם כל כרטיסי העבודה החודשיים, מקובצים לפי מנהל שטח או אתר
          </p>
        </div>
        <button
          onClick={() => { setBroadcastResult(null); setBroadcastOpen(true); }}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-lg transition-colors"
        >
          <span className="material-symbols-outlined text-base">send</span>
          שלח לכל מנהלי השטח
        </button>
      </div>

      <PageBanner
        storageKey="missing-work-cards"
        title="מדריך: כרטיסי עבודה חסרים"
        icon="lightbulb"
        summary={
          <>
            דף זה מציג עובדים פעילים שטרם הוגשו עבורם כל כרטיסי העבודה לחודש הנבחר. כל עובד אמור להגיש מספר כרטיסים בחודש (ברירת מחדל 2),
            וניתן לקבץ את התצוגה לפי מנהל שטח או לפי אתר.
          </>
        }
        details={
          <ul className="list-disc list-inside space-y-1">
            <li>קבצו לפי מנהל שטח כדי לשלוח לכל מנהל את רשימת העובדים החסרים שלו.</li>
            <li>קבצו לפי אתר כדי לראות גם אתרים שלא הועלה עבורם אף כרטיס.</li>
            <li>השתמשו בכפתור "שלח לכל מנהלי השטח" כדי לשלוח לכל מנהל קובץ Excel בוואטסאפ אוטומטית.</li>
            <li>סטטוס "כרטיס ראשון בלבד" מציין שהתקבל רק חלק מהכרטיסים הצפויים.</li>
          </ul>
        }
      />

      {/* Controls */}
      <div className="bg-white dark:bg-[#1a2a35] rounded-xl shadow-xl border border-slate-200/50 dark:border-slate-700/50 p-4 flex flex-col gap-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">חודש</label>
            <MonthPicker value={selectedMonth} onChange={setSelectedMonth} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">תצוגה</label>
            <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
              <button
                onClick={() => setMode('field_manager')}
                className={`px-4 py-2 text-sm font-semibold transition-colors ${mode === 'field_manager' ? 'bg-primary text-white' : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300'}`}
              >
                לפי מנהל שטח
              </button>
              <button
                onClick={() => setMode('site')}
                className={`px-4 py-2 text-sm font-semibold transition-colors ${mode === 'site' ? 'bg-primary text-white' : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300'}`}
              >
                לפי אתר
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">חיפוש</label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all text-sm"
              placeholder="חפש לפי שם, ת.ז. או טלפון..."
            />
          </div>
        </div>
        {!isLoading && summaryChips}
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="p-8 text-center text-slate-500">טוען נתונים...</div>
      ) : error ? (
        <div className="p-8 text-center text-red-500">{error}</div>
      ) : mode === 'field_manager' ? (
        <div className="flex flex-col gap-4">
          {filteredManagerGroups.length === 0 && (
            <div className="p-8 text-center text-slate-500 bg-white dark:bg-[#1a2a35] rounded-xl border border-slate-200/50 dark:border-slate-700/50">
              אין עובדים חסרים לחודש זה 🎉
            </div>
          )}
          {filteredManagerGroups.map((g) => {
            const key = g.field_manager_id ?? 'none';
            const isOpen = expanded[key] ?? false;
            const canSend = !!g.field_manager_id && !!g.manager_phone;
            return (
              <div key={key} className="bg-white dark:bg-[#1a2a35] rounded-xl shadow-xl border border-slate-200/50 dark:border-slate-700/50 overflow-hidden">
                <div className="flex items-center justify-between gap-3 px-6 py-4">
                  <button onClick={() => toggle(key)} className="flex items-center gap-3 text-right flex-1 min-w-0">
                    <span className={`material-symbols-outlined text-slate-400 transition-transform ${isOpen ? 'rotate-90' : ''}`}>chevron_left</span>
                    <div className="min-w-0">
                      <div className="font-bold text-[#111518] dark:text-white truncate">
                        {g.manager_name || 'ללא מנהל שטח'}
                      </div>
                      <div className="text-sm text-[#617989] dark:text-slate-400 flex items-center gap-2 flex-wrap">
                        <CompliantBadge complete={g.complete_count} total={g.total_employees} />
                        <span>
                          {g.missing_count} חסרים · {g.none_count} ללא כרטיס · {g.partial_count} ראשון בלבד
                          {g.manager_phone ? '' : g.field_manager_id ? ' · ⚠️ אין טלפון' : ''}
                        </span>
                      </div>
                    </div>
                  </button>
                  <div className="flex items-center gap-2 shrink-0">
                    {g.field_manager_id && (
                      <button
                        onClick={() => handleExport(g.field_manager_id!, g.manager_name)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      >
                        <span className="material-symbols-outlined text-sm">download</span>
                        Excel
                      </button>
                    )}
                    {g.field_manager_id && (
                      <button
                        onClick={() => handleSend(g.field_manager_id!, g.manager_name)}
                        disabled={!canSend || sendingId === g.field_manager_id}
                        title={canSend ? '' : 'אין מספר טלפון למנהל זה'}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
                      >
                        <span className="material-symbols-outlined text-sm">send</span>
                        {sendingId === g.field_manager_id ? 'שולח...' : 'שלח'}
                      </button>
                    )}
                  </div>
                </div>
                {isOpen && <EmployeeTable rows={g.employees} />}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {filteredSiteGroups.length === 0 && (
            <div className="p-8 text-center text-slate-500 bg-white dark:bg-[#1a2a35] rounded-xl border border-slate-200/50 dark:border-slate-700/50">
              אין אתרים עם פערים לחודש זה 🎉
            </div>
          )}
          {filteredSiteGroups.map((g) => {
            const key = g.site_id ?? 'none';
            const isOpen = expanded[key] ?? false;
            return (
              <div key={key} className="bg-white dark:bg-[#1a2a35] rounded-xl shadow-xl border border-slate-200/50 dark:border-slate-700/50 overflow-hidden">
                <button onClick={() => toggle(key)} className="w-full flex items-center justify-between gap-3 px-6 py-4 text-right">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`material-symbols-outlined text-slate-400 transition-transform ${isOpen ? 'rotate-90' : ''}`}>chevron_left</span>
                    <div className="min-w-0">
                      <div className="font-bold text-[#111518] dark:text-white truncate">{g.site_name || 'ללא אתר'}</div>
                      <div className="text-sm text-[#617989] dark:text-slate-400">
                        מנהל שטח: {g.manager_name || '—'} · כיסוי {g.complete_count}/{g.total_employees}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <CompliantBadge complete={g.complete_count} total={g.total_employees} />
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                      {g.missing_count} חסרים
                    </span>
                  </div>
                </button>
                {isOpen && <EmployeeTable rows={g.employees} />}
              </div>
            );
          })}
        </div>
      )}

      {/* Broadcast modal */}
      <Modal isOpen={broadcastOpen} onClose={() => setBroadcastOpen(false)} title="שליחה לכל מנהלי השטח" maxWidth="lg">
        {!broadcastResult ? (
          <div className="flex flex-col gap-4">
            <p className="text-slate-700 dark:text-slate-300">
              פעולה זו תשלח לכל מנהל שטח קובץ Excel בוואטסאפ עם רשימת העובדים שחסרים להם כרטיסי עבודה לחודש{' '}
              <strong>{selectedMonth}</strong>. מנהלים ללא מספר טלפון או ללא עובדים חסרים ידולגו.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setBroadcastOpen(false)}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                ביטול
              </button>
              <button
                onClick={handleBroadcast}
                disabled={broadcasting}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold"
              >
                <span className="material-symbols-outlined text-base">send</span>
                {broadcasting ? 'שולח...' : 'שלח עכשיו'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <BroadcastSummary result={broadcastResult} />
            <div className="flex justify-end">
              <button
                onClick={() => setBroadcastOpen(false)}
                className="px-4 py-2 rounded-lg bg-primary text-white font-semibold hover:bg-primary/90"
              >
                סגור
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function CompliantBadge({ complete, total }: { complete: number; total: number }) {
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
      {complete}/{total} עומדים בדרישה
    </span>
  );
}

function Chip({ label, value, tone }: { label: string; value: number; tone: 'red' | 'amber' | 'slate' | 'green' }) {
  const tones: Record<string, string> = {
    green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400',
    red: 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400',
    slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  };
  return (
    <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium ${tones[tone]}`}>
      <span className="font-bold text-base">{value}</span>
      {label}
    </span>
  );
}

function BroadcastSummary({ result }: { result: BroadcastResult }) {
  const Row = ({ entry, label }: { entry: { manager_name: string | null; reason?: string; error?: string; employee_count?: number }; label?: string }) => (
    <li className="flex items-center justify-between gap-2 text-sm py-1">
      <span className="text-slate-700 dark:text-slate-300">{entry.manager_name || 'ללא שם'}</span>
      <span className="text-slate-500 dark:text-slate-400 text-xs">
        {entry.employee_count != null ? `${entry.employee_count} עובדים` : label || entry.reason || entry.error}
      </span>
    </li>
  );
  const reasonHe: Record<string, string> = {
    no_phone: 'אין טלפון',
    no_manager: 'ללא מנהל',
    no_missing: 'אין חסרים',
    not_found: 'לא נמצא',
    invalid_phone: 'טלפון לא תקין',
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 p-3">
          <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{result.sent.length}</div>
          <div className="text-xs text-slate-600 dark:text-slate-400">נשלחו</div>
        </div>
        <div className="rounded-lg bg-slate-100 dark:bg-slate-800 p-3">
          <div className="text-2xl font-bold text-slate-700 dark:text-slate-300">{result.skipped.length}</div>
          <div className="text-xs text-slate-600 dark:text-slate-400">דולגו</div>
        </div>
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 p-3">
          <div className="text-2xl font-bold text-red-700 dark:text-red-400">{result.failed.length}</div>
          <div className="text-xs text-slate-600 dark:text-slate-400">נכשלו</div>
        </div>
      </div>
      {result.sent.length > 0 && (
        <div>
          <h4 className="text-sm font-bold text-emerald-700 dark:text-emerald-400 mb-1">נשלחו</h4>
          <ul className="divide-y divide-slate-100 dark:divide-slate-700/50">{result.sent.map((e, i) => <Row key={i} entry={e} />)}</ul>
        </div>
      )}
      {result.failed.length > 0 && (
        <div>
          <h4 className="text-sm font-bold text-red-700 dark:text-red-400 mb-1">נכשלו</h4>
          <ul className="divide-y divide-slate-100 dark:divide-slate-700/50">{result.failed.map((e, i) => <Row key={i} entry={e} />)}</ul>
        </div>
      )}
      {result.skipped.length > 0 && (
        <div>
          <h4 className="text-sm font-bold text-slate-600 dark:text-slate-300 mb-1">דולגו</h4>
          <ul className="divide-y divide-slate-100 dark:divide-slate-700/50">
            {result.skipped.map((e, i) => <Row key={i} entry={e} label={reasonHe[e.reason || ''] || e.reason} />)}
          </ul>
        </div>
      )}
    </div>
  );
}
