import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Site } from '../types';
import { getSite } from '../api/sites';
import { useAuth } from '../context/AuthContext';

export default function SiteDetailsPage() {
  const { siteId } = useParams<{ siteId: string }>();
  const [site, setSite] = useState<Site | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    const fetchSite = async () => {
      if (!siteId) return;
      
      setIsLoading(true);
      try {
        const data = await getSite(siteId);
        setSite(data);
        setError(null);
      } catch (err) {
        console.error('Failed to fetch site:', err);
        setError('שגיאה בטעינת פרטי האתר');
      } finally {
        setIsLoading(false);
      }
    };

    fetchSite();
  }, [siteId]);

  const handleBack = () => {
    navigate(`/${user?.business?.code}/sites`);
  };

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <div className="p-8 text-center text-slate-500">טוען פרטי אתר...</div>
      </div>
    );
  }

  if (error || !site) {
    return (
      <div className="flex flex-col gap-6">
        <button
          onClick={handleBack}
          className="flex items-center gap-2 text-primary hover:text-primary/80 transition-colors w-fit"
        >
          <span className="material-symbols-outlined">arrow_forward</span>
          <span>חזרה לרשימת אתרים</span>
        </button>
        <div className="p-8 text-center text-red-500">{error || 'אתר לא נמצא'}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <button
        onClick={handleBack}
        className="flex items-center gap-2 text-primary hover:text-primary/80 transition-colors w-fit"
      >
        <span className="material-symbols-outlined">arrow_forward</span>
        <span>חזרה לרשימת אתרים</span>
      </button>

      <div>
        <h2 className="text-[#111518] dark:text-white text-3xl font-bold">{site.site_name}</h2>
        <p className="text-[#617989] dark:text-slate-400 mt-1">קוד אתר: {site.site_code || 'לא הוגדר'}</p>
      </div>

      <div className="bg-white dark:bg-[#1a2a35] rounded-xl shadow-xl border border-slate-200/50 dark:border-slate-700/50 p-12">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-4 mx-auto">
            <span className="material-symbols-outlined text-3xl">construction</span>
          </div>
          <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
            פרטי אתר - בקרוב
          </h3>
          <p className="text-slate-600 dark:text-slate-400">
            בעתיד תוכל לנהל עובדים, להעלות כרטיסי עבודה ולצפות בפירוט מלא של האתר
          </p>
        </div>
      </div>
    </div>
  );
}
