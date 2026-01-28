import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Site } from '../types';
import { getSites, createSite } from '../api/sites';
import { useAuth } from '../context/AuthContext';

export default function SitesPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({ site_name: '', site_code: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();

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
    fetchSites();
  }, []);

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
      setFormError(err.response?.data?.message || 'שגיאה ביצירת האתר');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRowClick = (siteId: string) => {
    navigate(`/${user?.business?.code}/sites/${siteId}`);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-2">
        <div>
          <h2 className="text-[#111518] dark:text-white text-3xl font-bold">ניהול אתרים</h2>
          <p className="text-[#617989] dark:text-slate-400 mt-1">צפה בכל אתרי העבודה והעובדים המשויכים אליהם</p>
        </div>
        <button
          onClick={handleOpenCreate}
          className="bg-primary hover:bg-primary/90 text-white font-bold py-3 px-6 rounded-lg shadow-lg shadow-primary/30 transition-all flex items-center justify-center gap-2"
        >
          <span className="material-symbols-outlined">add</span>
          <span>צור אתר</span>
        </button>
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
                  <th className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200">שם אתר</th>
                  <th className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200">קוד אתר</th>
                  <th className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200">מספר עובדים</th>
                  <th className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200">סטטוס</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                {sites.map((site) => (
                  <tr
                    key={site.id}
                    onClick={() => handleRowClick(site.id)}
                    className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 cursor-pointer transition-colors"
                  >
                    <td className="px-6 py-5">
                      <span className="text-[#111518] dark:text-white font-medium">{site.site_name}</span>
                    </td>
                    <td className="px-6 py-5">
                      <span className="text-[#617989] dark:text-slate-400">
                        {site.site_code || 'לא הוגדר'}
                      </span>
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
                {sites.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-slate-500">
                      לא נמצאו אתרים
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Site Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-slate-100 dark:border-slate-700">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                יצירת אתר חדש
              </h3>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {formError && (
                <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100">
                  {formError}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  שם אתר
                </label>
                <input
                  type="text"
                  value={formData.site_name}
                  onChange={(e) => setFormData({ ...formData, site_name: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all"
                  placeholder="שם האתר"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  קוד אתר (אופציונלי)
                </label>
                <input
                  type="text"
                  value={formData.site_code}
                  onChange={(e) => setFormData({ ...formData, site_code: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all"
                  placeholder="קוד קצר"
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
