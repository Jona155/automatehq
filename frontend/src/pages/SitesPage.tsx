import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Site } from '../types';
import {
  getSites,
  createSite,
  downloadMonthlySummaryBatch,
  downloadSalaryTemplateBatch,
} from '../api/sites';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../hooks/useToast';
import { usePermissions } from '../hooks/usePermissions';
import MonthPicker from '../components/MonthPicker';
import Modal from '../components/Modal';
import LoadingIndicator from '../components/LoadingIndicator';
import { downloadBlobFile } from '../utils/fileDownload';
import BatchUploadModal from '../components/BatchUploadModal';
import SiteTariffImportModal from '../components/SiteTariffImportModal';
import { downloadSiteTariffsExport } from '../api/siteTariffImport';
import { getDefaultMonth } from '../utils/monthUtils';

type SortField = 'site_name' | 'site_code' | 'employee_count' | 'is_active';
type SortOrder = 'asc' | 'desc';
type StatusFilter = 'all' | 'active' | 'inactive';

type MetricTone = 'accent' | 'ok' | 'neutral';

const TONE_CLASSES: Record<MetricTone, { bg: string; fg: string }> = {
  accent: {
    bg: 'bg-blue-50 dark:bg-blue-500/10',
    fg: 'text-blue-700 dark:text-blue-300',
  },
  ok: {
    bg: 'bg-emerald-50 dark:bg-emerald-500/10',
    fg: 'text-emerald-700 dark:text-emerald-300',
  },
  neutral: {
    bg: 'bg-slate-100 dark:bg-slate-700/50',
    fg: 'text-slate-700 dark:text-slate-300',
  },
};

function MetricCard({
  label,
  value,
  sublabel,
  icon,
  tone,
}: {
  label: string;
  value: number | string;
  sublabel?: string;
  icon: string;
  tone: MetricTone;
}) {
  const t = TONE_CLASSES[tone];
  return (
    <div className="flex items-center gap-3 p-4 bg-white dark:bg-[#1a2a35] border border-slate-200/70 dark:border-slate-700/60 rounded-xl">
      <div className={`w-10 h-10 rounded-lg grid place-items-center flex-shrink-0 ${t.bg} ${t.fg}`}>
        <span className="material-symbols-outlined text-lg">{icon}</span>
      </div>
      <div className="min-w-0 flex-1 flex flex-col gap-0.5">
        <div className="flex items-baseline gap-1.5 flex-wrap leading-none">
          <span className="text-2xl font-semibold text-slate-900 dark:text-white tabular-nums tracking-tight leading-none">
            {value}
          </span>
          {sublabel && (
            <span className="text-[11.5px] text-slate-500 dark:text-slate-400 font-medium tabular-nums leading-none">
              {sublabel}
            </span>
          )}
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400 leading-tight">{label}</div>
      </div>
    </div>
  );
}

function StatusPill({ active }: { active: boolean }) {
  if (active) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        פעיל
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300">
      <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
      לא פעיל
    </span>
  );
}

function CodeCell({ code }: { code?: string | null }) {
  if (code) {
    return (
      <span className="inline-block px-2 py-0.5 bg-slate-100 dark:bg-slate-900/60 text-slate-700 dark:text-slate-300 rounded text-[12.5px] font-mono">
        {code}
      </span>
    );
  }
  return <span className="text-slate-400 dark:text-slate-500 italic text-[12.5px]">לא הוגדר</span>;
}

export default function SitesPage() {
  const { isAuthenticated, user } = useAuth();
  const { isAdmin } = usePermissions();
  const [sites, setSites] = useState<Site[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({ site_name: '', site_code: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [filterName, setFilterName] = useState('');
  const [filterCode, setFilterCode] = useState('');
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('all');
  const [sortField, setSortField] = useState<SortField>('site_name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [summaryExportOpen, setSummaryExportOpen] = useState(false);
  const [summaryExportMonth, setSummaryExportMonth] = useState(() => getDefaultMonth(user?.business?.default_month_cutoff_day));
  const [isSummaryExporting, setIsSummaryExporting] = useState(false);
  const [summaryExportError, setSummaryExportError] = useState<string | null>(null);
  const [salaryExportOpen, setSalaryExportOpen] = useState(false);
  const [salaryExportMonth, setSalaryExportMonth] = useState(() => getDefaultMonth(user?.business?.default_month_cutoff_day));
  const [isSalaryExporting, setIsSalaryExporting] = useState(false);
  const [salaryExportError, setSalaryExportError] = useState<string | null>(null);
  const [globalUploadOpen, setGlobalUploadOpen] = useState(false);
  const [tariffImportOpen, setTariffImportOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [isTariffExporting, setIsTariffExporting] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();
  const { showToast, ToastContainer } = useToast();

  useEffect(() => {
    if (!exportMenuOpen) return;
    const handlePointer = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExportMenuOpen(false);
    };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [exportMenuOpen]);

  const fetchSites = async () => {
    setIsLoading(true);
    try {
      const data = await getSites({ active: false }); // Get all sites including inactive
      setSites(data);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch sites:', err);
      setError('שגיאה בטעינת אתרים');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchSites();
  }, [isAuthenticated]);

  const totalSitesAll = sites.length;
  const activeCount = useMemo(() => sites.filter((s) => s.is_active).length, [sites]);
  const inactiveCount = totalSitesAll - activeCount;
  const activeEmployees = useMemo(
    () => sites.filter((s) => s.is_active).reduce((sum, s) => sum + (s.employee_count ?? 0), 0),
    [sites]
  );
  const activePct = totalSitesAll > 0 ? Math.round((activeCount / totalSitesAll) * 100) : 0;

  const filteredSites = useMemo(() => {
    return sites.filter((site) => {
      const matchesName = !filterName || site.site_name.toLowerCase().includes(filterName.toLowerCase());
      const matchesCode = !filterCode || (site.site_code || '').toLowerCase().includes(filterCode.toLowerCase());
      const matchesStatus =
        filterStatus === 'all' || (filterStatus === 'active' ? site.is_active : !site.is_active);
      return matchesName && matchesCode && matchesStatus;
    });
  }, [sites, filterName, filterCode, filterStatus]);

  const sortedSites = useMemo(() => {
    const sorted = [...filteredSites];
    sorted.sort((a, b) => {
      let comparison = 0;
      if (sortField === 'employee_count') {
        const aVal = a.employee_count ?? -1;
        const bVal = b.employee_count ?? -1;
        comparison = aVal - bVal;
      } else if (sortField === 'is_active') {
        const aVal = a.is_active ? 1 : 0;
        const bVal = b.is_active ? 1 : 0;
        comparison = aVal - bVal;
      } else {
        const aVal = sortField === 'site_code' ? a.site_code || '' : a.site_name;
        const bVal = sortField === 'site_code' ? b.site_code || '' : b.site_name;
        comparison = aVal.localeCompare(bVal, 'he');
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });
    return sorted;
  }, [filteredSites, sortField, sortOrder]);

  const totalSites = sortedSites.length;
  const totalPages = Math.max(1, Math.ceil(totalSites / pageSize));

  const paginatedSites = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return sortedSites.slice(startIndex, startIndex + pageSize);
  }, [sortedSites, currentPage, pageSize]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filterName, filterCode, filterStatus, sortField, sortOrder, pageSize]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const hasActiveFilter = filterStatus !== 'all' || !!filterName || !!filterCode;
  const clearFilters = () => {
    setFilterName('');
    setFilterCode('');
    setFilterStatus('all');
  };

  const handleOpenCreate = () => {
    setFormData({ site_name: '', site_code: '' });
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleOpenSummaryExport = () => {
    setSummaryExportError(null);
    setSummaryExportMonth(getDefaultMonth(user?.business?.default_month_cutoff_day));
    setSummaryExportOpen(true);
  };

  const handleDownloadSummaryBatch = async () => {
    if (!summaryExportMonth) {
      setSummaryExportError('יש לבחור חודש לייצוא.');
      return;
    }
    setIsSummaryExporting(true);
    setSummaryExportError(null);
    try {
      const blob = await downloadMonthlySummaryBatch(summaryExportMonth, {
        approved_only: false,
        include_inactive: false,
        include_inactive_sites: false,
      });
      downloadBlobFile(blob, `monthly_summary_all_sites_${summaryExportMonth}.xlsx`);
      setSummaryExportOpen(false);
    } catch (err: any) {
      console.error('Failed to export summary batch:', err);
      setSummaryExportError(err?.response?.data?.message || 'שגיאה בהורדת הסיכום');
    } finally {
      setIsSummaryExporting(false);
    }
  };

  const handleOpenSalaryExport = () => {
    setSalaryExportError(null);
    setSalaryExportMonth(getDefaultMonth(user?.business?.default_month_cutoff_day));
    setSalaryExportOpen(true);
  };

  const handleDownloadSalaryBatch = async () => {
    if (!salaryExportMonth) {
      setSalaryExportError('יש לבחור חודש לייצוא.');
      return;
    }
    setIsSalaryExporting(true);
    setSalaryExportError(null);
    try {
      const blob = await downloadSalaryTemplateBatch(salaryExportMonth, {
        include_inactive: false,
        include_inactive_sites: false,
      });
      downloadBlobFile(blob, `salary_template_all_sites_${salaryExportMonth}.xlsx`);
      setSalaryExportOpen(false);
    } catch (err: any) {
      console.error('Failed to export salary batch:', err);
      setSalaryExportError(err?.response?.data?.message || 'שגיאה בהורדת תבנית שכר');
    } finally {
      setIsSalaryExporting(false);
    }
  };

  const handleDownloadTariffsExport = async () => {
    setExportMenuOpen(false);
    setIsTariffExporting(true);
    try {
      const blob = await downloadSiteTariffsExport({ include_inactive: true });
      downloadBlobFile(blob, 'site_details.xlsx');
      showToast('קובץ פרטי האתרים הורד בהצלחה', 'success');
    } catch (err: any) {
      console.error('Failed to export site details:', err);
      showToast(err?.response?.data?.message || 'שגיאה בהורדת פרטי האתרים', 'error');
    } finally {
      setIsTariffExporting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.site_name.trim()) {
      setFormError('שם אתר הוא שדה חובה');
      return;
    }
    setIsSubmitting(true);
    setFormError(null);
    try {
      await createSite({
        site_name: formData.site_name.trim(),
        site_code: formData.site_code.trim() || undefined,
      });
      setIsModalOpen(false);
      fetchSites();
    } catch (err: any) {
      console.error('Failed to create site:', err);
      setFormError(err.response?.data?.message || 'שגיאה ביצירת אתר');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRowClick = (siteId: string) => {
    navigate(`/${user?.business?.code}/sites/${siteId}`);
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) {
      return (
        <span className="inline-flex flex-col leading-[0.6] text-slate-300 dark:text-slate-600">
          <span className="material-symbols-outlined text-[10px] -mb-0.5">expand_less</span>
          <span className="material-symbols-outlined text-[10px] -mt-0.5">expand_more</span>
        </span>
      );
    }
    return (
      <span className="inline-flex flex-col leading-[0.6]">
        <span
          className={`material-symbols-outlined text-[10px] -mb-0.5 ${
            sortOrder === 'asc' ? 'text-slate-700 dark:text-slate-200' : 'text-slate-300 dark:text-slate-600'
          }`}
        >
          expand_less
        </span>
        <span
          className={`material-symbols-outlined text-[10px] -mt-0.5 ${
            sortOrder === 'desc' ? 'text-slate-700 dark:text-slate-200' : 'text-slate-300 dark:text-slate-600'
          }`}
        >
          expand_more
        </span>
      </span>
    );
  };

  const segOptions: { id: StatusFilter; label: string; count: number }[] = [
    { id: 'all', label: 'הכל', count: totalSitesAll },
    { id: 'active', label: 'פעילים', count: activeCount },
    { id: 'inactive', label: 'לא פעילים', count: inactiveCount },
  ];

  return (
    <div className="flex flex-col gap-0">
      <ToastContainer />

      {/* ─── Header ─── */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-5">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-white tracking-tight">ניהול אתרים</h1>
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 tabular-nums">
              {totalSitesAll}
            </span>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">נהל את אתרי העבודה שלך בארגון</p>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <div className="relative" ref={exportMenuRef}>
              <button
                onClick={() => setExportMenuOpen((v) => !v)}
                disabled={isTariffExporting}
                aria-haspopup="menu"
                aria-expanded={exportMenuOpen}
                className="h-9 px-3.5 inline-flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <span className="material-symbols-outlined text-base">
                  {isTariffExporting ? 'progress_activity' : 'download'}
                </span>
                ייצוא Excel
                <span className="material-symbols-outlined text-base -mx-1">expand_more</span>
              </button>
              {exportMenuOpen && (
                <div
                  role="menu"
                  className="absolute end-0 mt-1.5 w-64 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg shadow-slate-900/5 dark:shadow-black/30 py-1 z-20"
                >
                  <button
                    role="menuitem"
                    onClick={() => {
                      setExportMenuOpen(false);
                      handleOpenSummaryExport();
                    }}
                    className="w-full text-right px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60 inline-flex items-center gap-2.5"
                  >
                    <span className="material-symbols-outlined text-base text-slate-500 dark:text-slate-400">summarize</span>
                    סיכום אתרים (xlsx)
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setExportMenuOpen(false);
                      handleOpenSalaryExport();
                    }}
                    className="w-full text-right px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60 inline-flex items-center gap-2.5"
                  >
                    <span className="material-symbols-outlined text-base text-slate-500 dark:text-slate-400">request_quote</span>
                    תבנית שכר ל-wave
                  </button>
                  <div className="my-1 h-px bg-slate-100 dark:bg-slate-700/60" />
                  <button
                    role="menuitem"
                    onClick={handleDownloadTariffsExport}
                    disabled={isTariffExporting}
                    className="w-full text-right px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60 inline-flex items-center gap-2.5 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <span className="material-symbols-outlined text-base text-slate-500 dark:text-slate-400">price_change</span>
                    פרטי אתרים (xlsx)
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={() => setTariffImportOpen(true)}
              className="h-9 px-3.5 inline-flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-colors"
            >
              <span className="material-symbols-outlined text-base">upload_file</span>
              ייבוא פרטי אתר
            </button>
            <button
              onClick={() => setGlobalUploadOpen(true)}
              className="h-9 px-3.5 inline-flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-colors"
            >
              <span className="material-symbols-outlined text-base">cloud_upload</span>
              העלאת כרטיסי עבודה
            </button>
            <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-1" />
            <button
              onClick={handleOpenCreate}
              className="h-9 px-4 inline-flex items-center gap-2 text-sm font-semibold text-white bg-primary hover:bg-primary/90 rounded-lg shadow-sm shadow-primary/20 transition-colors"
            >
              <span className="material-symbols-outlined text-base">add</span>
              יצירת אתר
            </button>
          </div>
        )}
      </div>

      {/* ─── Metric strip ─── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <MetricCard label="סה״כ אתרים" value={totalSitesAll} icon="apartment" tone="accent" />
        <MetricCard
          label="אתרים פעילים"
          value={activeCount}
          sublabel={totalSitesAll > 0 ? `${activePct}%` : undefined}
          icon="check_circle"
          tone="ok"
        />
        <MetricCard label="אתרים לא פעילים" value={inactiveCount} icon="block" tone="neutral" />
        <MetricCard
          label="עובדים פעילים"
          value={activeEmployees}
          sublabel={`ב-${activeCount} אתרים`}
          icon="groups"
          tone="ok"
        />
      </div>

      {/* ─── Filter row ─── */}
      <div className="flex items-center gap-3 flex-wrap p-3 bg-white dark:bg-[#1a2a35] border border-slate-200/70 dark:border-slate-700/60 rounded-xl mb-3.5">
        <div className="inline-flex p-0.5 bg-slate-100 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-lg flex-shrink-0">
          {segOptions.map((o) => {
            const active = filterStatus === o.id;
            return (
              <button
                key={o.id}
                onClick={() => setFilterStatus(o.id)}
                className={`px-3 py-1.5 rounded-md text-[12.5px] inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-semibold shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 font-medium hover:text-slate-700 dark:hover:text-slate-200'
                }`}
              >
                <span>{o.label}</span>
                <span
                  className={`text-[11px] tabular-nums font-medium ${
                    active ? 'text-slate-500 dark:text-slate-400' : 'text-slate-400 dark:text-slate-500'
                  }`}
                >
                  {o.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="w-px h-6 bg-slate-200 dark:bg-slate-700" />

        <div className="relative flex-1 min-w-[200px] max-w-[320px]">
          <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 text-base pointer-events-none">
            search
          </span>
          <input
            type="text"
            value={filterName}
            onChange={(e) => setFilterName(e.target.value)}
            placeholder="חיפוש לפי שם אתר…"
            className="w-full h-9 pr-10 pl-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[13px] text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
          />
        </div>

        <input
          type="text"
          value={filterCode}
          onChange={(e) => setFilterCode(e.target.value)}
          placeholder="קוד אתר"
          className="w-44 h-9 px-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[13px] text-slate-900 dark:text-white placeholder:text-slate-400 font-mono outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
        />

        <span className="flex-1" />

        {hasActiveFilter && (
          <button
            onClick={clearFilters}
            className="text-[12.5px] text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 px-2.5 py-1.5 rounded-md inline-flex items-center gap-1 transition-colors"
          >
            <span className="material-symbols-outlined text-[14px]">close</span>
            נקה סינון
          </button>
        )}
      </div>

      {/* ─── Table card ─── */}
      <div className="bg-white dark:bg-[#1a2a35] rounded-xl shadow-sm border border-slate-200/70 dark:border-slate-700/60 overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-slate-500">טוען אתרים...</div>
        ) : error ? (
          <div className="p-12 text-center text-red-500">{error}</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="bg-slate-50/60 dark:bg-slate-800/50">
                    <th
                      onClick={() => handleSort('site_name')}
                      className={`px-4 py-3 text-[11.5px] font-medium tracking-wide cursor-pointer select-none border-b border-slate-200 dark:border-slate-700/60 hover:bg-slate-100/60 dark:hover:bg-slate-800/80 transition-colors ${
                        sortField === 'site_name'
                          ? 'text-slate-900 dark:text-white'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      <span className="inline-flex items-center gap-1">
                        שם אתר
                        <SortIcon field="site_name" />
                      </span>
                    </th>
                    <th
                      onClick={() => handleSort('site_code')}
                      style={{ width: 120 }}
                      className={`px-4 py-3 text-[11.5px] font-medium tracking-wide cursor-pointer select-none border-b border-slate-200 dark:border-slate-700/60 hover:bg-slate-100/60 dark:hover:bg-slate-800/80 transition-colors ${
                        sortField === 'site_code'
                          ? 'text-slate-900 dark:text-white'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      <span className="inline-flex items-center gap-1">
                        קוד
                        <SortIcon field="site_code" />
                      </span>
                    </th>
                    <th
                      onClick={() => handleSort('employee_count')}
                      style={{ width: 130 }}
                      className={`px-4 py-3 text-[11.5px] font-medium tracking-wide cursor-pointer select-none border-b border-slate-200 dark:border-slate-700/60 hover:bg-slate-100/60 dark:hover:bg-slate-800/80 transition-colors ${
                        sortField === 'employee_count'
                          ? 'text-slate-900 dark:text-white'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      <span className="inline-flex items-center gap-1">
                        עובדים
                        <SortIcon field="employee_count" />
                      </span>
                    </th>
                    <th
                      onClick={() => handleSort('is_active')}
                      style={{ width: 120 }}
                      className={`px-4 py-3 text-[11.5px] font-medium tracking-wide cursor-pointer select-none border-b border-slate-200 dark:border-slate-700/60 hover:bg-slate-100/60 dark:hover:bg-slate-800/80 transition-colors ${
                        sortField === 'is_active'
                          ? 'text-slate-900 dark:text-white'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      <span className="inline-flex items-center gap-1">
                        סטטוס
                        <SortIcon field="is_active" />
                      </span>
                    </th>
                    <th
                      style={{ width: 80 }}
                      className="px-4 py-3 border-b border-slate-200 dark:border-slate-700/60 bg-slate-50/60 dark:bg-slate-800/50"
                    />
                  </tr>
                </thead>
                <tbody>
                  {paginatedSites.map((site) => {
                    const empty = !site.employee_count;
                    return (
                      <tr
                        key={site.id}
                        onClick={() => handleRowClick(site.id)}
                        className="group cursor-pointer hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="px-4 py-3 border-b border-slate-100 dark:border-slate-700/40 text-[13.5px] font-medium text-slate-900 dark:text-white">
                          {site.site_name}
                        </td>
                        <td className="px-4 py-3 border-b border-slate-100 dark:border-slate-700/40">
                          <CodeCell code={site.site_code} />
                        </td>
                        <td className="px-4 py-3 border-b border-slate-100 dark:border-slate-700/40 tabular-nums">
                          <span className="inline-flex items-baseline gap-1">
                            <span
                              className={`text-[13.5px] font-medium ${
                                empty ? 'text-slate-400 dark:text-slate-500' : 'text-slate-900 dark:text-white'
                              }`}
                            >
                              {site.employee_count ?? 0}
                            </span>
                            <span className="text-xs text-slate-500 dark:text-slate-400">עובדים</span>
                          </span>
                        </td>
                        <td className="px-4 py-3 border-b border-slate-100 dark:border-slate-700/40">
                          <StatusPill active={site.is_active} />
                        </td>
                        <td className="px-3 py-2 border-b border-slate-100 dark:border-slate-700/40 text-left">
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex gap-0.5">
                            <button
                              title="צפייה"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRowClick(site.id);
                              }}
                              className="w-7 h-7 rounded-md grid place-items-center hover:bg-slate-100 dark:hover:bg-slate-700/60 text-slate-500 dark:text-slate-400"
                            >
                              <span className="material-symbols-outlined text-base">visibility</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {sortedSites.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-12 text-center text-slate-500">
                        {hasActiveFilter ? 'לא נמצאו אתרים התואמים את הסינון' : 'לא נמצאו אתרים'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* ─── Pagination footer ─── */}
            {sortedSites.length > 0 && (
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 px-4 py-3 border-t border-slate-200 dark:border-slate-700/60 text-[13px] text-slate-500 dark:text-slate-400">
                <div className="flex items-center gap-3">
                  <span>
                    מציג <b className="text-slate-900 dark:text-white tabular-nums">{paginatedSites.length}</b> מתוך{' '}
                    <b className="text-slate-900 dark:text-white tabular-nums">{totalSites}</b> אתרים
                  </span>
                  <div className="w-px h-4 bg-slate-200 dark:bg-slate-700" />
                  <label className="inline-flex items-center gap-1.5">
                    <span>שורות לעמוד</span>
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setCurrentPage(1);
                      }}
                      className="px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[12.5px] text-slate-900 dark:text-white tabular-nums cursor-pointer outline-none focus:border-primary"
                    >
                      {[10, 25, 50, 100].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="w-8 h-8 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 grid place-items-center text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <span className="material-symbols-outlined text-base">chevron_right</span>
                  </button>
                  <span className="px-2 text-[13px] text-slate-900 dark:text-white tabular-nums">
                    {currentPage} / {totalPages}
                  </span>
                  <button
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="w-8 h-8 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 grid place-items-center text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <span className="material-symbols-outlined text-base">chevron_left</span>
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ─── Summary export modal ─── */}
      <Modal
        isOpen={summaryExportOpen}
        onClose={() => setSummaryExportOpen(false)}
        title="הורדת סיכום אתרים (Excel)"
        maxWidth="sm"
      >
        <div className="flex flex-col gap-4" dir="rtl">
          {summaryExportError && !isSummaryExporting && (
            <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100">
              {summaryExportError}
            </div>
          )}
          {isSummaryExporting ? (
            <LoadingIndicator title="מכין קובץ Excel..." subtitle="התהליך יכול לקחת עד דקה" />
          ) : (
            <>
              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">חודש לייצוא</label>
                <div className="inline-flex">
                  <MonthPicker
                    value={summaryExportMonth}
                    onChange={setSummaryExportMonth}
                    storageKey="sites_summary_export_month"
                  />
                </div>
              </div>
              <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setSummaryExportOpen(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700 rounded-lg transition-colors font-medium"
                  disabled={isSummaryExporting}
                >
                  ביטול
                </button>
                <button
                  type="button"
                  onClick={handleDownloadSummaryBatch}
                  disabled={isSummaryExporting}
                  className="px-6 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg transition-colors font-bold shadow-lg shadow-primary/30 disabled:opacity-50"
                >
                  {isSummaryExporting ? 'מוריד...' : 'הורד Excel'}
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* ─── Salary export modal ─── */}
      <Modal
        isOpen={salaryExportOpen}
        onClose={() => setSalaryExportOpen(false)}
        title="הורדת תבנית שכר ל-wave"
        maxWidth="sm"
      >
        <div className="flex flex-col gap-4" dir="rtl">
          {salaryExportError && !isSalaryExporting && (
            <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100">
              {salaryExportError}
            </div>
          )}
          {isSalaryExporting ? (
            <LoadingIndicator title="מכין קובץ שכר..." subtitle="התהליך יכול לקחת עד דקה" />
          ) : (
            <>
              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">חודש לייצוא</label>
                <div className="inline-flex">
                  <MonthPicker
                    value={salaryExportMonth}
                    onChange={setSalaryExportMonth}
                    storageKey="sites_salary_export_month"
                  />
                </div>
              </div>
              <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setSalaryExportOpen(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700 rounded-lg transition-colors font-medium"
                  disabled={isSalaryExporting}
                >
                  ביטול
                </button>
                <button
                  type="button"
                  onClick={handleDownloadSalaryBatch}
                  disabled={isSalaryExporting}
                  className="px-6 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg transition-colors font-bold shadow-lg shadow-primary/30 disabled:opacity-50"
                >
                  {isSalaryExporting ? 'מוריד תבנית שכר ל-wave...' : 'הורד תבנית שכר ל-wave'}
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* ─── Create Site Modal ─── */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-slate-100 dark:border-slate-700">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">יצירת אתר חדש</h3>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {formError && (
                <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100">{formError}</div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">שם אתר</label>
                <input
                  type="text"
                  value={formData.site_name}
                  onChange={(e) => setFormData({ ...formData, site_name: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all"
                  placeholder="אתר מרכז"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">קוד אתר (אופציונלי)</label>
                <input
                  type="text"
                  value={formData.site_code}
                  onChange={(e) => setFormData({ ...formData, site_code: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all"
                  placeholder="SITE-01"
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700 rounded-lg transition-colors font-medium"
                >
                  ביטול
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-6 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg transition-colors font-bold shadow-lg shadow-primary/30 disabled:opacity-50"
                >
                  {isSubmitting ? 'שומר...' : 'צור'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <BatchUploadModal
        isOpen={globalUploadOpen}
        onClose={() => setGlobalUploadOpen(false)}
        onUploadComplete={() => setGlobalUploadOpen(false)}
      />
      <SiteTariffImportModal
        isOpen={tariffImportOpen}
        onClose={() => setTariffImportOpen(false)}
        onApplied={() => {
          fetchSites();
          showToast('פרטי האתרים עודכנו בהצלחה', 'success');
        }}
      />
    </div>
  );
}
