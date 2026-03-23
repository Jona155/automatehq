import { useState } from 'react';

interface PageBannerProps {
  storageKey: string;
  title: string;
  summary: React.ReactNode;
  details?: React.ReactNode;
  icon?: string;
}

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40';

const collapseGrid = (open: boolean) =>
  `grid transition-[grid-template-rows,opacity] duration-300 ease-in-out ${
    open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
  }`;

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

  const detailsId = `banner-details-${storageKey}`;

  return (
    <>
      {/* Compact pill — animates in when dismissed, out when restored */}
      <div className={collapseGrid(dismissed)} aria-hidden={!dismissed}>
        <div className="overflow-hidden">
          {/* Padding so overflow-hidden doesn't clip focus ring */}
          <div className="py-1">
            <button
              onClick={handleRestore}
              className={`group inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400
                bg-blue-50 dark:bg-blue-900/30 border border-blue-200/60 dark:border-blue-800/60
                rounded-full px-3 py-1.5
                hover:bg-blue-100 dark:hover:bg-blue-900/50 hover:border-blue-300 dark:hover:border-blue-700
                hover:shadow-sm transition-all duration-200 ${focusRing}`}
              aria-label={`הצג מדריך: ${title}`}
            >
              <span className="material-symbols-outlined text-sm">{icon}</span>
              <span>{title}</span>
              <span className="material-symbols-outlined text-sm transition-transform duration-200 group-hover:-translate-y-0.5">
                expand_more
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Full banner — animates in when restored, out when dismissed */}
      <div className={collapseGrid(!dismissed)} aria-hidden={dismissed}>
        <div className="overflow-hidden">
          <div
            className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800
              border-r-4 border-r-blue-400 dark:border-r-blue-500
              rounded-lg p-4 shadow-sm"
            dir="rtl"
            role="region"
            aria-label={title}
          >
            <div className="flex items-start gap-3">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-800/50 shrink-0 mt-0.5">
                <span className="material-symbols-outlined text-blue-600 dark:text-blue-400 text-lg">{icon}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-200">{title}</h4>
                  <button
                    onClick={handleDismiss}
                    className={`p-1 rounded-full text-blue-400 hover:text-blue-600 dark:hover:text-blue-300
                      hover:bg-blue-100 dark:hover:bg-blue-800/50 transition-all duration-200 shrink-0 ${focusRing}`}
                    aria-label="סגור מדריך"
                  >
                    <span className="material-symbols-outlined text-lg">close</span>
                  </button>
                </div>
                <div className="text-sm text-blue-800 dark:text-blue-300 mt-1 leading-relaxed">
                  {summary}
                </div>
                {details && (
                  <>
                    <div
                      id={detailsId}
                      className={collapseGrid(expanded)}
                      aria-hidden={!expanded}
                    >
                      <div className="overflow-hidden">
                        <div className="text-sm text-blue-800 dark:text-blue-300 leading-relaxed border-t border-blue-200/50 dark:border-blue-700/50 mt-2 pt-2">
                          {details}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => setExpanded(!expanded)}
                      aria-expanded={expanded}
                      aria-controls={detailsId}
                      className={`mt-2 flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400
                        hover:text-blue-800 dark:hover:text-blue-300 transition-colors rounded ${focusRing}`}
                    >
                      <span>{expanded ? 'הצג פחות' : 'הצג עוד'}</span>
                      <span
                        className={`material-symbols-outlined text-sm transition-transform duration-300 ${
                          expanded ? 'rotate-180' : ''
                        }`}
                      >
                        expand_more
                      </span>
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
