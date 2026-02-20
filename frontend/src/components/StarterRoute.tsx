import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function StarterRoute() {
  const { user } = useAuth();

  if (user?.role !== 'APPLICATION_MANAGER') {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
