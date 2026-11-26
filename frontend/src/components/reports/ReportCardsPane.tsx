import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import EmployeeCardsView, { type EmployeeCardActions } from './EmployeeCardsView';
import type { CardEmployee, SiteMonthCards } from './workCardViewer';

export const CARDS_PANE_MIN_WIDTH = 280;
/** Room the report grid always keeps next to the pane. */
const GRID_MIN_WIDTH = 360;

interface ReportCardsPaneProps {
  /** The employee the report selection is on (null before any selection). */
  employee: CardEmployee | null;
  cards: SiteMonthCards;
  width: number;
  onWidthChange: (width: number, done: boolean) => void;
  /** Link of the viewer tab, and the tab it opens in (reused on later clicks). */
  popOutHref: string;
  popOutTarget: string;
  onClose: () => void;
  /** Approve / "completes the month" actions for the shown employee. */
  actionsFor?: (employeeId: string) => EmployeeCardActions;
}

/**
 * Work card images beside the report. Follows the employee of the selected
 * cell, so moving through the sheet with the keyboard keeps the card in view;
 * pinning holds one employee while editing elsewhere. Mount it with a key per
 * site and month so a pin does not outlive the sheet it was made on.
 */
export default function ReportCardsPane({
  employee, cards, width, onWidthChange, popOutHref, popOutTarget, onClose, actionsFor,
}: ReportCardsPaneProps) {
  const [pinned, setPinned] = useState<CardEmployee | null>(null);
  const shown = pinned ?? employee;
  const paneRef = useRef<HTMLElement | null>(null);

  const startResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = paneRef.current?.offsetWidth ?? width;
    // The grid is the pane's previous sibling; it may give up all but GRID_MIN_WIDTH.
    const gridWidth = (paneRef.current?.previousElementSibling as HTMLElement | null)?.offsetWidth ?? GRID_MIN_WIDTH;
    const maxWidth = Math.max(CARDS_PANE_MIN_WIDTH, startWidth + gridWidth - GRID_MIN_WIDTH);
    let latest = startWidth;
    const onMove = (move: PointerEvent) => {
      // Right-to-left: the pane sits left of the grid, so dragging right widens it.
      latest = Math.round(Math.min(maxWidth, Math.max(CARDS_PANE_MIN_WIDTH, startWidth + (move.clientX - startX))));
      onWidthChange(latest, false);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      onWidthChange(latest, true);
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [onWidthChange, width]);

  const shownCards = shown ? cards.byEmployee.get(shown.id) ?? [] : [];

  return (
    <aside
      ref={paneRef}
      data-testid="cards-pane"
      aria-label="כרטיסי עבודה"
      className="relative shrink-0 min-h-0 flex flex-col rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
      // On a narrower window the pane gives way first: the grid keeps its room.
      style={{ width, minWidth: CARDS_PANE_MIN_WIDTH, maxWidth: `calc(100% - ${GRID_MIN_WIDTH + 16}px)` }}
    >
      {/* Splitter, in the gap between the grid and the pane */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="שינוי רוחב חלונית הכרטיסים"
        title="גררו לשינוי הרוחב"
        data-testid="cards-pane-resize"
        onPointerDown={startResize}
        onDoubleClick={() => onWidthChange(Math.max(CARDS_PANE_MIN_WIDTH, 420), true)}
        className="absolute inset-y-0 -right-3 w-2 z-10 cursor-col-resize rounded-full hover:bg-sky-400/60 active:bg-sky-500/70"
      />

      <div className="shrink-0 flex items-center gap-2 border-b border-slate-200 dark:border-slate-700 px-3 py-2">
        <div className="flex-1 min-w-0">
          <div className="text-[11px] leading-4 text-slate-500 dark:text-slate-400">
            {pinned ? 'כרטיס עבודה · נעוץ' : 'כרטיס עבודה · לפי התא הנבחר'}
          </div>
          <div data-testid="cards-pane-employee" className="truncate font-bold text-slate-900 dark:text-white">
            {shown ? shown.full_name : 'בחרו תא של עובד'}
            {shown?.passport_id && <span className="font-normal text-xs text-slate-500 dark:text-slate-400"> · {shown.passport_id}</span>}
          </div>
        </div>
        <button
          type="button"
          data-testid="cards-pane-pin"
          aria-pressed={Boolean(pinned)}
          disabled={!shown}
          onClick={() => setPinned(pinned ? null : shown)}
          title={pinned ? 'שחרור — הכרטיס יעקוב שוב אחרי התא הנבחר' : 'נעיצה — הכרטיס יישאר מוצג גם כשעוברים לעובד אחר'}
          className={`w-8 h-8 grid place-items-center rounded-lg disabled:opacity-30 ${
            pinned ? 'bg-primary/10 text-primary' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700'
          }`}
        >
          <span className="material-symbols-outlined text-[20px]" style={pinned ? { fontVariationSettings: "'FILL' 1" } : undefined}>push_pin</span>
        </button>
        <a
          href={popOutHref}
          target={popOutTarget}
          data-testid="cards-pane-popout"
          title="פתיחה בכרטיסייה נפרדת — אפשר לגרור אותה למסך אחר, והיא תמשיך לעקוב אחרי הדוח"
          className="w-8 h-8 grid place-items-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
        >
          <span className="material-symbols-outlined text-[20px]">open_in_new</span>
        </a>
        <button
          type="button"
          data-testid="cards-pane-close"
          onClick={onClose}
          title="סגירת החלונית"
          className="w-8 h-8 grid place-items-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
        >
          <span className="material-symbols-outlined text-[20px]">close</span>
        </button>
      </div>

      {shown ? (
        <EmployeeCardsView
          cards={shownCards}
          loading={cards.status === 'loading'}
          error={cards.status === 'error'}
          className="flex-1 min-h-0"
          actions={actionsFor?.(shown.id)}
        />
      ) : (
        <div className="flex-1 grid place-items-center p-6 text-center text-sm text-slate-500 dark:text-slate-400">
          בחרו תא בדוח כדי לראות את כרטיס העבודה של העובד.
        </div>
      )}
    </aside>
  );
}
