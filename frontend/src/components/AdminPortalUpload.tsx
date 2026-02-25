import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { uploadAdminPortalFiles, type AdminPortalSite } from '../api/publicPortal';
import MonthPicker from './MonthPicker';

interface AdminPortalUploadProps {
  sessionToken: string;
  userName: string;
  businessName: string;
  sites: AdminPortalSite[];
}

const getCurrentMonth = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

const formatMonthHebrew = (value: string): string => {
  const [year, month] = value.split('-');
  const date = new Date(parseInt(year), parseInt(month) - 1, 1);
  return date.toLocaleDateString('he-IL', { year: 'numeric', month: 'long' });
};

const formatFileSize = (size: number): string => {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const getFileId = (file: File) => `${file.name}-${file.size}-${file.lastModified}`;

export default function AdminPortalUpload({ sessionToken, userName, businessName, sites }: AdminPortalUploadProps) {
  const [selectedSiteId, setSelectedSiteId] = useState('');
  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentMonth());
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const fileSummary = useMemo(() => files.map((file) => ({
    id: getFileId(file),
    name: file.name,
    size: formatFileSize(file.size),
  })), [files]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files || []);
    if (selected.length === 0) return;
    setFiles((prev) => {
      const existing = new Map(prev.map((f) => [getFileId(f), f]));
      selected.forEach((f) => existing.set(getFileId(f), f));
      return Array.from(existing.values());
    });
    setMessage(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleRemoveFile = (fileId: string) => {
    setFiles((prev) => prev.filter((f) => getFileId(f) !== fileId));
    setMessage(null);
    setError(null);
  };

  const handleClearAll = () => {
    setFiles([]);
    setMessage(null);
    setError(null);
  };

  const handleUpload = async () => {
    if (files.length === 0) {
      setError('יש לבחור קבצים להעלאה.');
      return;
    }
    setIsUploading(true);
    setError(null);
    setMessage(null);
    try {
      const result = await uploadAdminPortalFiles(
        sessionToken,
        { site_id: selectedSiteId || undefined, processing_month: selectedMonth + '-01' },
        files,
      );
      setMessage(`הועלו בהצלחה ${result?.uploaded?.length ?? files.length} קבצים.`);
      setFiles([]);
    } catch {
      setError('ההעלאה נכשלה. נסה שוב.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-6" dir="rtl">
      <div className="text-sm text-slate-600">
        <span className="font-medium text-slate-900">{userName}</span>
        {' · '}
        <span className="text-slate-500">{businessName}</span>
      </div>

      {/* Site selector */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">אתר</label>
        <select
          value={selectedSiteId}
          onChange={(e) => setSelectedSiteId(e.target.value)}
          className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-white text-right"
        >
          <option value="">בחר אתר (אופציונלי)</option>
          {sites.map((site) => (
            <option key={site.id} value={site.id}>{site.site_name}</option>
          ))}
        </select>
      </div>

      {/* Month display */}
      <div>
        <div className="flex items-center justify-between">
          <div className="text-sm text-slate-700">
            <span className="font-medium">חודש נוכחי: </span>
            <span className="text-slate-900 font-semibold">{formatMonthHebrew(selectedMonth)}</span>
          </div>
          <button
            type="button"
            onClick={() => setShowMonthPicker((v) => !v)}
            className="text-xs text-primary hover:underline"
          >
            שנה חודש
          </button>
        </div>
        {showMonthPicker && (
          <div className="mt-3">
            <MonthPicker
              value={selectedMonth}
              onChange={(v) => { setSelectedMonth(v); setShowMonthPicker(false); }}
              storageKey="admin_portal_month"
            />
          </div>
        )}
      </div>

      {/* File upload area */}
      <div className="border border-dashed border-slate-300 rounded-xl p-6 text-center">
        <input
          type="file"
          multiple
          accept="image/*,application/pdf"
          onChange={handleFileChange}
          className="hidden"
          id="admin-portal-upload-input"
          ref={fileInputRef}
        />
        <label
          htmlFor="admin-portal-upload-input"
          className="inline-flex items-center justify-center px-4 py-2 bg-slate-900 text-white rounded-lg cursor-pointer hover:bg-slate-800 transition-colors"
        >
          {files.length > 0 ? 'הוסף קבצים נוספים' : 'בחר קבצים להעלאה'}
        </label>
        <p className="mt-3 text-xs text-slate-500">תומך בקבצי תמונה וקבצי PDF.</p>
      </div>

      {/* File list */}
      {fileSummary.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-slate-700">קבצים שנבחרו</h4>
            <button
              type="button"
              onClick={handleClearAll}
              className="text-xs font-medium text-slate-500 hover:text-slate-700"
            >
              נקה הכל
            </button>
          </div>
          <ul className="space-y-2">
            {fileSummary.map((file) => (
              <li
                key={file.id}
                className="flex items-center justify-between text-sm text-slate-600 border border-slate-200 rounded-lg px-3 py-2"
              >
                <button
                  type="button"
                  onClick={() => handleRemoveFile(file.id)}
                  className="text-xs font-medium text-red-500 hover:text-red-600"
                >
                  הסר
                </button>
                <div className="flex flex-col items-end">
                  <span>{file.name}</span>
                  <span className="text-xs text-slate-400">{file.size}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <div className="text-sm text-red-600">{error}</div>}
      {message && <div className="text-sm text-green-600">{message}</div>}

      <button
        onClick={handleUpload}
        disabled={isUploading}
        className="w-full px-4 py-3 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors font-medium disabled:opacity-50"
      >
        {isUploading ? 'מעלה...' : 'העלה קבצים'}
      </button>
    </div>
  );
}
