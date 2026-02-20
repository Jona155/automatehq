import { Navigate, Outlet, useParams } from 'react-router-dom';
import { usePermissions } from '../hooks/usePermissions';

export default function AdminRoute() {
  const { isAdmin } = usePermissions();
  const { businessCode } = useParams();

  if (!isAdmin) {
    return <Navigate to={`/${businessCode}/dashboard`} replace />;
  }

  return <Outlet />;
}
