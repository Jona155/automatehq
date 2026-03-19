import { useState } from 'react';

interface PageBannerProps {
  storageKey: string;
  title: string;
  summary: React.ReactNode;
  details?: React.ReactNode;
  icon?: string;
}

export default function PageBanner({ storageKey, title, summary, details, icon = 'info' }: PageBannerProps) {
  const [dismissed, setDismissed] = useState(() => {
    return localStorage.getItem(`banner_dismissed_${storageKey}`) === '1';
  });
  const [expanded, setExpanded] = useState(false);

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem(`banner_dismissed_${storageKey}`, '1');
  };

  const handleRestore = () => {
    setDismissed(false);
    localStorage.removeItem(`banner_dismissed_${storageKey}`);
  };

  if (dismissed) {
    return (
      <button
        onClick={handleRestore}
        className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors self-start"
      >
        <span className="material-symbols-outlined text-sm">info</span>
        <span>{title}</span>
        <span className="material-symbols-outlined text-sm">expand_more</span>
      </button>
    );
  }

  return (
    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4" dir="rtl">
      <div className="flex items-start gap-3">
        <span className="material-symbols-outlined text-blue-600 dark:text-blue-400 mt-0.5">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-200">{title}</h4>
            <button
              onClick={handleDismiss}
              className="p-1 rounded-lg text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-800/50 transition-colors shrink-0"
              aria-label="סגור"
            >
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          </div>
          <div className="text-sm text-blue-800 dark:text-blue-300 mt-1 leading-relaxed">
            {summary}
          </div>
          {details && expanded && (
            <div className="text-sm text-blue-800 dark:text-blue-300 mt-2 leading-relaxed">
              {details}
            </div>
          )}
          {details && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="mt-2 flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors"
            >
              <span>{expanded ? 'הצג פחות' : 'הצג עוד'}</span>
              <span className="material-symbols-outlined text-sm">
                {expanded ? 'expand_less' : 'expand_more'}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
