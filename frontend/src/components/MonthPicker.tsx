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

const shiftMonth = (value: string, delta: number): string => {
  const [year, month] = value.split('-').map(Number);
  const date = new Date(year, (month || 1) - 1 + delta, 1);
  const nextYear = date.getFullYear();
  const nextMonth = String(date.getMonth() + 1).padStart(2, '0');
  return `${nextYear}-${nextMonth}`;
};

export default function MonthPicker({ value, onChange }: MonthPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [tempYear, setTempYear] = useState<number>(new Date().getFullYear());
  const [tempMonth, setTempMonth] = useState<number>(new Date().getMonth() + 1);

  // Parse current value when it changes
  useEffect(() => {
    if (value) {
      const [year, month] = value.split('-');
      setTempYear(parseInt(year));
      setTempMonth(parseInt(month));
    }
  }, [value]);

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

  const handleQuickChange = (delta: number) => {
    const baseValue = value || getPreviousMonth();
    const nextValue = shiftMonth(baseValue, delta);
    onChange(nextValue);
    const [year, month] = nextValue.split('-').map(Number);
    setTempYear(year);
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
      <div className="flex items-center gap-1 rounded-xl border border-slate-200/80 dark:border-slate-700 bg-white/90 dark:bg-slate-900/40 shadow-sm p-1">
        <button
          type="button"
          onClick={() => handleQuickChange(-1)}
          className="h-9 w-9 grid place-items-center rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-800/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          aria-label="Previous month"
          title="Previous month"
        >
          <span className="material-symbols-outlined text-[20px]">chevron_right</span>
        </button>

        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 px-3 h-9 rounded-lg text-sm font-semibold text-slate-900 dark:text-white hover:bg-slate-100/80 dark:hover:bg-slate-800/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <span className="material-symbols-outlined text-[19px] text-slate-500 dark:text-slate-400">calendar_month</span>
          <span className="font-medium text-slate-900 dark:text-white">
            {value ? formatMonthDisplay(value) : 'בחר חודש'}
          </span>
          <span className="material-symbols-outlined text-[18px] text-slate-500 dark:text-slate-400">
            {isOpen ? 'expand_less' : 'expand_more'}
          </span>
        </button>

        <button
          type="button"
          onClick={() => handleQuickChange(1)}
          className="h-9 w-9 grid place-items-center rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-800/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          aria-label="Next month"
          title="Next month"
        >
          <span className="material-symbols-outlined text-[20px]">chevron_left</span>
        </button>
      </div>


      {isOpen && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />

          {/* Dropdown */}
          <div className="absolute left-0 mt-3 bg-white/95 dark:bg-slate-900/90 backdrop-blur border border-slate-200/80 dark:border-slate-700 rounded-2xl shadow-xl z-50 p-4 min-w-[320px]">
            {/* Year selector */}
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => handleYearChange(-1)}
                className="h-8 w-8 grid place-items-center rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-800/70 transition-colors"
              >
                <span className="material-symbols-outlined">chevron_right</span>
              </button>
              <span className="text-lg font-bold text-slate-900 dark:text-white">{tempYear}</span>
              <button
                onClick={() => handleYearChange(1)}
                className="h-8 w-8 grid place-items-center rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100/80 dark:hover:bg-slate-800/70 transition-colors"
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
                        ? 'bg-primary text-white shadow-sm'
                        : 'bg-slate-100/80 dark:bg-slate-800 text-slate-900 dark:text-white hover:bg-slate-200/80 dark:hover:bg-slate-700/80'
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
                className="flex-1 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors font-semibold shadow-sm"
              >
                החל
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="flex-1 px-4 py-2 bg-slate-100/80 dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg hover:bg-slate-200/80 dark:hover:bg-slate-700/80 transition-colors font-semibold"
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
