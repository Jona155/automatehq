import { useState, useEffect, useMemo, useCallback, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
import MonthPicker from '../components/MonthPicker';
import PageBanner from '../components/PageBanner';
import Modal from '../components/Modal';
import SearchableMultiSelect from '../components/SearchableMultiSelect';
import { useToast } from '../hooks/useToast';
import { getDefaultMonth } from '../utils/monthUtils';
import { downloadBlobFile } from '../utils/fileDownload';
import {
  getAbsences,
  saveAbsenceSettings,
  saveEmployeeAbsenceDays,
  setAbsenceExclusions,
  downloadAbsencesReport,
  type AbsenceEmployeeOverride,
  type AbsenceRow,
  type AbsencesResponse,
} from '../api/absences';

type KindFilter = 'all' | 'sick' | 'empty';

const WEEKDAYS_HE = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const SATURDAY = 6; // Date.getDay()

const parseMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return { year: y, monthIndex: m - 1 };
};

const daysInMonth = (month: string) => {
  const { year, monthIndex } = parseMonth(month);
  return new Date(year, monthIndex + 1, 0).getDate();
};

const weekdayOf = (month: string, day: number) => {
  const { year, monthIndex } = parseMonth(month);
  return new Date(year, monthIndex, day).getDay();
};

const dayLabel = (month: string, day: number) =>
  `${String(day).padStart(2, '0')}/${month.slice(5, 7)}`;

const inputClass =
  'w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all text-sm';

function DayChip({ month, day, kind }: { month: string; day: number; kind: 'sick' | 'empty' }) {
  return (
    <span
      title={kind === 'sick' ? 'מחלה' : 'ללא דיווח'}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold ${
        kind === 'sick'
          ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
          : 'bg-slate-100 text-slate-600 dark:bg-slate-700/50 dark:text-slate-300'
      }`}
    >
      {dayLabel(month, day)}
      <span className="opacity-70">{WEEKDAYS_HE[weekdayOf(month, day)]}</span>
    </span>
  );
}

function CardStatusBadge({ status }: { status: AbsenceRow['card_status'] }) {
  return status === 'APPROVED' ? (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
      מאושר
    </span>
  ) : (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
      ממתין לאישור
    </span>
  );
}

function SummaryTile({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="bg-white dark:bg-[#1a2a35] rounded-xl shadow border border-slate-200/50 dark:border-slate-700/50 p-4">
      <div className="text-sm text-[#617989] dark:text-slate-400">{label}</div>
      <div className="text-2xl font-bold text-[#111518] dark:text-white mt-1">{value}</div>
      {sub && <div className="text-xs text-[#617989] dark:text-slate-400 mt-1">{sub}</div>}
    </div>
  );
}

function AbsenceTable({
  rows,
  month,
  businessCode,
  kind,
  canManage,
  excludedMode,
  selected,
  onToggleRow,
  onToggleAll,
  onAction,
  onEditDays,
}: {
  rows: AbsenceRow[];
  month: string;
  businessCode: string;
  kind: KindFilter;
  canManage: boolean;
  excludedMode: boolean;
  selected: Set<string>;
  onToggleRow: (id: string) => void;
  onToggleAll: (ids: string[], select: boolean) => void;
  onAction: (row: AbsenceRow) => void;
  onEditDays: (row: AbsenceRow) => void;
}) {
  const showSelect = canManage && !excludedMode;
  const ids = rows.map((r) => r.employee_id);
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
  const th = 'px-4 py-2 font-bold text-[#111518] dark:text-slate-200';

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-right border-collapse text-sm">
        <thead>
          <tr className="bg-slate-50 dark:bg-slate-800/50 border-y border-slate-200 dark:border-slate-700">
            {showSelect && (
              <th className="px-4 py-2 w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  disabled={ids.length === 0}
                  onChange={() => onToggleAll(ids, !allSelected)}
                  title="בחר הכל"
                  className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-primary focus:ring-primary/50"
                />
              </th>
            )}
            <th className={th}>שם עובד</th>
            <th className={th}>אתר</th>
            {kind !== 'empty' && <th className={th}>מחלה</th>}
            {kind !== 'sick' && <th className={th}>ללא דיווח</th>}
            <th className={th}>ימים</th>
            <th className={th}>כרטיס</th>
            {excludedMode && <th className={th}>סיבה</th>}
            {canManage && <th className={th}>פעולות</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
          {rows.map((row) => {
            const reviewHref = row.review_site_id
              ? `/${businessCode}/sites/${row.review_site_id}/review?selectedMonth=${encodeURIComponent(month)}&cardId=${row.review_card_id}`
              : null;
            return (
              <tr key={row.employee_id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 align-top">
                {showSelect && (
                  <td className="px-4 py-2.5 w-10">
                    <input
                      type="checkbox"
                      checked={selected.has(row.employee_id)}
                      onChange={() => onToggleRow(row.employee_id)}
                      className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-primary focus:ring-primary/50"
                    />
                  </td>
                )}
                <td className="px-4 py-2.5">
                  <div className="font-medium text-[#111518] dark:text-white">{row.full_name}</div>
                  <div className="text-xs text-[#617989] dark:text-slate-400">
                    {row.passport_id || '—'}
                    {row.external_employee_id ? ` · #${row.external_employee_id}` : ''}
                  </div>
                  {row.ignored_days.length > 0 && (
                    <div
                      className="mt-1 inline-flex items-center gap-1 text-xs text-primary"
                      title={row.ignored_days.map((d) => dayLabel(month, d)).join(', ')}
                    >
                      <span className="material-symbols-outlined text-sm">event_busy</span>
                      {row.ignored_days.length} ימים אישיים לא נספרים
                    </div>
                  )}
                </td>
                <td className="px-4 py-2.5 text-[#617989] dark:text-slate-400">{row.site_name || '—'}</td>
                {kind !== 'empty' && (
                  <td className="px-4 py-2.5 font-semibold text-red-600 dark:text-red-400">{row.sick_count}</td>
                )}
                {kind !== 'sick' && (
                  <td className="px-4 py-2.5 font-semibold text-slate-700 dark:text-slate-300">{row.empty_count}</td>
                )}
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-1 max-w-md">
                    {kind !== 'empty' &&
                      row.sick_days.map((d) => <DayChip key={`s${d}`} month={month} day={d} kind="sick" />)}
                    {kind !== 'sick' &&
                      row.empty_days.map((d) => <DayChip key={`e${d}`} month={month} day={d} kind="empty" />)}
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-col items-start gap-1">
                    <CardStatusBadge status={row.card_status} />
                    {reviewHref && (
                      <Link to={reviewHref} className="text-xs text-primary hover:underline">
                        פתח כרטיס
                      </Link>
                    )}
                  </div>
                </td>
                {excludedMode && (
                  <td className="px-4 py-2.5 text-[#617989] dark:text-slate-400">{row.exclusion_reason || '—'}</td>
                )}
                {canManage && (
                  <td className="px-4 py-2.5">
                    <div className="flex flex-col items-start gap-1.5">
                      <button
                        onClick={() => onEditDays(row)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-primary"
                      >
                        <span className="material-symbols-outlined text-base">event_busy</span>
                        ימים לעובד
                      </button>
                      <button
                        onClick={() => onAction(row)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-primary"
                      >
                        <span className="material-symbols-outlined text-base">
                          {excludedMode ? 'undo' : 'visibility_off'}
                        </span>
                        {excludedMode ? 'החזר' : 'הסר מהתצוגה'}
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const EMPTY_DAYS: number[] = [];

/**
 * Calendar for picking days that don't count as workdays. Used for the
 * month-wide setting and, with `lockedDays` + `showRangeHelpers`, for a single
 * employee's own days on top of it.
 */
function IgnoredDaysModal({
  isOpen,
  month,
  title,
  description,
  initialIgnored,
  lockedDays = EMPTY_DAYS,
  showRangeHelpers = false,
  onClose,
  onSave,
}: {
  isOpen: boolean;
  month: string;
  title: string;
  description: ReactNode;
  initialIgnored: number[];
  /** Days already ignored for the whole month — shown, but not editable here. */
  lockedDays?: number[];
  showRangeHelpers?: boolean;
  onClose: () => void;
  onSave: (days: number[]) => Promise<void>;
}) {
  const [ignored, setIgnored] = useState<Set<number>>(new Set(initialIgnored));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) setIgnored(new Set(initialIgnored));
  }, [isOpen, initialIgnored]);

  const total = daysInMonth(month);
  const leading = weekdayOf(month, 1);
  const cells: (number | null)[] = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: total }, (_, i) => i + 1),
  ];
  const allDays = Array.from({ length: total }, (_, i) => i + 1);
  const locked = new Set(lockedDays);
  // Saturdays and month-wide days never count, so they don't break a start/end range.
  const isFixed = (day: number) => weekdayOf(month, day) === SATURDAY || locked.has(day);
  const editableDays = allDays.filter((d) => !isFixed(d));

  const toggle = (day: number) =>
    setIgnored((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });

  // First / last counted day, derived from the leading / trailing run of ignored days.
  const startDay = editableDays.find((d) => !ignored.has(d)) ?? 1;
  const endDay = [...editableDays].reverse().find((d) => !ignored.has(d)) ?? total;

  const setStart = (start: number) =>
    setIgnored((prev) => {
      const next = new Set(prev);
      editableDays.forEach((d) => {
        if (d < start) next.add(d);
        else if (d < startDay) next.delete(d);
      });
      return next;
    });

  const setEnd = (end: number) =>
    setIgnored((prev) => {
      const next = new Set(prev);
      editableDays.forEach((d) => {
        if (d > end) next.add(d);
        else if (d > endDay) next.delete(d);
      });
      return next;
    });

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave([...ignored].sort((a, b) => a - b));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} maxWidth="md">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-[#617989] dark:text-slate-400">{description}</p>
        {showRangeHelpers && (
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ['התחיל לעבוד ב־', startDay, setStart],
                ['סיים לעבוד ב־', endDay, setEnd],
              ] as [string, number, (d: number) => void][]
            ).map(([label, value, onChange]) => (
              <div key={label}>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{label}</label>
                <select
                  value={value}
                  onChange={(e) => onChange(Number(e.target.value))}
                  className={inputClass}
                >
                  {editableDays.map((d) => (
                    <option key={d} value={d}>
                      {dayLabel(month, d)} ({WEEKDAYS_HE[weekdayOf(month, d)]})
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-7 gap-1.5 text-center">
          {WEEKDAYS_HE.map((w) => (
            <div key={w} className="text-xs font-bold text-[#617989] dark:text-slate-400 py-1">
              {w}
            </div>
          ))}
          {cells.map((day, i) => {
            if (day === null) return <div key={`b${i}`} />;
            const isSaturday = weekdayOf(month, day) === SATURDAY;
            const isLocked = locked.has(day);
            const isIgnored = ignored.has(day);
            return (
              <button
                key={day}
                type="button"
                disabled={isSaturday || isLocked}
                onClick={() => toggle(day)}
                aria-pressed={isIgnored}
                title={isLocked ? 'הוחרג לכל העובדים בהגדרות החודש' : undefined}
                className={`h-10 rounded-lg text-sm font-semibold border transition-colors ${
                  isSaturday
                    ? 'bg-slate-50 dark:bg-slate-800/40 text-slate-300 dark:text-slate-600 border-transparent cursor-not-allowed'
                    : isLocked
                      ? 'bg-primary/10 text-primary/60 border-transparent line-through cursor-not-allowed'
                      : isIgnored
                        ? 'bg-primary text-white border-primary line-through'
                        : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-primary'
                }`}
              >
                {day}
              </button>
            );
          })}
        </div>
        <div className="text-sm text-slate-700 dark:text-slate-300">
          {ignored.size === 0 ? 'לא נבחרו ימים להתעלמות' : `${ignored.size} ימים מסומנים להתעלמות`}
        </div>
        <div className="flex justify-between gap-2">
          <button
            onClick={() => setIgnored(new Set())}
            disabled={ignored.size === 0}
            className="px-4 py-2 rounded-lg text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
          >
            נקה הכל
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              ביטול
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-primary text-white font-semibold hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? 'שומר...' : 'שמור'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default function AbsencesPage() {
  const { isAuthenticated } = useAuth();
  const { isAdmin, isFieldManager } = usePermissions();
  const { businessCode = '' } = useParams();
  const { showToast, ToastContainer } = useToast();
  const canManage = isAdmin;

  // Absences should be chased as early as possible, so default to the current month.
  const [selectedMonth, setSelectedMonth] = useState<string>(() => getDefaultMonth());
  const [searchQuery, setSearchQuery] = useState('');
  const [siteFilter, setSiteFilter] = useState<string[]>([]);
  const [kind, setKind] = useState<KindFilter>('all');

  const [data, setData] = useState<AbsencesResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<'forbidden' | 'generic' | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showExcluded, setShowExcluded] = useState(false);
  const [pendingExclude, setPendingExclude] = useState<string[] | null>(null);
  const [excludeReason, setExcludeReason] = useState('');
  const [applying, setApplying] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [employeeDaysTarget, setEmployeeDaysTarget] = useState<AbsenceEmployeeOverride | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setSelected(new Set());
    try {
      setData(await getAbsences(selectedMonth));
    } catch (err: any) {
      console.error('Failed to fetch absences:', err);
      setError(err?.response?.status === 403 ? 'forbidden' : 'generic');
    } finally {
      setIsLoading(false);
    }
  }, [selectedMonth]);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchData();
  }, [isAuthenticated, fetchData]);

  const siteOptions = useMemo(() => {
    const names = new Set<string>();
    [...(data?.rows ?? []), ...(data?.excluded_rows ?? [])].forEach((r) => {
      if (r.site_name) names.add(r.site_name);
    });
    return [...names]
      .sort((a, b) => a.localeCompare(b, 'he'))
      .map((name) => ({ value: name, label: name }));
  }, [data]);

  const applyFilters = useCallback(
    (rows: AbsenceRow[]) => {
      const q = searchQuery.trim().toLowerCase();
      return rows.filter((r) => {
        if (siteFilter.length > 0 && !siteFilter.includes(r.site_name ?? '')) return false;
        if (kind === 'sick' && r.sick_count === 0) return false;
        if (kind === 'empty' && r.empty_count === 0) return false;
        if (!q) return true;
        return (
          (r.full_name ?? '').toLowerCase().includes(q) ||
          (r.passport_id ?? '').toLowerCase().includes(q) ||
          (r.external_employee_id ?? '').toLowerCase().includes(q)
        );
      });
    },
    [searchQuery, siteFilter, kind],
  );

  const visibleRows = useMemo(() => applyFilters(data?.rows ?? []), [data, applyFilters]);
  const visibleExcluded = useMemo(() => applyFilters(data?.excluded_rows ?? []), [data, applyFilters]);

  const toggleRow = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = (ids: string[], select: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (select ? next.add(id) : next.delete(id)));
      return next;
    });

  const applyExclusion = async (ids: string[], excluded: boolean, reason?: string) => {
    setApplying(true);
    try {
      await setAbsenceExclusions(selectedMonth, ids, excluded, reason);
      showToast(
        excluded ? `${ids.length} עובדים הוסרו מהתצוגה לחודש זה` : `${ids.length} עובדים הוחזרו לתצוגה`,
        'success',
      );
      setPendingExclude(null);
      setExcludeReason('');
      await fetchData();
    } catch {
      showToast('שגיאה בעדכון הרשימה', 'error');
    } finally {
      setApplying(false);
    }
  };

  const handleSaveSettings = async (days: number[]) => {
    try {
      await saveAbsenceSettings(selectedMonth, days);
      showToast('הגדרות החודש נשמרו', 'success');
      setSettingsOpen(false);
      await fetchData();
    } catch {
      showToast('שגיאה בשמירת הגדרות החודש', 'error');
    }
  };

  const handleSaveEmployeeDays = async (days: number[]) => {
    if (!employeeDaysTarget) return;
    try {
      await saveEmployeeAbsenceDays(selectedMonth, employeeDaysTarget.employee_id, days);
      showToast(`הימים של ${employeeDaysTarget.full_name} נשמרו`, 'success');
      setEmployeeDaysTarget(null);
      await fetchData();
    } catch {
      showToast('שגיאה בשמירת ימי העובד', 'error');
    }
  };

  const editEmployeeDays = (row: AbsenceRow) =>
    setEmployeeDaysTarget({
      employee_id: row.employee_id,
      full_name: row.full_name,
      site_name: row.site_name,
      ignored_days: row.ignored_days,
    });

  const handleExport = async () => {
    try {
      const blob = await downloadAbsencesReport(selectedMonth);
      downloadBlobFile(blob, `היעדרויות - ${selectedMonth}.xlsx`);
    } catch {
      showToast('שגיאה בייצוא הקובץ', 'error');
    }
  };

  const ignoredDays = data?.settings.ignored_days ?? EMPTY_DAYS;
  const employeeOverrides = data?.employee_overrides ?? [];
  const cutoffLabel = useMemo(() => {
    if (!data) return '';
    if (data.cutoff_day === 0) return 'חודש עתידי — אין ימים לספירה';
    if (data.cutoff_day < daysInMonth(selectedMonth)) return `נספר עד ${dayLabel(selectedMonth, data.cutoff_day)} (היום)`;
    return 'החודש כולו';
  }, [data, selectedMonth]);

  return (
    <div className="flex flex-col gap-6">
      <ToastContainer />

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-[#111518] dark:text-white text-3xl font-bold">היעדרויות</h2>
          <p className="text-[#617989] dark:text-slate-400 mt-1">
            עובדים שהחסירו ימי עבודה (א׳–ו׳) בחודש הנבחר — ימי מחלה או ימים ללא דיווח
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleExport}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold transition-colors"
          >
            <span className="material-symbols-outlined text-base">download</span>
            הורד אקסל
          </button>
          {canManage && (
            <button
              onClick={() => setSettingsOpen(true)}
              disabled={!data}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary hover:bg-primary/90 text-white font-semibold shadow-lg transition-colors disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-base">calendar_month</span>
              הגדרות חודש
            </button>
          )}
        </div>
      </div>

      <PageBanner
        storageKey="absences"
        title="מדריך: היעדרויות"
        icon="lightbulb"
        summary={
          <>
            דף זה מציג עובדים שהחסירו ימי עבודה בחודש, כדי שניתן יהיה לאסוף אישורי מחלה מרופא מוקדם ככל האפשר.
            נספרים ימים א׳–ו׳ שסומנו כמחלה או שאין בהם דיווח כלל. שבתות אינן נספרות.
          </>
        }
        details={
          <ul className="list-disc list-inside space-y-1">
            <li>בחודש הנוכחי נספרים רק הימים עד היום (כולל).</li>
            <li>הנתונים נלקחים מהכרטיס המאושר, ואם אין כזה — מהכרטיסים שטרם אושרו.</li>
            <li>עובדים שלא הוגש עבורם אף כרטיס מופיעים בדף "כרטיסי עבודה חסרים" ולא כאן.</li>
            {isFieldManager && <li>התצוגה מוגבלת לאתרים שבאחריותך.</li>}
            {canManage && <li>ב"הגדרות חודש" ניתן לסמן ימים שאין לספור (למשל חגים).</li>}
            {canManage && (
              <li>
                ב"ימים לעובד" ניתן לסמן ימים שאין לספור לעובד מסוים בלבד — למשל עובד שהתחיל לעבוד באמצע החודש או
                שסיים לפני סופו.
              </li>
            )}
            {canManage && <li>ניתן להסיר עובדים מהתצוגה לחודש הנבחר בלבד, ולהחזיר אותם בכל עת.</li>}
          </ul>
        }
      />

      {/* Controls */}
      <div className="bg-white dark:bg-[#1a2a35] rounded-xl shadow-xl border border-slate-200/50 dark:border-slate-700/50 p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">חודש</label>
            <MonthPicker value={selectedMonth} onChange={setSelectedMonth} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">אתר</label>
            <SearchableMultiSelect
              options={siteOptions}
              selected={siteFilter}
              onChange={setSiteFilter}
              searchPlaceholder="חיפוש אתרים..."
              icon="apartment"
              allLabel="כל האתרים"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">סוג היעדרות</label>
            <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
              {(
                [
                  ['all', 'הכל'],
                  ['sick', 'מחלה'],
                  ['empty', 'ללא דיווח'],
                ] as [KindFilter, string][]
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setKind(value)}
                  className={`px-4 py-2 text-sm font-semibold transition-colors ${
                    kind === value ? 'bg-primary text-white' : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">חיפוש</label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={inputClass}
              placeholder="חפש לפי שם, ת.ז. או מספר עובד..."
            />
          </div>
        </div>
        {data && !isLoading && (
          <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700/50 flex flex-wrap items-center gap-2 text-sm">
            <span className="material-symbols-outlined text-base text-slate-400">event_available</span>
            <span className="font-medium text-slate-700 dark:text-slate-300">ימים שאינם נספרים כהיעדרות:</span>
            {ignoredDays.length === 0 ? (
              <span className="text-[#617989] dark:text-slate-400">אין (מלבד שבתות)</span>
            ) : (
              ignoredDays.map((d) => (
                <span
                  key={d}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-primary/10 text-primary"
                >
                  {dayLabel(selectedMonth, d)}
                  <span className="opacity-70">{WEEKDAYS_HE[weekdayOf(selectedMonth, d)]}</span>
                </span>
              ))
            )}
            {canManage && (
              <button
                onClick={() => setSettingsOpen(true)}
                className="ms-1 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
              >
                <span className="material-symbols-outlined text-sm">edit</span>
                {ignoredDays.length === 0 ? 'הוסף ימים' : 'ערוך'}
              </button>
            )}
          </div>
        )}
        {data && !isLoading && employeeOverrides.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="material-symbols-outlined text-base text-slate-400">event_busy</span>
            <span className="font-medium text-slate-700 dark:text-slate-300">ימים אישיים לעובדים:</span>
            {employeeOverrides.map((o) => {
              const label = (
                <>
                  {o.full_name}
                  <span className="opacity-70">· {o.ignored_days.length} ימים</span>
                </>
              );
              const chipClass =
                'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-primary/10 text-primary';
              const title = o.ignored_days.map((d) => dayLabel(selectedMonth, d)).join(', ');
              return canManage ? (
                <button
                  key={o.employee_id}
                  onClick={() => setEmployeeDaysTarget(o)}
                  title={title}
                  className={`${chipClass} hover:bg-primary/20`}
                >
                  {label}
                </button>
              ) : (
                <span key={o.employee_id} title={title} className={chipClass}>
                  {label}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-slate-500">טוען נתונים...</div>
      ) : error || !data ? (
        <div className="bg-white dark:bg-[#1a2a35] rounded-xl shadow-xl border border-slate-200/50 dark:border-slate-700/50 p-10 flex flex-col items-center text-center gap-3">
          <span className="material-symbols-outlined text-4xl text-slate-400">{error === 'forbidden' ? 'lock' : 'error'}</span>
          <h3 className="text-lg font-bold text-[#111518] dark:text-white">
            {error === 'forbidden' ? 'אין לך הרשאה לצפות בדף זה' : 'שגיאה בטעינת הנתונים'}
          </h3>
          {error !== 'forbidden' && (
            <button
              onClick={() => void fetchData()}
              className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white font-semibold hover:bg-primary/90"
            >
              <span className="material-symbols-outlined text-base">refresh</span>
              נסה שוב
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <SummaryTile label="עובדים עם היעדרות" value={data.summary.employees} />
            <SummaryTile label="ימי מחלה" value={data.summary.sick_days} />
            <SummaryTile label="ימים ללא דיווח" value={data.summary.empty_days} />
            <SummaryTile
              label="ימי עבודה שנספרו"
              value={data.workdays_counted}
              sub={[cutoffLabel, ignoredDays.length ? `${ignoredDays.length} ימים הוחרגו` : '']
                .filter(Boolean)
                .join(' · ')}
            />
          </div>

          {data.summary.skipped_no_day_data > 0 && (
            <div className="text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-4 py-2">
              {data.summary.skipped_no_day_data} עובדים לא נכללו כי לכרטיסים שלהם אין עדיין נתוני ימים (חילוץ בתהליך או
              סה"כ חודשי בלבד).
            </div>
          )}

          <div className="bg-white dark:bg-[#1a2a35] rounded-xl shadow-xl border border-slate-200/50 dark:border-slate-700/50 overflow-hidden">
            {visibleRows.length === 0 ? (
              <div className="p-10 text-center text-slate-500">
                {data.rows.length === 0 ? 'אין היעדרויות בחודש זה' : 'אין תוצאות התואמות לסינון'}
              </div>
            ) : (
              <AbsenceTable
                rows={visibleRows}
                month={selectedMonth}
                businessCode={businessCode}
                kind={kind}
                canManage={canManage}
                excludedMode={false}
                selected={selected}
                onToggleRow={toggleRow}
                onToggleAll={toggleAll}
                onAction={(row) => setPendingExclude([row.employee_id])}
                onEditDays={editEmployeeDays}
              />
            )}
          </div>

          {data.excluded_rows.length > 0 && (
            <div className="bg-white dark:bg-[#1a2a35] rounded-xl shadow-xl border border-slate-200/50 dark:border-slate-700/50 overflow-hidden">
              <button
                onClick={() => setShowExcluded((v) => !v)}
                className="w-full flex items-center justify-between px-6 py-4 text-start"
              >
                <span className="font-bold text-[#111518] dark:text-white">
                  הוסרו מהתצוגה ({data.excluded_rows.length})
                </span>
                <span className={`material-symbols-outlined transition-transform ${showExcluded ? 'rotate-180' : ''}`}>
                  expand_more
                </span>
              </button>
              {showExcluded && (
                <AbsenceTable
                  rows={visibleExcluded}
                  month={selectedMonth}
                  businessCode={businessCode}
                  kind={kind}
                  canManage={canManage}
                  excludedMode
                  selected={selected}
                  onToggleRow={toggleRow}
                  onToggleAll={toggleAll}
                  onAction={(row) => void applyExclusion([row.employee_id], false)}
                  onEditDays={editEmployeeDays}
                />
              )}
            </div>
          )}
        </>
      )}

      {canManage && selected.size > 0 && (
        <div className="sticky bottom-4 self-center flex items-center gap-3 bg-[#111518] text-white rounded-xl shadow-2xl px-5 py-3">
          <span className="text-sm">{selected.size} עובדים נבחרו</span>
          <button
            onClick={() => setPendingExclude([...selected])}
            className="px-3 py-1.5 rounded-lg bg-primary text-sm font-semibold hover:bg-primary/90"
          >
            הסר מהתצוגה
          </button>
          <button onClick={() => setSelected(new Set())} className="text-sm text-slate-300 hover:text-white">
            נקה בחירה
          </button>
        </div>
      )}

      <Modal
        isOpen={pendingExclude !== null}
        onClose={() => setPendingExclude(null)}
        title="הסרת עובדים מתצוגת ההיעדרויות"
        maxWidth="md"
      >
        <div className="flex flex-col gap-4">
          <p className="text-slate-700 dark:text-slate-300">
            {pendingExclude?.length === 1 ? 'העובד' : <><strong>{pendingExclude?.length ?? 0}</strong> עובדים</>}{' '}
            יוסרו מדף ההיעדרויות ומקובץ האקסל לחודש <strong>{selectedMonth}</strong> בלבד. ניתן להחזיר אותם בכל עת.
          </p>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">סיבה (לא חובה)</label>
            <input
              type="text"
              value={excludeReason}
              onChange={(e) => setExcludeReason(e.target.value)}
              className={inputClass}
              placeholder="למשל: התקבל אישור רפואי, עזב את העבודה..."
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setPendingExclude(null)}
              className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              ביטול
            </button>
            <button
              onClick={() => {
                if (pendingExclude) void applyExclusion(pendingExclude, true, excludeReason.trim());
              }}
              disabled={applying}
              className="px-4 py-2 rounded-lg bg-primary text-white font-semibold hover:bg-primary/90 disabled:opacity-50"
            >
              {applying ? 'מעדכן...' : 'הסר מהתצוגה'}
            </button>
          </div>
        </div>
      </Modal>

      {canManage && (
        <IgnoredDaysModal
          isOpen={settingsOpen}
          month={selectedMonth}
          title={`הגדרות חודש ${selectedMonth}`}
          description="לחצו על ימים שאין לספור כימי עבודה בחודש זה (למשל חגים או ימי שבתון). ימים אלו לא ייספרו כהיעדרות גם אם אין בהם דיווח. שבתות אינן נספרות לעולם."
          initialIgnored={ignoredDays}
          onClose={() => setSettingsOpen(false)}
          onSave={handleSaveSettings}
        />
      )}

      {canManage && (
        <IgnoredDaysModal
          isOpen={employeeDaysTarget !== null}
          month={selectedMonth}
          title={`ימים לעובד — ${employeeDaysTarget?.full_name ?? ''}`}
          description={
            <>
              ימים שלא ייספרו כימי עבודה עבור <strong>{employeeDaysTarget?.full_name}</strong> בלבד בחודש{' '}
              {selectedMonth} — למשל לפני שהתחיל לעבוד או אחרי שסיים. ימים שהוחרגו בהגדרות החודש מסומנים ואינם
              ניתנים לעריכה כאן.
            </>
          }
          initialIgnored={employeeDaysTarget?.ignored_days ?? EMPTY_DAYS}
          lockedDays={ignoredDays}
          showRangeHelpers
          onClose={() => setEmployeeDaysTarget(null)}
          onSave={handleSaveEmployeeDays}
        />
      )}
    </div>
  );
}
