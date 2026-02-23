import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import EmployeesPage from './pages/EmployeesPage';
import SitesPage from './pages/SitesPage';
import SiteDetailsPage from './pages/SiteDetailsPage';
import SiteReviewPage from './pages/SiteReviewPage';
import UsersPage from './pages/UsersPage';
import EmployeeImportPage from './pages/EmployeeImportPage';
import PublicPortalPage from './pages/PublicPortalPage';
import AdminPortalPage from './pages/AdminPortalPage';
import ProtectedRoute from './components/ProtectedRoute';
import TenantGuard from './components/TenantGuard';
import Layout from './components/Layout';
import AdminRoute from './components/AdminRoute';
import StarterRoute from './components/StarterRoute';
import StarterLayout from './components/StarterLayout';
import StarterBusinessesPage from './pages/StarterBusinessesPage';

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/portal/:token" element={<PublicPortalPage />} />
          <Route path="/admin-portal/:businessCode" element={<AdminPortalPage />} />
          
          <Route element={<ProtectedRoute />}>
            {/* Starter (APPLICATION_MANAGER) routes */}
            <Route element={<StarterRoute />}>
              <Route element={<StarterLayout />}>
                <Route path="/starter/businesses" element={<StarterBusinessesPage />} />
              </Route>
            </Route>
            <Route path="/starter" element={<Navigate to="/starter/businesses" replace />} />

            {/* Business-scoped routes */}
            <Route element={<TenantGuard />}>
              <Route element={<Layout />}>
                <Route path="/:businessCode/dashboard" element={<DashboardPage />} />
                <Route path="/:businessCode/employees" element={<EmployeesPage />} />
                <Route path="/:businessCode/sites" element={<SitesPage />} />
                <Route path="/:businessCode/sites/:siteId" element={<SiteDetailsPage />} />
                <Route path="/:businessCode/sites/:siteId/review" element={<SiteReviewPage />} />
                <Route element={<AdminRoute />}>
                  <Route path="/:businessCode/users" element={<UsersPage />} />
                  <Route path="/:businessCode/employee-imports" element={<EmployeeImportPage />} />
                </Route>
              </Route>
            </Route>
            <Route path="/" element={<Navigate to="/login" replace />} />
          </Route>
          
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
