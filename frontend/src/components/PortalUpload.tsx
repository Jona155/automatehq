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
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
};

const formatMonthSinhala = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString('si-LK', { year: 'numeric', month: 'long' });
};

const formatFileSize = (size: number) => {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const getFileId = (file: File) => `${file.name}-${file.size}-${file.lastModified}`;

function BilingualText({
  en,
  si,
  className = '',
  secondaryClassName = 'text-xs text-slate-500',
}: {
  en: string;
  si: string;
  className?: string;
  secondaryClassName?: string;
}) {
  return (
    <span className={className}>
      <span className="block">{en}</span>
      <span className={`block ${secondaryClassName}`}>{si}</span>
    </span>
  );
}

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
      setError('Select files to upload');
      return;
    }
    setIsUploading(true);
    setError(null);
    setMessage(null);
    try {
      const result = await uploadPortalFiles(sessionToken, files);
      setMessage(`Successfully uploaded ${result?.uploaded?.length ?? files.length} file(s)`);
      setFiles([]);
    } catch (err: any) {
      console.error('Upload failed:', err);
      setError('Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-6 text-left" dir="ltr">
      <div className="text-sm text-slate-600">
        <div className="mb-2">
          <BilingualText en="Site" si="අඩවිය" />
          <span className="font-medium text-slate-900">{siteName}</span>
        </div>
        <div className="mb-2">
          <BilingualText en="Responsible Employee" si="වගකිවයුතු සේවකයා" />
          <span className="font-medium text-slate-900">{employeeName}</span>
        </div>
        <div>
          <BilingualText en="Month" si="මාසය" />
          <span className="font-medium text-slate-900 block">{formatMonth(month)}</span>
          <span className="text-xs text-slate-500 block">{formatMonthSinhala(month)}</span>
        </div>
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
          {files.length > 0 ? (
            <BilingualText en="Add More Files" si="තවත් ගොනු එක් කරන්න" secondaryClassName="text-xs text-white/80" />
          ) : (
            <BilingualText en="Select Files to Upload" si="උඩුගත කිරීමට ගොනු තෝරන්න" secondaryClassName="text-xs text-white/80" />
          )}
        </label>
        <p className="mt-3 text-xs text-slate-500">
          <BilingualText en="Supports image files and PDF files." si="රූප ගොනු සහ PDF ගොනු සඳහා සහය දක්වයි." />
        </p>
        {files.length > 0 && (
          <p className="mt-2 text-xs text-slate-500">
            <BilingualText en="You can add more files before uploading." si="උඩුගත කිරීමට පෙර තවත් ගොනු එක් කළ හැක." />
          </p>
        )}
      </div>

      {fileSummary.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-slate-700">
              <BilingualText en="Selected Files" si="තෝරාගත් ගොනු" secondaryClassName="text-xs text-slate-500 font-normal" />
            </h4>
            <button
              type="button"
              onClick={handleClearAll}
              className="text-xs font-medium text-slate-500 hover:text-slate-700"
            >
              <BilingualText en="Clear All" si="සියල්ල ඉවත් කරන්න" secondaryClassName="text-[11px] text-slate-400" />
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
                  <BilingualText en="Remove" si="ඉවත් කරන්න" secondaryClassName="text-[11px] text-red-400" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <div className="text-sm text-red-600">
          <BilingualText en={error} si="උඩුගත කිරීම අසාර්ථක විය. කරුණාකර නැවත උත්සාහ කරන්න." secondaryClassName="text-xs text-red-500/90" />
        </div>
      )}
      {message && (
        <div className="text-sm text-green-600">
          <BilingualText en={message} si="ගොනු සාර්ථකව උඩුගත කරන ලදී." secondaryClassName="text-xs text-green-600/90" />
        </div>
      )}

      <button
        onClick={handleUpload}
        disabled={isUploading}
        className="w-full px-4 py-3 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors font-medium disabled:opacity-50"
      >
        {isUploading ? (
          <BilingualText en="Uploading..." si="උඩුගත කරමින්..." secondaryClassName="text-xs text-white/80" />
        ) : (
          <BilingualText en="Upload Files" si="ගොනු උඩුගත කරන්න" secondaryClassName="text-xs text-white/80" />
        )}
      </button>
    </div>
  );
}
