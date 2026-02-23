import { useParams } from 'react-router-dom';
import { useState } from 'react';
import PortalAuth from '../components/PortalAuth';
import PortalUpload from '../components/PortalUpload';

interface PortalSession {
  sessionToken: string;
  siteName: string;
  employeeName: string;
  month: string;
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

export default function PublicPortalPage() {
  const { token } = useParams<{ token: string }>();
  const [session, setSession] = useState<PortalSession | null>(null);

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 px-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <h1 className="text-xl font-bold text-slate-900 mb-2">
            <BilingualText en="Invalid Link" si="වලංගු නොවන සබැඳිය" secondaryClassName="text-sm font-normal text-slate-500 mt-1" />
          </h1>
          <p className="text-sm text-slate-500">
            <BilingualText en="The link is missing or incorrect. Please request a new link from the site manager." si="සබැඳිය නොමැත හෝ වැරදියි. කරුණාකර අඩවි කළමනාකරුගෙන් නව සබැඳියක් ඉල්ලන්න." />
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-10 flex items-center justify-center" dir="ltr">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-lg w-full space-y-6 text-left">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            <BilingualText en="Work Card Upload Portal" si="වැඩ කාඩ්පත් උඩුගත කිරීමේ පෝටලය" secondaryClassName="text-sm font-normal text-slate-500 mt-1" />
          </h1>
          <p className="text-sm text-slate-500 mt-2">
            <BilingualText en="Upload files for your site. Phone verification is required before uploading." si="ඔබගේ අඩවිය සඳහා ගොනු උඩුගත කරන්න. උඩුගත කිරීමට පෙර දුරකථන සත්‍යාපනය අවශ්‍ය වේ." />
          </p>
        </div>

        {!session ? (
          <PortalAuth token={token} onVerified={setSession} />
        ) : (
          <PortalUpload
            sessionToken={session.sessionToken}
            siteName={session.siteName}
            employeeName={session.employeeName}
            month={session.month}
          />
        )}
      </div>
    </div>
  );
}
