import { useState, useRef, useEffect, useMemo, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import type { SelectOption } from './SearchableMultiSelect';

interface SearchableSelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  /** Classes applied to the trigger button (sizing/colors per call site). */
  className?: string;
  ariaLabel?: string;
}

interface MenuPos {
  top: number;
  left: number;
  width: number;
  openUp: boolean;
}

const MENU_MAX_HEIGHT = 280;

/**
 * Single-select dropdown with a text-search box. The menu is rendered through a
 * portal with fixed positioning so it is never clipped by an overflow:auto
 * ancestor (e.g. the day-entries table). One menu is open at a time.
 */
export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'בחר...',
  searchPlaceholder = 'חיפוש...',
  disabled = false,
  className = '',
  ariaLabel,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pos, setPos] = useState<MenuPos | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedLabel = useMemo(
    () => options.find((o) => o.value === value)?.label ?? placeholder,
    [options, value, placeholder]
  );

  const filteredOptions = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, search]);

  const computePosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < MENU_MAX_HEIGHT && rect.top > spaceBelow;
    setPos({
      top: openUp ? rect.top : rect.bottom,
      left: rect.left,
      width: Math.max(rect.width, 200),
      openUp,
    });
  };

  // Position the menu before paint to avoid a visible jump.
  useLayoutEffect(() => {
    if (isOpen) computePosition();
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => searchInputRef.current?.focus());
    } else {
      setSearch('');
      setPos(null);
    }
  }, [isOpen]);

  // Close on outside click (checking both trigger and the portalled menu),
  // and on scroll/resize where the cached position would be stale.
  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    const onScrollOrResize = () => setIsOpen(false);
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [isOpen]);

  const select = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => !disabled && setIsOpen((o) => !o)}
        className={`flex items-center gap-1 ${className}`}
      >
        <span className="flex-1 truncate">{selectedLabel}</span>
        <span className="material-symbols-outlined text-[16px] opacity-60 shrink-0">
          {isOpen ? 'expand_less' : 'expand_more'}
        </span>
      </button>

      {isOpen && pos && createPortal(
        <div
          ref={menuRef}
          dir="rtl"
          style={{
            position: 'fixed',
            top: pos.openUp ? undefined : pos.top + 4,
            bottom: pos.openUp ? window.innerHeight - pos.top + 4 : undefined,
            left: pos.left,
            width: pos.width,
          }}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-[100] overflow-hidden"
        >
          <div className="p-2 border-b border-slate-200 dark:border-slate-700">
            <div className="relative">
              <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-[18px] text-slate-400">
                search
              </span>
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full pr-9 pl-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
              />
            </div>
          </div>
          <div className="max-h-60 overflow-y-auto py-1">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-slate-400">לא נמצאו תוצאות</div>
            ) : (
              filteredOptions.map((option) => {
                const isSelected = option.value === value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => select(option.value)}
                    className={`flex items-center gap-2.5 w-full px-3 py-2 text-right text-sm transition-colors ${
                      isSelected
                        ? 'bg-primary/5 dark:bg-primary/10 text-primary font-medium'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[16px] shrink-0 w-4">
                      {isSelected ? 'check' : ''}
                    </span>
                    <span className="truncate">{option.label}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
