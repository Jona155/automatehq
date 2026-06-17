import { useState, useMemo } from 'react';
import type { DayStatus, Site } from '../types';
import { DAY_STATUS_LABELS } from '../constants/dayStatus';
import SearchableSelect from './SearchableSelect';

// Sentinel for the site selector meaning "reset attribution to the card's own
// site" (stored as null), distinct from "" which means "leave attribution as-is".
const SITE_DEFAULT = '__DEFAULT__';

interface DayEntryRow {
  day_of_month: number;
  from_time: string;
  to_time: string;
  total_hours: string;
  day_status: DayStatus | null;
  attributed_site_id?: string | null;
  isDirty: boolean;
  isLocked: boolean;
}

interface BulkDayUpdatePanelProps {
  month: string; // "YYYY-MM"
  dayEntries: DayEntryRow[];
  onApply: (selectedDays: number[], values: {
    from_time?: string;
    to_time?: string;
    total_hours?: string;
    day_status?: DayStatus | null;
    attributed_site_id?: string | null;
  }) => void;
  onClose: () => void;
  disabled?: boolean;
  sites?: Site[];
  cardSiteId?: string | null;
}

const HEBREW_WEEKDAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

const INPUT_BASE_CLASS = 'w-full px-2 py-1.5 rounded-lg border text-sm border-slate-300 dark:border-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40';
const inputClass = (dimmed: boolean) =>
  `${INPUT_BASE_CLASS} ${dimmed ? 'bg-slate-100 dark:bg-slate-700 opacity-50' : 'bg-white dark:bg-slate-800'}`;

export default function BulkDayUpdatePanel({ month, dayEntries, onApply, onClose, disabled, sites = [], cardSiteId = null }: BulkDayUpdatePanelProps) {
  const [selectedDays, setSelectedDays] = useState<Set<number>>(new Set());
  const [fromTime, setFromTime] = useState('');
  const [toTime, setToTime] = useState('');
  const [totalHours, setTotalHours] = useState('');
  const [dayStatus, setDayStatus] = useState<DayStatus | ''>('');
  const [siteId, setSiteId] = useState('');

  const otherSites = useMemo(() => sites.filter(s => s.id !== cardSiteId), [sites, cardSiteId]);
  const showSiteSelector = otherSites.length > 0;
  const siteOptions = useMemo(() => [
    { value: '', label: '— ללא שינוי —' },
    { value: SITE_DEFAULT, label: 'ברירת מחדל — אתר זה' },
    ...otherSites.map(s => ({ value: s.id, label: s.site_name })),
  ], [otherSites]);

  const { daysInMonth, lockedDays, daysWithData, dirtyDays, attributedDays, calendarCells } = useMemo(() => {
    const [year, mon] = month.split('-').map(Number);
    const daysInMonth = new Date(year, mon, 0).getDate();
    // Sunday = 0 in JS, which is also the first day of the Hebrew week
    const firstDayOffset = new Date(year, mon - 1, 1).getDay();

    const lockedDays = new Set<number>();
    const daysWithData = new Set<number>();
    const dirtyDays = new Set<number>();
    const attributedDays = new Set<number>();

    for (const entry of dayEntries) {
      if (entry.isLocked) lockedDays.add(entry.day_of_month);
      if (entry.from_time || entry.to_time || entry.total_hours || entry.day_status) {
        daysWithData.add(entry.day_of_month);
      }
      if (entry.isDirty) dirtyDays.add(entry.day_of_month);
      if (entry.attributed_site_id) attributedDays.add(entry.day_of_month);
    }

    const calendarCells: (number | null)[] = [];
    for (let i = 0; i < firstDayOffset; i++) calendarCells.push(null);
    for (let d = 1; d <= daysInMonth; d++) calendarCells.push(d);

    return { daysInMonth, firstDayOffset, lockedDays, daysWithData, dirtyDays, attributedDays, calendarCells };
  }, [month, dayEntries]);

  const toggleDay = (day: number) => {
    if (disabled || lockedDays.has(day)) return;
    setSelectedDays(prev => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  };

  const selectAll = () => {
    const all = new Set<number>();
    for (let d = 1; d <= daysInMonth; d++) {
      if (!lockedDays.has(d)) all.add(d);
    }
    setSelectedDays(all);
  };

  const clearSelection = () => setSelectedDays(new Set());

  const handleApply = () => {
    if (selectedDays.size === 0) return;
    const values: Parameters<typeof onApply>[1] = {};
    if (dayStatus) {
      values.day_status = dayStatus as DayStatus;
    } else {
      if (fromTime) values.from_time = fromTime;
      if (toTime) values.to_time = toTime;
      if (totalHours) values.total_hours = totalHours;
      values.day_status = null;
    }
    // Site attribution applies independently of hours/status. "" = leave as-is,
    // SITE_DEFAULT = reset to the card's site (null), otherwise the chosen site.
    if (siteId === SITE_DEFAULT) {
      values.attributed_site_id = null;
    } else if (siteId) {
      values.attributed_site_id = siteId;
    }
    onApply(Array.from(selectedDays), values);
    setFromTime('');
    setToTime('');
    setTotalHours('');
    setDayStatus('');
    setSiteId('');
    setSelectedDays(new Set());
  };

  const hasStatusSelected = dayStatus !== '';
  const hasAnyInput = fromTime || toTime || totalHours || dayStatus || siteId;

  return (
    <div className="mx-4 mb-3 p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h5 className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
          <span className="material-symbols-outlined text-base">calendar_month</span>
          עדכון מרובה
        </h5>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          aria-label="סגור עדכון מרובה"
        >
          <span className="material-symbols-outlined text-lg">close</span>
        </button>
      </div>

      {/* Calendar Grid */}
      <div>
        <div className="grid grid-cols-7 gap-1 mb-1">
          {HEBREW_WEEKDAYS.map(day => (
            <div key={day} className="text-center text-xs font-medium text-slate-500 dark:text-slate-400 py-1">
              {day}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {calendarCells.map((day, idx) => {
            if (day === null) {
              return <div key={`empty-${idx}`} />;
            }
            const isSelected = selectedDays.has(day);
            const isLocked = lockedDays.has(day);
            const hasData = daysWithData.has(day);
            const isDirty = dirtyDays.has(day);
            const isAttributed = attributedDays.has(day);

            return (
              <button
                key={day}
                type="button"
                onClick={() => toggleDay(day)}
                disabled={disabled || isLocked}
                title={isLocked ? 'יום נעול' : isAttributed ? `יום ${day} — משויך לאתר אחר` : `יום ${day}`}
                className={`
                  relative flex flex-col items-center justify-center rounded-lg py-1.5 text-sm font-medium transition-colors
                  ${isLocked
                    ? 'bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed'
                    : isSelected
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 cursor-pointer border border-slate-200 dark:border-slate-600'
                  }
                `}
              >
                {day}
                {(hasData || isDirty) && (
                  <span className={`absolute bottom-0.5 w-1.5 h-1.5 rounded-full ${isDirty ? 'bg-amber-400' : 'bg-slate-400 dark:bg-slate-500'}`} />
                )}
                {isAttributed && (
                  <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-indigo-500" title="משויך לאתר אחר" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selection controls */}
      <div className="flex items-center gap-3 text-xs text-slate-600 dark:text-slate-400">
        <span>{selectedDays.size} ימים נבחרו</span>
        <button type="button" onClick={selectAll} className="text-indigo-600 dark:text-indigo-400 hover:underline">בחר הכל</button>
        <button type="button" onClick={clearSelection} className="text-slate-500 hover:underline">נקה בחירה</button>
      </div>

      {/* Input Fields */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">כניסה</label>
          <input
            type="time"
            value={fromTime}
            onChange={e => setFromTime(e.target.value)}
            disabled={disabled || hasStatusSelected}
            className={inputClass(hasStatusSelected)}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">יציאה</label>
          <input
            type="time"
            value={toTime}
            onChange={e => setToTime(e.target.value)}
            disabled={disabled || hasStatusSelected}
            className={inputClass(hasStatusSelected)}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">סה"כ שעות</label>
          <input
            type="number"
            step="0.25"
            min="0"
            max="24"
            value={totalHours}
            onChange={e => setTotalHours(e.target.value)}
            disabled={disabled || hasStatusSelected}
            className={inputClass(hasStatusSelected)}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">סטטוס</label>
          <select
            value={dayStatus}
            onChange={e => setDayStatus(e.target.value as DayStatus | '')}
            disabled={disabled}
            className={inputClass(false)}
          >
            <option value="">בחר...</option>
            {Object.entries(DAY_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Site attribution (only when other sites exist) */}
      {showSiteSelector && (
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">שייך לאתר</label>
          <SearchableSelect
            options={siteOptions}
            value={siteId}
            onChange={setSiteId}
            disabled={disabled}
            searchPlaceholder="חיפוש אתר..."
            ariaLabel="שייך לאתר"
            className={inputClass(false)}
          />
        </div>
      )}

      {/* Apply button */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleApply}
          disabled={disabled || selectedDays.size === 0 || !hasAnyInput}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <span className="material-symbols-outlined text-sm">check</span>
          החל על הימים הנבחרים
        </button>
      </div>
    </div>
  );
}
