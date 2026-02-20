import { useState, useEffect } from 'react';
import type { Business, User } from '../types';
import {
  getBusinesses,
  createBusiness,
  updateBusiness,
  activateBusiness,
  deactivateBusiness,
  getBusinessUsers,
  createBusinessUser,
} from '../api/businesses';
import type { CreateBusinessPayload, UpdateBusinessPayload, CreateBusinessUserPayload } from '../api/businesses';

export default function StarterBusinessesPage() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingBusiness, setEditingBusiness] = useState<Business | null>(null);
  const [isDeactivateModalOpen, setIsDeactivateModalOpen] = useState(false);
  const [businessToDeactivate, setBusinessToDeactivate] = useState<Business | null>(null);

  // Business form state
  const [formData, setFormData] = useState({ name: '', code: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // User creation modal state
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [userModalBusiness, setUserModalBusiness] = useState<Business | null>(null);
  const [userFormData, setUserFormData] = useState({ full_name: '', email: '', password: '', role: 'ADMIN' as 'ADMIN' | 'OPERATOR_MANAGER' });
  const [userFormError, setUserFormError] = useState<string | null>(null);
  const [isUserSubmitting, setIsUserSubmitting] = useState(false);

  // Users list drawer state
  const [isUsersDrawerOpen, setIsUsersDrawerOpen] = useState(false);
  const [drawerBusiness, setDrawerBusiness] = useState<Business | null>(null);
  const [businessUsers, setBusinessUsers] = useState<User[]>([]);
  const [isUsersLoading, setIsUsersLoading] = useState(false);

  const fetchBusinesses = async () => {
    setIsLoading(true);
    try {
      const data = await getBusinesses();
      setBusinesses(data);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch businesses:', err);
      setError('שגיאה בטעינת עסקים');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchBusinesses();
  }, []);

  const handleOpenCreate = () => {
    setEditingBusiness(null);
    setFormData({ name: '', code: '' });
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (business: Business) => {
    setEditingBusiness(business);
    setFormData({ name: business.name, code: business.code });
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleOpenDeactivate = (business: Business) => {
    setBusinessToDeactivate(business);
    setIsDeactivateModalOpen(true);
  };

  const validateForm = () => {
    if (!formData.name.trim()) return 'שם העסק הוא שדה חובה';
    if (!formData.code.trim()) return 'קוד העסק הוא שדה חובה';
    if (!/^[a-z0-9-]+$/.test(formData.code)) return 'קוד העסק חייב להכיל רק אותיות קטנות באנגלית, מספרים ומקפים';
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
      if (editingBusiness) {
        const payload: UpdateBusinessPayload = {
          name: formData.name,
          code: formData.code,
        };
        await updateBusiness(editingBusiness.id, payload);
      } else {
        const payload: CreateBusinessPayload = {
          name: formData.name,
          code: formData.code,
        };
        await createBusiness(payload);
      }
      setIsModalOpen(false);
      fetchBusinesses();
    } catch (err: any) {
      console.error('Failed to save business:', err);
      setFormError(err.response?.data?.message || 'שגיאה בשמירת העסק');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleActive = async (business: Business) => {
    if (business.is_active) {
      handleOpenDeactivate(business);
    } else {
      try {
        await activateBusiness(business.id);
        fetchBusinesses();
      } catch (err: any) {
        console.error('Failed to activate business:', err);
        alert(err.response?.data?.message || 'שגיאה בהפעלת העסק');
      }
    }
  };

  const handleDeactivate = async () => {
    if (!businessToDeactivate) return;
    try {
      await deactivateBusiness(businessToDeactivate.id);
      setIsDeactivateModalOpen(false);
      fetchBusinesses();
    } catch (err: any) {
      console.error('Failed to deactivate business:', err);
      alert(err.response?.data?.message || 'שגיאה בהשבתת העסק');
    }
  };

  // --- Users drawer ---
  const handleOpenUsersDrawer = async (business: Business) => {
    setDrawerBusiness(business);
    setIsUsersDrawerOpen(true);
    setIsUsersLoading(true);
    try {
      const users = await getBusinessUsers(business.id);
      setBusinessUsers(users);
    } catch (err) {
      console.error('Failed to fetch users:', err);
      setBusinessUsers([]);
    } finally {
      setIsUsersLoading(false);
    }
  };

  const refreshDrawerUsers = async () => {
    if (!drawerBusiness) return;
    setIsUsersLoading(true);
    try {
      const users = await getBusinessUsers(drawerBusiness.id);
      setBusinessUsers(users);
    } catch (err) {
      console.error('Failed to fetch users:', err);
    } finally {
      setIsUsersLoading(false);
    }
  };

  // --- User creation ---
  const handleOpenCreateUser = (business: Business) => {
    setUserModalBusiness(business);
    setUserFormData({ full_name: '', email: '', password: '', role: 'ADMIN' });
    setUserFormError(null);
    setIsUserModalOpen(true);
  };

  const validateUserForm = () => {
    if (!userFormData.full_name.trim()) return 'שם מלא הוא שדה חובה';
    if (!userFormData.email.trim()) return 'אימייל הוא שדה חובה';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userFormData.email)) return 'כתובת אימייל לא תקינה';
    if (!userFormData.password.trim()) return 'סיסמה היא שדה חובה';
    if (userFormData.password.length < 4) return 'סיסמה חייבת להכיל לפחות 4 תווים';
    return null;
  };

  const handleUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errorMsg = validateUserForm();
    if (errorMsg) {
      setUserFormError(errorMsg);
      return;
    }
    if (!userModalBusiness) return;

    setIsUserSubmitting(true);
    setUserFormError(null);

    try {
      const payload: CreateBusinessUserPayload = {
        full_name: userFormData.full_name,
        email: userFormData.email,
        password: userFormData.password,
        role: userFormData.role,
      };
      await createBusinessUser(userModalBusiness.id, payload);
      setIsUserModalOpen(false);
      // If the drawer is open for the same business, refresh
      if (isUsersDrawerOpen && drawerBusiness?.id === userModalBusiness.id) {
        refreshDrawerUsers();
      }
    } catch (err: any) {
      console.error('Failed to create user:', err);
      setUserFormError(err.response?.data?.message || 'שגיאה ביצירת המשתמש');
    } finally {
      setIsUserSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-2">
        <div>
          <h2 className="text-[#111518] dark:text-white text-3xl font-bold">ניהול עסקים</h2>
          <p className="text-[#617989] dark:text-slate-400 mt-1">נהל את העסקים הרשומים במערכת</p>
        </div>
        <button
          onClick={handleOpenCreate}
          className="bg-primary hover:bg-primary/90 text-white font-bold py-3 px-6 rounded-lg shadow-lg shadow-primary/30 transition-all flex items-center justify-center gap-2"
        >
          <span className="material-symbols-outlined">add</span>
          <span>צור עסק</span>
        </button>
      </div>

      <div className="bg-white dark:bg-[#1a2a35] rounded-xl shadow-xl border border-slate-200/50 dark:border-slate-700/50 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-slate-500">טוען עסקים...</div>
        ) : error ? (
          <div className="p-8 text-center text-red-500">{error}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                  <th className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200">שם העסק</th>
                  <th className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200">קוד</th>
                  <th className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200">סטטוס</th>
                  <th className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200 text-left">פעולות</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                {businesses.map((business) => (
                  <tr key={business.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-6 py-5">
                      <span className="text-[#111518] dark:text-white font-medium">{business.name}</span>
                    </td>
                    <td className="px-6 py-5">
                      <span className="text-[#111518] dark:text-white font-mono text-sm">{business.code}</span>
                    </td>
                    <td className="px-6 py-5">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          business.is_active
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                        }`}
                      >
                        {business.is_active ? 'פעיל' : 'מושבת'}
                      </span>
                    </td>
                    <td className="px-6 py-5 text-left">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleOpenUsersDrawer(business)}
                          className="p-2 text-[#617989] hover:text-primary hover:bg-primary/5 rounded-lg transition-all"
                          title="צפה במשתמשים"
                        >
                          <span className="material-symbols-outlined">group</span>
                        </button>
                        <button
                          onClick={() => handleOpenCreateUser(business)}
                          className="p-2 text-[#617989] hover:text-primary hover:bg-primary/5 rounded-lg transition-all"
                          title="צור משתמש"
                        >
                          <span className="material-symbols-outlined">person_add</span>
                        </button>
                        <button
                          onClick={() => handleOpenEdit(business)}
                          className="p-2 text-[#617989] hover:text-primary hover:bg-primary/5 rounded-lg transition-all"
                          title="ערוך"
                        >
                          <span className="material-symbols-outlined">edit</span>
                        </button>
                        <button
                          onClick={() => handleToggleActive(business)}
                          className={`p-2 rounded-lg transition-all ${
                            business.is_active
                              ? 'text-[#617989] hover:text-red-500 hover:bg-red-50'
                              : 'text-[#617989] hover:text-green-500 hover:bg-green-50'
                          }`}
                          title={business.is_active ? 'השבת' : 'הפעל'}
                        >
                          <span className="material-symbols-outlined">
                            {business.is_active ? 'toggle_on' : 'toggle_off'}
                          </span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {businesses.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-slate-500">
                      לא נמצאו עסקים
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create/Edit Business Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-slate-100 dark:border-slate-700">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                {editingBusiness ? 'עריכת עסק' : 'יצירת עסק חדש'}
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
                  שם העסק
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all"
                  placeholder="שם העסק"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  קוד (slug)
                </label>
                <input
                  type="text"
                  dir="ltr"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all text-left"
                  placeholder="my-business"
                />
                <p className="text-xs text-slate-500 mt-1">אותיות קטנות באנגלית, מספרים ומקפים בלבד</p>
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
                  {isSubmitting ? 'שומר...' : editingBusiness ? 'עדכן' : 'צור'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Deactivate Confirmation Modal */}
      {isDeactivateModalOpen && businessToDeactivate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="p-6">
              <div className="w-12 h-12 rounded-full bg-red-100 text-red-500 flex items-center justify-center mb-4 mx-auto">
                <span className="material-symbols-outlined text-2xl">warning</span>
              </div>
              <h3 className="text-xl font-bold text-center text-slate-900 dark:text-white mb-2">
                השבתת עסק
              </h3>
              <p className="text-center text-slate-600 dark:text-slate-400 mb-6">
                האם אתה בטוח שברצונך להשבית את העסק <strong>{businessToDeactivate.name}</strong>? משתמשי העסק לא יוכלו להתחבר למערכת.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setIsDeactivateModalOpen(false)}
                  className="flex-1 px-4 py-2 text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700 rounded-lg transition-colors font-medium"
                >
                  ביטול
                </button>
                <button
                  onClick={handleDeactivate}
                  className="flex-1 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors font-bold shadow-lg shadow-red-500/30"
                >
                  השבת
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create User Modal */}
      {isUserModalOpen && userModalBusiness && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-slate-100 dark:border-slate-700">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                יצירת משתמש עבור {userModalBusiness.name}
              </h3>
            </div>
            <form onSubmit={handleUserSubmit} className="p-6 space-y-4">
              {userFormError && (
                <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100">
                  {userFormError}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  שם מלא
                </label>
                <input
                  type="text"
                  value={userFormData.full_name}
                  onChange={(e) => setUserFormData({ ...userFormData, full_name: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all"
                  placeholder="ישראל ישראלי"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  אימייל
                </label>
                <input
                  type="email"
                  value={userFormData.email}
                  onChange={(e) => setUserFormData({ ...userFormData, email: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all"
                  placeholder="email@example.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  סיסמה
                </label>
                <input
                  type="password"
                  value={userFormData.password}
                  onChange={(e) => setUserFormData({ ...userFormData, password: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all"
                  placeholder="******"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  תפקיד
                </label>
                <select
                  value={userFormData.role}
                  onChange={(e) => setUserFormData({ ...userFormData, role: e.target.value as 'ADMIN' | 'OPERATOR_MANAGER' })}
                  className="w-full px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all"
                >
                  <option value="ADMIN">מנהל</option>
                  <option value="OPERATOR_MANAGER">מנהל תפעול</option>
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setIsUserModalOpen(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700 rounded-lg transition-colors font-medium"
                >
                  ביטול
                </button>
                <button
                  type="submit"
                  disabled={isUserSubmitting}
                  className="px-6 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg transition-colors font-bold shadow-lg shadow-primary/30 disabled:opacity-50"
                >
                  {isUserSubmitting ? 'יוצר...' : 'צור משתמש'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Users Drawer */}
      {isUsersDrawerOpen && drawerBusiness && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setIsUsersDrawerOpen(false)} />
          <div className="relative w-full max-w-md bg-white dark:bg-slate-800 shadow-2xl flex flex-col">
            <div className="p-6 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                  משתמשי {drawerBusiness.name}
                </h3>
                <p className="text-sm text-slate-500 mt-0.5">{businessUsers.length} משתמשים</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleOpenCreateUser(drawerBusiness)}
                  className="p-2 text-primary hover:bg-primary/5 rounded-lg transition-all"
                  title="צור משתמש"
                >
                  <span className="material-symbols-outlined">person_add</span>
                </button>
                <button
                  onClick={() => setIsUsersDrawerOpen(false)}
                  className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-all"
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {isUsersLoading ? (
                <div className="p-8 text-center text-slate-500">טוען משתמשים...</div>
              ) : businessUsers.length === 0 ? (
                <div className="p-8 text-center">
                  <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-400 flex items-center justify-center mx-auto mb-4">
                    <span className="material-symbols-outlined text-3xl">group_off</span>
                  </div>
                  <p className="text-slate-500 dark:text-slate-400 mb-4">אין משתמשים לעסק זה</p>
                  <button
                    onClick={() => handleOpenCreateUser(drawerBusiness)}
                    className="px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg transition-colors font-bold text-sm"
                  >
                    צור משתמש ראשון
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {businessUsers.map((user) => (
                    <div
                      key={user.id}
                      className="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-100 dark:border-slate-700"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-slate-900 dark:text-white">{user.full_name}</span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                          user.is_active
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                        }`}>
                          {user.is_active ? 'פעיל' : 'מושבת'}
                        </span>
                      </div>
                      <div className="mt-1 text-sm text-slate-500">{user.email}</div>
                      <div className="mt-1">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary">
                          {user.role === 'ADMIN' ? 'מנהל' : user.role === 'OPERATOR_MANAGER' ? 'מנהל תפעול' : user.role}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
