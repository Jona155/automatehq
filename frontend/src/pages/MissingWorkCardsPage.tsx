import { useState, useEffect, useMemo } from 'react';
import type { Employee, Site } from '../types';
import { getMissingWorkCardEmployees } from '../api/workCards';
import { getSites } from '../api/sites';
import { useAuth } from '../context/AuthContext';
import MonthPicker from '../components/MonthPicker';

const getCurrentMonth = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

export default function MissingWorkCardsPage() {
  const { isAuthenticated } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentMonth());
  const [filterSiteId, setFilterSiteId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  const fetchMissing = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const monthParam = `${selectedMonth}-01`;
      const data = await getMissingWorkCardEmployees({
        month: monthParam,
        site_id: filterSiteId || undefined,
      });
      setEmployees(data);
    } catch (err) {
      console.error('Failed to fetch missing work card employees:', err);
      setError('שגיאה בטעינת הנתונים');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    getSites({ active: true })
      .then(setSites)
      .catch((err) => console.error('Failed to fetch sites:', err));
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchMissing();
  }, [isAuthenticated, selectedMonth, filterSiteId]);

  const filteredEmployees = useMemo(() => {
    if (!searchQuery.trim()) return employees;
    const q = searchQuery.toLowerCase();
    return employees.filter(
      (emp) =>
        (emp.full_name ?? '').toLowerCase().includes(q) ||
        (emp.passport_id ?? '').toLowerCase().includes(q) ||
        (emp.phone_number ?? '').includes(q),
    );
  }, [employees, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredEmployees.length / pageSize));

  const paginatedEmployees = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredEmployees.slice(start, start + pageSize);
  }, [filteredEmployees, currentPage, pageSize]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, filterSiteId, selectedMonth]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const getSiteName = (siteId: string | null) => {
    if (!siteId) return '—';
    const site = sites.find((s) => s.id === siteId);
    return site?.site_name ?? '—';
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-2">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-[#111518] dark:text-white text-3xl font-bold">כרטיסי עבודה חסרים</h2>
            {!isLoading && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                {filteredEmployees.length} עובדים חסרים
              </span>
            )}
          </div>
          <p className="text-[#617989] dark:text-slate-400 mt-1">
            עובדים פעילים שלא הגישו כרטיס עבודה לחודש הנבחר
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-white dark:bg-[#1a2a35] rounded-xl shadow-xl border border-slate-200/50 dark:border-slate-700/50 p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              חודש
            </label>
            <MonthPicker value={selectedMonth} onChange={setSelectedMonth} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              אתר
            </label>
            <select
              value={filterSiteId}
              onChange={(e) => setFilterSiteId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all text-sm"
            >
              <option value="">כל האתרים</option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.site_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              חיפוש
            </label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all text-sm"
              placeholder="חפש לפי שם, ת.ז. או טלפון..."
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-[#1a2a35] rounded-xl shadow-xl border border-slate-200/50 dark:border-slate-700/50 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-slate-500">טוען נתונים...</div>
        ) : error ? (
          <div className="p-8 text-center text-red-500">{error}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                  <th className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200">
                    שם עובד
                  </th>
                  <th className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200">
                    מספר דרכון / ת.ז.
                  </th>
                  <th className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200">
                    טלפון
                  </th>
                  <th className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200">
                    אתר
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                {paginatedEmployees.map((employee) => (
                  <tr
                    key={employee.id}
                    className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors"
                  >
                    <td className="px-6 py-5">
                      <span className="text-[#111518] dark:text-white font-medium">
                        {employee.full_name}
                      </span>
                    </td>
                    <td className="px-6 py-5">
                      <span className="text-[#111518] dark:text-white font-medium">
                        {employee.passport_id}
                      </span>
                    </td>
                    <td className="px-6 py-5">
                      <span className="text-[#617989] dark:text-slate-400">
                        {employee.phone_number}
                      </span>
                    </td>
                    <td className="px-6 py-5">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary">
                        {getSiteName(employee.site_id)}
                      </span>
                    </td>
                  </tr>
                ))}
                {filteredEmployees.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-slate-500">
                      לא נמצאו עובדים חסרים לחודש זה
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {filteredEmployees.length > 0 && (
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 px-6 py-4 border-t border-slate-100 dark:border-slate-700/50 bg-slate-50/60 dark:bg-slate-900/40">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(1)}
                    disabled={currentPage === 1}
                    className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    ראשון
                  </button>
                  <button
                    onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    הקודם
                  </button>
                  <button
                    onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    הבא
                  </button>
                  <button
                    onClick={() => setCurrentPage(totalPages)}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    אחרון
                  </button>
                </div>
                <div className="text-sm text-slate-600 dark:text-slate-400">
                  עמוד {currentPage} מתוך {totalPages}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
