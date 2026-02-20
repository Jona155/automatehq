import { useEffect, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import WorkCardReviewTab from '../components/WorkCardReviewTab';
import { useSidebar } from '../context/SidebarContext';

function getPreviousMonth(): string {
  const now = new Date();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const year = prevMonth.getFullYear();
  const month = String(prevMonth.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export default function SiteReviewPage() {
  const { businessCode, siteId } = useParams<{ businessCode: string; siteId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { collapsed, setCollapsed } = useSidebar();
  const initialCollapsedRef = useRef(collapsed);

  const selectedMonth = searchParams.get('selectedMonth') || getPreviousMonth();
  const shouldAutoCollapse = searchParams.get('sidebar') !== 'keep';

  useEffect(() => {
    if (!shouldAutoCollapse) return;

    setCollapsed(true);

    return () => {
      setCollapsed(initialCollapsedRef.current);
    };
  }, [setCollapsed, shouldAutoCollapse]);

  if (!siteId) {
    return (
      <div className="p-6 text-center text-red-500">
        Site id is missing.
      </div>
    );
  }

  const handleBack = () => {
    navigate(`/${businessCode}/sites/${siteId}`);
  };

  const handleMonthChange = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('selectedMonth', value);
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900 sm:px-6">
        <button
          onClick={handleBack}
          className="flex items-center gap-2 text-primary hover:text-primary/80 transition-colors"
        >
          <span className="material-symbols-outlined">arrow_forward</span>
          <span>חזרה לפרטי האתר</span>
        </button>
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Review Mode</span>
      </div>

      <div className="flex-1 min-h-0">
        <WorkCardReviewTab
          siteId={siteId}
          selectedMonth={selectedMonth}
          onMonthChange={handleMonthChange}
          monthStorageKey={`site_review_month_${siteId}`}
        />
      </div>
    </div>
  );
}
