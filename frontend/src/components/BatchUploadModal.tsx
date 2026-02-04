import { useState, useRef } from 'react';
import Modal from './Modal';
import MonthPicker from './MonthPicker';
import { uploadBatchWorkCards } from '../api/workCards';

interface BatchUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  siteId: string;
  siteName: string;
  onUploadComplete: () => void;
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
const MAX_FILES = 50;

// Helper to get previous month in YYYY-MM format
const getPreviousMonth = (): string => {
  const now = new Date();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const year = prevMonth.getFullYear();
  const month = String(prevMonth.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

export default function BatchUploadModal({
  isOpen,
  onClose,
  siteId,
  siteName,
  onUploadComplete,
}: BatchUploadModalProps) {
  const [selectedMonth, setSelectedMonth] = useState<string>(getPreviousMonth());
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{
    uploaded: number;
    failed: number;
    errors: Array<{ filename: string; error: string }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleClose = () => {
    if (!isUploading) {
      setSelectedFiles([]);
      setError(null);
      setUploadResult(null);
      onClose();
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    // Validate total file count
    if (files.length > MAX_FILES) {
      setError(`ניתן להעלות עד ${MAX_FILES} קבצים בכל פעם`);
      return;
    }

    // Validate each file
    const validFiles: File[] = [];
    const errors: string[] = [];

    for (const file of files) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        errors.push(`${file.name}: סוג קובץ לא נתמך`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        errors.push(`${file.name}: גודל הקובץ חורג מהמותר (מקסימום 10MB)`);
        continue;
      }
      validFiles.push(file);
    }

    if (errors.length > 0) {
      setError(errors.join('\n'));
    } else {
      setError(null);
    }

    setSelectedFiles(validFiles);
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleRemoveFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (selectedFiles.length === 0) return;

    setIsUploading(true);
    setError(null);
    setUploadResult(null);

    try {
      const result = await uploadBatchWorkCards(siteId, selectedMonth, selectedFiles);
      
      setUploadResult({
        uploaded: result.uploaded?.length || 0,
        failed: result.failed?.length || 0,
        errors: result.failed || [],
      });

      // If all files uploaded successfully, notify parent and close
      if (!result.failed?.length) {
        onUploadComplete();
        setTimeout(() => {
          handleClose();
        }, 1500);
      }
    } catch (err: any) {
      const errorMessage = err?.response?.data?.message || err?.message || 'שגיאה בהעלאת הקבצים';
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
    <Modal isOpen={isOpen} onClose={handleClose} title="העלאה מרובה של כרטיסי נוכחות" maxWidth="lg">
      <div className="space-y-6">
        {/* Site Info */}
        <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-lg">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-600 flex items-center justify-center">
              <span className="material-symbols-outlined">domain</span>
            </div>
            <div>
              <div className="font-bold text-slate-900 dark:text-white">{siteName}</div>
              <div className="text-sm text-slate-600 dark:text-slate-400">
                העלאה מרובה - המערכת תזהה את העובדים באופן אוטומטי
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
            storageKey={`batch_upload_month_${siteId}`}
          />
        </div>

        {/* File Upload */}
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            קבצי כרטיסי נוכחות (עד {MAX_FILES} קבצים)
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />

          {selectedFiles.length === 0 ? (
            <button
              onClick={handleUploadClick}
              disabled={isUploading}
              className="w-full border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg p-8 flex flex-col items-center justify-center gap-3 hover:border-primary hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-4xl text-slate-400">upload_file</span>
              <div className="text-center">
                <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  לחץ לבחירת קבצים
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  ניתן לבחור מספר קבצים (תמונות או PDF, מקסימום 10MB כל אחד)
                </div>
              </div>
            </button>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-slate-600 dark:text-slate-400">
                  {selectedFiles.length} קבצים נבחרו
                </span>
                <button
                  onClick={handleUploadClick}
                  disabled={isUploading}
                  className="text-sm text-primary hover:underline disabled:opacity-50"
                >
                  הוסף עוד
                </button>
              </div>
              <div className="max-h-48 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-lg divide-y divide-slate-200 dark:divide-slate-700">
                {selectedFiles.map((file, index) => (
                  <div
                    key={`${file.name}-${index}`}
                    className="flex items-center gap-3 p-3 bg-white dark:bg-slate-800"
                  >
                    <span className="material-symbols-outlined text-xl text-primary">description</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-900 dark:text-white truncate">
                        {file.name}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {formatFileSize(file.size)}
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemoveFile(index)}
                      disabled={isUploading}
                      className="p-1 text-slate-400 hover:text-red-500 transition-colors disabled:opacity-50"
                      aria-label="הסר קובץ"
                    >
                      <span className="material-symbols-outlined text-lg">close</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Upload Result */}
        {uploadResult && (
          <div
            className={`p-4 rounded-lg flex items-start gap-3 ${
              uploadResult.failed === 0
                ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
                : 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800'
            }`}
          >
            <span
              className={`material-symbols-outlined text-xl ${
                uploadResult.failed === 0
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-amber-600 dark:text-amber-400'
              }`}
            >
              {uploadResult.failed === 0 ? 'check_circle' : 'warning'}
            </span>
            <div className="flex-1">
              <p
                className={`text-sm font-medium ${
                  uploadResult.failed === 0
                    ? 'text-green-800 dark:text-green-300'
                    : 'text-amber-800 dark:text-amber-300'
                }`}
              >
                הועלו {uploadResult.uploaded} קבצים בהצלחה
                {uploadResult.failed > 0 && `, ${uploadResult.failed} נכשלו`}
              </p>
              {uploadResult.errors.length > 0 && (
                <div className="mt-2 text-xs text-amber-700 dark:text-amber-400 space-y-1">
                  {uploadResult.errors.map((err, i) => (
                    <div key={i}>
                      {err.filename}: {err.error}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-3">
            <span className="material-symbols-outlined text-red-600 dark:text-red-400 text-xl">
              error
            </span>
            <p className="text-sm text-red-800 dark:text-red-300 flex-1 whitespace-pre-wrap">{error}</p>
          </div>
        )}

        {/* Info Box */}
        <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg flex items-start gap-3">
          <span className="material-symbols-outlined text-blue-600 dark:text-blue-400 text-xl">info</span>
          <div className="text-sm text-blue-800 dark:text-blue-300">
            <p className="font-medium mb-1">איך זה עובד?</p>
            <ul className="list-disc list-inside space-y-1 text-xs">
              <li>המערכת תחלץ את מספר הדרכון/ת.ז מכל כרטיס</li>
              <li>כרטיסים עם התאמה יועברו לסקירה</li>
              <li>כרטיסים ללא התאמה יופיעו ב"ממתינים לשיוך"</li>
            </ul>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={handleSubmit}
            disabled={selectedFiles.length === 0 || isUploading}
            className="flex-1 px-4 py-3 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isUploading ? (
              <>
                <span className="material-symbols-outlined text-xl animate-spin">progress_activity</span>
                <span>מעלה...</span>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-xl">cloud_upload</span>
                <span>העלה {selectedFiles.length > 0 ? `(${selectedFiles.length})` : ''}</span>
              </>
            )}
          </button>
          <button
            onClick={handleClose}
            disabled={isUploading}
            className="px-4 py-3 bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploadResult ? 'סגור' : 'ביטול'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
