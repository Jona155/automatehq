import { useMemo } from 'react';
import type { DashboardSummary, KanbanColumn as KanbanColumnType } from '../../types';
import KanbanColumn from './KanbanColumn';

type SiteReview = DashboardSummary['sites_review_table'][number];

const COLUMNS = [
  { id: 'MISSING_UPLOADS' as KanbanColumnType, label: 'העלאות חסרות', icon: 'cloud_upload', color: '#f59e0b' },
  { id: 'PROCESSING' as KanbanColumnType, label: 'בעיבוד', icon: 'hourglass_top', color: '#8b5cf6' },
  { id: 'NEEDS_ASSIGNMENT' as KanbanColumnType, label: 'צריך שיוך', icon: 'person_search', color: '#f97316' },
  { id: 'NEEDS_REVIEW' as KanbanColumnType, label: 'צריך בדיקה', icon: 'rate_review', color: '#0ea5e9' },
  { id: 'READY' as KanbanColumnType, label: 'מוכן', icon: 'check_circle', color: '#22c55e' },
] as const;

function classifySite(site: SiteReview): KanbanColumnType {
  if (site.missing_work_cards > 0) return 'MISSING_UPLOADS';
  if (site.extractions_processing > 0) return 'PROCESSING';
  if (site.needs_assignment > 0) return 'NEEDS_ASSIGNMENT';
  if (site.needs_review > 0 || site.rejected > 0) return 'NEEDS_REVIEW';
  return 'READY';
}

interface Props {
  sites: DashboardSummary['sites_review_table'];
  month: string;
  businessCode: string;
  onMissingClick: (siteId: string, siteName: string) => void;
}

export default function KanbanBoard({ sites, month, businessCode, onMissingClick }: Props) {
  const grouped = useMemo(() => {
    const groups: Record<KanbanColumnType, SiteReview[]> = {
      MISSING_UPLOADS: [],
      PROCESSING: [],
      NEEDS_ASSIGNMENT: [],
      NEEDS_REVIEW: [],
      READY: [],
    };
    for (const site of sites) {
      groups[classifySite(site)].push(site);
    }
    return groups;
  }, [sites]);

  return (
    <div className="flex flex-row gap-3 overflow-x-auto snap-x snap-mandatory pb-2 -mx-1 px-1">
      {COLUMNS.map((col) => (
        <KanbanColumn
          key={col.id}
          column={col}
          sites={grouped[col.id]}
          month={month}
          businessCode={businessCode}
          onMissingClick={onMissingClick}
        />
      ))}
    </div>
  );
}
