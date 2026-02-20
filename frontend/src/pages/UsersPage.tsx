import { useState, useEffect } from 'react';
import type { User } from '../types';
import { getUsers, createUser, updateUser, deleteUser } from '../api/users';
import type { CreateUserPayload, UpdateUserPayload } from '../api/users';
import { useAuth } from '../context/AuthContext';

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const { user: currentUser } = useAuth();

  // Form State
  const [formData, setFormData] = useState({
    full_name: '',
    email: '',
    password: '',
    role: 'ADMIN' as 'ADMIN' | 'OPERATOR_MANAGER',
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchUsers = async () => {
    setIsLoading(true);
    try {
      const data = await getUsers({ active: true });
      setUsers(data);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch users:', err);
      setError('שגיאה בטעינת משתמשים');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleOpenCreate = () => {
    setEditingUser(null);
    setFormData({ full_name: '', email: '', password: '', role: 'ADMIN' });
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (user: User) => {
    setEditingUser(user);
    setFormData({
      full_name: user.full_name,
      email: user.email,
      password: '', // Password not shown
      role: (user.role === 'OPERATOR_MANAGER' ? 'OPERATOR_MANAGER' : 'ADMIN'),
    });
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleOpenDelete = (user: User) => {
    setUserToDelete(user);
    setIsDeleteModalOpen(true);
  };

  const validateForm = () => {
    if (!formData.full_name.trim()) return 'שם מלא הוא שדה חובה';
    if (!formData.email.trim()) return 'אימייל הוא שדה חובה';
    if (!editingUser && !formData.password.trim()) return 'סיסמה היא שדה חובה';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) return 'כתובת אימייל לא תקינה';
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
      if (editingUser) {
        const payload: UpdateUserPayload = {
          full_name: formData.full_name,
          email: formData.email,
          ...(editingUser.id !== currentUser?.id ? { role: formData.role } : {}),
        };
        await updateUser(editingUser.id, payload);
      } else {
        const payload: CreateUserPayload = {
          full_name: formData.full_name,
          email: formData.email,
          password: formData.password,
          role: formData.role,
        };
        await createUser(payload);
      }
      setIsModalOpen(false);
      fetchUsers();
    } catch (err: any) {
      console.error('Failed to save user:', err);
      setFormError(err.response?.data?.message || 'שגיאה בשמירת המשתמש');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!userToDelete) return;

    try {
      await deleteUser(userToDelete.id);
      setIsDeleteModalOpen(false);
      fetchUsers();
    } catch (err: any) {
      console.error('Failed to delete user:', err);
      // Ideally show a toast or alert here
      alert(err.response?.data?.message || 'שגיאה במחיקת המשתמש');
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-2">
        <div>
          <h2 className="text-[#111518] dark:text-white text-3xl font-bold">ניהול משתמשים</h2>
          <p className="text-[#617989] dark:text-slate-400 mt-1">נהל את הגישה וההרשאות של חברי הצוות שלך</p>
        </div>
        <button 
          onClick={handleOpenCreate}
          className="bg-primary hover:bg-primary/90 text-white font-bold py-3 px-6 rounded-lg shadow-lg shadow-primary/30 transition-all flex items-center justify-center gap-2"
        >
          <span className="material-symbols-outlined">add</span>
          <span>צור משתמש</span>
        </button>
      </div>

      <div className="bg-white dark:bg-[#1a2a35] rounded-xl shadow-xl border border-slate-200/50 dark:border-slate-700/50 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-slate-500">טוען משתמשים...</div>
        ) : error ? (
          <div className="p-8 text-center text-red-500">{error}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                   <th className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200">שם מלא</th>
                  <th className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200">אימייל</th>
                  <th className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200">תפקיד</th>
                  <th className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200 text-left">פעולות</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                     <td className="px-6 py-5">
                       <span className="text-[#111518] dark:text-white font-medium">{user.full_name}</span>
                    </td>
                    <td className="px-6 py-5">
                      <div className="flex flex-col">
                        <span className="text-[#111518] dark:text-white font-medium">{user.email}</span>
                        <span className="text-xs text-[#617989]">
                          נוסף ב-{new Date(user.created_at).toLocaleDateString('he-IL')}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary">
                        {user.role === 'ADMIN' ? 'מנהל' : user.role === 'OPERATOR_MANAGER' ? 'מנהל תפעול' : user.role}
                      </span>
                    </td>
                    <td className="px-6 py-5 text-left">
                      <div className="flex items-center justify-end gap-3">
                        <button 
                          onClick={() => handleOpenEdit(user)}
                          className="p-2 text-[#617989] hover:text-primary hover:bg-primary/5 rounded-lg transition-all" 
                          title="ערוך"
                        >
                          <span className="material-symbols-outlined">edit</span>
                        </button>
                        {currentUser?.id !== user.id && (
                          <button 
                            onClick={() => handleOpenDelete(user)}
                            className="p-2 text-[#617989] hover:text-red-500 hover:bg-red-50 rounded-lg transition-all" 
                            title="מחק"
                          >
                            <span className="material-symbols-outlined">delete</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-slate-500">
                      לא נמצאו משתמשים
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-slate-100 dark:border-slate-700">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                {editingUser ? 'עריכת משתמש' : 'יצירת משתמש חדש'}
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
                  אימייל (שם משתמש)
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all"
                  placeholder="email@example.com"
                />
              </div>
              {!editingUser && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    סיסמה
                  </label>
                  <input
                    type="password"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="w-full px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all"
                    placeholder="******"
                  />
                </div>
              )}
              {editingUser && (
                <div className="p-3 bg-blue-50 text-blue-800 text-sm rounded-lg">
                  לא ניתן לשנות סיסמה כרגע.
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  תפקיד
                </label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value as 'ADMIN' | 'OPERATOR_MANAGER' })}
                  disabled={editingUser?.id === currentUser?.id}
                  className="w-full px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all"
                >
                  <option value="ADMIN">מנהל</option>
                  <option value="OPERATOR_MANAGER">מנהל תפעול</option>
                </select>
                {editingUser?.id === currentUser?.id && (
                  <p className="text-xs text-slate-500 mt-1">לא ניתן לשנות את התפקיד של עצמך</p>
                )}
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
                  {isSubmitting ? 'שומר...' : (editingUser ? 'עדכן' : 'צור')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {isDeleteModalOpen && userToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="p-6">
              <div className="w-12 h-12 rounded-full bg-red-100 text-red-500 flex items-center justify-center mb-4 mx-auto">
                <span className="material-symbols-outlined text-2xl">warning</span>
              </div>
              <h3 className="text-xl font-bold text-center text-slate-900 dark:text-white mb-2">
                מחיקת משתמש
              </h3>
              <p className="text-center text-slate-600 dark:text-slate-400 mb-6">
                האם אתה בטוח שברצונך למחוק את המשתמש <strong>{userToDelete.full_name}</strong>? פעולה זו תסיר את הגישה שלו למערכת.
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
