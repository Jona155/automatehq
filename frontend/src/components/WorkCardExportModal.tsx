import { useEffect, useMemo, useState } from 'react';
import type { Employee } from '../types';
import MonthPicker from './MonthPicker';
import Modal from './Modal';
import { downloadWorkCardsExport } from '../api/workCards';

interface WorkCardExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  siteId: string;
  siteName: string;
  employees: Employee[];
}

const STATUS_OPTIONS = [
  { value: 'NEEDS_REVIEW', label: 'ממתין לבדיקה' },
  { value: 'APPROVED', label: 'מאושר' },
  { value: 'REJECTED', label: 'נדחה' },
  { value: 'NEEDS_ASSIGNMENT', label: 'ממתין לשיוך' },
];

const getPreviousMonth = (): string => {
  const now = new Date();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const year = prevMonth.getFullYear();
  const month = String(prevMonth.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

export default function WorkCardExportModal({
  isOpen,
  onClose,
  siteId,
  siteName,
  employees,
}: WorkCardExportModalProps) {
  const [selectedMonth, setSelectedMonth] = useState<string>(getPreviousMonth());
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(() =>
    STATUS_OPTIONS.map((option) => option.value)
  );
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const [includeUnassigned, setIncludeUnassigned] = useState(true);
  const [includeMetadata, setIncludeMetadata] = useState(true);
  const [includeDayEntries, setIncludeDayEntries] = useState(false);
  const [search, setSearch] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setSelectedEmployeeIds(employees.map((employee) => employee.id));
    setSelectedStatuses(STATUS_OPTIONS.map((option) => option.value));
    setIncludeUnassigned(true);
    setIncludeMetadata(true);
    setIncludeDayEntries(false);
    setError(null);
  }, [isOpen, employees]);

  const filteredEmployees = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return employees;
    return employees.filter((employee) => {
      return (
        employee.full_name.toLowerCase().includes(query) ||
        (employee.passport_id || '').toLowerCase().includes(query)
      );
    });
  }, [employees, search]);

  const toggleStatus = (value: string) => {
    setSelectedStatuses((prev) =>
      prev.includes(value) ? prev.filter((status) => status !== value) : [...prev, value]
    );
  };

  const toggleEmployee = (employeeId: string) => {
    setSelectedEmployeeIds((prev) =>
      prev.includes(employeeId) ? prev.filter((id) => id !== employeeId) : [...prev, employeeId]
    );
  };

  const canDownload = selectedStatuses.length > 0 && (includeUnassigned || selectedEmployeeIds.length > 0);

  const handleDownload = async () => {
    if (!canDownload || isDownloading) return;
    setIsDownloading(true);
    setError(null);
    try {
      const blob = await downloadWorkCardsExport({
        site_id: siteId,
        processing_month: selectedMonth,
        statuses: selectedStatuses,
        employee_ids: selectedEmployeeIds,
        include_unassigned: includeUnassigned,
        include_metadata: includeMetadata,
        include_day_entries: includeDayEntries,
      });

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `work_cards_${siteName}_${selectedMonth}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      const errorMessage =
        err?.response?.data?.message ||
        err?.message ||
        'שגיאה בהורדת הקבצים';
      setError(errorMessage);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="הורדת כרטיסי עבודה" maxWidth="lg">
      <div className="space-y-6">
        <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-lg">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 flex items-center justify-center">
              <span className="material-symbols-outlined">download</span>
            </div>
            <div>
              <div className="font-bold text-slate-900 dark:text-white">{siteName}</div>
              <div className="text-sm text-slate-600 dark:text-slate-400">
                הורדת כרטיסי עבודה לפי חודש וסינון
              </div>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            חודש עיבוד
          </label>
          <MonthPicker
            value={selectedMonth}
            onChange={setSelectedMonth}
            storageKey={`work_card_export_month_${siteId}`}
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              סטטוס כרטיסים
            </label>
            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={() => setSelectedStatuses(STATUS_OPTIONS.map((option) => option.value))}
              >
                בחר הכל
              </button>
              <button
                type="button"
                className="text-slate-500 hover:underline"
                onClick={() => setSelectedStatuses([])}
              >
                נקה
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {STATUS_OPTIONS.map((option) => (
              <label key={option.value} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={selectedStatuses.includes(option.value)}
                  onChange={() => toggleStatus(option.value)}
                  className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-primary focus:ring-primary"
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              עובדים
            </label>
            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={() => setSelectedEmployeeIds(employees.map((employee) => employee.id))}
              >
                בחר הכל
              </button>
              <button
                type="button"
                className="text-slate-500 hover:underline"
                onClick={() => setSelectedEmployeeIds([])}
              >
                נקה
              </button>
            </div>
          </div>

          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="חיפוש לפי שם או דרכון"
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm mb-3"
          />

          <div className="max-h-48 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-lg divide-y divide-slate-200 dark:divide-slate-700">
            {filteredEmployees.map((employee) => (
              <label
                key={employee.id}
                className="flex items-center justify-between gap-2 p-3 text-sm text-slate-700 dark:text-slate-300"
              >
                <div className="flex flex-col">
                  <span className="font-medium">{employee.full_name}</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">{employee.passport_id}</span>
                </div>
                <input
                  type="checkbox"
                  checked={selectedEmployeeIds.includes(employee.id)}
                  onChange={() => toggleEmployee(employee.id)}
                  className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-primary focus:ring-primary"
                />
              </label>
            ))}
            {filteredEmployees.length === 0 && (
              <div className="p-4 text-center text-slate-500 text-sm">לא נמצאו עובדים</div>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 mt-3">
            <input
              type="checkbox"
              checked={includeUnassigned}
              onChange={(event) => setIncludeUnassigned(event.target.checked)}
              className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-primary focus:ring-primary"
            />
            <span>כלול כרטיסים ללא שיוך</span>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={includeMetadata}
              onChange={(event) => setIncludeMetadata(event.target.checked)}
              className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-primary focus:ring-primary"
            />
            <span>כלול קובץ מטא-דאטה (CSV)</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={includeDayEntries}
              onChange={(event) => setIncludeDayEntries(event.target.checked)}
              className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-primary focus:ring-primary"
            />
            <span>כלול שעות יומיות (CSV)</span>
          </label>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-300 text-sm">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700 rounded-lg transition-colors font-medium"
            disabled={isDownloading}
          >
            ביטול
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={!canDownload || isDownloading}
            className="px-6 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg transition-colors font-bold shadow-lg shadow-primary/30 disabled:opacity-50"
          >
            {isDownloading ? 'מוריד...' : 'הורד'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
