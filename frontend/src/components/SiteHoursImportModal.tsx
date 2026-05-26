import { useState, useRef } from 'react';
import Modal from './Modal';
import { importHoursFromExcel } from '../api/siteHoursImport';
import type { HoursImportSuccess, HoursImportValidationError } from '../api/siteHoursImport';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  siteId: string;
  selectedMonth: string; // "YYYY-MM"
  onSuccess: () => void;
}

type State = 'idle' | 'uploading' | 'success' | 'error';

const ERROR_TYPE_LABELS: Record<string, string> = {
  unknown_employee: 'עובד לא שייך לאתר',
  tariff_mismatch: 'אי-התאמה בתעריף',
  invalid_day: 'יום לא קיים בחודש',
  unrecognized_value: 'ערך לא מוכר',
  structure: 'מבנה קובץ שגוי',
};

export default function SiteHoursImportModal({ isOpen, onClose, siteId, selectedMonth, onSuccess }: Props) {
  const [state, setState] = useState<State>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [successData, setSuccessData] = useState<HoursImportSuccess | null>(null);
  const [validationErrors, setValidationErrors] = useState<HoursImportValidationError[]>([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const resetState = () => {
    setState('idle');
    setFile(null);
    setSuccessData(null);
    setValidationErrors([]);
    setErrorMessage('');
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleFileSelect = (selected: File | null) => {
    if (!selected) return;
    if (!selected.name.toLowerCase().endsWith('.xlsx')) {
      setErrorMessage('יש להעלות קובץ בפורמט XLSX בלבד');
      setState('error');
      return;
    }
    setFile(selected);
    setState('idle');
    setErrorMessage('');
    setValidationErrors([]);
    setSuccessData(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileSelect(e.dataTransfer.files[0] ?? null);
  };

  const handleImport = async () => {
    if (!file) return;
    setState('uploading');
    setValidationErrors([]);
    setErrorMessage('');
    try {
      const result = await importHoursFromExcel(siteId, selectedMonth, file);
      setSuccessData(result);
      setState('success');
      onSuccess();
    } catch (err: any) {
      const data = err?.response?.data;
      const errors: HoursImportValidationError[] = data?.data?.validation_errors ?? [];
      if (errors.length > 0) {
        setValidationErrors(errors);
      } else {
        setErrorMessage(data?.message || 'שגיאה בייבוא הקובץ');
      }
      setState('error');
    }
  };

  const formatMonth = (m: string) => {
    const [y, mo] = m.split('-');
    return `${mo}/${y}`;
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="ייבוא שעות מ-Excel" maxWidth="md">
      <div className="flex flex-col gap-5 p-1" dir="rtl">
        {/* Month indicator */}
        <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <span className="material-symbols-outlined text-base">calendar_month</span>
          <span>חודש: <strong>{formatMonth(selectedMonth)}</strong></span>
        </div>

        {/* File drop zone */}
        {state !== 'success' && (
          <div
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
              isDragging
                ? 'border-primary bg-primary/5'
                : 'border-slate-300 dark:border-slate-600 hover:border-primary hover:bg-primary/5 dark:hover:border-primary'
            }`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => handleFileSelect(e.target.files?.[0] ?? null)}
            />
            <span className="material-symbols-outlined text-3xl text-slate-400 dark:text-slate-500 mb-2 block">
              upload_file
            </span>
            {file ? (
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{file.name}</p>
            ) : (
              <>
                <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                  גרור קובץ XLSX לכאן או לחץ לבחירה
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                  יש להעלות את קובץ הסיכום החודשי בפורמט XLSX
                </p>
              </>
            )}
          </div>
        )}

        {/* Success result */}
        {state === 'success' && successData && (
          <div className="rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="material-symbols-outlined text-green-600 dark:text-green-400">check_circle</span>
              <span className="font-semibold text-green-800 dark:text-green-300 text-sm">הייבוא הושלם בהצלחה</span>
            </div>
            <div className="text-sm text-green-700 dark:text-green-300 space-y-1">
              <div>עודכנו <strong>{successData.updated_cards}</strong> כרטיסי עבודה</div>
              <div>עודכנו <strong>{successData.updated_entries}</strong> רשומות יום</div>
            </div>
            {successData.employees.length > 0 && (
              <div className="mt-3 space-y-1">
                {successData.employees.map((emp) => (
                  <div key={emp.passport} className="text-xs text-green-700 dark:text-green-400">
                    {emp.name} — {emp.entries_changed} רשומות
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Validation errors */}
        {state === 'error' && validationErrors.length > 0 && (
          <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="material-symbols-outlined text-red-600 dark:text-red-400">error</span>
              <span className="font-semibold text-red-800 dark:text-red-300 text-sm">
                הקובץ לא יובא — נמצאו {validationErrors.length} שגיאות
              </span>
            </div>
            <ul className="space-y-2 max-h-56 overflow-y-auto">
              {validationErrors.map((err, i) => (
                <li key={i} className="text-xs text-red-700 dark:text-red-300">
                  <span className="inline-block bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 rounded px-1.5 py-0.5 font-medium ml-1.5">
                    {ERROR_TYPE_LABELS[err.type] ?? err.type}
                  </span>
                  {err.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Generic error */}
        {state === 'error' && validationErrors.length === 0 && errorMessage && (
          <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4 flex items-center gap-2">
            <span className="material-symbols-outlined text-red-600 dark:text-red-400">error</span>
            <span className="text-sm text-red-700 dark:text-red-300">{errorMessage}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 justify-end pt-1">
          <button
            onClick={state === 'success' ? handleClose : handleClose}
            className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
          >
            {state === 'success' ? 'סגור' : 'ביטול'}
          </button>
          {state !== 'success' && (
            <button
              onClick={handleImport}
              disabled={!file || state === 'uploading'}
              className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {state === 'uploading' ? (
                <>
                  <span className="material-symbols-outlined text-base animate-spin">progress_activity</span>
                  <span>מייבא...</span>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-base">upload_file</span>
                  <span>ייבוא</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
