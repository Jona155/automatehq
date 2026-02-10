import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Site } from '../types';
import { getSites, createSite } from '../api/sites';
import { useAuth } from '../context/AuthContext';

type SortField = 'site_name' | 'site_code' | 'employee_count' | 'is_active';
type SortOrder = 'asc' | 'desc';

export default function SitesPage() {
  const { isAuthenticated, user } = useAuth();
  const [sites, setSites] = useState<Site[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({ site_name: '', site_code: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [filterName, setFilterName] = useState('');
  const [filterCode, setFilterCode] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [sortField, setSortField] = useState<SortField>('site_name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(10);
  const navigate = useNavigate();

  const fetchSites = async () => {
    setIsLoading(true);
    try {
      const data = await getSites({ active: false }); // Get all sites including inactive
      setSites(data);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch sites:', err);
      setError('שגיאה בטעינת אתרים');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isAuthenticated) return;

    fetchSites();
  }, [isAuthenticated]);

  const filteredSites = useMemo(() => {
    return sites.filter((site) => {
      const matchesName = !filterName || site.site_name.toLowerCase().includes(filterName.toLowerCase());
      const matchesCode = !filterCode || (site.site_code || '').toLowerCase().includes(filterCode.toLowerCase());
      const matchesStatus =
        !filterStatus || (filterStatus === 'active' ? site.is_active : !site.is_active);
      return matchesName && matchesCode && matchesStatus;
    });
  }, [sites, filterName, filterCode, filterStatus]);

  const sortedSites = useMemo(() => {
    const sorted = [...filteredSites];
    sorted.sort((a, b) => {
      let comparison = 0;
      if (sortField === 'employee_count') {
        const aVal = a.employee_count ?? -1;
        const bVal = b.employee_count ?? -1;
        comparison = aVal - bVal;
      } else if (sortField === 'is_active') {
        const aVal = a.is_active ? 1 : 0;
        const bVal = b.is_active ? 1 : 0;
        comparison = aVal - bVal;
      } else {
        const aVal = sortField === 'site_code' ? a.site_code || '' : a.site_name;
        const bVal = sortField === 'site_code' ? b.site_code || '' : b.site_name;
        comparison = aVal.localeCompare(bVal, 'he');
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });
    return sorted;
  }, [filteredSites, sortField, sortOrder]);

  const totalSites = sortedSites.length;
  const totalPages = Math.max(1, Math.ceil(totalSites / pageSize));

  const paginatedSites = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return sortedSites.slice(startIndex, startIndex + pageSize);
  }, [sortedSites, currentPage, pageSize]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filterName, filterCode, filterStatus, sortField, sortOrder, pageSize]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const clearFilters = () => {
    setFilterName('');
    setFilterCode('');
    setFilterStatus('');
  };

  const handleOpenCreate = () => {
    setFormData({ site_name: '', site_code: '' });
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.site_name.trim()) {
      setFormError('שם אתר הוא שדה חובה');
      return;
    }
    setIsSubmitting(true);
    setFormError(null);
    try {
      await createSite({
        site_name: formData.site_name.trim(),
        site_code: formData.site_code.trim() || undefined,
      });
      setIsModalOpen(false);
      fetchSites();
    } catch (err: any) {
      console.error('Failed to create site:', err);
      setFormError(err.response?.data?.message || 'שגיאה ביצירת אתר');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRowClick = (siteId: string) => {
    navigate(`/${user?.business?.code}/sites/${siteId}`);
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) {
      return <span className="material-symbols-outlined text-sm opacity-30">unfold_more</span>;
    }
    return (
      <span className="material-symbols-outlined text-sm">
        {sortOrder === 'asc' ? 'arrow_upward' : 'arrow_downward'}
      </span>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-2">
        <div>
          <h2 className="text-[#111518] dark:text-white text-3xl font-bold">ניהול אתרים</h2>
          <p className="text-[#617989] dark:text-slate-400 mt-1">נהל את אתרי העבודה שלך בארגון</p>
        </div>
        <button
          onClick={handleOpenCreate}
          className="bg-primary hover:bg-primary/90 text-white font-bold py-3 px-6 rounded-lg shadow-lg shadow-primary/30 transition-all flex items-center justify-center gap-2"
        >
          <span className="material-symbols-outlined">add</span>
          <span>צור אתר</span>
        </button>
      </div>

      <div className="bg-white dark:bg-[#1a2a35] rounded-xl shadow-xl border border-slate-200/50 dark:border-slate-700/50 p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">סינון לפי שם</label>
            <input
              type="text"
              value={filterName}
              onChange={(e) => setFilterName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all text-sm"
              placeholder="חפש לפי שם..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">סינון לפי קוד אתר</label>
            <input
              type="text"
              value={filterCode}
              onChange={(e) => setFilterCode(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all text-sm"
              placeholder="חפש לפי קוד..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">סינון לפי סטטוס</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all text-sm"
            >
              <option value="">כל הסטטוסים</option>
              <option value="active">פעיל</option>
              <option value="inactive">לא פעיל</option>
            </select>
          </div>
          <div className="flex items-end justify-end">
            {(filterName || filterCode || filterStatus) && (
              <button
                onClick={clearFilters}
                className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors font-medium"
              >
                נקה
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-[#1a2a35] rounded-xl shadow-xl border border-slate-200/50 dark:border-slate-700/50 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-slate-500">טוען אתרים...</div>
        ) : error ? (
          <div className="p-8 text-center text-red-500">{error}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                  <th
                    className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors"
                    onClick={() => handleSort('site_name')}
                  >
                    <div className="flex items-center gap-1">
                      <span>שם אתר</span>
                      <SortIcon field="site_name" />
                    </div>
                  </th>
                  <th
                    className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors"
                    onClick={() => handleSort('site_code')}
                  >
                    <div className="flex items-center gap-1">
                      <span>קוד אתר</span>
                      <SortIcon field="site_code" />
                    </div>
                  </th>
                  <th
                    className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors"
                    onClick={() => handleSort('employee_count')}
                  >
                    <div className="flex items-center gap-1">
                      <span>מספר עובדים</span>
                      <SortIcon field="employee_count" />
                    </div>
                  </th>
                  <th
                    className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors"
                    onClick={() => handleSort('is_active')}
                  >
                    <div className="flex items-center gap-1">
                      <span>סטטוס</span>
                      <SortIcon field="is_active" />
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                {paginatedSites.map((site) => (
                  <tr
                    key={site.id}
                    onClick={() => handleRowClick(site.id)}
                    className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 cursor-pointer transition-colors"
                  >
                    <td className="px-6 py-5">
                      <span className="text-[#111518] dark:text-white font-medium">{site.site_name}</span>
                    </td>
                    <td className="px-6 py-5">
                      <span className="text-[#617989] dark:text-slate-400">{site.site_code || 'לא הוגדר'}</span>
                    </td>
                    <td className="px-6 py-5">
                      <span className="text-[#111518] dark:text-white font-medium">
                        {site.employee_count !== undefined ? `${site.employee_count} עובדים` : 'טוען...'}
                      </span>
                    </td>
                    <td className="px-6 py-5">
                      {site.is_active ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                          פעיל
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                          לא פעיל
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {sortedSites.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-slate-500">
                      {filterName || filterCode || filterStatus
                        ? 'לא נמצאו אתרים התואמים את הסינון'
                        : 'לא נמצאו אתרים'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {sortedSites.length > 0 && (
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 px-6 py-4 border-t border-slate-100 dark:border-slate-700/50 bg-slate-50/60 dark:bg-slate-900/40">
                <div className="text-sm text-slate-600 dark:text-slate-400">
                  Page {currentPage} of {totalPages}
                </div>
                <div className="flex items-center gap-2 justify-end">
                  <button
                    onClick={() => setCurrentPage(1)}
                    disabled={currentPage === 1}
                    className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    First
                  </button>
                  <button
                    onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    Prev
                  </button>
                  <button
                    onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    Next
                  </button>
                  <button
                    onClick={() => setCurrentPage(totalPages)}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    Last
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Create Site Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-slate-100 dark:border-slate-700">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">יצירת אתר חדש</h3>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {formError && (
                <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100">
                  {formError}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">שם אתר</label>
                <input
                  type="text"
                  value={formData.site_name}
                  onChange={(e) => setFormData({ ...formData, site_name: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all"
                  placeholder="אתר מרכז"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">קוד אתר (אופציונלי)</label>
                <input
                  type="text"
                  value={formData.site_code}
                  onChange={(e) => setFormData({ ...formData, site_code: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all"
                  placeholder="SITE-01"
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700 rounded-lg transition-colors font-medium"
                >
                  ביטול
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-6 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg transition-colors font-bold shadow-lg shadow-primary/30 disabled:opacity-50"
                >
                  {isSubmitting ? 'שומר...' : 'צור'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
