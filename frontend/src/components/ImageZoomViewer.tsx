import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

interface ImageZoomViewerProps {
  /** Image source. When null, a loading spinner is shown. */
  src: string | null;
  alt?: string;
  /** Extra classes for the viewport container (e.g. height / border). */
  className?: string;
}

// Self-contained image viewer with zoom (buttons + wheel), rotate, fit and pan.
// Encapsulates the transform state so it can be dropped in anywhere a work card
// image is shown. Mirrors the toolbar and gestures used in the review screen.
export default function ImageZoomViewer({ src, alt = '', className = '' }: ImageZoomViewerProps) {
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<
    { x: number; y: number; originX: number; originY: number } | null
  >(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  // Reset the transform whenever the image changes so a new card starts clean.
  useEffect(() => {
    setScale(1);
    setRotation(0);
    setOffset({ x: 0, y: 0 });
  }, [src]);

  const zoom = useCallback((direction: 'in' | 'out') => {
    setScale((prev) => {
      const next = direction === 'in' ? prev + 0.2 : prev - 0.2;
      return Math.min(4, Math.max(0.5, Number(next.toFixed(2))));
    });
  }, []);

  const rotate = useCallback(() => {
    setRotation((prev) => (prev + 90) % 360);
  }, []);

  const fit = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  const reset = useCallback(() => {
    setScale(1);
    setRotation(0);
    setOffset({ x: 0, y: 0 });
  }, []);

  // Wheel zoom needs a non-passive listener so preventDefault stops page scroll.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      if (!src) return;
      event.preventDefault();
      event.stopPropagation();
      const zoomDelta = Math.max(-0.35, Math.min(0.35, -event.deltaY * 0.002));
      setScale((prev) => {
        const next = prev + zoomDelta;
        return Math.min(4, Math.max(0.5, Number(next.toFixed(3))));
      });
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, [src]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!src || event.button !== 0 || scale <= 1) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsPanning(true);
      setPanStart({ x: event.clientX, y: event.clientY, originX: offset.x, originY: offset.y });
    },
    [src, scale, offset.x, offset.y]
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!panStart) return;
      event.preventDefault();
      const deltaX = event.clientX - panStart.x;
      const deltaY = event.clientY - panStart.y;
      setOffset({ x: panStart.originX + deltaX, y: panStart.originY + deltaY });
    },
    [panStart]
  );

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    event.stopPropagation();
    setIsPanning(false);
    setPanStart(null);
  }, []);

  const btnClass =
    'w-8 h-8 inline-flex items-center justify-center rounded-full hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80';
  const textBtnClass =
    'px-2 h-8 inline-flex items-center justify-center rounded-full hover:bg-white/20 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80';

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {/* Toolbar */}
      <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 z-20">
        <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-slate-900/80 text-white shadow-lg px-2 py-1 backdrop-blur-sm">
          <button type="button" onClick={() => zoom('out')} className={btnClass} aria-label="הקטן תמונה" title="הקטנה">
            <span className="material-symbols-outlined text-base">zoom_out</span>
          </button>
          <button type="button" onClick={() => zoom('in')} className={btnClass} aria-label="הגדל תמונה" title="הגדלה">
            <span className="material-symbols-outlined text-base">zoom_in</span>
          </button>
          <button type="button" onClick={fit} className={textBtnClass} aria-label="התאם תמונה למסך" title="התאם למסך">
            התאם
          </button>
          <button type="button" onClick={rotate} className={btnClass} aria-label="סובב תמונה" title="סיבוב">
            <span className="material-symbols-outlined text-base">rotate_90_degrees_ccw</span>
          </button>
          <button type="button" onClick={reset} className={textBtnClass} aria-label="אפס תצוגת תמונה" title="איפוס">
            אפס
          </button>
        </div>
      </div>

      {/* Viewport */}
      <div
        ref={viewportRef}
        className={`h-full w-full overflow-hidden p-4 overscroll-contain ${
          scale > 1 ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'
        }`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        role="region"
        aria-label="תצוגת תמונה עם זום והזזה"
        tabIndex={0}
        style={{ touchAction: scale > 1 ? 'none' : 'pan-y' }}
      >
        {src ? (
          <div className="relative h-full w-full flex items-center justify-center overflow-hidden">
            <img
              src={src}
              alt={alt}
              draggable={false}
              className="max-h-full max-w-full w-auto h-auto object-contain rounded-lg select-none"
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale}) rotate(${rotation}deg)`,
                transformOrigin: 'center center',
                transition: isPanning ? 'none' : 'transform 120ms ease-out',
              }}
            />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full gap-2 text-slate-400">
            <span className="material-symbols-outlined text-3xl animate-spin">progress_activity</span>
            <span className="text-sm">טוען תמונה…</span>
          </div>
        )}
      </div>
    </div>
  );
}
