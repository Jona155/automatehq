import { Navigate, Outlet, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * TenantGuard ensures the URL's businessCode matches the authenticated user's business.
 * If the URL business code doesn't match, redirects to the user's correct tenant.
 * APPLICATION_MANAGER users are allowed in if selectedBusiness matches the URL code.
 */
export default function TenantGuard() {
  const { businessCode } = useParams<{ businessCode: string }>();
  const { business, selectedBusiness, user, isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
  }

  // APPLICATION_MANAGER path
  if (user?.role === 'APPLICATION_MANAGER') {
    if (!selectedBusiness || selectedBusiness.code !== businessCode) {
      return <Navigate to="/starter/businesses" replace />;
    }
    return <Outlet />;
  }

  // If not authenticated, ProtectedRoute should have already redirected
  if (!isAuthenticated || !business) {
    return <Navigate to="/login" replace />;
  }

  // Validate URL business code matches user's business
  if (businessCode !== business.code) {
    // Redirect to user's correct tenant dashboard
    return <Navigate to={`/${business.code}/dashboard`} replace />;
  }

  return <Outlet />;
}
