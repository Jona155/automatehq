import { useState, type FormEvent } from 'react';
import { verifyPortalAccess } from '../api/publicPortal';

interface PortalAuthProps {
  token: string;
  onVerified: (data: { sessionToken: string; siteName: string; employeeName: string; month: string }) => void;
}

export default function PortalAuth({ token, onVerified }: PortalAuthProps) {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const data = await verifyPortalAccess({ token, phone_number: phoneNumber });
      onVerified({
        sessionToken: data.session_token,
        siteName: data.site_name,
        employeeName: data.employee_name,
        month: data.month,
      });
    } catch (err: any) {
      console.error('Verification failed:', err);
      const message = err?.response?.data?.message || 'שגיאה באימות הטלפון';
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">מספר טלפון</label>
        <input
          type="tel"
          value={phoneNumber}
          onChange={(event) => setPhoneNumber(event.target.value)}
          placeholder="לדוגמה: 050-1234567"
          className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
          required
        />
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

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
