import { useState, useEffect } from 'react';
import type { WorkCard, Employee } from '../../types';
import { getWorkCardFile } from '../../api/workCards';

interface UnknownUploadCardProps {
  card: WorkCard;
  employees: Employee[];
  onAssign: (employeeId: string) => void;
}

export default function UnknownUploadCard({ card, employees, onAssign }: UnknownUploadCardProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoadingImage, setIsLoadingImage] = useState(true);
  const [showImageModal, setShowImageModal] = useState(false);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');

  useEffect(() => {
    const loadImage = async () => {
      try {
        const blob = await getWorkCardFile(card.id);
        const url = URL.createObjectURL(blob);
        setImageUrl(url);
      } catch (err) {
        console.error('Failed to load image:', err);
      } finally {
        setIsLoadingImage(false);
      }
    };

    loadImage();

    return () => {
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    };
  }, [card.id]);

  const handleAssign = () => {
    if (selectedEmployeeId) {
      onAssign(selectedEmployeeId);
      setSelectedEmployeeId('');
    }
  };

  return (
    <>
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm group">
        <div 
          className="h-40 bg-slate-200 dark:bg-slate-700 relative flex items-center justify-center overflow-hidden cursor-pointer"
          onClick={() => setShowImageModal(true)}
        >
          {isLoadingImage ? (
            <span className="material-symbols-outlined text-3xl text-slate-400 animate-spin">progress_activity</span>
          ) : imageUrl ? (
            <>
              <img
                src={imageUrl}
                alt="Work Card"
                className="w-full h-full object-cover opacity-80"
              />
              <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <button className="bg-white text-slate-900 px-3 py-1.5 rounded-lg text-xs font-bold shadow-lg">
                  צפייה מוגדלת
                </button>
              </div>
            </>
          ) : (
            <span className="material-symbols-outlined text-3xl text-slate-400">image_not_supported</span>
          )}
        </div>
        
        <div className="p-4">
          <div className="mb-3">
            <div className="text-xs text-slate-500 dark:text-slate-400">תאריך העלאה</div>
            <div className="text-sm font-medium">
              {new Date(card.created_at).toLocaleString('he-IL', { 
                year: 'numeric', 
                month: '2-digit', 
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
              })}
            </div>
          </div>
          
          <div className="space-y-2">
            <select
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-primary focus:border-transparent"
              value={selectedEmployeeId}
              onChange={(e) => setSelectedEmployeeId(e.target.value)}
            >
              <option value="">בחר עובד</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.full_name} - {emp.passport_id}
                </option>
              ))}
            </select>
            
            <button
              onClick={handleAssign}
              disabled={!selectedEmployeeId}
              className="w-full px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              שיוך לעובד
            </button>
          </div>
        </div>
      </div>

      {/* Image Modal */}
      {showImageModal && imageUrl && (
        <div 
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-6"
          onClick={() => setShowImageModal(false)}
        >
          <div className="relative max-w-5xl max-h-full" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setShowImageModal(false)}
              className="absolute -top-12 left-0 text-white hover:text-slate-300 transition-colors"
            >
              <span className="material-symbols-outlined text-3xl">close</span>
            </button>
            <img
              src={imageUrl}
              alt="Work Card"
              className="max-w-full max-h-[90vh] object-contain rounded-lg"
            />
          </div>
        </div>
      )}
    </>
  );
}
