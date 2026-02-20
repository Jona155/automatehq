import { useAuth } from '../context/AuthContext';

export function usePermissions() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  return {
    isAdmin,
    canUpload: true,
    canEditHours: isAdmin,
    canApprove: isAdmin,
    canDelete: isAdmin,
    canExport: isAdmin,
    canManageSites: isAdmin,
    canManageEmployees: isAdmin,
    canManageUsers: isAdmin,
    canImportEmployees: isAdmin,
    canManageAccessLinks: isAdmin,
    canTriggerExtraction: isAdmin,
  };
}
