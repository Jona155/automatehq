import { useState, useEffect, useMemo } from 'react';
import { getHoursMatrix } from '../api/workCards';
import type { MatrixData, Employee } from '../types';
import MonthPicker from './MonthPicker';

interface MonthlySummaryTabProps {
  siteId: string;
}

// Helper to get previous month in YYYY-MM format
const getPreviousMonth = (): string => {
  const now = new Date();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const year = prevMonth.getFullYear();
  const month = String(prevMonth.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

// Get number of days in a month
const getDaysInMonth = (yearMonth: string): number => {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(year, month, 0).getDate();
};

// Get Hebrew day name for a date
const getHebrewDayName = (yearMonth: string, day: number): string => {
  const [year, month] = yearMonth.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const dayNames = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
  return dayNames[date.getDay()];
};

// Status colors and labels
const STATUS_CONFIG: Record<string, { bg: string; text: string; label: string }> = {
  APPROVED: {
    bg: 'bg-green-100 dark:bg-green-900/40',
    text: 'text-green-800 dark:text-green-300',
    label: 'מאושר',
  },
  NEEDS_REVIEW: {
    bg: 'bg-yellow-100 dark:bg-yellow-900/40',
    text: 'text-yellow-800 dark:text-yellow-300',
    label: 'ממתין לסקירה',
  },
  NEEDS_ASSIGNMENT: {
    bg: 'bg-orange-100 dark:bg-orange-900/40',
    text: 'text-orange-800 dark:text-orange-300',
    label: 'ממתין לשיוך',
  },
  REJECTED: {
    bg: 'bg-red-100 dark:bg-red-900/40',
    text: 'text-red-800 dark:text-red-300',
    label: 'נדחה',
  },
  NO_UPLOAD: {
    bg: 'bg-slate-100 dark:bg-slate-800',
    text: 'text-slate-400 dark:text-slate-500',
    label: 'ללא העלאה',
  },
};

export default function MonthlySummaryTab({ siteId }: MonthlySummaryTabProps) {
  const [selectedMonth, setSelectedMonth] = useState<string>(getPreviousMonth());
  const [matrixData, setMatrixData] = useState<MatrixData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [includeInactive, setIncludeInactive] = useState(false);

  // Fetch matrix data when month or filters change
  useEffect(() => {
    const fetchMatrix = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await getHoursMatrix(siteId, selectedMonth, {
          approved_only: false, // Show all statuses for the summary
          include_inactive: includeInactive,
        });
        setMatrixData(data);
      } catch (err) {
        console.error('Failed to fetch matrix data:', err);
        setError('שגיאה בטעינת נתוני הסיכום');
      } finally {
        setIsLoading(false);
      }
    };

    if (siteId && selectedMonth) {
      fetchMatrix();
    }
  }, [siteId, selectedMonth, includeInactive]);

  // Generate days array for the selected month
  const daysInMonth = useMemo(() => {
    const numDays = getDaysInMonth(selectedMonth);
    return Array.from({ length: numDays }, (_, i) => i + 1);
  }, [selectedMonth]);

  // Get status for an employee
  const getEmployeeStatus = (employeeId: string): string => {
    if (!matrixData?.status_map) return 'NO_UPLOAD';
    return matrixData.status_map[employeeId] || 'NO_UPLOAD';
  };

  // Get cell background color based on status
  const getCellStyle = (employeeId: string) => {
    const status = getEmployeeStatus(employeeId);
    const config = STATUS_CONFIG[status] || STATUS_CONFIG.NO_UPLOAD;
    return config;
  };

  // Calculate total hours for an employee
  const getEmployeeTotalHours = (employeeId: string): number => {
    if (!matrixData?.matrix[employeeId]) return 0;
    return Object.values(matrixData.matrix[employeeId]).reduce((sum, hours) => sum + hours, 0);
  };

  // Calculate total hours for a day across all employees
  const getDayTotalHours = (day: number): number => {
    if (!matrixData?.matrix) return 0;
    return Object.values(matrixData.matrix).reduce((sum, days) => sum + (days[day] || 0), 0);
  };

  // Calculate grand total
  const grandTotal = useMemo(() => {
    if (!matrixData?.employees) return 0;
    return matrixData.employees.reduce((sum, emp) => sum + getEmployeeTotalHours(emp.id), 0);
  }, [matrixData]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between flex-wrap gap-4">
        <h2 className="text-lg font-bold">סיכום חודשי</h2>
        <div className="flex items-center gap-4">
          {/* Include Inactive Toggle */}
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-primary focus:ring-primary"
            />
            <span>הצג עובדים לא פעילים</span>
          </label>
          
          {/* Month Picker */}
          <MonthPicker
            value={selectedMonth}
            onChange={setSelectedMonth}
            storageKey={`summary_month_${siteId}`}
          />
        </div>
      </div>

      {/* Legend */}
      <div className="px-6 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center gap-4 flex-wrap">
        <span className="text-sm font-medium text-slate-600 dark:text-slate-400">מקרא:</span>
        {Object.entries(STATUS_CONFIG).map(([status, config]) => (
          <div key={status} className="flex items-center gap-1.5">
            <div className={`w-4 h-4 rounded ${config.bg}`} />
            <span className="text-xs text-slate-600 dark:text-slate-400">{config.label}</span>
          </div>
        ))}
      </div>

      {/* Matrix Table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <span className="material-symbols-outlined text-3xl text-slate-400 animate-spin">
              progress_activity
            </span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-64 text-center p-4">
            <span className="material-symbols-outlined text-4xl text-red-400 mb-2">error</span>
            <p className="text-red-500">{error}</p>
          </div>
        ) : !matrixData || matrixData.employees.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center p-4">
            <span className="material-symbols-outlined text-4xl text-slate-300 dark:text-slate-600 mb-2">
              table_chart
            </span>
            <p className="text-slate-500 dark:text-slate-400">אין עובדים באתר זה</p>
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-20 bg-white dark:bg-slate-800">
              <tr>
                {/* Day column header - sticky */}
                <th className="sticky right-0 z-30 bg-slate-100 dark:bg-slate-900 px-3 py-3 text-center font-bold border-b border-l border-slate-200 dark:border-slate-700 min-w-[60px]">
                  יום
                </th>
                {/* Employee column headers */}
                {matrixData.employees.map((employee) => {
                  const status = getEmployeeStatus(employee.id);
                  const config = STATUS_CONFIG[status] || STATUS_CONFIG.NO_UPLOAD;
                  return (
                    <th
                      key={employee.id}
                      className={`px-2 py-3 text-center font-medium border-b border-l border-slate-200 dark:border-slate-700 min-w-[100px] ${config.bg}`}
                    >
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-slate-900 dark:text-white text-xs truncate max-w-[90px]">
                          {employee.full_name}
                        </span>
                        <span className={`text-[10px] ${config.text}`}>{config.label}</span>
                      </div>
                    </th>
                  );
                })}
                {/* Total column header */}
                <th className="px-3 py-3 text-center font-bold border-b border-slate-200 dark:border-slate-700 min-w-[70px] bg-slate-100 dark:bg-slate-900">
                  סה״כ יום
                </th>
              </tr>
            </thead>
            <tbody>
              {daysInMonth.map((day) => (
                <tr key={day} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50">
                  {/* Day cell - sticky */}
                  <td className="sticky right-0 z-10 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-center font-medium border-b border-l border-slate-200 dark:border-slate-700">
                    <div className="flex flex-col items-center">
                      <span className="text-slate-900 dark:text-white">{day}</span>
                      <span className="text-[10px] text-slate-400">
                        {getHebrewDayName(selectedMonth, day)}
                      </span>
                    </div>
                  </td>
                  {/* Hours cells */}
                  {matrixData.employees.map((employee) => {
                    const hours = matrixData.matrix[employee.id]?.[day];
                    const config = getCellStyle(employee.id);
                    return (
                      <td
                        key={employee.id}
                        className={`px-2 py-2 text-center border-b border-l border-slate-200 dark:border-slate-700 ${config.bg}`}
                      >
                        {hours !== undefined && hours !== null ? (
                          <span className={`font-medium ${config.text}`}>
                            {hours.toFixed(1)}
                          </span>
                        ) : (
                          <span className="text-slate-300 dark:text-slate-600">-</span>
                        )}
                      </td>
                    );
                  })}
                  {/* Day total cell */}
                  <td className="px-3 py-2 text-center font-medium border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
                    {getDayTotalHours(day) > 0 ? getDayTotalHours(day).toFixed(1) : '-'}
                  </td>
                </tr>
              ))}
              {/* Totals row */}
              <tr className="sticky bottom-0 z-10 bg-slate-100 dark:bg-slate-900 font-bold">
                <td className="sticky right-0 z-20 bg-slate-200 dark:bg-slate-800 px-3 py-3 text-center border-t-2 border-l border-slate-300 dark:border-slate-600">
                  סה״כ
                </td>
                {matrixData.employees.map((employee) => {
                  const total = getEmployeeTotalHours(employee.id);
                  const config = getCellStyle(employee.id);
                  return (
                    <td
                      key={employee.id}
                      className={`px-2 py-3 text-center border-t-2 border-l border-slate-300 dark:border-slate-600 ${config.bg}`}
                    >
                      <span className={config.text}>{total > 0 ? total.toFixed(1) : '-'}</span>
                    </td>
                  );
                })}
                <td className="px-3 py-3 text-center border-t-2 border-slate-300 dark:border-slate-600 bg-slate-200 dark:bg-slate-800">
                  {grandTotal > 0 ? grandTotal.toFixed(1) : '-'}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {/* Summary Footer */}
      {matrixData && matrixData.employees.length > 0 && (
        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between text-sm text-slate-600 dark:text-slate-400">
          <span>
            {matrixData.employees.length} עובדים | {daysInMonth.length} ימים
          </span>
          <span className="font-medium">
            סה״כ שעות בחודש: <span className="text-primary">{grandTotal.toFixed(1)}</span>
          </span>
        </div>
      )}
    </div>
  );
}
