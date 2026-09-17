import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';

export interface SelectOption {
  value: string;
  label: string;
}

interface SearchableMultiSelectProps {
  options: SelectOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  searchPlaceholder?: string;
  icon?: string;
  allLabel?: string;
}

interface DropdownPosition {
  left: number;
  width: number;
  top: number;
  maxHeight: number;
}

export default function SearchableMultiSelect({
  options,
  selected,
  onChange,
  searchPlaceholder = 'חיפוש...',
  icon,
  allLabel = 'הכל',
}: SearchableMultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [dropdownPosition, setDropdownPosition] = useState<DropdownPosition | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const updateDropdownPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const gap = 4;
    const preferredHeight = 340;
    const spaceBelow = window.innerHeight - rect.bottom - gap;

    setDropdownPosition({
      left: rect.left,
      width: rect.width,
      top: rect.bottom + gap,
      maxHeight: Math.max(96, Math.min(preferredHeight, spaceBelow)),
    });
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) return;

    updateDropdownPosition();
    window.addEventListener('resize', updateDropdownPosition);
    window.addEventListener('scroll', updateDropdownPosition, true);
    return () => {
      window.removeEventListener('resize', updateDropdownPosition);
      window.removeEventListener('scroll', updateDropdownPosition, true);
    };
  }, [isOpen, updateDropdownPosition]);

  useEffect(() => {
    if (isOpen && dropdownPosition) {
      requestAnimationFrame(() => searchInputRef.current?.focus());
    } else if (!isOpen) {
      setSearch('');
      setDropdownPosition(null);
    }
  }, [isOpen, dropdownPosition]);

  const closeDropdown = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    if (!isOpen) return;

    const handleOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!containerRef.current?.contains(target) && !dropdownRef.current?.contains(target)) {
        closeDropdown();
      }
    };

    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [closeDropdown, isOpen]);

  const filteredOptions = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, search]);

  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  const resetSelection = () => onChange([]);

  const displayText = useMemo(() => {
    if (selected.length === 0) return allLabel;
    if (selected.length === 1) {
      const opt = options.find((o) => o.value === selected[0]);
      return opt?.label ?? selected[0];
    }
    return `${selected.length} נבחרו`;
  }, [selected, options, allLabel]);

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-sm text-right focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none"
      >
        {icon && (
          <span className="material-symbols-outlined text-[18px] text-slate-500 dark:text-slate-400">
            {icon}
          </span>
        )}
        <span className="flex-1 truncate font-medium">{displayText}</span>
        <span className="material-symbols-outlined text-[18px] text-slate-500 dark:text-slate-400">
          {isOpen ? 'expand_less' : 'expand_more'}
        </span>
      </button>

      {/* Dropdown */}
      {isOpen && dropdownPosition && createPortal(
        <div
          ref={dropdownRef}
          dir="rtl"
          className="fixed z-[100] flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl overflow-hidden"
          style={dropdownPosition}
        >
          {/* Search */}
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

          {/* Quick action */}
          {selected.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-700/50">
              <button
                type="button"
                onClick={resetSelection}
                className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
              >
                {allLabel}
              </button>
            </div>
          )}

          {/* Options list */}
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-slate-400">לא נמצאו תוצאות</div>
            ) : (
              filteredOptions.map((option) => {
                const isSelected = selected.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => toggle(option.value)}
                    className={`flex items-center gap-2.5 w-full px-3 py-2 text-right text-sm transition-colors ${
                      isSelected
                        ? 'bg-primary/5 dark:bg-primary/10 text-primary font-medium'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span
                      className={`flex-shrink-0 w-4.5 h-4.5 rounded border flex items-center justify-center transition-colors ${
                        isSelected
                          ? 'bg-primary border-primary text-white'
                          : 'border-slate-300 dark:border-slate-600'
                      }`}
                    >
                      {isSelected && (
                        <span className="material-symbols-outlined text-[14px]">check</span>
                      )}
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
    </div>
  );
}
