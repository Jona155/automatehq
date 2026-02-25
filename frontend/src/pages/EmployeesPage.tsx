import { useState, useEffect, useMemo } from 'react';
import type { Employee, Site } from '../types';
import { getEmployees, createEmployee, updateEmployee, deleteEmployee } from '../api/employees';
import type { CreateEmployeePayload, UpdateEmployeePayload } from '../api/employees';
import { getSites } from '../api/sites';
import { useAuth } from '../context/AuthContext';
import { usePermissions } from '../hooks/usePermissions';

type SortField = 'full_name' | 'passport_id' | 'phone_number' | 'site_name';
type SortOrder = 'asc' | 'desc';

export default function EmployeesPage() {
  const { isAuthenticated } = useAuth();
  const { isAdmin } = usePermissions();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [employeeToDelete, setEmployeeToDelete] = useState<Employee | null>(null);

  // Filter states
  const [filterName, setFilterName] = useState('');
  const [filterPassport, setFilterPassport] = useState('');
  const [filterPhone, setFilterPhone] = useState('');
  const [filterSiteId, setFilterSiteId] = useState('');

  // Sort state
  const [sortField, setSortField] = useState<SortField>('full_name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(10);

  // Form State
  const [formData, setFormData] = useState({
    full_name: '',
    passport_id: '',
    phone_number: '',
    site_id: '',
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchEmployees = async () => {
    setIsLoading(true);
    try {
      const data = await getEmployees({ active: true });
      setEmployees(data);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch employees:', err);
      setError('שגיאה בטעינת עובדים');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchSites = async () => {
    try {
      const data = await getSites({ active: true });
      setSites(data);
    } catch (err) {
      console.error('Failed to fetch sites:', err);
    }
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    
    fetchEmployees();
    fetchSites();
  }, [isAuthenticated]);

  // Get site name helper
  const getSiteName = (siteId: string) => {
    const site = sites.find((s) => s.id === siteId);
    return site?.site_name || 'לא ידוע';
  };

  const isResponsibleEmployee = (employee: Employee) => {
    const site = sites.find((s) => s.id === employee.site_id);
    return site?.responsible_employee_id === employee.id;
  };

  // Filtering logic
  const filteredEmployees = useMemo(() => {
    return employees.filter((emp) => {
      const name = emp.full_name ?? '';
      const passportId = emp.passport_id ?? '';
      const phoneNumber = emp.phone_number ?? '';

      const matchesName = !filterName || name.toLowerCase().includes(filterName.toLowerCase());
      const matchesPassport = !filterPassport || passportId.toLowerCase().includes(filterPassport.toLowerCase());
      const matchesPhone = !filterPhone || phoneNumber.includes(filterPhone);
      const matchesSite = !filterSiteId || emp.site_id === filterSiteId;
      
      return matchesName && matchesPassport && matchesPhone && matchesSite;
    });
  }, [employees, filterName, filterPassport, filterPhone, filterSiteId]);

  // Sorting logic
  const sortedEmployees = useMemo(() => {
    const sorted = [...filteredEmployees];
    sorted.sort((a, b) => {
      let aVal: string;
      let bVal: string;

      if (sortField === 'site_name') {
        aVal = getSiteName(a.site_id);
        bVal = getSiteName(b.site_id);
      } else {
        aVal = a[sortField] ?? '';
        bVal = b[sortField] ?? '';
      }

      const comparison = aVal.localeCompare(bVal, 'he');
      return sortOrder === 'asc' ? comparison : -comparison;
    });
    return sorted;
  }, [filteredEmployees, sortField, sortOrder, sites]);

  const totalEmployees = sortedEmployees.length;
  const totalPages = Math.max(1, Math.ceil(totalEmployees / pageSize));

  const paginatedEmployees = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return sortedEmployees.slice(startIndex, startIndex + pageSize);
  }, [sortedEmployees, currentPage, pageSize]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filterName, filterPassport, filterPhone, filterSiteId, sortField, sortOrder, pageSize]);

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
    setFilterPassport('');
    setFilterPhone('');
    setFilterSiteId('');
  };

  const handleOpenCreate = () => {
    setEditingEmployee(null);
    setFormData({ full_name: '', passport_id: '', phone_number: '', site_id: '' });
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (employee: Employee) => {
    setEditingEmployee(employee);
    setFormData({
      full_name: employee.full_name,
      passport_id: employee.passport_id,
      phone_number: employee.phone_number,
      site_id: employee.site_id,
    });
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleOpenDelete = (employee: Employee) => {
    setEmployeeToDelete(employee);
    setIsDeleteModalOpen(true);
  };

  const validateForm = () => {
    if (!formData.full_name.trim()) return 'שם מלא הוא שדה חובה';
    if (!formData.passport_id.trim()) return 'תעודת זהות היא שדה חובה';
    if (!formData.phone_number.trim()) return 'מספר טלפון הוא שדה חובה';
    if (!formData.site_id) return 'אתר הוא שדה חובה';
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errorMsg = validateForm();
    if (errorMsg) {
      setFormError(errorMsg);
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    try {
      if (editingEmployee) {
        const payload: UpdateEmployeePayload = {
          full_name: formData.full_name,
          passport_id: formData.passport_id,
          phone_number: formData.phone_number,
          site_id: formData.site_id,
        };
        await updateEmployee(editingEmployee.id, payload);
      } else {
        const payload: CreateEmployeePayload = {
          full_name: formData.full_name,
          passport_id: formData.passport_id,
          phone_number: formData.phone_number,
          site_id: formData.site_id,
        };
        await createEmployee(payload);
      }
      setIsModalOpen(false);
      fetchEmployees();
    } catch (err: any) {
      console.error('Failed to save employee:', err);
      setFormError(err.response?.data?.message || 'שגיאה בשמירת העובד');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!employeeToDelete) return;

    try {
      await deleteEmployee(employeeToDelete.id);
      setIsDeleteModalOpen(false);
      fetchEmployees();
    } catch (err: any) {
      console.error('Failed to delete employee:', err);
      alert(err.response?.data?.message || 'שגיאה במחיקת העובד');
    }
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
          <h2 className="text-[#111518] dark:text-white text-3xl font-bold">ניהול עובדים</h2>
          <p className="text-[#617989] dark:text-slate-400 mt-1">נהל את העובדים שלך באתרי העבודה השונים</p>
        </div>
        {isAdmin && <button
          onClick={handleOpenCreate}
          className="bg-primary hover:bg-primary/90 text-white font-bold py-3 px-6 rounded-lg shadow-lg shadow-primary/30 transition-all flex items-center justify-center gap-2"
        >
          <span className="material-symbols-outlined">add</span>
          <span>צור עובד</span>
        </button>}
      </div>

      {/* Filter Bar */}
      <div className="bg-white dark:bg-[#1a2a35] rounded-xl shadow-xl border border-slate-200/50 dark:border-slate-700/50 p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              סינון לפי שם
            </label>
            <input
              type="text"
              value={filterName}
              onChange={(e) => setFilterName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all text-sm"
              placeholder="חפש לפי שם..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              סינון לפי תעודת זהות
            </label>
            <input
              type="text"
              value={filterPassport}
              onChange={(e) => setFilterPassport(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all text-sm"
              placeholder="חפש לפי ת.ז..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              סינון לפי טלפון
            </label>
            <input
              type="text"
              value={filterPhone}
              onChange={(e) => setFilterPhone(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all text-sm"
              placeholder="חפש לפי טלפון..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              סינון לפי אתר
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <select
                value={filterSiteId}
                onChange={(e) => setFilterSiteId(e.target.value)}
                className="flex-1 min-w-0 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all text-sm"
              >
                <option value="">כל האתרים</option>
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.site_name}
                  </option>
                ))}
              </select>
              {(filterName || filterPassport || filterPhone || filterSiteId) && (
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
      </div>

      <div className="bg-white dark:bg-[#1a2a35] rounded-xl shadow-xl border border-slate-200/50 dark:border-slate-700/50 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-slate-500">טוען עובדים...</div>
        ) : error ? (
          <div className="p-8 text-center text-red-500">{error}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                  <th
                    className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors"
                    onClick={() => handleSort('full_name')}
                  >
                    <div className="flex items-center gap-1">
                      <span>שם מלא</span>
                      <SortIcon field="full_name" />
                    </div>
                  </th>
                  <th
                    className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors"
                    onClick={() => handleSort('passport_id')}
                  >
                    <div className="flex items-center gap-1">
                      <span>תעודת זהות</span>
                      <SortIcon field="passport_id" />
                    </div>
                  </th>
                  <th
                    className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors"
                    onClick={() => handleSort('phone_number')}
                  >
                    <div className="flex items-center gap-1">
                      <span>טלפון</span>
                      <SortIcon field="phone_number" />
                    </div>
                  </th>
                  <th
                    className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors"
                    onClick={() => handleSort('site_name')}
                  >
                    <div className="flex items-center gap-1">
                      <span>אתר נוכחי</span>
                      <SortIcon field="site_name" />
                    </div>
                  </th>
                  {isAdmin && <th className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200 text-left">
                    פעולות
                  </th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                {paginatedEmployees.map((employee) => (
                  <tr key={employee.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-2">
                        <span className="text-[#111518] dark:text-white font-medium">{employee.full_name}</span>
                        {isResponsibleEmployee(employee) && (
                          <span className="inline-flex items-center rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-xs font-semibold">
                            אחראי
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <span className="text-[#111518] dark:text-white font-medium">{employee.passport_id}</span>
                    </td>
                    <td className="px-6 py-5">
                      <span className="text-[#617989] dark:text-slate-400">{employee.phone_number}</span>
                    </td>
                    <td className="px-6 py-5">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary">
                        {getSiteName(employee.site_id)}
                      </span>
                    </td>
                    {isAdmin && <td className="px-6 py-5 text-left">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => handleOpenEdit(employee)}
                          className="p-2 text-[#617989] hover:text-primary hover:bg-primary/5 rounded-lg transition-all"
                          title="ערוך"
                        >
                          <span className="material-symbols-outlined">edit</span>
                        </button>
                        <button
                          onClick={() => handleOpenDelete(employee)}
                          className="p-2 text-[#617989] hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                          title="מחק"
                        >
                          <span className="material-symbols-outlined">delete</span>
                        </button>
                      </div>
                    </td>}
                  </tr>
                ))}
                {sortedEmployees.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-slate-500">
                      {filterName || filterPassport || filterPhone || filterSiteId
                        ? 'לא נמצאו עובדים התואמים את הסינון'
                        : 'לא נמצאו עובדים'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {sortedEmployees.length > 0 && (
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

      {/* Create/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-slate-100 dark:border-slate-700">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                {editingEmployee ? 'עריכת עובד' : 'יצירת עובד חדש'}
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
                  שם מלא
                </label>
                <input
                  type="text"
                  value={formData.full_name}
                  onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all"
                  placeholder="ישראל ישראלי"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  תעודת זהות
                </label>
                <input
                  type="text"
                  value={formData.passport_id}
                  onChange={(e) => setFormData({ ...formData, passport_id: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all"
                  placeholder="123456789"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  מספר טלפון
                </label>
                <input
                  type="text"
                  value={formData.phone_number}
                  onChange={(e) => setFormData({ ...formData, phone_number: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all"
                  placeholder="050-1234567"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  אתר עבודה
                </label>
                <select
                  value={formData.site_id}
                  onChange={(e) => setFormData({ ...formData, site_id: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all"
                >
                  <option value="">בחר אתר</option>
                  {sites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.site_name}
                    </option>
                  ))}
                </select>
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
                  {isSubmitting ? 'שומר...' : editingEmployee ? 'עדכן' : 'צור'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {isDeleteModalOpen && employeeToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="p-6">
              <div className="w-12 h-12 rounded-full bg-red-100 text-red-500 flex items-center justify-center mb-4 mx-auto">
                <span className="material-symbols-outlined text-2xl">warning</span>
              </div>
              <h3 className="text-xl font-bold text-center text-slate-900 dark:text-white mb-2">
                מחיקת עובד
              </h3>
              <p className="text-center text-slate-600 dark:text-slate-400 mb-6">
                האם אתה בטוח שברצונך למחוק את העובד <strong>{employeeToDelete.full_name}</strong>? פעולה זו תסמן את העובד כלא פעיל.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setIsDeleteModalOpen(false)}
                  className="flex-1 px-4 py-2 text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700 rounded-lg transition-colors font-medium"
                >
                  ביטול
                </button>
                <button
                  onClick={handleDelete}
                  className="flex-1 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors font-bold shadow-lg shadow-red-500/30"
                >
                  מחק
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
