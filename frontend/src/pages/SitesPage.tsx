import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Site } from '../types';
import {
  getSites,
  createSite,
  sendAccessLinksBatchToWhatsapp,
  downloadMonthlySummaryBatch,
  downloadSalaryTemplateBatch,
} from '../api/sites';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../hooks/useToast';
import { usePermissions } from '../hooks/usePermissions';
import MonthPicker from '../components/MonthPicker';
import Modal from '../components/Modal';
import LoadingIndicator from '../components/LoadingIndicator';
import { useOnClickOutside } from '../hooks/useOnClickOutside';
import { downloadBlobFile } from '../utils/fileDownload';

type SortField = 'site_name' | 'site_code' | 'employee_count' | 'is_active';
type SortOrder = 'asc' | 'desc';

const getDefaultMonth = () => {
  const now = new Date();
  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const year = currentMonth.getFullYear();
  const month = String(currentMonth.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

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
  const [filterStatus, setFilterStatus] = useState('');
  const [sortField, setSortField] = useState<SortField>('site_name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(10);
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement | null>(null);
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchSearch, setBatchSearch] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);
  const [isBatchSending, setIsBatchSending] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchMonth, setBatchMonth] = useState(getDefaultMonth());
  const [summaryExportOpen, setSummaryExportOpen] = useState(false);
  const [summaryExportMonth, setSummaryExportMonth] = useState(getDefaultMonth());
  const [isSummaryExporting, setIsSummaryExporting] = useState(false);
  const [summaryExportError, setSummaryExportError] = useState<string | null>(null);
  const [salaryExportOpen, setSalaryExportOpen] = useState(false);
  const [salaryExportMonth, setSalaryExportMonth] = useState(getDefaultMonth());
  const [isSalaryExporting, setIsSalaryExporting] = useState(false);
  const [salaryExportError, setSalaryExportError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { showToast, ToastContainer } = useToast();

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

  useOnClickOutside(actionsRef, () => setActionsOpen(false), actionsOpen);

  const filteredSites = useMemo(() => {
    return sites.filter((site) => {
      const matchesName = !filterName || site.site_name.toLowerCase().includes(filterName.toLowerCase());
      const matchesCode = !filterCode || (site.site_code || '').toLowerCase().includes(filterCode.toLowerCase());
      const matchesStatus =
        !filterStatus || (filterStatus === 'active' ? site.is_active : !site.is_active);
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

  const clearFilters = () => {
    setFilterName('');
    setFilterCode('');
    setFilterStatus('');
  };

  const handleOpenCreate = () => {
    setFormData({ site_name: '', site_code: '' });
    setFormError(null);
    setIsModalOpen(true);
  };

  const eligibleSites = useMemo(() => sites.filter((site) => !!site.responsible_employee_id), [sites]);
  const eligibleSitesSorted = useMemo(() => {
    const sorted = [...eligibleSites];
    sorted.sort((a, b) => a.site_name.localeCompare(b.site_name, 'he'));
    return sorted;
  }, [eligibleSites]);
  const filteredEligibleSites = useMemo(() => {
    const query = batchSearch.trim().toLowerCase();
    if (!query) return eligibleSitesSorted;
    return eligibleSitesSorted.filter((site) => site.site_name.toLowerCase().includes(query));
  }, [eligibleSitesSorted, batchSearch]);

  const handleOpenBatch = () => {
    setBatchError(null);
    setBatchSearch('');
    setShowAdvanced(false);
    setSelectedSiteIds(eligibleSites.map((site) => site.id));
    setBatchModalOpen(true);
  };

  const handleToggleSite = (siteId: string) => {
    setSelectedSiteIds((prev) =>
      prev.includes(siteId) ? prev.filter((id) => id !== siteId) : [...prev, siteId]
    );
  };

  const handleSelectAllSites = () => {
    setSelectedSiteIds(eligibleSites.map((site) => site.id));
  };

  const handleClearAllSites = () => {
    setSelectedSiteIds([]);
  };

  const handleSendBatch = async () => {
    if (selectedSiteIds.length === 0) {
      setBatchError('יש לבחור לפחות אתר אחד לשליחה.');
      return;
    }
    if (!batchMonth) {
      setBatchError('יש לבחור חודש לשליחה.');
      return;
    }

    setIsBatchSending(true);
    setBatchError(null);
    try {
      const processingMonth = `${batchMonth}-01`;
      const response = await sendAccessLinksBatchToWhatsapp({
        site_ids: selectedSiteIds,
        processing_month: processingMonth,
      });
      const summary = `נשלחו ${response.sent_count} הודעות. דולגו ${response.skipped_count}. נכשלו ${response.failed_count}.`;
      showToast(summary, response.failed_count > 0 ? 'error' : 'success');
      setBatchModalOpen(false);
    } catch (err: any) {
      console.error('Failed to send batch WhatsApp:', err);
      setBatchError(err?.response?.data?.message || 'שגיאה בשליחת הודעות וואטסאפ');
    } finally {
      setIsBatchSending(false);
    }
  };

  const handleOpenSummaryExport = () => {
    setSummaryExportError(null);
    setSummaryExportMonth(getDefaultMonth());
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
    setSalaryExportMonth(getDefaultMonth());
    setSalaryExportOpen(true);
  };

  const handleDownloadSalaryBatch = async () => {
    if (!salaryExportMonth) {
      setSalaryExportError('\u05d9\u05e9 \u05dc\u05d1\u05d7\u05d5\u05e8 \u05d7\u05d5\u05d3\u05e9 \u05dc\u05d9\u05d9\u05e6\u05d5\u05d0.');
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
      setSalaryExportError(
        err?.response?.data?.message || '\u05e9\u05d2\u05d9\u05d0\u05d4 \u05d1\u05d4\u05d5\u05e8\u05d3\u05ea \u05e7\u05d5\u05d1\u05e5 \u05e9\u05db\u05e8'
      );
    } finally {
      setIsSalaryExporting(false);
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
      return <span className="material-symbols-outlined text-sm opacity-30">unfold_more</span>;
    }
    return (
      <span className="material-symbols-outlined text-sm">
        {sortOrder === 'asc' ? 'arrow_upward' : 'arrow_downward'}
      </span>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <ToastContainer />
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-2">
        <div>
          <h2 className="text-[#111518] dark:text-white text-3xl font-bold">ניהול אתרים</h2>
          <p className="text-[#617989] dark:text-slate-400 mt-1">נהל את אתרי העבודה שלך בארגון</p>
        </div>
        {isAdmin && <div className="relative" ref={actionsRef} dir="rtl">
          <button
            onClick={() => setActionsOpen((prev) => !prev)}
            className="flex items-center gap-2 px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-colors font-medium text-sm bg-white dark:bg-transparent"
          >
            <span className="material-symbols-outlined text-lg">more_horiz</span>
            <span>פעולות באתרים</span>
          </button>

          {actionsOpen && (
            <div className="absolute left-0 mt-2 w-64 max-w-[calc(100vw-2rem)] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl overflow-hidden z-50" dir="rtl">
              <button
                onClick={() => {
                  setActionsOpen(false);
                  handleOpenCreate();
                }}
                className="w-full text-right px-4 py-3 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-colors flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-lg">add</span>
                <span>יצירת אתר</span>
              </button>
              <button
                onClick={() => {
                  setActionsOpen(false);
                  handleOpenSummaryExport();
                }}
                className="w-full text-right px-4 py-3 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-colors flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-lg">table_view</span>
                <span>הורדת סיכום אתרים (Excel)</span>
              </button>
              <button
                onClick={() => {
                  setActionsOpen(false);
                  handleOpenSalaryExport();
                }}
                className="w-full text-right px-4 py-3 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-colors flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-lg">request_quote</span>
                <span>{"\u05d4\u05d5\u05e8\u05d3\u05ea \u05ea\u05d1\u05e0\u05d9\u05ea \u05e9\u05db\u05e8 \u05dc-wave"}</span>
              </button>
              <button
                onClick={() => {
                  setActionsOpen(false);
                  handleOpenBatch();
                }}
                className="w-full text-right px-4 py-3 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-colors flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-lg">chat</span>
                <span>שליחת הודעות וואטסאפ</span>
              </button>
            </div>
          )}
        </div>}
      </div>
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
            <LoadingIndicator
              title="מכין קובץ Excel..."
              subtitle="התהליך יכול לקחת עד דקה"
            />
          ) : (
            <>
              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">
                  חודש לייצוא
                </label>
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
      <Modal
        isOpen={salaryExportOpen}
        onClose={() => setSalaryExportOpen(false)}
        title={"\u05d4\u05d5\u05e8\u05d3\u05ea \u05ea\u05d1\u05e0\u05d9\u05ea \u05e9\u05db\u05e8 \u05dc-wave"}
        maxWidth="sm"
      >
        <div className="flex flex-col gap-4" dir="rtl">
          {salaryExportError && !isSalaryExporting && (
            <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100">
              {salaryExportError}
            </div>
          )}
          {isSalaryExporting ? (
            <LoadingIndicator
              title={"\u05de\u05db\u05d9\u05df \u05e7\u05d5\u05d1\u05e5 \u05e9\u05db\u05e8..."}
              subtitle={"\u05d4\u05ea\u05d4\u05dc\u05d9\u05da \u05d9\u05db\u05d5\u05dc \u05dc\u05e7\u05d7\u05ea \u05e2\u05d3 \u05d3\u05e7\u05d4"}
            />
          ) : (
            <>
              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">
                  {"\u05d7\u05d5\u05d3\u05e9 \u05dc\u05d9\u05d9\u05e6\u05d5\u05d0"}
                </label>
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
                  {"\u05d1\u05d9\u05d8\u05d5\u05dc"}
                </button>
                <button
                  type="button"
                  onClick={handleDownloadSalaryBatch}
                  disabled={isSalaryExporting}
                  className="px-6 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg transition-colors font-bold shadow-lg shadow-primary/30 disabled:opacity-50"
                >
                  {isSalaryExporting
                    ? '\u05de\u05d5\u05e8\u05d9\u05d3 \u05ea\u05d1\u05e0\u05d9\u05ea \u05e9\u05db\u05e8 \u05dc-wave...'
                    : '\u05d4\u05d5\u05e8\u05d3 \u05ea\u05d1\u05e0\u05d9\u05ea \u05e9\u05db\u05e8 \u05dc-wave'}
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>

      <div className="bg-white dark:bg-[#1a2a35] rounded-xl shadow-xl border border-slate-200/50 dark:border-slate-700/50 p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">סינון לפי שם</label>
            <input
              type="text"
              value={filterName}
              onChange={(e) => setFilterName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all text-sm"
              placeholder="חפש לפי שם..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">סינון לפי קוד אתר</label>
            <input
              type="text"
              value={filterCode}
              onChange={(e) => setFilterCode(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all text-sm"
              placeholder="חפש לפי קוד..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">סינון לפי סטטוס</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all text-sm"
            >
              <option value="">כל הסטטוסים</option>
              <option value="active">פעיל</option>
              <option value="inactive">לא פעיל</option>
            </select>
          </div>
          <div className="flex items-end justify-end">
            {(filterName || filterCode || filterStatus) && (
              <button
                onClick={clearFilters}
                className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors font-medium"
              >
                נקה
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-[#1a2a35] rounded-xl shadow-xl border border-slate-200/50 dark:border-slate-700/50 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-slate-500">טוען אתרים...</div>
        ) : error ? (
          <div className="p-8 text-center text-red-500">{error}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                  <th
                    className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors"
                    onClick={() => handleSort('site_name')}
                  >
                    <div className="flex items-center gap-1">
                      <span>שם אתר</span>
                      <SortIcon field="site_name" />
                    </div>
                  </th>
                  <th
                    className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors"
                    onClick={() => handleSort('site_code')}
                  >
                    <div className="flex items-center gap-1">
                      <span>קוד אתר</span>
                      <SortIcon field="site_code" />
                    </div>
                  </th>
                  <th
                    className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors"
                    onClick={() => handleSort('employee_count')}
                  >
                    <div className="flex items-center gap-1">
                      <span>מספר עובדים</span>
                      <SortIcon field="employee_count" />
                    </div>
                  </th>
                  <th
                    className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors"
                    onClick={() => handleSort('is_active')}
                  >
                    <div className="flex items-center gap-1">
                      <span>סטטוס</span>
                      <SortIcon field="is_active" />
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                {paginatedSites.map((site) => (
                  <tr
                    key={site.id}
                    onClick={() => handleRowClick(site.id)}
                    className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 cursor-pointer transition-colors"
                  >
                    <td className="px-6 py-5">
                      <span className="text-[#111518] dark:text-white font-medium">{site.site_name}</span>
                    </td>
                    <td className="px-6 py-5">
                      <span className="text-[#617989] dark:text-slate-400">{site.site_code || 'לא הוגדר'}</span>
                    </td>
                    <td className="px-6 py-5">
                      <span className="text-[#111518] dark:text-white font-medium">
                        {site.employee_count !== undefined ? `${site.employee_count} עובדים` : 'טוען...'}
                      </span>
                    </td>
                    <td className="px-6 py-5">
                      {site.is_active ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                          פעיל
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                          לא פעיל
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {sortedSites.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-slate-500">
                      {filterName || filterCode || filterStatus
                        ? 'לא נמצאו אתרים התואמים את הסינון'
                        : 'לא נמצאו אתרים'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {sortedSites.length > 0 && (
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 px-6 py-4 border-t border-slate-100 dark:border-slate-700/50 bg-slate-50/60 dark:bg-slate-900/40">
                <div className="text-sm text-slate-600 dark:text-slate-400">
                  Page {currentPage} of {totalPages}
                </div>
                <div className="flex items-center gap-2 justify-end">
                  <button
                    onClick={() => setCurrentPage(1)}
                    disabled={currentPage === 1}
                    className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    First
                  </button>
                  <button
                    onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    Prev
                  </button>
                  <button
                    onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    Next
                  </button>
                  <button
                    onClick={() => setCurrentPage(totalPages)}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    Last
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <Modal
        isOpen={batchModalOpen}
        onClose={() => setBatchModalOpen(false)}
        title="שליחת הודעות וואטסאפ לעובדים אחראים"
        maxWidth="lg"
      >
        <div className="flex flex-col gap-6" dir="rtl">
          {batchError && (
            <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100">
              {batchError}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-5 items-start">
            <div className="order-2 lg:order-1">
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">
                חודש לשליחה
              </label>
              <div className="inline-flex">
                <MonthPicker
                  value={batchMonth}
                  onChange={setBatchMonth}
                  storageKey="sites_whatsapp_month"
                />
              </div>
            </div>

            <div className="order-1 lg:order-2 bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
              <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">סטטוס בחירה</h4>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-slate-900 dark:text-white">{selectedSiteIds.length}</span>
                <span className="text-sm text-slate-600 dark:text-slate-400">
                  מתוך {eligibleSites.length} אתרים עם עובד אחראי
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-500 mt-2">
                דולגו {Math.max(0, sites.length - eligibleSites.length)} אתרים ללא עובד אחראי.
              </p>
            </div>
          </div>

          <button
            onClick={() => setShowAdvanced((prev) => !prev)}
            className="text-sm text-primary hover:text-primary/80 transition-colors w-fit font-semibold"
            type="button"
          >
            {showAdvanced ? 'הסתר אפשרויות מתקדמות' : 'אפשרויות מתקדמות'}
          </button>

          {showAdvanced && (
            <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-4 bg-white/70 dark:bg-slate-900/30">
              <div className="flex flex-col lg:flex-row lg:items-center gap-3 justify-between">
                <div className="relative w-full lg:max-w-sm">
                  <span className="material-symbols-outlined text-[18px] text-slate-400 absolute right-3 top-1/2 -translate-y-1/2">
                    search
                  </span>
                  <input
                    type="text"
                    value={batchSearch}
                    onChange={(e) => setBatchSearch(e.target.value)}
                    className="w-full px-9 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all text-sm"
                    placeholder="חיפוש לפי שם אתר..."
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSelectAllSites}
                    type="button"
                    className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    בחר הכל
                  </button>
                  <button
                    onClick={handleClearAllSites}
                    type="button"
                    className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    נקה בחירה
                  </button>
                </div>
              </div>

              {filteredEligibleSites.length === 0 ? (
                <div className="text-sm text-slate-500">לא נמצאו אתרים תואמים לחיפוש.</div>
              ) : (
                <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700/60 border border-slate-200/80 dark:border-slate-700/60 rounded-xl bg-white dark:bg-slate-900/40">
                  {filteredEligibleSites.map((site) => (
                    <label
                      key={site.id}
                      className="flex items-center justify-between px-3 py-2 text-sm cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={selectedSiteIds.includes(site.id)}
                          onChange={() => handleToggleSite(site.id)}
                        />
                        <span className="text-slate-800 dark:text-slate-200">{site.site_name}</span>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${site.is_active ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>
                        {site.is_active ? 'פעיל' : 'לא פעיל'}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              נשלחות הודעות רק לעובדים אחראים עם מספר וואטסאפ תקין.
            </div>
            <button
              type="button"
              onClick={() => setBatchModalOpen(false)}
              className="px-4 py-2 text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700 rounded-lg transition-colors font-medium"
              disabled={isBatchSending}
            >
              ביטול
            </button>
            <button
              type="button"
              onClick={handleSendBatch}
              disabled={isBatchSending}
              className="px-6 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg transition-colors font-bold shadow-lg shadow-primary/30 disabled:opacity-50"
            >
              {isBatchSending ? 'שולח...' : 'שלח הודעות'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Create Site Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-slate-100 dark:border-slate-700">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">יצירת אתר חדש</h3>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {formError && (
                <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100">
                  {formError}
                </div>
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
    </div>
  );
}
