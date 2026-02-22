import { useEffect, useMemo, useState } from 'react';
import type { Employee, UploadAccessRequest } from '../types';
import MonthPicker from './MonthPicker';
import { createAccessLink, getAccessLinks, revokeAccessLink, sendAccessLinkToWhatsapp } from '../api/sites';
import { useToast } from '../hooks/useToast';

interface AccessLinksManagerProps {
  siteId: string;
  employees: Employee[];
  isLoadingEmployees?: boolean;
  defaultEmployeeId?: string | null;
}

const formatMonth = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  return date.toLocaleDateString('he-IL', { year: 'numeric', month: 'long' });
};

const formatDateTime = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  return date.toLocaleDateString('he-IL', { year: 'numeric', month: 'numeric', day: 'numeric' });
};

const getDefaultMonth = () => {
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const year = nextMonth.getFullYear();
  const month = String(nextMonth.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

export default function AccessLinksManager({
  siteId,
  employees,
  isLoadingEmployees,
  defaultEmployeeId,
}: AccessLinksManagerProps) {
  const [links, setLinks] = useState<UploadAccessRequest[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [sendingWhatsappId, setSendingWhatsappId] = useState<string | null>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [selectedMonth, setSelectedMonth] = useState(getDefaultMonth());
  const [error, setError] = useState<string | null>(null);
  const { showToast, ToastContainer } = useToast();

  const eligibleEmployees = useMemo(() => employees.filter((employee) => employee.is_active), [employees]);
  const defaultEmployee = useMemo(() => {
    if (!defaultEmployeeId) return null;
    return eligibleEmployees.find((employee) => employee.id === defaultEmployeeId) || null;
  }, [defaultEmployeeId, eligibleEmployees]);

  const fetchLinks = async () => {
    if (!siteId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await getAccessLinks(siteId);
      setLinks(data);
    } catch (err) {
      console.error('Failed to fetch access links:', err);
      setError('שגיאה בטעינת קישורי גישה');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLinks();
  }, [siteId]);

  useEffect(() => {
    if (!defaultEmployee) return;
    const hasSelected = selectedEmployeeId && eligibleEmployees.some((employee) => employee.id === selectedEmployeeId);
    if (hasSelected) return;
    setSelectedEmployeeId(defaultEmployee.id);
  }, [defaultEmployee, eligibleEmployees, selectedEmployeeId]);

  const handleCreate = async () => {
    if (!selectedEmployeeId || !selectedMonth) return;
    setIsCreating(true);
    try {
      const processingMonth = `${selectedMonth}-01`;
      const created = await createAccessLink(siteId, { employee_id: selectedEmployeeId, processing_month: processingMonth });
      setLinks((prev) => [created, ...prev]);
      showToast('הקישור נוצר בהצלחה', 'success');
    } catch (err) {
      console.error('Failed to create access link:', err);
      showToast('שגיאה ביצירת קישור גישה', 'error');
    } finally {
      setIsCreating(false);
    }
  };

  const handleCopy = async (url?: string) => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      showToast('הקישור הועתק ללוח', 'success');
    } catch (err) {
      console.error('Failed to copy link:', err);
      showToast('לא הצלחנו להעתיק את הקישור', 'error');
    }
  };

  const handleRevoke = async (requestId: string) => {
    try {
      await revokeAccessLink(siteId, requestId);
      setLinks((prev) => prev.filter((link) => link.id !== requestId));
      showToast('הקישור בוטל', 'success');
    } catch (err) {
      console.error('Failed to revoke link:', err);
      showToast('שגיאה בביטול הקישור', 'error');
    }
  };

  const handleSendWhatsapp = async (requestId: string) => {
    if (sendingWhatsappId === requestId) return;
    setSendingWhatsappId(requestId);
    try {
      await sendAccessLinkToWhatsapp(siteId, requestId);
      showToast('הקישור נוצר בהצלחה', 'success');
    } catch (err: any) {
      console.error('Failed to send WhatsApp:', err);
      const msg = err?.response?.data?.message || 'שגיאה בשליחת הודעה';
      showToast(msg, 'error');
    } finally {
      setSendingWhatsappId(null);
    }
  };


  return (
    <div className="px-6 py-6 border-b border-slate-200 dark:border-slate-700">
      <ToastContainer />
      <div className="flex flex-col gap-4">
        <div>
          <h3 className="text-lg font-bold">גישה מרחוק להעלאת כרטיסים</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            צור קישור מאובטח לעובד אחראי כדי להעלות כרטיסי עבודה לחודש ספציפי.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">עובד אחראי</label>
            <select
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              value={selectedEmployeeId}
              onChange={(event) => setSelectedEmployeeId(event.target.value)}
              disabled={isLoadingEmployees || eligibleEmployees.length === 0}
            >
              <option value="">בחר עובד</option>
              {eligibleEmployees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.full_name.split(' ')[0]} - {employee.passport_id}
                  {defaultEmployeeId === employee.id ? ' (ברירת מחדל)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">חודש עיבוד</label>
            <MonthPicker value={selectedMonth} onChange={setSelectedMonth} storageKey={`site_access_link_month_${siteId}`} />
          </div>

          <div className="flex">
            <button
              onClick={handleCreate}
              disabled={!selectedEmployeeId || !selectedMonth || isCreating}
              className="w-full px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isCreating ? 'יוצר קישור...' : 'צור קישור'}
            </button>
          </div>
        </div>

        <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 dark:bg-slate-900 flex items-center justify-between">
            <h4 className="font-medium text-slate-800 dark:text-slate-200">קישורים פעילים</h4>
            <button
              onClick={fetchLinks}
              className="text-sm text-primary hover:text-primary/80 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              disabled={isLoading}
            >
              רענן
            </button>
          </div>

          {isLoading ? (
            <div className="p-4 text-center text-slate-500">טוען קישורים...</div>
          ) : error ? (
            <div className="p-4 text-center text-red-500">{error}</div>
          ) : links.length === 0 ? (
            <div className="p-4 text-center text-slate-500">אין קישורים פעילים כרגע</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead>
                  <tr className="bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 uppercase text-[11px] tracking-wide">
                    <th className="px-4 py-3 font-medium">עובד</th>
                    <th className="px-4 py-3 font-medium">חודש</th>
                    <th className="px-4 py-3 font-medium">נוצר</th>
                    <th className="px-4 py-3 font-medium">תוקף</th>
                    <th className="px-4 py-3 font-medium">פעולות</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {links.map((link) => (
                    <tr key={link.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/40">
                      <td className="px-4 py-3">{link.employee_name || '-'}</td>
                      <td className="px-4 py-3">{formatMonth(link.processing_month)}</td>
                      <td className="px-4 py-3">{formatDateTime(link.created_at)}</td>
                      <td className="px-4 py-3">{formatDateTime(link.expires_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleCopy(link.url)}
                            className="px-3 py-1 text-xs rounded-lg border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors active:scale-[0.98]"
                          >
                            העתק
                          </button>
                          <button
                            onClick={() => handleRevoke(link.id)}
                            className="px-3 py-1 text-xs rounded-lg border border-red-200 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors active:scale-[0.98]"
                          >
                            בטל
                          </button>
                          <button
                            onClick={() => handleSendWhatsapp(link.id)}
                            disabled={sendingWhatsappId === link.id}
                            className="px-3 py-1 text-xs rounded-lg border border-green-200 text-green-700 hover:bg-green-50 dark:hover:bg-green-900/30 dark:border-green-800 dark:text-green-400 flex items-center gap-1 transition-colors active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
                            title="שלח בוואטסאפ"
                          >
                            {sendingWhatsappId === link.id ? (
                              <span className="h-3 w-3 rounded-full border-2 border-green-400 border-t-transparent animate-spin" />
                            ) : (
                              <span className="material-symbols-outlined text-[16px]">chat</span>
                            )}
                            <span className="hidden sm:inline">WhatsApp</span>
                          </button>
                        </div>
                        {link.url && (
                          <div className="mt-2 text-xs text-slate-400 break-all">{link.url}</div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
