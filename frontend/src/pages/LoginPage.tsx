import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import './LoginPage.css';

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
        // Field managers land directly on their performance analytics.
        const landing = user?.role === 'FIELD_MANAGER' ? 'analytics' : 'dashboard';
        navigate(`/${business.code}/${landing}`, { replace: true });
      }
    }
  }, [isAuthenticated, business, user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    if (!email || !password) {
      setError('נא למלא את כל השדות');
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
        setError('לא משויך עסק לחשבון הזה');
        setIsLoading(false);
        return;
      }
      // Field managers land directly on their performance analytics.
      const landing = loggedInUser.role === 'FIELD_MANAGER' ? 'analytics' : 'dashboard';
      navigate(`/${businessCode}/${landing}`);
    } catch (err: any) {
      console.error(err);
      // Extract error message from API response if available
      const message = err.response?.data?.message || 'אימייל או סיסמה שגויים';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="lg-page">
      <main className="lg-pane">
        <div className="lg-brand">
          <span className="lg-mark"><i></i></span>AutomateHQ
        </div>

        <div className="lg-form-wrap">
          <h1>ברוכים השבים</h1>
          <p className="lg-sub">התחברו כדי לנהל את התהליכים והאוטומציות שלכם</p>

          <form onSubmit={handleSubmit}>
            <div className="lg-field">
              <label htmlFor="email">אימייל</label>
              <input
                id="email"
                type="email"
                placeholder="name@company.com"
                dir="ltr"
                style={{ textAlign: 'right' }}
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="lg-field">
              <label htmlFor="password">סיסמה</label>
              <input
                id="password"
                type="password"
                placeholder="הזינו סיסמה"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {error && <p className="lg-error">{error}</p>}

            <button className="lg-btn" type="submit" disabled={isLoading}>
              {isLoading ? 'מתחברים...' : (
                <>
                  כניסה למערכת <span className="lg-arrow">←</span>
                </>
              )}
            </button>
          </form>
        </div>

        <p className="lg-foot">© 2026 AutomateHQ. כל הזכויות שמורות.</p>
      </main>

      <aside className="lg-canvas">
        <div className="lg-m-brand">
          <span className="lg-mark"><i></i></span>AutomateHQ
        </div>
        <div className="lg-feat-head">
          <h2>הפלטפורמה שמריצה את השטח</h2>
          <p>מכרטיס עבודה כתוב ביד ועד דוח מוכן — בלי הקלדה, בלי טעויות.</p>
        </div>
        <div className="lg-feats">
          <div className="lg-feat lg-f1">
            <span className="lg-ico" style={{ background: 'rgba(110,168,255,.16)', color: '#8FB4FF' }}>◆</span>
            <span className="lg-txt">
              <span className="lg-t">חילוץ שעות בבינה מלאכותית</span>
              <span className="lg-d">קריאה אוטומטית של כרטיסי עבודה בכתב יד</span>
            </span>
          </div>
          <div className="lg-feat lg-f2">
            <span className="lg-ico" style={{ background: 'rgba(74,222,128,.16)', color: '#4ADE80' }}>▣</span>
            <span className="lg-txt">
              <span className="lg-t">הפקת דוחות אוטומטית</span>
              <span className="lg-d">דוחות חודשיים ופרויקטליים נוצרים לבד</span>
            </span>
          </div>
          <div className="lg-feat lg-f3">
            <span className="lg-ico" style={{ background: 'rgba(245,158,11,.16)', color: '#FBBF24' }}>◇</span>
            <span className="lg-txt">
              <span className="lg-t">אינטגרציית וואטסאפ ואימייל</span>
              <span className="lg-d">תקשורת רציפה עם העובדים והלקוחות</span>
            </span>
          </div>
          <div className="lg-feat lg-f4">
            <span className="lg-ico" style={{ background: 'rgba(255,255,255,.1)', color: '#CBD5E1' }}>●</span>
            <span className="lg-txt">
              <span className="lg-t">אנליטיקות ביצועי עובדים</span>
              <span className="lg-d">תמונת מצב מדויקת לכל צוות ואתר</span>
            </span>
          </div>
        </div>
        <p className="lg-tagline">
          כל התהליך במקום אחד — <em>מהיר, מדויק, ובלי עבודה ידנית.</em>
        </p>
      </aside>
    </div>
  );
}
