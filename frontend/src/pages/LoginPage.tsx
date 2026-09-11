import { useState, useEffect } from 'react';
import { useAuth, type OtpChallenge } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import type { User } from '../types';
import './LoginPage.css';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [method, setMethod] = useState<'password' | 'phone'>('password');
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login, requestOtp, verifyOtp, resendOtp, isAuthenticated, business, user } = useAuth();
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

  useEffect(() => {
    if (!challenge) return;
    const updateCountdowns = () => {
      setSecondsRemaining(Math.max(0, Math.ceil((new Date(challenge.expires_at).getTime() - Date.now()) / 1000)));
      setResendSeconds((current) => Math.max(0, current - 1));
    };
    updateCountdowns();
    const timer = window.setInterval(updateCountdowns, 1000);
    return () => window.clearInterval(timer);
  }, [challenge]);

  const navigateAfterLogin = (loggedInUser: User) => {
    if (loggedInUser?.role === 'APPLICATION_MANAGER') {
      navigate('/starter/businesses');
      return;
    }
    const businessCode = loggedInUser?.business?.code;
    if (!businessCode) {
      setError('לא משויך עסק לחשבון הזה');
      return;
    }
    const landing = loggedInUser.role === 'FIELD_MANAGER' ? 'analytics' : 'dashboard';
    navigate(`/${businessCode}/${landing}`);
  };

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
      navigateAfterLogin(loggedInUser);
    } catch (err: any) {
      console.error(err);
      // Extract error message from API response if available
      const message = err.response?.data?.message || 'אימייל או סיסמה שגויים';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOtpRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!phoneNumber.trim()) {
      setError('נא להזין מספר טלפון');
      return;
    }
    setIsLoading(true);
    try {
      const nextChallenge = await requestOtp(phoneNumber);
      setChallenge(nextChallenge);
      setResendSeconds(nextChallenge.resend_after_seconds);
      setOtpCode('');
    } catch (err: any) {
      setError(err.response?.data?.message || 'שליחת קוד האימות נכשלה');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOtpVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!challenge || otpCode.length !== 6) {
      setError('נא להזין קוד בן 6 ספרות');
      return;
    }
    setIsLoading(true);
    try {
      const loggedInUser = await verifyOtp(challenge.challenge_id, otpCode);
      navigateAfterLogin(loggedInUser);
    } catch (err: any) {
      setError(err.response?.data?.message || 'קוד האימות שגוי או שפג תוקפו');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOtpResend = async () => {
    if (!challenge || resendSeconds > 0) return;
    setError('');
    setIsLoading(true);
    try {
      const nextChallenge = await resendOtp(challenge.challenge_id);
      setChallenge(nextChallenge);
      setResendSeconds(nextChallenge.resend_after_seconds);
      setOtpCode('');
    } catch (err: any) {
      setError(err.response?.data?.message || 'שליחת קוד חדש נכשלה');
    } finally {
      setIsLoading(false);
    }
  };

  const switchMethod = (nextMethod: 'password' | 'phone') => {
    setMethod(nextMethod);
    setChallenge(null);
    setOtpCode('');
    setError('');
  };

  const formatCountdown = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
  };

  return (
    <div className="lg-page">
      <main className="lg-pane">
        <div className="lg-brand">
          <span className="lg-mark"><i></i></span>AutomateHQ
        </div>

        <div className="lg-form-wrap">
          <h1>ברוכים השבים</h1>
          <p className="lg-sub">התחברו באמצעות סיסמה או קוד חד-פעמי ב-WhatsApp</p>

          {!challenge && (
            <div className="lg-method-tabs" role="tablist" aria-label="שיטת התחברות">
              <button type="button" className={method === 'password' ? 'active' : ''} onClick={() => switchMethod('password')}>
                אימייל וסיסמה
              </button>
              <button type="button" className={method === 'phone' ? 'active' : ''} onClick={() => switchMethod('phone')}>
                קוד ב-WhatsApp
              </button>
            </div>
          )}

          {method === 'password' && !challenge && (
            <form onSubmit={handleSubmit}>
              <div className="lg-field">
                <label htmlFor="email">אימייל</label>
                <input id="email" type="email" placeholder="name@company.com" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="lg-field">
                <label htmlFor="password">סיסמה</label>
                <input id="password" type="password" placeholder="הזינו סיסמה" required value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              {error && <p className="lg-error">{error}</p>}
              <button className="lg-btn" type="submit" disabled={isLoading}>
                {isLoading ? 'מתחברים...' : <>כניסה למערכת <span className="lg-arrow">←</span></>}
              </button>
            </form>
          )}

          {method === 'phone' && !challenge && (
            <form onSubmit={handleOtpRequest}>
              <div className="lg-field">
                <label htmlFor="phone-number">מספר טלפון</label>
                <input id="phone-number" type="tel" inputMode="tel" autoComplete="tel" placeholder="050-123-4567" dir="ltr" required value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} />
              </div>
              <p className="lg-hint">נשלח קוד אימות בן 6 ספרות למספר ה-WhatsApp הרשום במערכת.</p>
              {error && <p className="lg-error">{error}</p>}
              <button className="lg-btn" type="submit" disabled={isLoading}>
                {isLoading ? 'שולחים קוד...' : <>שלחו לי קוד <span className="lg-arrow">←</span></>}
              </button>
            </form>
          )}

          {challenge && (
            <form onSubmit={handleOtpVerify}>
              <div className="lg-otp-heading">
                <h2>הזינו את קוד האימות</h2>
                <p>שלחנו קוד בן 6 ספרות ל-{challenge.masked_phone}</p>
              </div>
              <div className="lg-field">
                <label htmlFor="otp-code">קוד אימות</label>
                <input
                  id="otp-code"
                  className="lg-otp-input"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  placeholder="000000"
                  dir="ltr"
                  autoFocus
                  required
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                />
              </div>
              <p className={`lg-expiry ${secondsRemaining === 0 ? 'expired' : ''}`}>
                {secondsRemaining > 0 ? `הקוד בתוקף לעוד ${formatCountdown(secondsRemaining)}` : 'פג תוקף הקוד'}
              </p>
              {error && <p className="lg-error">{error}</p>}
              <button className="lg-btn" type="submit" disabled={isLoading || secondsRemaining === 0 || otpCode.length !== 6}>
                {isLoading ? 'מאמתים...' : <>אימות וכניסה <span className="lg-arrow">←</span></>}
              </button>
              <div className="lg-otp-actions">
                <button type="button" onClick={handleOtpResend} disabled={isLoading || resendSeconds > 0}>
                  {resendSeconds > 0 ? `שליחה מחדש בעוד ${resendSeconds} שניות` : 'שליחת קוד חדש'}
                </button>
                <button type="button" onClick={() => switchMethod('phone')}>שינוי מספר הטלפון</button>
              </div>
            </form>
          )}
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
