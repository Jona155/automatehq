import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
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
  downloadCompanyReport,
  setExemptions,
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
  exempt: 0,
  sites_with_gaps: 0,
  managers_with_gaps: 0,
};

// Ignoring an employee sets a flag on the cards they already sent, so someone
// with no card at all has nothing to flag and cannot be ignored.
const canBeIgnored = (row: MissingEmployeeRow) => row.status !== 'NONE';

function StatusBadge({ row }: { row: MissingEmployeeRow }) {
  if (row.is_exempt) {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 dark:bg-slate-700/50 dark:text-slate-300">
        הוחרג ידנית
      </span>
    );
  }
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

function EmployeeRow({
  emp,
  canManage,
  selected,
  onToggleRow,
  onExempt,
  onRevert,
}: {
  emp: MissingEmployeeRow;
  canManage: boolean;
  selected: boolean;
  onToggleRow: (id: string) => void;
  onExempt: (emp: MissingEmployeeRow) => void;
  onRevert: (emp: MissingEmployeeRow) => void;
}) {
  const selectable = canBeIgnored(emp);
  return (
    <tr
      className={`hover:bg-slate-50/50 dark:hover:bg-slate-800/30 ${emp.is_exempt ? 'opacity-60' : ''}`}
    >
      {canManage && (
        <td className="px-4 py-2.5 w-10">
          {!emp.is_exempt && (
            <input
              type="checkbox"
              checked={selected}
              disabled={!selectable}
              onChange={() => onToggleRow(emp.employee_id)}
              title={selectable ? '' : 'לא ניתן להחריג עובד שלא התקבל עבורו אף כרטיס'}
              className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-primary focus:ring-primary/50 disabled:opacity-40 disabled:cursor-not-allowed"
            />
          )}
        </td>
      )}
      <td className="px-4 py-2.5 font-medium text-[#111518] dark:text-white">{emp.full_name}</td>
      <td className="px-4 py-2.5 text-[#111518] dark:text-white">{emp.passport_id || '—'}</td>
      <td className="px-4 py-2.5 text-[#617989] dark:text-slate-400">{emp.phone_number || '—'}</td>
      <td className="px-4 py-2.5 text-[#617989] dark:text-slate-400">{emp.site_name || '—'}</td>
      <td className="px-4 py-2.5"><StatusBadge row={emp} /></td>
      {canManage && (
        <td className="px-4 py-2.5">
          {emp.is_exempt ? (
            <button
              onClick={() => onRevert(emp)}
              className="inline-flex items-center whitespace-nowrap px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              בטל החרגה
            </button>
          ) : selectable ? (
            <button
              onClick={() => onExempt(emp)}
              title="סמן שהכרטיסים שהתקבלו הם ההגשה המלאה לחודש זה"
              className="inline-flex items-center whitespace-nowrap px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              החרג מהדוח
            </button>
          ) : (
            // No card at all -> nothing to flag. A dash matches how the other
            // columns render "no value" and avoids a permanently dead button.
            <span
              className="text-[#617989] dark:text-slate-500"
              title="לא ניתן להחריג עובד שלא התקבל עבורו אף כרטיס"
            >
              —
            </span>
          )}
        </td>
      )}
    </tr>
  );
}

function EmployeeTable({
  rows,
  exemptRows,
  canManage,
  selected,
  onToggleRow,
  onToggleGroup,
  onExempt,
  onRevert,
}: {
  rows: MissingEmployeeRow[];
  exemptRows: MissingEmployeeRow[];
  canManage: boolean;
  selected: Set<string>;
  onToggleRow: (id: string) => void;
  onToggleGroup: (ids: string[], select: boolean) => void;
  onExempt: (emp: MissingEmployeeRow) => void;
  onRevert: (emp: MissingEmployeeRow) => void;
}) {
  const selectableIds = rows.filter(canBeIgnored).map((r) => r.employee_id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  if (rows.length === 0 && exemptRows.length === 0) {
    return <div className="px-6 py-4 text-sm text-slate-500">אין עובדים חסרים</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-right border-collapse text-sm">
        <thead>
          <tr className="bg-slate-50 dark:bg-slate-800/50 border-y border-slate-200 dark:border-slate-700">
            {canManage && (
              <th className="px-4 py-2 w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  disabled={selectableIds.length === 0}
                  onChange={() => onToggleGroup(selectableIds, !allSelected)}
                  title="בחר את כל העובדים בקבוצה"
                  className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-primary focus:ring-primary/50 disabled:opacity-40"
                />
              </th>
            )}
            <th className="px-4 py-2 font-bold text-[#111518] dark:text-slate-200">שם עובד</th>
            <th className="px-4 py-2 font-bold text-[#111518] dark:text-slate-200">ת.ז. / דרכון</th>
            <th className="px-4 py-2 font-bold text-[#111518] dark:text-slate-200">טלפון</th>
            <th className="px-4 py-2 font-bold text-[#111518] dark:text-slate-200">אתר</th>
            <th className="px-4 py-2 font-bold text-[#111518] dark:text-slate-200">סטטוס</th>
            {canManage && <th className="px-4 py-2 font-bold text-[#111518] dark:text-slate-200">פעולות</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
          {rows.map((emp) => (
            <EmployeeRow
              key={emp.employee_id}
              emp={emp}
              canManage={canManage}
              selected={selected.has(emp.employee_id)}
              onToggleRow={onToggleRow}
              onExempt={onExempt}
              onRevert={onRevert}
            />
          ))}
          {exemptRows.map((emp) => (
            <EmployeeRow
              key={emp.employee_id}
              emp={emp}
              canManage={canManage}
              selected={false}
              onToggleRow={onToggleRow}
              onExempt={onExempt}
              onRevert={onRevert}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function MissingWorkCardsPage() {
  const { isAuthenticated, user } = useAuth();
  const { isFieldManager } = usePermissions();
  const { showToast, ToastContainer } = useToast();

  // Field managers only ever see their own sites, so the manager pivot collapses
  // to a single group — default them to the site pivot instead. `modeOverride`
  // stays null until the user picks a pivot themselves.
  const [modeOverride, setModeOverride] = useState<PivotMode | null>(null);
  const mode: PivotMode = modeOverride ?? (isFieldManager ? 'site' : 'field_manager');
  const setMode = setModeOverride;
  const [selectedMonth, setSelectedMonth] = useState<string>(() =>
    getDefaultMonth(REPORTING_CUTOFF_DAY),
  );
  const [searchQuery, setSearchQuery] = useState('');

  const [managerGroups, setManagerGroups] = useState<ManagerGroup[]>([]);
  const [siteGroups, setSiteGroups] = useState<SiteGroup[]>([]);
  const [summary, setSummary] = useState<MissingSummary>(EMPTY_SUMMARY);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<'forbidden' | 'generic' | null>(null);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [sendingId, setSendingId] = useState<string | null>(null);

  // Only admins may ignore employees — field managers are the audience of the
  // report, so they must not be able to shrink their own list (backend enforces).
  const canManage = !isFieldManager;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showExempt, setShowExempt] = useState(false);
  // Employee ids awaiting confirmation — one row's id from the row action, or the
  // whole selection from the bulk bar. Non-null means the confirm dialog is open.
  const [pendingExempt, setPendingExempt] = useState<string[] | null>(null);
  const [applyingExempt, setApplyingExempt] = useState(false);

  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcasting, setBroadcasting] = useState(false);
  const [broadcastResult, setBroadcastResult] = useState<BroadcastResult | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setSelected(new Set());
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
    } catch (err: any) {
      console.error('Failed to fetch missing cards:', err);
      setError(err?.response?.status === 403 ? 'forbidden' : 'generic');
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

  // Ignored employees are only materialized when the user asks to see them, so
  // the default view stays exactly the list of people who need chasing.
  const visibleExempt = useCallback(
    (rows: MissingEmployeeRow[]) => {
      if (!showExempt) return [];
      return searchQuery.trim() ? rows.filter(matchesSearch) : rows;
    },
    [showExempt, searchQuery, matchesSearch],
  );

  const filteredManagerGroups = useMemo(() => {
    const q = searchQuery.trim();
    return managerGroups
      .map((g) => ({
        ...g,
        employees: q ? g.employees.filter(matchesSearch) : g.employees,
        exempt_employees: visibleExempt(g.exempt_employees),
      }))
      // A manager whose every gap was ignored comes back from the API with no
      // gaps at all — hide them unless the user is looking at ignored rows.
      .filter((g) => g.employees.length > 0 || g.exempt_employees.length > 0);
  }, [managerGroups, searchQuery, matchesSearch, visibleExempt]);

  const filteredSiteGroups = useMemo(() => {
    const q = searchQuery.trim();
    const mapped = siteGroups.map((g) => ({
      ...g,
      employees: q ? g.employees.filter(matchesSearch) : g.employees,
      exempt_employees: visibleExempt(g.exempt_employees),
    }));
    // Unsearched, every site is listed (including fully-covered ones) as before.
    if (!q) return mapped;
    return mapped.filter((g) => g.employees.length > 0 || g.exempt_employees.length > 0);
  }, [siteGroups, searchQuery, matchesSearch, visibleExempt]);

  const toggleRow = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleGroup = (ids: string[], select: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (select ? next.add(id) : next.delete(id)));
      return next;
    });

  const applyExemption = async (employeeIds: string[], exempt: boolean) => {
    setApplyingExempt(true);
    try {
      const res = await setExemptions(selectedMonth, employeeIds, exempt);
      if (res.skipped_no_card.length > 0) {
        showToast(
          `${res.updated} עודכנו. ${res.skipped_no_card.length} דולגו — לא התקבל עבורם אף כרטיס`,
          'info',
        );
      } else {
        showToast(
          exempt
            ? `${res.updated} עובדים הוחרגו מהדוח לחודש זה`
            : `ההחרגה בוטלה עבור ${res.updated} עובדים`,
          'success',
        );
      }
      setPendingExempt(null);
      await fetchData();
    } catch (err: any) {
      showToast(err?.response?.data?.message || 'שגיאה בעדכון ההחרגות', 'error');
    } finally {
      setApplyingExempt(false);
    }
  };

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

  const handleExportCompany = async () => {
    try {
      const blob = await downloadCompanyReport(selectedMonth);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `כרטיסים חסרים - כל החברה - ${selectedMonth}.xlsx`;
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
      {!isFieldManager && (
        <Chip label="מנהלים עם פערים" value={summary.managers_with_gaps} tone="slate" />
      )}
    </div>
  );

  // A field manager with no sites assigned gets no rows at all — say so
  // explicitly instead of the celebratory "no gaps" empty state.
  const hasNoScope = isFieldManager && !isLoading && !error && summary.total_employees === 0;

  return (
    <div className="flex flex-col gap-6">
      <ToastContainer />

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-[#111518] dark:text-white text-3xl font-bold">כרטיסי עבודה חסרים</h2>
          <p className="text-[#617989] dark:text-slate-400 mt-1">
            {isFieldManager
              ? 'עובדים פעילים באתרים שבאחריותך שטרם הוגשו עבורם כל כרטיסי העבודה החודשיים'
              : 'עובדים פעילים שטרם הוגשו עבורם כל כרטיסי העבודה החודשיים, מקובצים לפי מנהל שטח או אתר'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleExportCompany}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold transition-colors"
          >
            <span className="material-symbols-outlined text-base">download</span>
            {isFieldManager ? 'הורד אקסל לאתרים שלי' : 'הורד אקסל לכל החברה'}
          </button>
          {!isFieldManager && (
            <button
              onClick={() => { setBroadcastResult(null); setBroadcastOpen(true); }}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-lg transition-colors"
            >
              <span className="material-symbols-outlined text-base">send</span>
              שלח לכל מנהלי השטח
            </button>
          )}
        </div>
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
            {isFieldManager ? (
              <li>התצוגה מוגבלת לאתרים שאתם מוגדרים כמנהלי השטח שלהם.</li>
            ) : (
              <li>קבצו לפי מנהל שטח כדי לשלוח לכל מנהל את רשימת העובדים החסרים שלו.</li>
            )}
            <li>קבצו לפי אתר כדי לראות גם אתרים שלא הועלה עבורם אף כרטיס.</li>
            {!isFieldManager && (
              <li>השתמשו בכפתור "שלח לכל מנהלי השטח" כדי לשלוח לכל מנהל קובץ Excel בוואטסאפ אוטומטית.</li>
            )}
            <li>סטטוס "כרטיס ראשון בלבד" מציין שהתקבל רק חלק מהכרטיסים הצפויים.</li>
            {canManage && (
              <li>
                אם ידוע לכם שהכרטיס שהתקבל מספיק (למשל העובדים סיימו בסוף החודש), סמנו אותם
                והחריגו אותם מהדוח. ההחרגה תקפה לחודש הנבחר בלבד, וניתן לבטלה בכל עת.
              </li>
            )}
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
        {!isLoading && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            {summaryChips}
            {canManage && (
              <button
                onClick={() => setShowExempt((v) => !v)}
                disabled={summary.exempt === 0}
                aria-pressed={showExempt}
                title={
                  summary.exempt === 0
                    ? 'לא הוחרגו עובדים בחודש זה'
                    : 'הצגה או הסתרה של העובדים שהוחרגו ידנית מהדוח'
                }
                className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  showExempt
                    ? 'bg-primary border-primary text-white shadow-md'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 enabled:hover:bg-slate-100 dark:enabled:hover:bg-slate-800'
                }`}
              >
                <span className="material-symbols-outlined text-lg leading-none">
                  {showExempt ? 'visibility' : 'visibility_off'}
                </span>
                עובדים שהוחרגו ידנית
                <span
                  className={`inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-xs font-bold ${
                    showExempt
                      ? 'bg-white/25 text-white'
                      : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200'
                  }`}
                >
                  {summary.exempt}
                </span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="p-8 text-center text-slate-500">טוען נתונים...</div>
      ) : error ? (
        <EmptyCard
          icon={error === 'forbidden' ? 'lock' : 'error'}
          title={error === 'forbidden' ? 'אין לך הרשאה לצפות בדף זה' : 'שגיאה בטעינת הנתונים'}
          body={
            error === 'forbidden'
              ? 'הדף זמין למנהלי מערכת ולמנהלי שטח. פנו למנהל המערכת אם לדעתכם נדרשת לכם גישה.'
              : 'לא הצלחנו לטעון את רשימת הכרטיסים החסרים. נסו שוב או בחרו חודש אחר.'
          }
          action={
            error === 'generic'
              ? { label: 'נסה שוב', onClick: () => { void fetchData(); } }
              : undefined
          }
        />
      ) : hasNoScope ? (
        <EmptyCard
          icon="apartment"
          title="לא שויכו אליך אתרים"
          body={`לא נמצאו אתרים שבהם ${user?.full_name || 'המשתמש'} מוגדר כמנהל שטח, ולכן אין נתונים להצגה. פנו למנהל המערכת כדי לשייך אתרים.`}
        />
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
                    {g.field_manager_id && !isFieldManager && (
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
                {isOpen && (
                  <EmployeeTable
                    rows={g.employees}
                    exemptRows={g.exempt_employees}
                    canManage={canManage}
                    selected={selected}
                    onToggleRow={toggleRow}
                    onToggleGroup={toggleGroup}
                    onExempt={(emp) => setPendingExempt([emp.employee_id])}
                    onRevert={(emp) => { void applyExemption([emp.employee_id], false); }}
                  />
                )}
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
                {isOpen && (
                  <EmployeeTable
                    rows={g.employees}
                    exemptRows={g.exempt_employees}
                    canManage={canManage}
                    selected={selected}
                    onToggleRow={toggleRow}
                    onToggleGroup={toggleGroup}
                    onExempt={(emp) => setPendingExempt([emp.employee_id])}
                    onRevert={(emp) => { void applyExemption([emp.employee_id], false); }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Selection action bar */}
      {canManage && selected.size > 0 && (
        <div className="sticky bottom-4 z-10 mx-auto w-fit flex items-center gap-4 px-5 py-3 rounded-xl bg-[#111518] dark:bg-slate-700 text-white shadow-2xl">
          <span className="text-sm font-semibold">{selected.size} עובדים נבחרו</span>
          <button
            onClick={() => setPendingExempt([...selected])}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-[#111518] hover:bg-slate-100 text-sm font-semibold transition-colors"
          >
            <span className="material-symbols-outlined text-sm">visibility_off</span>
            החרג מהדוח
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="text-sm text-slate-300 hover:text-white transition-colors"
          >
            נקה בחירה
          </button>
        </div>
      )}

      {/* Exemption confirm */}
      <Modal
        isOpen={pendingExempt !== null}
        onClose={() => setPendingExempt(null)}
        title="החרגת עובדים מדוח החוסרים"
        maxWidth="md"
      >
        <div className="flex flex-col gap-4">
          <p className="text-slate-700 dark:text-slate-300">
            {pendingExempt?.length === 1 ? (
              <>
                העובד יסומן כאילו הכרטיסים שהתקבלו עבורו הם ההגשה המלאה לחודש{' '}
                <strong>{selectedMonth}</strong>, וייעלם מהדף הזה ומהדוחות שנשלחים למנהלי השטח.
              </>
            ) : (
              <>
                <strong>{pendingExempt?.length ?? 0}</strong> עובדים יסומנו כאילו הכרטיסים שהתקבלו
                עבורם הם ההגשה המלאה לחודש <strong>{selectedMonth}</strong>. הם ייעלמו מהדף הזה
                ומהדוחות שנשלחים למנהלי השטח.
              </>
            )}
          </p>
          <p className="text-sm text-[#617989] dark:text-slate-400">
            ההחרגה תקפה לחודש זה בלבד ואינה עוברת לחודשים הבאים. ניתן לבטל אותה בכל עת דרך כפתור
            "עובדים שהוחרגו ידנית".
          </p>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setPendingExempt(null)}
              className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              ביטול
            </button>
            <button
              onClick={() => { if (pendingExempt) void applyExemption(pendingExempt, true); }}
              disabled={applyingExempt}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white font-semibold hover:bg-primary/90 disabled:opacity-50"
            >
              {applyingExempt ? 'מעדכן...' : 'אשר החרגה'}
            </button>
          </div>
        </div>
      </Modal>

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

function EmptyCard({
  icon,
  title,
  body,
  action,
}: {
  icon: string;
  title: string;
  body: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="bg-white dark:bg-[#1a2a35] rounded-xl shadow-xl border border-slate-200/50 dark:border-slate-700/50 p-10 flex flex-col items-center text-center gap-3">
      <span className="material-symbols-outlined text-4xl text-slate-400 dark:text-slate-500">{icon}</span>
      <h3 className="text-lg font-bold text-[#111518] dark:text-white">{title}</h3>
      <p className="text-sm text-[#617989] dark:text-slate-400 max-w-md">{body}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white font-semibold hover:bg-primary/90 transition-colors"
        >
          <span className="material-symbols-outlined text-base">refresh</span>
          {action.label}
        </button>
      )}
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
