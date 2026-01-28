import { useEffect, useState } from 'react';

interface MonthPickerProps {
  value: string; // Format: YYYY-MM
  onChange: (value: string) => void;
  storageKey?: string; // Optional localStorage key for persistence
}

// Helper to get previous month in YYYY-MM format
const getPreviousMonth = (): string => {
  const now = new Date();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const year = prevMonth.getFullYear();
  const month = String(prevMonth.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

// Helper to format YYYY-MM to display text
const formatMonthDisplay = (value: string): string => {
  const [year, month] = value.split('-');
  const date = new Date(parseInt(year), parseInt(month) - 1, 1);
  return date.toLocaleDateString('he-IL', { year: 'numeric', month: 'long' });
};

export default function MonthPicker({ value, onChange, storageKey = 'selected_month' }: MonthPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [tempYear, setTempYear] = useState<number>(new Date().getFullYear());
  const [tempMonth, setTempMonth] = useState<number>(new Date().getMonth() + 1);

  // Initialize from localStorage or default to previous month
  useEffect(() => {
    if (!value) {
      const stored = localStorage.getItem(storageKey);
      const initial = stored || getPreviousMonth();
      onChange(initial);
    }
  }, []);

  // Parse current value when it changes
  useEffect(() => {
    if (value) {
      const [year, month] = value.split('-');
      setTempYear(parseInt(year));
      setTempMonth(parseInt(month));
    }
  }, [value]);

  // Save to localStorage when value changes
  useEffect(() => {
    if (value) {
      localStorage.setItem(storageKey, value);
    }
  }, [value, storageKey]);

  const handleApply = () => {
    const newValue = `${tempYear}-${String(tempMonth).padStart(2, '0')}`;
    onChange(newValue);
    setIsOpen(false);
  };

  const handleYearChange = (delta: number) => {
    setTempYear((prev) => prev + delta);
  };

  const handleMonthClick = (month: number) => {
    setTempMonth(month);
  };

  const months = [
    'ינואר',
    'פברואר',
    'מרץ',
    'אפריל',
    'מאי',
    'יוני',
    'יולי',
    'אוגוסט',
    'ספטמבר',
    'אוקטובר',
    'נובמבר',
    'דצמבר',
  ];

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
      >
        <span className="material-symbols-outlined text-slate-600 dark:text-slate-400">calendar_month</span>
        <span className="font-medium text-slate-900 dark:text-white">
          {value ? formatMonthDisplay(value) : 'בחר חודש'}
        </span>
        <span className="material-symbols-outlined text-slate-600 dark:text-slate-400">
          {isOpen ? 'expand_less' : 'expand_more'}
        </span>
      </button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />

          {/* Dropdown */}
          <div className="absolute left-0 mt-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg shadow-lg z-50 p-4 min-w-[320px]">
            {/* Year selector */}
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => handleYearChange(-1)}
                className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors"
              >
                <span className="material-symbols-outlined">chevron_right</span>
              </button>
              <span className="text-lg font-bold text-slate-900 dark:text-white">{tempYear}</span>
              <button
                onClick={() => handleYearChange(1)}
                className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors"
              >
                <span className="material-symbols-outlined">chevron_left</span>
              </button>
            </div>

            {/* Month grid */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              {months.map((monthName, index) => {
                const monthNum = index + 1;
                const isSelected = monthNum === tempMonth;
                return (
                  <button
                    key={monthNum}
                    onClick={() => handleMonthClick(monthNum)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isSelected
                        ? 'bg-primary text-white'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white hover:bg-slate-200 dark:hover:bg-slate-600'
                    }`}
                  >
                    {monthName}
                  </button>
                );
              })}
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={handleApply}
                className="flex-1 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors font-medium"
              >
                החל
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="flex-1 px-4 py-2 bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors font-medium"
              >
                ביטול
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
