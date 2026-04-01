import { useMemo } from 'react';
import type { DashboardSummary } from '../../types';
import { formatNumber } from '../../utils/formatNumber';

interface Props {
  sites: DashboardSummary['sites_review_table'];
  onRefresh: () => void;
}

export default function DashboardSummaryBar({ sites, onRefresh }: Props) {
  const { totalEmployees, totalApproved, approvalPct, sitesReady, totalProcessing } = useMemo(() => {
    const totalEmployees = sites.reduce((sum, s) => sum + s.active_employee_count, 0);
    const totalApproved = sites.reduce((sum, s) => sum + s.approved, 0);
    return {
      totalEmployees,
      totalApproved,
      approvalPct: totalEmployees > 0 ? Math.round((totalApproved / totalEmployees) * 100) : 0,
      sitesReady: sites.filter(
        (s) => s.missing_work_cards === 0 && s.extractions_processing === 0 && s.needs_assignment === 0 && s.needs_review === 0 && s.rejected === 0
      ).length,
      totalProcessing: sites.reduce((sum, s) => sum + s.extractions_processing, 0),
    };
  }, [sites]);

  const circumference = 2 * Math.PI * 18;
  const strokeDashoffset = circumference - (approvalPct / 100) * circumference;

  return (
    <div className="bg-white dark:bg-[#1a2a35] rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
      <div className="flex items-stretch divide-x divide-x-reverse divide-slate-100 dark:divide-slate-700/60">
        {/* Approval progress - primary metric */}
        <div className="flex-1 flex items-center gap-4 px-6 py-5">
          <div className="relative w-12 h-12 shrink-0">
            <svg viewBox="0 0 44 44" className="w-12 h-12 -rotate-90">
              <circle cx="22" cy="22" r="18" fill="none" stroke="currentColor" strokeWidth="3.5"
                className="text-slate-100 dark:text-slate-700" />
              <circle cx="22" cy="22" r="18" fill="none" strokeWidth="3.5" strokeLinecap="round"
                className="text-emerald-500 transition-all duration-700"
                style={{ strokeDasharray: circumference, strokeDashoffset }} />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-slate-700 dark:text-slate-200">
              {approvalPct}%
            </span>
          </div>
          <div>
            <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">אישור עובדים</p>
            <p className="text-xl font-bold text-slate-900 dark:text-white mt-0.5">
              {formatNumber(totalApproved)}
              <span className="text-sm font-normal text-slate-400 mr-1">/ {formatNumber(totalEmployees)}</span>
            </p>
          </div>
        </div>

        {/* Sites ready */}
        <div className="flex-1 flex items-center gap-4 px-6 py-5">
          <div className="w-10 h-10 rounded-xl bg-sky-50 dark:bg-sky-900/20 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-sky-500 text-xl">domain</span>
          </div>
          <div>
            <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">אתרים מוכנים</p>
            <p className="text-xl font-bold text-slate-900 dark:text-white mt-0.5">
              {sitesReady}
              <span className="text-sm font-normal text-slate-400 mr-1">/ {sites.length}</span>
            </p>
          </div>
        </div>

        {/* Processing */}
        <div className="flex-1 flex items-center gap-4 px-6 py-5">
          <div className="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-900/20 flex items-center justify-center shrink-0">
            <span className={`material-symbols-outlined text-purple-500 text-xl ${totalProcessing > 0 ? 'animate-spin' : ''}`}>
              hourglass_top
            </span>
          </div>
          <div>
            <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">בעיבוד</p>
            <p className={`text-xl font-bold mt-0.5 ${totalProcessing > 0 ? 'text-purple-600 dark:text-purple-400' : 'text-slate-900 dark:text-white'}`}>
              {formatNumber(totalProcessing)}
            </p>
          </div>
        </div>

        {/* Refresh */}
        <div className="flex items-center px-4">
          <button
            onClick={onRefresh}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            title="רענן נתונים"
          >
            <span className="material-symbols-outlined text-xl">refresh</span>
          </button>
        </div>
      </div>
    </div>
  );
}
