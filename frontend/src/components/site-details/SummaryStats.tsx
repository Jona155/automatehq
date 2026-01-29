export interface SummaryStatsData {
  uploaded: number;
  pending: number;
  failed: number;
  approved: number;
}

interface SummaryStatsProps {
  stats: SummaryStatsData;
}

export default function SummaryStats({ stats }: SummaryStatsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
            <span className="material-symbols-outlined text-blue-600 dark:text-blue-400">upload</span>
          </div>
          <div>
            <p className="text-sm text-slate-600 dark:text-slate-400">הועלו</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.uploaded}</p>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center">
            <span className="material-symbols-outlined text-yellow-600 dark:text-yellow-400">pending</span>
          </div>
          <div>
            <p className="text-sm text-slate-600 dark:text-slate-400">בטיפול</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.pending}</p>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <span className="material-symbols-outlined text-red-600 dark:text-red-400">error</span>
          </div>
          <div>
            <p className="text-sm text-slate-600 dark:text-slate-400">נכשלו</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.failed}</p>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
            <span className="material-symbols-outlined text-green-600 dark:text-green-400">check_circle</span>
          </div>
          <div>
            <p className="text-sm text-slate-600 dark:text-slate-400">אושרו</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.approved}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
