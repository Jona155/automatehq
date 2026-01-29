import { useState, useEffect, useRef } from 'react';
import type { EmployeeUploadStatus, Employee, WorkCard } from '../../types';
import { 
  uploadSingleWorkCard, 
  uploadBatchWorkCards, 
  getWorkCards, 
  updateWorkCard 
} from '../../api/workCards';
import { getEmployees } from '../../api/employees';
import UnknownUploadCard from './UnknownUploadCard';

interface EmployeesTabProps {
  siteId: string;
  selectedMonth: string;
  employeeStatuses: EmployeeUploadStatus[];
  isLoading: boolean;
  onRefresh: () => Promise<void>;
  onViewCard: (cardId: string) => void;
  showToast: (message: string, type: 'success' | 'error') => void;
}

export default function EmployeesTab({
  siteId,
  selectedMonth,
  employeeStatuses,
  isLoading,
  onRefresh,
  onViewCard,
  showToast
}: EmployeesTabProps) {
  // State
  const [searchQuery, setSearchQuery] = useState('');
  const [uploadingEmployees, setUploadingEmployees] = useState<Map<string, boolean>>(new Map());
  const [unknownUploads, setUnknownUploads] = useState<WorkCard[]>([]);
  const [isUnknownExpanded, setIsUnknownExpanded] = useState(false);
  const [siteEmployees, setSiteEmployees] = useState<Employee[]>([]);
  const [isBulkUploading, setIsBulkUploading] = useState(false);
  
  // Refs
  const bulkFileInputRef = useRef<HTMLInputElement>(null);

  // Fetch local data
  useEffect(() => {
    if (siteId && selectedMonth) {
      fetchUnknownUploads();
      fetchSiteEmployees();
    }
  }, [siteId, selectedMonth]);

  // Auto-collapse unknown uploads if empty
  useEffect(() => {
    if (unknownUploads.length === 0) {
      setIsUnknownExpanded(false);
    }
  }, [unknownUploads.length]);

  const fetchUnknownUploads = async () => {
    try {
      const allCards = await getWorkCards({ 
        site_id: siteId, 
        processing_month: selectedMonth 
      });
      const unknown = allCards.filter(card => !card.employee_id);
      setUnknownUploads(unknown);
    } catch (err) {
      console.error('Failed to fetch unknown uploads:', err);
    }
  };

  const fetchSiteEmployees = async () => {
    try {
      const employees = await getEmployees({ site_id: siteId, active: true });
      setSiteEmployees(employees);
    } catch (err) {
      console.error('Failed to fetch site employees:', err);
    }
  };

  const handleSingleUploadClick = (employeeId: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,.pdf';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file && siteId && selectedMonth) {
        await handleSingleUpload(employeeId, file);
      }
    };
    input.click();
  };

  const handleSingleUpload = async (employeeId: string, file: File) => {
    setUploadingEmployees(prev => new Map(prev).set(employeeId, true));
    
    try {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/f58507d7-2586-4617-8b51-be91d6ef2bc8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'EmployeesTab.tsx:handleSingleUpload',message:'Upload single work card (start)',data:{siteId,selectedMonth,employeeId,fileName:file.name,fileType:file.type,fileSize:file.size},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'H1'})}).catch(()=>{});
      // #endregion
      const created = await uploadSingleWorkCard(siteId, employeeId, selectedMonth, file);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/f58507d7-2586-4617-8b51-be91d6ef2bc8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'EmployeesTab.tsx:handleSingleUpload',message:'Upload single work card (success)',data:{createdCardId:created?.id,createdEmployeeId:created?.employee_id,createdSiteId:created?.site_id,createdProcessingMonth:created?.processing_month},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'H5'})}).catch(()=>{});
      // #endregion
      showToast('הקובץ הועלה בהצלחה', 'success');
      await onRefresh();
      await fetchUnknownUploads();
    } catch (err) {
      console.error('Failed to upload file:', err);
      const anyErr = err as any;
      const status = anyErr?.response?.status;
      const backendMessage = anyErr?.response?.data?.message ?? anyErr?.message;
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/f58507d7-2586-4617-8b51-be91d6ef2bc8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'EmployeesTab.tsx:handleSingleUpload',message:'Upload single work card (error)',data:{siteId,selectedMonth,employeeId,status,backendMessage},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'H1'})}).catch(()=>{});
      // #endregion
      showToast('שגיאה בהעלאת הקובץ', 'error');
    } finally {
      setUploadingEmployees(prev => {
        const next = new Map(prev);
        next.delete(employeeId);
        return next;
      });
    }
  };

  const handleBulkUpload = () => {
    bulkFileInputRef.current?.click();
  };

  const handleBulkUploadFiles = async (files: FileList) => {
    if (!siteId || !selectedMonth || files.length === 0) return;

    setIsBulkUploading(true);
    
    try {
      const filesArray = Array.from(files);
      const result = await uploadBatchWorkCards(siteId, selectedMonth, filesArray);
      
      const successCount = result.uploaded.length;
      const failedCount = result.failed.length;
      
      if (successCount > 0) {
        showToast(`הועלו ${successCount} קבצים בהצלחה`, 'success');
      }
      if (failedCount > 0) {
        showToast(`${failedCount} קבצים נכשלו`, 'error');
      }
      
      await onRefresh();
      await fetchUnknownUploads();
    } catch (err) {
      console.error('Failed to upload batch:', err);
      showToast('שגיאה בהעלאה מרובה', 'error');
    } finally {
      setIsBulkUploading(false);
      if (bulkFileInputRef.current) {
        bulkFileInputRef.current.value = '';
      }
    }
  };

  const handleAssignEmployee = async (cardId: string, employeeId: string) => {
    try {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/f58507d7-2586-4617-8b51-be91d6ef2bc8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'EmployeesTab.tsx:handleAssignEmployee',message:'Assign employee to work card (start)',data:{siteId,selectedMonth,cardId,employeeId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
      // #endregion
      await updateWorkCard(cardId, { employee_id: employeeId });
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/f58507d7-2586-4617-8b51-be91d6ef2bc8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'EmployeesTab.tsx:handleAssignEmployee',message:'Assign employee to work card (success)',data:{cardId,employeeId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H5'})}).catch(()=>{});
      // #endregion
      showToast('העובד שויך בהצלחה', 'success');
      await onRefresh();
      await fetchUnknownUploads();
    } catch (err) {
      console.error('Failed to assign employee:', err);
      const anyErr = err as any;
      const status = anyErr?.response?.status;
      const backendMessage = anyErr?.response?.data?.message ?? anyErr?.message;
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/f58507d7-2586-4617-8b51-be91d6ef2bc8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'EmployeesTab.tsx:handleAssignEmployee',message:'Assign employee to work card (error)',data:{cardId,employeeId,status,backendMessage},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
      // #endregion
      showToast('שגיאה בשיוך העובד', 'error');
    }
  };

  const getStatusBadge = (status: EmployeeUploadStatus['status']) => {
    const badges = {
      NO_UPLOAD: { label: 'ללא העלאה', color: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' },
      PENDING: { label: 'ממתין', color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' },
      EXTRACTED: { label: 'חולץ', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
      APPROVED: { label: 'אושר', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
      FAILED: { label: 'נכשל', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
    };
    
    const badge = badges[status];
    return (
      <span className={`px-3 py-1 rounded-full text-xs font-medium ${badge.color}`}>
        {badge.label}
      </span>
    );
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const filteredEmployeeStatuses = employeeStatuses.filter(({ employee }) =>
    employee.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    employee.passport_id.includes(searchQuery)
  );

  return (
    <div className="space-y-6">
      {/* Hidden file input for bulk upload */}
      <input
        ref={bulkFileInputRef}
        type="file"
        multiple
        accept="image/*,.pdf"
        className="hidden"
        onChange={(e) => e.target.files && handleBulkUploadFiles(e.target.files)}
      />

      {/* Employee List */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
          <h2 className="text-lg font-bold">רשימת עובדים</h2>
          <div className="flex items-center gap-4">
            <button
              onClick={handleBulkUpload}
              className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-sm"
            >
              <span className="material-symbols-outlined text-lg">upload_file</span>
              <span className="font-medium">העלאה מרובה</span>
            </button>
            <div className="relative">
              <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-lg">search</span>
              <input
                className="pr-10 pl-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm w-64 focus:ring-2 focus:ring-primary focus:border-transparent"
                placeholder="חיפוש לפי שם או ת.ז..."
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-slate-500">טוען רשימת עובדים...</div>
        ) : filteredEmployeeStatuses.length === 0 ? (
          <div className="p-8 text-center text-slate-500">לא נמצאו עובדים</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-400 text-sm">
                  <th className="px-6 py-4 font-medium">שם העובד</th>
                  <th className="px-6 py-4 font-medium">מספר דרכון / ת.ז</th>
                  <th className="px-6 py-4 font-medium">סטטוס חודשי</th>
                  <th className="px-6 py-4 font-medium text-left">פעולות</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {filteredEmployeeStatuses.map(({ employee, status, work_card_id }) => {
                  const isUploading = uploadingEmployees.get(employee.id);
                  const initials = getInitials(employee.full_name);
                  
                  return (
                    <tr key={employee.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 flex items-center justify-center font-bold text-xs uppercase">
                            {initials}
                          </div>
                          <span className="font-medium">{employee.full_name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-slate-600 dark:text-slate-400">
                        {employee.passport_id}
                      </td>
                      <td className="px-6 py-4">
                        {getStatusBadge(status)}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => handleSingleUploadClick(employee.id)}
                            disabled={isUploading}
                            className="p-2 text-slate-400 hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            title="העלאת מסמך"
                          >
                            {isUploading ? (
                              <span className="material-symbols-outlined text-xl animate-spin">progress_activity</span>
                            ) : (
                              <span className="material-symbols-outlined text-xl">upload</span>
                            )}
                          </button>
                          {work_card_id && (
                            <button
                              onClick={() => onViewCard(work_card_id)}
                              className="p-2 text-slate-400 hover:text-primary transition-colors"
                              title="צפייה בכרטיס"
                            >
                              <span className="material-symbols-outlined text-xl">visibility</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between text-sm text-slate-600 dark:text-slate-400">
          <span>מציג {filteredEmployeeStatuses.length} עובדים</span>
        </div>
      </div>

      {/* Unknown Uploads Section */}
      <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
        <button
          className="w-full flex items-center justify-between p-4 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          onClick={() => setIsUnknownExpanded(!isUnknownExpanded)}
        >
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-amber-600 dark:text-amber-400">warning</span>
            <span className="font-bold">העלאות שלא שויכו ({unknownUploads.length})</span>
            {unknownUploads.length > 0 && (
              <span className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 px-2 py-0.5 rounded">
                נדרשת פעולה
              </span>
            )}
          </div>
          <span 
            className={`material-symbols-outlined transition-transform duration-200 ${
              isUnknownExpanded ? 'rotate-180' : ''
            }`}
          >
            expand_more
          </span>
        </button>

        {isUnknownExpanded && unknownUploads.length > 0 && (
          <div className="p-6 border-t border-slate-200 dark:border-slate-700 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {unknownUploads.map((card) => (
              <UnknownUploadCard
                key={card.id}
                card={card}
                employees={siteEmployees}
                onAssign={(employeeId) => handleAssignEmployee(card.id, employeeId)}
              />
            ))}
            
            {/* Add more files card */}
            <div className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl flex flex-col items-center justify-center p-6 text-slate-400 hover:text-primary hover:border-primary transition-all cursor-pointer">
              <button
                onClick={handleBulkUpload}
                disabled={isBulkUploading}
                className="flex flex-col items-center disabled:opacity-50"
              >
                {isBulkUploading ? (
                  <>
                    <span className="material-symbols-outlined text-4xl mb-2 animate-spin">progress_activity</span>
                    <span className="text-sm font-medium text-center">מעלה קבצים...</span>
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-4xl mb-2">add_circle</span>
                    <span className="text-sm font-medium text-center">העלה קבצים נוספים ללא שיוך</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
