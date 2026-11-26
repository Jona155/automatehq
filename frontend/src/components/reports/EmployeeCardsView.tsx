import { useEffect, useMemo, useState } from 'react';
import ImageZoomViewer from '../ImageZoomViewer';
import type { WorkCard } from '../../types';
import { REVIEW_STATUS_CLASSES, REVIEW_STATUS_LABELS, useWorkCardImages } from './workCardViewer';

interface EmployeeCardsViewProps {
  /** The employee's cards, in report order (the first one feeds the report). */
  cards: WorkCard[];
  loading?: boolean;
  error?: boolean;
  /** Shown when the employee has no card at this site this month. */
  emptyMessage?: string;
  className?: string;
  /** Report-editor actions on the employee's cards; omitted in read-only viewers. */
  actions?: EmployeeCardActions;
}

export interface EmployeeCardActions {
  /**
   * Approves the employee's month, like the review screen: ``card`` is the one
   * still waiting for review. ``fullMonth`` is set when every card is a manual
   * one — the approval then counts as the whole month's submission.
   */
  onApprove: (card: WorkCard, fullMonth: boolean) => Promise<void>;
  /** Why approving is unavailable right now (e.g. unsaved changes), if it is. */
  approveBlockedReason?: string | null;
  /**
   * Marks (or unmarks) the received cards as the month's full submission — for
   * when the next card will not come and the report fills the rest of the month.
   */
  onSetCompletesMonth: (complete: boolean) => Promise<void>;
}

const STATUS_DOT: Record<WorkCard['review_status'], string> = {
  APPROVED: 'bg-emerald-500',
  NEEDS_REVIEW: 'bg-amber-500',
  NEEDS_ASSIGNMENT: 'bg-slate-400',
  REJECTED: 'bg-red-500',
};

function formatUploaded(iso: string | undefined) {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('he-IL');
}

/**
 * An employee's work cards, as in the review screen: with several cards, a
 * strip of numbered thumbnails (plus previous/next and an "n / total" count)
 * picks the one shown large below.
 */
export default function EmployeeCardsView({
  cards, loading, error, emptyMessage = 'אין כרטיס עבודה לעובד זה באתר בחודש זה.', className = '', actions,
}: EmployeeCardsViewProps) {
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState<'approve' | 'complete' | null>(null);
  const cardIds = useMemo(() => cards.map((c) => c.id), [cards]);
  // A different employee (or a reloaded list) starts at the card the report uses.
  const signature = cardIds.join(',');
  useEffect(() => setIndex(0), [signature]);
  const images = useWorkCardImages(cardIds);

  if (loading) {
    return (
      <div className={`grid place-items-center text-sm text-slate-400 ${className}`}>
        <span className="inline-flex items-center gap-2">
          <span className="material-symbols-outlined animate-spin">progress_activity</span>
          טוען כרטיסי עבודה…
        </span>
      </div>
    );
  }
  if (error) {
    return (
      <div className={`grid place-items-center text-sm text-red-600 ${className}`}>
        שגיאה בטעינת כרטיסי העבודה
      </div>
    );
  }
  if (!cards.length) {
    return (
      <div className={`grid place-items-center p-6 text-center text-sm text-slate-500 dark:text-slate-400 ${className}`}>
        <div className="space-y-2">
          <span className="material-symbols-outlined text-4xl text-slate-300">image_not_supported</span>
          <p>{emptyMessage}</p>
          {actions && (
            <p className="text-xs text-slate-400 dark:text-slate-500 max-w-xs mx-auto">
              מילוי ימים בדוח ושמירה ייצרו לעובד כרטיס עבודה ידני עם הימים שמולאו.
            </p>
          )}
        </div>
      </div>
    );
  }

  const active = Math.min(index, cards.length - 1);
  const card = cards[active];
  const image = images[card.id] ?? { status: 'loading' as const };
  const isManual = card.source === 'MANUAL';
  const multiple = cards.length > 1;

  // Same choice as the review screen: the newest card still waiting for review.
  const pendingCard = cards.find((c) => c.review_status === 'NEEDS_REVIEW') ?? null;
  const allManual = cards.every((c) => c.source === 'MANUAL');
  const monthCompleted = cards.some((c) => c.completes_month);
  const run = async (kind: 'approve' | 'complete', action: () => Promise<void>) => {
    if (busy) return;
    setBusy(kind);
    try {
      await action();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={`flex flex-col min-h-0 ${className}`}>
      {multiple && (
        <div className="shrink-0 border-b border-slate-200 dark:border-slate-700 px-2 py-2 space-y-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 dark:text-slate-200">
              <span className="material-symbols-outlined text-[16px]">photo_library</span>
              {cards.length} כרטיסים לעובד
            </span>
            <div className="ms-auto flex items-center gap-1">
              <button
                type="button"
                onClick={() => setIndex(active - 1)}
                disabled={active === 0}
                title="הכרטיס הקודם"
                aria-label="הכרטיס הקודם"
                className="w-7 h-7 grid place-items-center rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30"
              >
                <span className="material-symbols-outlined text-[18px]">chevron_right</span>
              </button>
              <span data-testid="work-card-counter" className="text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 rounded-full px-2 py-0.5 tabular-nums">
                {active + 1} / {cards.length}
              </span>
              <button
                type="button"
                onClick={() => setIndex(active + 1)}
                disabled={active === cards.length - 1}
                title="הכרטיס הבא"
                aria-label="הכרטיס הבא"
                className="w-7 h-7 grid place-items-center rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30"
              >
                <span className="material-symbols-outlined text-[18px]">chevron_left</span>
              </button>
            </div>
          </div>

          <div role="tablist" aria-label="כרטיסי העובד" className="flex items-center gap-2 overflow-x-auto pb-0.5">
            {cards.map((c, i) => {
              const thumb = images[c.id];
              const isActive = i === active;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  data-testid={`work-card-thumb-${i}`}
                  onClick={() => setIndex(i)}
                  title={`כרטיס ${i + 1} · ${REVIEW_STATUS_LABELS[c.review_status]}${c.original_filename ? ` · ${c.original_filename}` : ''}${i === 0 ? ' · השעות בדוח נלקחות מכרטיס זה' : ''}`}
                  className={`relative shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition-colors ${
                    isActive
                      ? 'border-primary ring-2 ring-primary/30'
                      : 'border-slate-200 dark:border-slate-600 hover:border-slate-400'
                  }`}
                >
                  {thumb?.status === 'ready' ? (
                    <img src={thumb.src} alt={`כרטיס ${i + 1}`} className="w-full h-full object-cover" draggable={false} />
                  ) : (
                    <div className="w-full h-full grid place-items-center bg-slate-100 dark:bg-slate-700 text-slate-400">
                      <span className={`material-symbols-outlined text-lg ${thumb?.status === 'loading' ? 'animate-pulse' : ''}`}>
                        {c.source === 'MANUAL' ? 'edit_note' : thumb?.status === 'error' ? 'broken_image' : 'image'}
                      </span>
                    </div>
                  )}
                  <span className={`absolute top-1 left-1 w-2 h-2 rounded-full ring-1 ring-white ${STATUS_DOT[c.review_status]}`} />
                  {i === 0 && (
                    <span className="absolute top-0.5 right-0.5 grid place-items-center w-4 h-4 rounded bg-white/90 text-primary">
                      <span className="material-symbols-outlined text-[12px]">table_view</span>
                    </span>
                  )}
                  <span className="absolute bottom-0 left-0 right-0 bg-slate-900/70 text-white text-[10px] leading-tight text-center tabular-nums">
                    {i + 1}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="shrink-0 flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5 text-xs text-slate-500 dark:text-slate-400">
        {multiple && <span className="font-semibold text-slate-700 dark:text-slate-200">כרטיס {active + 1}</span>}
        <span className={`inline-flex items-center px-2 h-5 rounded-full border font-semibold ${REVIEW_STATUS_CLASSES[card.review_status]}`}>
          {REVIEW_STATUS_LABELS[card.review_status]}
        </span>
        {multiple && active === 0 && (
          <span className="inline-flex items-center gap-0.5 font-semibold text-primary">
            <span className="material-symbols-outlined text-[14px]">table_view</span>
            השעות בדוח נלקחות מכרטיס זה
          </span>
        )}
        {card.original_filename && <span className="truncate max-w-[14rem]" title={card.original_filename}>{card.original_filename}</span>}
        {formatUploaded(card.created_at) && <span>הועלה {formatUploaded(card.created_at)}</span>}
      </div>

      {actions && (
        <div className="shrink-0 flex flex-wrap items-center gap-2 px-3 pb-1.5">
          {pendingCard && (
            <button
              type="button"
              data-testid="approve-employee-month"
              disabled={busy !== null || Boolean(actions.approveBlockedReason)}
              onClick={() => { void run('approve', () => actions.onApprove(pendingCard, allManual)); }}
              title={
                actions.approveBlockedReason
                || (allManual
                  ? 'אישור הכרטיס הידני כהגשה של כל החודש — העובד לא יופיע בדוח הכרטיסים החסרים'
                  : 'אישור כרטיסי העבודה של העובד לחודש זה, כמו במסך סקירת הכרטיסים')
              }
              className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-[16px]">check_circle</span>
              {busy === 'approve' ? 'מאשר…' : 'אשר'}
            </button>
          )}
          {!allManual && (
            <button
              type="button"
              data-testid="completes-month-toggle"
              aria-pressed={monthCompleted}
              disabled={busy !== null}
              onClick={() => { void run('complete', () => actions.onSetCompletesMonth(!monthCompleted)); }}
              title={
                monthCompleted
                  ? 'ביטול — העובד יחזור להופיע בדוח הכרטיסים החסרים אם חסר לו כרטיס'
                  : 'כשהכרטיס הבא לא יגיע וימי החודש הנותרים מולאו בדוח: העובד לא יופיע בדוח הכרטיסים החסרים לחודש זה'
              }
              className={`inline-flex items-center gap-1.5 px-2.5 h-7 rounded-lg border text-xs font-semibold transition-colors disabled:opacity-50 ${
                monthCompleted
                  ? 'bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-900/30 dark:border-indigo-800 dark:text-indigo-200'
                  : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">
                {monthCompleted ? 'check_box' : 'check_box_outline_blank'}
              </span>
              {busy === 'complete' ? 'מעדכן…' : 'הדוח משלים את החודש'}
            </button>
          )}
        </div>
      )}

      {image.status === 'error' ? (
        <div className="flex-1 min-h-0 grid place-items-center p-6 text-center text-sm text-slate-500 dark:text-slate-400">
          {isManual ? 'כרטיס שהוזן ידנית — אין לו תמונה.' : 'לא ניתן לטעון את תמונת הכרטיס.'}
        </div>
      ) : (
        <ImageZoomViewer
          src={image.status === 'ready' ? image.src : null}
          alt={`כרטיס עבודה ${active + 1}`}
          className="flex-1 min-h-0 bg-slate-100 dark:bg-slate-900"
        />
      )}
    </div>
  );
}
