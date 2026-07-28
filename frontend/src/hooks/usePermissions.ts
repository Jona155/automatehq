import { useAuth } from '../context/AuthContext';

export function usePermissions() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const isOperatorManager = user?.role === 'OPERATOR_MANAGER';
  const isApplicationManager = user?.role === 'APPLICATION_MANAGER';

  const isFieldManager = user?.role === 'FIELD_MANAGER';

  return {
    isAdmin,
    isOperatorManager,
    isFieldManager,
    isApplicationManager,
    canUpload: true,
    canEditHours: isAdmin,
    canApprove: isAdmin,
    canDelete: isAdmin,
    canExport: isAdmin,
    canManageSites: isAdmin,
    canManageEmployees: isAdmin,
    canManageUsers: isAdmin,
    canImportEmployees: isAdmin,
    canManageAccessLinks: isAdmin || isOperatorManager,
    canTriggerExtraction: isAdmin,
  };
}
