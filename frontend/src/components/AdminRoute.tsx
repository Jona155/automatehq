import { Navigate, Outlet, useParams } from 'react-router-dom';
import { usePermissions } from '../hooks/usePermissions';

export default function AdminRoute() {
  const { isAdmin, isApplicationManager } = usePermissions();
  const { businessCode } = useParams();

  if (!isAdmin && !isApplicationManager) {
    return <Navigate to={`/${businessCode}/dashboard`} replace />;
  }

  return <Outlet />;
}
