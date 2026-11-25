import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface PopoverAnchor {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
}

interface CellPopoverProps {
  /** The report grid's scroll container. */
  grid: HTMLElement | null;
  anchor: PopoverAnchor;
  onClose: () => void;
  children: ReactNode;
}

const GAP = 6;
const MARGIN = 8;
const STICKY_HEADER = 60; // the sheet's frozen header rows

type Placement = { top: number; left: number } | null;

/**
 * A floating panel beside the selected cells: below them, else above, else to
 * the side, so the selection itself stays visible. It follows the cells while
 * the sheet scrolls and hides when they scroll out of view. It never takes
 * focus on its own, so arrow keys keep moving through the sheet.
 */
export default function CellPopover({ grid, anchor, onClose, children }: CellPopoverProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacementState] = useState<Placement>(null);
  // Placement is re-measured after every render; only a real move re-renders.
  const setPlacement = useCallback((next: Placement) => {
    setPlacementState((prev) => (
      prev === next || (prev && next && Math.round(prev.top) === Math.round(next.top) && Math.round(prev.left) === Math.round(next.left))
        ? prev
        : next
    ));
  }, []);

  const place = useCallback(() => {
    const panel = panelRef.current;
    if (!grid || !panel) return;
    const first = grid.querySelector<HTMLElement>(`[data-pos="${anchor.minRow}:${anchor.minCol}"]`);
    const last = grid.querySelector<HTMLElement>(`[data-pos="${anchor.maxRow}:${anchor.maxCol}"]`);
    if (!first || !last) {
      setPlacement(null);
      return;
    }
    const a = first.getBoundingClientRect();
    const b = last.getBoundingClientRect();
    const view = grid.getBoundingClientRect();
    const box = {
      top: Math.max(Math.min(a.top, b.top), view.top + STICKY_HEADER),
      bottom: Math.min(Math.max(a.bottom, b.bottom), view.bottom),
      left: Math.max(Math.min(a.left, b.left), view.left),
      right: Math.min(Math.max(a.right, b.right), view.right),
    };
    // Selection scrolled out of sight: nothing to point at.
    if (box.bottom <= box.top || box.right <= box.left) {
      setPlacement(null);
      return;
    }
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const maxTop = window.innerHeight - height - MARGIN;
    const maxLeft = window.innerWidth - width - MARGIN;
    const clamp = (value: number, max: number) => Math.max(MARGIN, Math.min(max, value));
    // Right-to-left sheet: line the panel up with the selection's right edge.
    const alignedLeft = clamp(box.right - width, maxLeft);

    if (box.bottom + GAP + height <= window.innerHeight - MARGIN) {
      setPlacement({ top: box.bottom + GAP, left: alignedLeft });
    } else if (box.top - GAP - height >= MARGIN) {
      setPlacement({ top: box.top - GAP - height, left: alignedLeft });
    } else {
      // A tall selection: beside it, on whichever side has room (left first, the sheet runs that way).
      const side = box.left - GAP - width >= MARGIN ? box.left - GAP - width : box.right + GAP;
      setPlacement({ top: clamp(box.top, maxTop), left: clamp(side, maxLeft) });
    }
  }, [grid, anchor.minRow, anchor.minCol, anchor.maxRow, anchor.maxCol, setPlacement]);

  useLayoutEffect(() => {
    place();
  });

  useEffect(() => {
    if (!grid) return undefined;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    grid.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(grid);
    if (grid.firstElementChild) observer.observe(grid.firstElementChild);
    if (panelRef.current) observer.observe(panelRef.current);
    return () => {
      cancelAnimationFrame(frame);
      grid.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      observer.disconnect();
    };
  }, [grid, place]);

  return createPortal(
    <div
      ref={panelRef}
      dir="rtl"
      role="dialog"
      aria-label="עריכת תאים"
      data-testid="cell-popover"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
      // Measured hidden first, then shown where it fits.
      style={placement ? { top: placement.top, left: placement.left } : { top: 0, left: 0, visibility: 'hidden' }}
      className="fixed z-40 w-[19rem] max-h-[70vh] overflow-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-xl text-sm"
    >
      {children}
    </div>,
    document.body,
  );
}
