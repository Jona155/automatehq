import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { getSites } from '../api/sites';

/**
 * Sidebar entry for the report editor. Reports are per site, so this picks the
 * site last opened in the editor (or the first active one) and goes there.
 */
export default function ReportsLandingPage() {
  const { businessCode = '' } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [state, setState] = useState<'loading' | 'empty' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    getSites({ active: true })
      .then((sites) => {
        if (cancelled) return;
        if (sites.length === 0) {
          setState('empty');
          return;
        }
        let remembered: string | null = null;
        try {
          remembered = localStorage.getItem(`report-editor-last-site:${businessCode}`);
        } catch {
          remembered = null;
        }
        const target = sites.find((site) => site.id === remembered) ?? sites[0];
        const query = searchParams.toString();
        navigate(`/${businessCode}/sites/${target.id}/reports${query ? `?${query}` : ''}`, { replace: true });
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return () => {
      cancelled = true;
    };
    // Runs once per visit; the query string is only carried over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessCode, navigate]);

  return (
    <div className="py-24 text-center text-slate-500 dark:text-slate-400" dir="rtl" data-testid="reports-landing">
      {state === 'loading' && <p>טוען דוחות…</p>}
      {state === 'empty' && <p>אין אתרים פעילים. הוסיפו אתר כדי לצפות בדוחות החודשיים.</p>}
      {state === 'error' && <p>שגיאה בטעינת האתרים. נסו לרענן את הדף.</p>}
    </div>
  );
}
