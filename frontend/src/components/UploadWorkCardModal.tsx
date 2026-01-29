import { useState, useRef } from 'react';
import Modal from './Modal';
import MonthPicker from './MonthPicker';
import type { Employee } from '../types';

interface UploadWorkCardModalProps {
  isOpen: boolean;
  onClose: () => void;
  employee: Employee;
  siteId: string;
  onUpload: (employeeId: string, month: string, file: File) => Promise<void>;
}

const ALLOWED_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Helper to get previous month in YYYY-MM format
const getPreviousMonth = (): string => {
  const now = new Date();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const year = prevMonth.getFullYear();
  const month = String(prevMonth.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

export default function UploadWorkCardModal({
  isOpen,
  onClose,
  employee,
  siteId,
  onUpload,
}: UploadWorkCardModalProps) {
  const [selectedMonth, setSelectedMonth] = useState<string>(getPreviousMonth());
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleClose = () => {
    if (!isUploading) {
      setSelectedFile(null);
      setError(null);
      onClose();
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError('סוג קובץ לא נתמך. אנא העלה קובץ תמונה או PDF בלבד');
      setSelectedFile(null);
      return;
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      setError('גודל הקובץ חורג מהמותר (מקסימום 10MB)');
      setSelectedFile(null);
      return;
    }

    setError(null);
    setSelectedFile(file);
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleSubmit = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    setError(null);

    try {
      await onUpload(employee.id, selectedMonth, selectedFile);
      // Reset state and close modal
      setSelectedFile(null);
      setError(null);
      onClose();
    } catch (err: any) {
      const errorMessage = err?.response?.data?.message || err?.message || 'שגיאה בהעלאת הקובץ';
      setError(errorMessage);
    } finally {
      setIsUploading(false);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="העלאת כרטיס נוכחות" maxWidth="md">
      <div className="space-y-6">
        {/* Employee Info */}
        <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-lg">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 flex items-center justify-center font-bold text-sm">
              {employee.full_name
                .split(' ')
                .map((word) => word[0])
                .join('')
                .toUpperCase()
                .slice(0, 2)}
            </div>
            <div>
              <div className="font-bold text-slate-900 dark:text-white">{employee.full_name}</div>
              <div className="text-sm text-slate-600 dark:text-slate-400">
                ת.ז/דרכון: {employee.passport_id}
              </div>
            </div>
          </div>
        </div>

        {/* Month Selection */}
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            חודש עיבוד
          </label>
          <MonthPicker
            value={selectedMonth}
            onChange={setSelectedMonth}
            storageKey={`upload_work_card_month_${siteId}`}
          />
        </div>

        {/* File Upload */}
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            קובץ כרטיס נוכחות
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf"
            onChange={handleFileSelect}
            className="hidden"
          />

          {!selectedFile ? (
            <button
              onClick={handleUploadClick}
              disabled={isUploading}
              className="w-full border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg p-8 flex flex-col items-center justify-center gap-3 hover:border-primary hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-4xl text-slate-400">upload_file</span>
              <div className="text-center">
                <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  לחץ לבחירת קובץ
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  תמונה או PDF (מקסימום 10MB)
                </div>
              </div>
            </button>
          ) : (
            <div className="border border-slate-300 dark:border-slate-600 rounded-lg p-4 flex items-center gap-3 bg-slate-50 dark:bg-slate-900">
              <span className="material-symbols-outlined text-2xl text-primary">description</span>
              <div className="flex-1">
                <div className="text-sm font-medium text-slate-900 dark:text-white">
                  {selectedFile.name}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {formatFileSize(selectedFile.size)}
                </div>
              </div>
              <button
                onClick={() => setSelectedFile(null)}
                disabled={isUploading}
                className="p-1 text-slate-400 hover:text-red-500 transition-colors disabled:opacity-50"
                aria-label="הסר קובץ"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
          )}
        </div>

        {/* Error Message */}
        {error && (
          <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-3">
            <span className="material-symbols-outlined text-red-600 dark:text-red-400 text-xl">
              error
            </span>
            <p className="text-sm text-red-800 dark:text-red-300 flex-1">{error}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={handleSubmit}
            disabled={!selectedFile || isUploading}
            className="flex-1 px-4 py-3 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isUploading ? (
              <>
                <span className="material-symbols-outlined text-xl animate-spin">progress_activity</span>
                <span>מעלה...</span>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-xl">upload</span>
                <span>העלה</span>
              </>
            )}
          </button>
          <button
            onClick={handleClose}
            disabled={isUploading}
            className="px-4 py-3 bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ביטול
          </button>
        </div>
      </div>
    </Modal>
  );
}
