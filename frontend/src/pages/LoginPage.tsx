import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login, isAuthenticated, business, user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isAuthenticated) {
      if (user?.role === 'APPLICATION_MANAGER') {
        navigate('/starter/businesses', { replace: true });
      } else if (business) {
        navigate(`/${business.code}/dashboard`, { replace: true });
      }
    }
  }, [isAuthenticated, business, user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    if (!email || !password) {
      setError('Please fill in all fields');
      setIsLoading(false);
      return;
    }

    try {
      const loggedInUser = await login({ email, password });
      if (loggedInUser.role === 'APPLICATION_MANAGER') {
        navigate('/starter/businesses');
        return;
      }
      // Redirect to business dashboard using the business code
      const businessCode = loggedInUser.business?.code;
      if (!businessCode) {
        setError('No business associated with this account');
        setIsLoading(false);
        return;
      }
      navigate(`/${businessCode}/dashboard`);
    } catch (err: any) {
      console.error(err);
      // Extract error message from API response if available
      const message = err.response?.data?.message || 'Invalid email or password';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col font-display bg-background-light dark:bg-background-dark text-slate-900 dark:text-white">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 md:px-12 bg-transparent">
        <div className="flex items-center gap-3">
          <div className="size-8 text-primary">
            <svg fill="none" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
              <path clipRule="evenodd" d="M24 18.4228L42 11.475V34.3663C42 34.7796 41.7457 35.1504 41.3601 35.2992L24 42V18.4228Z" fill="currentColor" fillRule="evenodd"></path>
              <path clipRule="evenodd" d="M24 8.18819L33.4123 11.574L24 15.2071L14.5877 11.574L24 8.18819ZM9 15.8487L21 20.4805V37.6263L9 32.9945V15.8487ZM27 37.6263V20.4805L39 15.8487V32.9945L27 37.6263ZM25.354 2.29885C24.4788 1.98402 23.5212 1.98402 22.646 2.29885L4.98454 8.65208C3.7939 9.08038 3 10.2097 3 11.475V34.3663C3 36.0196 4.01719 37.5026 5.55962 38.098L22.9197 44.7987C23.6149 45.0671 24.3851 45.0671 25.0803 44.7987L42.4404 38.098C43.9828 37.5026 45 36.0196 45 34.3663V11.475C45 10.2097 44.2061 9.08038 43.0155 8.65208L25.354 2.29885Z" fill="currentColor" fillRule="evenodd"></path>
            </svg>
          </div>
          <h1 className="text-xl font-bold tracking-tight">AutomateHQ</h1>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-6 bg-gradient-to-br from-[#f8fafc] via-[#f1f5f9] to-[#e2e8f0] dark:from-[#101a22] dark:to-[#1a2a35]">
        <div className="w-full max-w-[460px] bg-white dark:bg-[#1a2a35] rounded-xl shadow-2xl overflow-hidden border border-slate-200/50 dark:border-slate-700/50">
          <div className="p-8 md:p-10">
            <div className="text-center mb-8">
              <h2 className="text-3xl font-bold leading-tight pb-2">Welcome Back</h2>
              <p className="text-[#617989] dark:text-slate-400 text-base font-normal">Sign in to your account</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold leading-normal" htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  className="block w-full rounded-lg border border-[#dbe1e6] dark:border-slate-600 bg-white dark:bg-slate-800 focus:ring-2 focus:ring-primary focus:border-primary h-14 px-4 text-base font-normal transition-all"
                  placeholder="name@company.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex justify-between items-center px-1">
                  <label className="text-sm font-semibold leading-normal" htmlFor="password">Password</label>
                  <a className="text-primary text-xs font-semibold hover:underline" href="#">Forgot password?</a>
                </div>
                <div className="relative">
                  <input
                    id="password"
                    type="password"
                    className="block w-full rounded-lg border border-[#dbe1e6] dark:border-slate-600 bg-white dark:bg-slate-800 focus:ring-2 focus:ring-primary focus:border-primary h-14 px-4 text-base font-normal transition-all"
                    placeholder="Enter your password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </div>

              {error && (
                <div className="text-red-500 text-sm text-center font-medium">
                  {error}
                </div>
              )}

              <div className="pt-4">
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full bg-primary hover:bg-primary/90 text-white font-bold py-4 rounded-lg shadow-lg shadow-primary/30 transition-all flex items-center justify-center gap-2 text-lg disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {isLoading ? 'Signing in...' : 'Sign in'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </main>

      <footer className="py-6 text-center bg-transparent">
        <p className="text-xs text-[#617989] dark:text-slate-500 font-medium">
          © 2026 AutomateHQ. All rights reserved.
        </p>
      </footer>
    </div>
  );
}
