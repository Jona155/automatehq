import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DashboardSummary } from '../../types';
import SiteCardDetail from './SiteCardDetail';
import { formatNumber } from '../../utils/formatNumber';

type SiteReview = DashboardSummary['sites_review_table'][number];

interface BadgeDef {
  show: boolean;
  icon: string;
  label: string;
  text: string;
  bg: string;
  spin?: boolean;
  onClick?: (e: React.MouseEvent) => void;
}

interface Props {
  site: SiteReview;
  month: string;
  businessCode: string;
  onMissingClick: (siteId: string, siteName: string) => void;
}

export default function SiteCard({ site, month, businessCode, onMissingClick }: Props) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const approvalPct =
    site.active_employee_count > 0
      ? Math.round((site.approved / site.active_employee_count) * 100)
      : 0;

  const badges: BadgeDef[] = [
    {
      show: site.missing_work_cards > 0,
      icon: 'cloud_upload', label: `${formatNumber(site.missing_work_cards)} חסרים`,
      text: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/30 hover:bg-amber-100 dark:hover:bg-amber-900/50',
      onClick: (e) => { e.stopPropagation(); onMissingClick(site.site_id, site.site_name); },
    },
    {
      show: site.needs_assignment > 0,
      icon: 'person_search', label: `${formatNumber(site.needs_assignment)} שיוך`,
      text: 'text-orange-700 dark:text-orange-400', bg: 'bg-orange-50 dark:bg-orange-900/30',
    },
    {
      show: site.needs_review > 0,
      icon: 'rate_review', label: `${formatNumber(site.needs_review)} בדיקה`,
      text: 'text-sky-700 dark:text-sky-400', bg: 'bg-sky-50 dark:bg-sky-900/30',
    },
    {
      show: site.rejected > 0,
      icon: 'close', label: `${formatNumber(site.rejected)} נדחו`,
      text: 'text-red-700 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/30',
    },
    {
      show: site.extractions_processing > 0,
      icon: 'hourglass_top', label: `${formatNumber(site.extractions_processing)} בעיבוד`,
      text: 'text-purple-700 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-900/30',
      spin: true,
    },
    {
      show: site.extractions_failed > 0,
      icon: 'error', label: `${formatNumber(site.extractions_failed)} נכשלו`,
      text: 'text-red-700 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/30',
    },
  ];

  const visibleBadges = badges.filter((b) => b.show);

  // Collapsed: compact single-row summary
  if (!expanded) {
    return (
      <div
        className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1a2a35] shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer"
        onClick={() => setExpanded(true)}
      >
        <div className="flex items-center gap-3 px-3 py-2.5">
          {/* Progress ring */}
          <div className="relative w-8 h-8 shrink-0">
            <svg viewBox="0 0 36 36" className="w-8 h-8 -rotate-90">
              <circle cx="18" cy="18" r="14" fill="none" strokeWidth="3" className="text-slate-100 dark:text-slate-700" stroke="currentColor" />
              <circle cx="18" cy="18" r="14" fill="none" strokeWidth="3" strokeLinecap="round"
                className={approvalPct === 100 ? 'text-emerald-500' : 'text-emerald-400'}
                stroke="currentColor"
                style={{
                  strokeDasharray: `${2 * Math.PI * 14}`,
                  strokeDashoffset: `${2 * Math.PI * 14 * (1 - approvalPct / 100)}`,
                  transition: 'stroke-dashoffset 0.7s ease-out',
                }}
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-slate-600 dark:text-slate-300">
              {approvalPct}%
            </span>
          </div>

          {/* Site name + counts */}
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-semibold text-slate-900 dark:text-white truncate">{site.site_name}</p>
            <p className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1 flex-wrap">
              <span>{formatNumber(site.approved)}/{formatNumber(site.active_employee_count)} מאושרים</span>
              {site.missing_work_cards > 0 && (
                <span className="text-amber-600 dark:text-amber-400">· {formatNumber(site.missing_work_cards)} חסרים</span>
              )}
              {site.needs_review > 0 && (
                <span className="text-sky-600 dark:text-sky-400">· {formatNumber(site.needs_review)} לבדיקה</span>
              )}
            </p>
          </div>

          {/* Expand hint */}
          <span className="material-symbols-outlined text-slate-300 dark:text-slate-600 text-[16px] shrink-0">
            expand_more
          </span>
        </div>
      </div>
    );
  }

  // Expanded: full card with all details
  return (
    <div className="rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-[#1a2a35] shadow-md overflow-hidden transition-all duration-200">
      <div className="px-3.5 py-3">
        {/* Row 1: Site name + link + collapse */}
        <div className="flex items-center gap-2 mb-2.5">
          <button
            onClick={() => navigate(`/${businessCode}/sites/${site.site_id}`)}
            className="w-6 h-6 flex items-center justify-center rounded-md text-slate-300 hover:text-sky-500 hover:bg-sky-50 dark:hover:bg-sky-900/20 transition-colors shrink-0"
            title="עבור לדף האתר"
          >
            <span className="material-symbols-outlined text-[15px]">open_in_new</span>
          </button>
          <h3
            className="flex-1 text-[13px] font-semibold text-slate-900 dark:text-white leading-tight line-clamp-2 cursor-pointer hover:text-sky-600 dark:hover:text-sky-400 transition-colors"
            onClick={() => navigate(`/${businessCode}/sites/${site.site_id}`)}
          >
            {site.site_name}
          </h3>
          <button
            onClick={() => setExpanded(false)}
            className="w-6 h-6 flex items-center justify-center rounded-md text-slate-300 hover:text-slate-500 transition-colors shrink-0"
          >
            <span className="material-symbols-outlined text-[16px] rotate-180">expand_more</span>
          </button>
        </div>

        {/* Row 2: Progress bar */}
        <div className="flex items-center gap-2.5 mb-2.5">
          <div className="flex-1 h-2 bg-slate-100 dark:bg-slate-700/60 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ease-out ${
                approvalPct === 100 ? 'bg-emerald-500' : 'bg-emerald-400'
              }`}
              style={{ width: `${Math.max(approvalPct, approvalPct > 0 ? 4 : 0)}%` }}
            />
          </div>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 shrink-0 tabular-nums">
            <span className={`font-bold ${approvalPct === 100 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-200'}`}>
              {formatNumber(site.approved)}
            </span>
            /{formatNumber(site.active_employee_count)}
          </span>
        </div>

        {/* Row 3: Badges */}
        {visibleBadges.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
            {visibleBadges.map((badge) => (
              <span
                key={badge.icon + badge.label}
                className={`inline-flex items-center gap-1 text-[10px] font-medium ${badge.text} ${badge.bg} px-1.5 py-[3px] rounded-md transition-colors ${badge.onClick ? 'cursor-pointer' : ''}`}
                onClick={badge.onClick}
              >
                <span className={`material-symbols-outlined text-[11px] ${badge.spin ? 'animate-spin' : ''}`}>
                  {badge.icon}
                </span>
                {badge.label}
              </span>
            ))}
          </div>
        )}

        {/* Row 4: Export status */}
        <div className="flex items-center gap-1">
          {site.export_count > 0 ? (
            <span className="material-symbols-outlined text-emerald-500 text-[13px]">check_circle</span>
          ) : (
            <span className="material-symbols-outlined text-slate-300 dark:text-slate-600 text-[13px]">download</span>
          )}
          <span className={`text-[10px] ${site.export_count > 0 ? 'text-slate-400' : 'text-slate-300 dark:text-slate-600'}`}>
            {site.export_count > 0 ? 'יוצא' : 'לא יוצא'}
          </span>
        </div>
      </div>

      {/* Employee detail panel */}
      <SiteCardDetail
        siteId={site.site_id}
        month={month}
        businessCode={businessCode}
      />
    </div>
  );
}
