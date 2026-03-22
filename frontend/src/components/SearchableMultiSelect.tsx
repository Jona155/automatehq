import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useOnClickOutside } from '../hooks/useOnClickOutside';

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
  const searchInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => searchInputRef.current?.focus());
    } else {
      setSearch('');
    }
  }, [isOpen]);

  const closeDropdown = useCallback(() => setIsOpen(false), []);
  useOnClickOutside(containerRef, closeDropdown, isOpen);

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
      {isOpen && (
        <div className="absolute left-0 right-0 mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-50 overflow-hidden">
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
          <div className="max-h-60 overflow-y-auto py-1">
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
        </div>
      )}
    </div>
  );
}
