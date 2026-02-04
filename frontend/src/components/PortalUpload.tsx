import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { uploadPortalFiles } from '../api/publicPortal';

interface PortalUploadProps {
  sessionToken: string;
  month: string;
  siteName: string;
  employeeName: string;
}

const formatMonth = (value: string) => {
  const date = new Date(value);
  return date.toLocaleDateString('he-IL', { year: 'numeric', month: 'long' });
};

const formatFileSize = (size: number) => {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const getFileId = (file: File) => `${file.name}-${file.size}-${file.lastModified}`;

export default function PortalUpload({ sessionToken, month, siteName, employeeName }: PortalUploadProps) {
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
    if (selected.length === 0) {
      return;
    }
    setFiles((prev) => {
      const existing = new Map(prev.map((file) => [getFileId(file), file]));
      selected.forEach((file) => {
        existing.set(getFileId(file), file);
      });
      return Array.from(existing.values());
    });
    setMessage(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRemoveFile = (fileId: string) => {
    setFiles((prev) => prev.filter((file) => getFileId(file) !== fileId));
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
      setError('בחר קבצים להעלאה');
      return;
    }
    setIsUploading(true);
    setError(null);
    setMessage(null);
    try {
      const result = await uploadPortalFiles(sessionToken, files);
      setMessage(`הועלו ${result?.uploaded?.length ?? files.length} קבצים בהצלחה`);
      setFiles([]);
    } catch (err: any) {
      console.error('Upload failed:', err);
      setError(err?.response?.data?.message || 'שגיאה בהעלאה');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-sm text-slate-600">
        <div>אתר: <span className="font-medium text-slate-900">{siteName}</span></div>
        <div>עובד אחראי: <span className="font-medium text-slate-900">{employeeName}</span></div>
        <div>חודש: <span className="font-medium text-slate-900">{formatMonth(month)}</span></div>
      </div>

      <div className="border border-dashed border-slate-300 rounded-xl p-6 text-center">
        <input
          type="file"
          multiple
          accept="image/*,application/pdf"
          onChange={handleFileChange}
          className="hidden"
          id="portal-upload-input"
          ref={fileInputRef}
        />
        <label
          htmlFor="portal-upload-input"
          className="inline-flex items-center justify-center px-4 py-2 bg-slate-900 text-white rounded-lg cursor-pointer hover:bg-slate-800 transition-colors"
        >
          {files.length > 0 ? 'הוסף קבצים נוספים' : 'בחר קבצים להעלאה'}
        </label>
        <p className="mt-3 text-xs text-slate-500">תומך בקבצי תמונה ו-PDF.</p>
        {files.length > 0 && (
          <p className="mt-2 text-xs text-slate-500">אפשר להוסיף קבצים נוספים לפני ההעלאה.</p>
        )}
      </div>

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
              <li key={file.id} className="flex items-center justify-between text-sm text-slate-600 border border-slate-200 rounded-lg px-3 py-2">
                <div className="flex flex-col">
                  <span>{file.name}</span>
                  <span className="text-xs text-slate-400">{file.size}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveFile(file.id)}
                  className="text-xs font-medium text-red-500 hover:text-red-600"
                >
                  הסר
                </button>
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
