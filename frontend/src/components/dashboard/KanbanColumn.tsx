import type { DashboardSummary } from '../../types';
import SiteCard from './SiteCard';

type SiteReview = DashboardSummary['sites_review_table'][number];

interface ColumnDef {
  id: string;
  label: string;
  icon: string;
  color: string;
}

interface Props {
  column: ColumnDef;
  sites: SiteReview[];
  month: string;
  businessCode: string;
  onMissingClick: (siteId: string, siteName: string) => void;
}

export default function KanbanColumn({ column, sites, month, businessCode, onMissingClick }: Props) {
  return (
    <div className="flex flex-col min-w-[280px] snap-start flex-shrink-0 lg:flex-1 lg:min-w-0">
      {/* Column header with colored accent */}
      <div className="rounded-xl bg-slate-50/80 dark:bg-slate-800/30 border border-slate-100 dark:border-slate-700/40 mb-3">
        <div className="h-1 rounded-t-xl" style={{ backgroundColor: column.color }} />
        <div className="flex items-center justify-between px-3.5 py-2.5">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-lg" style={{ color: column.color }}>
              {column.icon}
            </span>
            <h3 className="text-[13px] font-semibold text-slate-700 dark:text-slate-300">{column.label}</h3>
          </div>
          <span
            className="text-xs font-bold min-w-[22px] h-[22px] flex items-center justify-center rounded-md"
            style={{ backgroundColor: sites.length > 0 ? `${column.color}15` : 'transparent', color: sites.length > 0 ? column.color : '#94a3b8' }}
          >
            {sites.length}
          </span>
        </div>
      </div>

      {/* Cards list */}
      <div className="flex flex-col gap-2 pb-2">
        {sites.map((site) => (
          <SiteCard
            key={site.site_id}
            site={site}
            month={month}
            businessCode={businessCode}
            onMissingClick={onMissingClick}
          />
        ))}
        {sites.length === 0 && (
          <div className="flex items-center justify-center py-4 rounded-lg border border-dashed border-slate-200/70 dark:border-slate-700/30">
            <span className="text-[11px] text-slate-300 dark:text-slate-600">ריק</span>
          </div>
        )}
      </div>
    </div>
  );
}
