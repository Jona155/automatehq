import { useParams } from 'react-router-dom';
import { useState } from 'react';
import AdminPortalAuth, { type AdminPortalSession } from '../components/AdminPortalAuth';
import AdminPortalUpload from '../components/AdminPortalUpload';

export default function AdminPortalPage() {
  const { businessCode } = useParams<{ businessCode: string }>();
  const [session, setSession] = useState<AdminPortalSession | null>(null);

  if (!businessCode) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 px-4" dir="rtl">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <h1 className="text-xl font-bold text-slate-900">קישור לא תקין</h1>
          <p className="text-sm text-slate-500 mt-2">הקישור חסר או שגוי. פנה למנהל המערכת.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-10 flex items-center justify-center" dir="rtl">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            פורטל העלאת כרטיסי עבודה
          </h1>
          {session ? (
            <p className="text-sm text-slate-500 mt-1">{session.businessName}</p>
          ) : (
            <p className="text-sm text-slate-500 mt-2">
              נדרשת אימות מספר טלפון לפני ההעלאה.
            </p>
          )}
        </div>

        {!session ? (
          <AdminPortalAuth businessCode={businessCode} onVerified={setSession} />
        ) : (
          <AdminPortalUpload
            sessionToken={session.sessionToken}
            userName={session.userName}
            businessName={session.businessName}
            sites={session.sites}
          />
        )}
      </div>
    </div>
  );
}
