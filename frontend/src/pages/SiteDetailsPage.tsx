import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Site } from '../types';
import { getSite } from '../api/sites';
import { useAuth } from '../context/AuthContext';

export default function SiteDetailsPage() {
  const { siteId } = useParams<{ siteId: string }>();
  const { isAuthenticated, user } = useAuth();
  const [site, setSite] = useState<Site | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchSite = async () => {
      if (!isAuthenticated || !siteId) return;
      
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
  }, [isAuthenticated, siteId]);

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
      {/* Breadcrumb */}
      <button
        onClick={handleBack}
        className="flex items-center gap-2 text-primary hover:text-primary/80 transition-colors w-fit"
      >
        <span className="material-symbols-outlined">arrow_forward</span>
        <span>חזרה לרשימת אתרים</span>
      </button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-[#111518] dark:text-white text-3xl font-bold">{site.site_name}</h2>
          <p className="text-[#617989] dark:text-slate-400 mt-1">קוד אתר: {site.site_code || 'לא הוגדר'}</p>
        </div>
      </div>

      {/* Placeholder Content */}
      <div className="p-8 text-center border-2 border-dashed border-slate-300 rounded-lg dark:border-slate-700">
        <h3 className="text-xl font-medium text-slate-600 dark:text-slate-400">
          Site inner page - {site.site_name}
        </h3>
      </div>
    </div>
  );
}
