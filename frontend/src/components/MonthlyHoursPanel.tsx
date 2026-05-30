import type { WorkCard, WorkCardMonthlyBreakdown, WorkCardMonthlyBreakdownCard } from '../types';

interface MonthlyHoursPanelProps {
  breakdown: WorkCardMonthlyBreakdown;
  currentCardStatus: WorkCard['review_status'];
}

const formatHours = (value: number): string => value.toFixed(2).replace(/\.00$/, '');

const formatDateLabel = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`;
};

const statusLabel = (status: WorkCard['review_status']): string => {
  switch (status) {
    case 'APPROVED':
      return 'אושר';
    case 'NEEDS_REVIEW':
      return 'ממתין לסקירה';
    case 'NEEDS_ASSIGNMENT':
      return 'לא משויך';
    case 'REJECTED':
      return 'נדחה';
    default:
      return status;
  }
};

const describeCard = (card: WorkCardMonthlyBreakdownCard): string => {
  const dateIso = card.approved_at || card.created_at;
  const dateLabel = formatDateLabel(dateIso);
  const status = statusLabel(card.review_status);
  if (card.is_current) {
    return dateLabel ? `כרטיס זה (${dateLabel} · ${status})` : `כרטיס זה (${status})`;
  }
  return dateLabel ? `כרטיס מ-${dateLabel} (${status})` : `כרטיס (${status})`;
};

export default function MonthlyHoursPanel({ breakdown, currentCardStatus }: MonthlyHoursPanelProps) {
  const {
    cards,
    approved_total_hours,
    current_card_contribution_hours,
    projected_total_hours,
  } = breakdown;

  // Nothing to show before assignment.
  if (!breakdown.employee_id || cards.length === 0) {
    return null;
  }

  const otherCards = cards.filter((c) => !c.is_current);
  const hasPriorCards = otherCards.length > 0;
  const isApproved = currentCardStatus === 'APPROVED';

  // Single card, not approved yet: just show the card's contribution as the monthly figure.
  if (!hasPriorCards && !isApproved) {
    return (
      <div
        className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3 flex items-center justify-between gap-3"
        role="region"
        aria-label="סיכום שעות חודשי לעובד"
      >
        <span className="text-xs text-slate-600 dark:text-slate-300 flex items-center gap-2">
          <span className="material-symbols-outlined text-base text-indigo-500">schedule</span>
          סיכום שעות לעובד החודש
        </span>
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          {formatHours(current_card_contribution_hours)} שעות בכרטיס זה
        </span>
      </div>
    );
  }

  // Post-approval mode (with prior cards): show monthly total + per-card breakdown.
  if (isApproved) {
    return (
      <div
        className="rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-900/20 p-3"
        role="region"
        aria-label="סיכום שעות חודשי לעובד"
      >
        <div className="flex items-center justify-between gap-3 mb-2">
          <span className="text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2 font-medium">
            <span className="material-symbols-outlined text-base">check_circle</span>
            סה״כ שעות לעובד החודש
          </span>
          <span className="text-base font-bold text-emerald-800 dark:text-emerald-200">
            {formatHours(projected_total_hours)} שעות
          </span>
        </div>
        <ul className="space-y-1 text-xs text-slate-700 dark:text-slate-300">
          {cards.map((card) => (
            <li key={card.id} className="flex items-center justify-between gap-2">
              <span className={card.is_current ? 'font-medium text-emerald-800 dark:text-emerald-200' : ''}>
                {describeCard(card)}
              </span>
              <span className="font-mono">
                {formatHours(card.contribution_hours)} שעות
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // Pre-approval mode with prior cards: show breakdown — approved + pending = projected.
  return (
    <div
      className="rounded-xl border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50 dark:bg-indigo-900/20 p-3"
      role="region"
      aria-label="סיכום שעות חודשי לעובד"
    >
      <div className="flex items-center gap-2 mb-2 text-xs font-medium text-indigo-700 dark:text-indigo-300">
        <span className="material-symbols-outlined text-base">schedule</span>
        סיכום שעות לעובד החודש
      </div>
      <dl className="space-y-1 text-xs text-slate-700 dark:text-slate-300">
        <div className="flex items-center justify-between gap-2">
          <dt>מאושר עד כה</dt>
          <dd className="font-mono">{formatHours(approved_total_hours)} שעות</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt>בכרטיס זה (טרם אושר)</dt>
          <dd className="font-mono">{formatHours(current_card_contribution_hours)} שעות</dd>
        </div>
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-indigo-200 dark:border-indigo-800 text-sm font-semibold text-indigo-800 dark:text-indigo-200">
          <dt>סה״כ לאחר אישור</dt>
          <dd className="font-mono">{formatHours(projected_total_hours)} שעות</dd>
        </div>
      </dl>
    </div>
  );
}
