import { useState, type FormEvent } from 'react';
import { verifyAdminPortalAccess, type AdminPortalSite } from '../api/publicPortal';

export interface AdminPortalSession {
  sessionToken: string;
  userName: string;
  businessName: string;
  sites: AdminPortalSite[];
}

interface AdminPortalAuthProps {
  businessCode: string;
  onVerified: (data: AdminPortalSession) => void;
}

export default function AdminPortalAuth({ businessCode, onVerified }: AdminPortalAuthProps) {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const data = await verifyAdminPortalAccess({ business_code: businessCode, phone_number: phoneNumber });
      onVerified({
        sessionToken: data.session_token,
        userName: data.user_name,
        businessName: data.business_name,
        sites: data.sites,
      });
    } catch {
      setError('אימות נכשל. בדוק את מספר הטלפון ונסה שוב.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" dir="rtl">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">
          מספר טלפון
        </label>
        <input
          type="tel"
          value={phoneNumber}
          onChange={(e) => setPhoneNumber(e.target.value)}
          placeholder="לדוגמה: 050-1234567"
          className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-right"
          required
        />
      </div>

      {error && (
        <div className="text-sm text-red-600">{error}</div>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full px-4 py-3 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors font-medium disabled:opacity-50"
      >
        {isSubmitting ? 'מאמת...' : 'אמת מספר טלפון'}
      </button>
    </form>
  );
}
