import { useState, useEffect } from 'react';
import Modal from './Modal';
import { useToast } from '../hooks/useToast';
import { getMissingWorkCardEmployees } from '../api/workCards';
import { getFirstName } from '../utils/nameUtils';
import type { Employee } from '../types';

interface MissingEmployeesModalProps {
  isOpen: boolean;
  onClose: () => void;
  siteId: string;
  siteName: string;
  month: string;
}

function formatWhatsAppNumber(phone: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0')) return '972' + digits.slice(1);
  if (digits.startsWith('972')) return digits;
  return digits;
}

const ACTION_BTN_CLASS =
  'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors';

export default function MissingEmployeesModal({ isOpen, onClose, siteId, siteName, month }: MissingEmployeesModalProps) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showToast, ToastContainer } = useToast();

  useEffect(() => {
    if (!isOpen || !siteId) return;
    let cancelled = false;
    setEmployees([]);
    setIsLoading(true);
    setError(null);

    getMissingWorkCardEmployees({ month, site_id: siteId })
      .then((data) => {
        if (!cancelled) setEmployees(data);
      })
      .catch(() => {
        if (!cancelled) setError('שגיאה בטעינת הנתונים');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [isOpen, siteId, month]);

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`${label} הועתק ללוח`, 'success');
    } catch {
      showToast('לא הצלחנו להעתיק', 'error');
    }
  };

  const copyNames = () => {
    copyToClipboard(employees.map((e) => getFirstName(e.full_name)).join('\n'), 'שמות');
  };

  const copyPhones = () => {
    const phones = employees.filter((e) => e.phone_number).map((e) => e.phone_number);
    copyToClipboard(phones.join('\n'), 'טלפונים');
  };

  const copyAsTable = () => {
    const header = 'שם\tדרכון\tטלפון';
    const rows = employees.map((e) => `${e.full_name}\t${e.passport_id ?? ''}\t${e.phone_number ?? ''}`);
    copyToClipboard([header, ...rows].join('\n'), 'טבלה');
  };

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title={`עובדים חסרי כרטיס עבודה — ${siteName}`} maxWidth="lg">
        {isLoading ? (
          <div className="p-8 text-center text-slate-500">טוען נתונים...</div>
        ) : error ? (
          <div className="p-8 text-center text-red-500">{error}</div>
        ) : employees.length === 0 ? (
          <div className="p-8 text-center text-slate-500">לא נמצאו עובדים חסרים</div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                {employees.length} עובדים
              </span>
              <div className="flex-1" />
              <button className={ACTION_BTN_CLASS} onClick={copyNames}>
                <span className="material-symbols-outlined text-base">content_copy</span>
                העתק שמות
              </button>
              <button className={ACTION_BTN_CLASS} onClick={copyPhones}>
                <span className="material-symbols-outlined text-base">phone</span>
                העתק טלפונים
              </button>
              <button className={ACTION_BTN_CLASS} onClick={copyAsTable}>
                <span className="material-symbols-outlined text-base">table_chart</span>
                העתק כטבלה
              </button>
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                    <th className="px-4 py-3 text-sm font-bold text-[#111518] dark:text-slate-200">שם פרטי</th>
                    <th className="px-4 py-3 text-sm font-bold text-[#111518] dark:text-slate-200">מספר דרכון / ת.ז.</th>
                    <th className="px-4 py-3 text-sm font-bold text-[#111518] dark:text-slate-200">טלפון</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                  {employees.map((emp) => {
                    const waNumber = emp.phone_number ? formatWhatsAppNumber(emp.phone_number) : null;
                    return (
                      <tr key={emp.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                        <td className="px-4 py-3 text-[#111518] dark:text-white font-medium">{getFirstName(emp.full_name)}</td>
                        <td className="px-4 py-3 text-[#111518] dark:text-white">{emp.passport_id ?? '—'}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="text-[#617989] dark:text-slate-400">{emp.phone_number ?? '—'}</span>
                            {waNumber && (
                              <a
                                href={`https://wa.me/${waNumber}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300 transition-colors"
                                title="שלח הודעה בוואטסאפ"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                                </svg>
                              </a>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Modal>
      <ToastContainer />
    </>
  );
}
