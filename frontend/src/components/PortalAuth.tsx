import { useState, type FormEvent } from 'react';
import { verifyPortalAccess } from '../api/publicPortal';

interface PortalAuthProps {
  token: string;
  onVerified: (data: { sessionToken: string; siteName: string; employeeName: string; month: string }) => void;
}

function BilingualText({
  en,
  si,
  className = '',
  secondaryClassName = 'text-xs text-slate-500',
}: {
  en: string;
  si: string;
  className?: string;
  secondaryClassName?: string;
}) {
  return (
    <span className={className}>
      <span className="block">{en}</span>
      <span className={`block ${secondaryClassName}`}>{si}</span>
    </span>
  );
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
      setError('Phone verification failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 text-left" dir="ltr">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">
          <BilingualText
            en="Phone Number"
            si="දුරකථන අංකය"
            secondaryClassName="text-xs font-normal text-slate-500"
          />
        </label>
        <input
          type="tel"
          value={phoneNumber}
          onChange={(event) => setPhoneNumber(event.target.value)}
          placeholder="Example: 050-1234567"
          className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
          required
        />
        <div className="mt-2">
          <BilingualText en="Enter the phone number used for this portal." si="මෙම පෝටලයට භාවිත කරන දුරකථන අංකය ඇතුළත් කරන්න." />
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-600">
          <BilingualText en={error} si="දුරකථන සත්‍යාපනය අසාර්ථක විය. කරුණාකර නැවත උත්සාහ කරන්න." secondaryClassName="text-xs text-red-500/90" />
        </div>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full px-4 py-3 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors font-medium disabled:opacity-50"
      >
        {isSubmitting ? (
          <BilingualText en="Verifying..." si="සත්‍යාපනය කරමින්..." secondaryClassName="text-xs text-white/80" />
        ) : (
          <BilingualText en="Verify Phone Number" si="දුරකථන අංකය සත්‍යාපනය කරන්න" secondaryClassName="text-xs text-white/80" />
        )}
      </button>
    </form>
  );
}
