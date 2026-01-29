import { useState, useEffect } from 'react';
import type { MatrixData } from '../../types';
import { getHoursMatrix } from '../../api/workCards';

interface MatrixTabProps {
  siteId: string;
  selectedMonth: string;
  showToast: (message: string, type: 'success' | 'error') => void;
}

export default function MatrixTab({ siteId, selectedMonth, showToast }: MatrixTabProps) {
  const [matrixData, setMatrixData] = useState<MatrixData | null>(null);
  const [matrixApprovedOnly, setMatrixApprovedOnly] = useState(true);
  const [matrixIncludeInactive, setMatrixIncludeInactive] = useState(false);
  const [isLoadingMatrix, setIsLoadingMatrix] = useState(false);

  useEffect(() => {
    if (selectedMonth && siteId) {
      fetchMatrixData();
    }
  }, [selectedMonth, siteId, matrixApprovedOnly, matrixIncludeInactive]);

  const fetchMatrixData = async () => {
    setIsLoadingMatrix(true);
    try {
      const data = await getHoursMatrix(siteId, selectedMonth, {
        approved_only: matrixApprovedOnly,
        include_inactive: matrixIncludeInactive,
      });
      setMatrixData(data);
    } catch (err) {
      console.error('Failed to fetch matrix data:', err);
      showToast('שגיאה בטעינת מטריצת שעות', 'error');
    } finally {
      setIsLoadingMatrix(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Controls */}
      <div className="bg-white dark:bg-slate-800 p-4 rounded-lg shadow-sm border border-slate-200 dark:border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={matrixApprovedOnly}
              onChange={(e) => setMatrixApprovedOnly(e.target.checked)}
            />
            <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:-translate-x-full rtl:peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:right-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
            <span className="mr-3 text-sm font-medium text-slate-700 dark:text-slate-300">הצג מאושרים בלבד</span>
          </label>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={matrixIncludeInactive}
              onChange={(e) => setMatrixIncludeInactive(e.target.checked)}
            />
            <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:-translate-x-full rtl:peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:right-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
            <span className="mr-3 text-sm font-medium text-slate-700 dark:text-slate-300">כולל עובדים לא פעילים</span>
          </label>
        </div>
        <div className="flex items-center gap-4 text-xs font-medium text-slate-500">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"></div>
            <span>ריק</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"></div>
            <span>חולץ</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-emerald-100 dark:bg-emerald-900/40 border border-emerald-200 dark:border-emerald-800"></div>
            <span>אושר</span>
          </div>
        </div>
      </div>

      {/* Matrix Table */}
      <div className="flex-1 overflow-hidden bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-slate-200 dark:border-slate-800 flex flex-col">
        {isLoadingMatrix ? (
          <div className="flex-1 flex items-center justify-center p-12">
            <span className="material-symbols-outlined text-4xl text-slate-400 animate-spin">progress_activity</span>
          </div>
        ) : !matrixData || matrixData.employees.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-12 text-center text-slate-500">
            <div>
              <span className="material-symbols-outlined text-5xl mb-4">grid_on</span>
              <p>אין נתונים להצגה</p>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-auto" style={{ maxHeight: 'calc(100vh - 500px)' }}>
            <table className="w-full text-sm border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="sticky right-0 top-0 z-30 bg-slate-50 dark:bg-slate-800 px-4 py-3 text-right font-bold border-b border-l border-slate-200 dark:border-slate-700">
                    יום
                  </th>
                  {matrixData.employees.map((employee) => (
                    <th
                      key={employee.id}
                      className="sticky top-0 z-20 min-w-[120px] bg-slate-50 dark:bg-slate-800 px-4 py-3 text-center font-bold border-b border-slate-200 dark:border-slate-700"
                    >
                      {employee.full_name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                  <tr key={day} className="group hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="sticky right-0 z-10 px-4 py-2 text-right font-medium border-l border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 group-hover:bg-slate-50 dark:group-hover:bg-slate-800/50">
                      {day}
                    </td>
                    {matrixData.employees.map((employee) => {
                      const hours = matrixData.matrix[employee.id]?.[day];
                      const hasHours = hours !== undefined && hours !== null;
                      const cellClass = hasHours
                        ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 font-medium'
                        : 'bg-slate-50/50 dark:bg-slate-800/30 text-slate-400';

                      return (
                        <td
                          key={employee.id}
                          className="relative p-0 border-b border-slate-100 dark:border-slate-800 group/cell"
                        >
                          <div
                            className={`w-full h-12 flex items-center justify-center transition-all hover:ring-2 hover:ring-primary hover:z-10 ${cellClass}`}
                            title={hasHours ? `${hours} שעות` : 'אין נתונים'}
                          >
                            {hasHours ? hours.toFixed(1) : '-'}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
