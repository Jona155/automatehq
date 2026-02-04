import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import EmployeesPage from './pages/EmployeesPage';
import SitesPage from './pages/SitesPage';
import SiteDetailsPage from './pages/SiteDetailsPage';
import UsersPage from './pages/UsersPage';
import PublicPortalPage from './pages/PublicPortalPage';
import ProtectedRoute from './components/ProtectedRoute';
import TenantGuard from './components/TenantGuard';
import Layout from './components/Layout';

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/portal/:token" element={<PublicPortalPage />} />
          
          <Route element={<ProtectedRoute />}>
            <Route element={<TenantGuard />}>
              <Route element={<Layout />}>
                <Route path="/:businessCode/dashboard" element={<DashboardPage />} />
                <Route path="/:businessCode/employees" element={<EmployeesPage />} />
                <Route path="/:businessCode/sites" element={<SitesPage />} />
                <Route path="/:businessCode/sites/:siteId" element={<SiteDetailsPage />} />
                <Route path="/:businessCode/users" element={<UsersPage />} />
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
