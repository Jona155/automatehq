import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Site, Employee } from '../types';
import { downloadMonthlySummary, downloadSalaryTemplate, getSite, getSites, updateSite } from '../api/sites';
import { getEmployees } from '../api/employees';
import { uploadSingleWorkCard } from '../api/workCards';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../hooks/useToast';
import UploadWorkCardModal from '../components/UploadWorkCardModal';
import BatchUploadModal from '../components/BatchUploadModal';
import WorkCardExportModal from '../components/WorkCardExportModal';
import WorkCardReviewTab from '../components/WorkCardReviewTab';
import MonthlySummaryTab from '../components/MonthlySummaryTab';
import AccessLinksManager from '../components/AccessLinksManager';
import Modal from '../components/Modal';
import MonthPicker from '../components/MonthPicker';
import { useOnClickOutside } from '../hooks/useOnClickOutside';
import { downloadBlobFile } from '../utils/fileDownload';

type TabType = 'employees' | 'review' | 'summary';

// Default month for shared Review/Summary tabs (previous month in YYYY-MM)
function getPreviousMonth(): string {
  const now = new Date();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const year = prevMonth.getFullYear();
  const month = String(prevMonth.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}


export default function SiteDetailsPage() {
  const { siteId } = useParams<{ siteId: string }>();
  const { isAuthenticated, user } = useAuth();
  const [site, setSite] = useState<Site | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingEmployees, setIsLoadingEmployees] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [employeesError, setEmployeesError] = useState<string | null>(null);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [batchUploadModalOpen, setBatchUploadModalOpen] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('employees');
  const [selectedMonth, setSelectedMonth] = useState<string>(() => getPreviousMonth());
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [responsibleEmployeeId, setResponsibleEmployeeId] = useState<string>('');
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [isDownloadingSummary, setIsDownloadingSummary] = useState(false);
  const [isDownloadingSalaryTemplate, setIsDownloadingSalaryTemplate] = useState(false);
  const [salaryModalOpen, setSalaryModalOpen] = useState(false);
  const [salaryExportMonth, setSalaryExportMonth] = useState<string>(() => getPreviousMonth());
  const [salaryExportSiteId, setSalaryExportSiteId] = useState<string>('');
  const [salarySites, setSalarySites] = useState<Site[]>([]);
  const [salaryModalError, setSalaryModalError] = useState<string | null>(null);
  const actionsRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();
  const { showToast, ToastContainer } = useToast();

  // Restore shared month from localStorage when siteId is available
  useEffect(() => {
    if (!siteId) return;
    const stored = localStorage.getItem(`site_details_month_${siteId}`);
    if (stored) setSelectedMonth(stored);
  }, [siteId]);

  useEffect(() => {
    if (!isAuthenticated || !siteId) return;

    // Use AbortController to cancel requests on unmount/navigation
    const abortController = new AbortController();

    const fetchData = async () => {
      setIsLoading(true);
      setIsLoadingEmployees(true);

      try {
        // Fetch site and employees in parallel with abort signal
        const [siteResult, employeesResult] = await Promise.allSettled([
          getSite(siteId),
          getEmployees({ site_id: siteId, active: true }),
        ]);

        // Check if aborted before updating state
        if (abortController.signal.aborted) return;

        // Handle site result
        if (siteResult.status === 'fulfilled') {
          setSite(siteResult.value);
          setError(null);
        } else {
          // Don't show error if request was aborted
          if (siteResult.reason?.code !== 'ERR_CANCELED' && siteResult.reason?.code !== 'ERR_NETWORK') {
            console.error('Failed to fetch site:', siteResult.reason);
            setError('שגיאה בטעינת פרטי האתר');
          }
        }
        setIsLoading(false);

        // Handle employees result
        if (employeesResult.status === 'fulfilled') {
          setEmployees(employeesResult.value);
          setEmployeesError(null);
        } else {
          // Don't show error if request was aborted
          if (employeesResult.reason?.code !== 'ERR_CANCELED' && employeesResult.reason?.code !== 'ERR_NETWORK') {
            console.error('Failed to fetch employees:', employeesResult.reason);
            setEmployeesError('שגיאה בטעינת רשימת עובדים');
          }
        }
        setIsLoadingEmployees(false);
      } catch (err) {
        // Ignore errors from aborted requests
        if (abortController.signal.aborted) return;
        console.error('Fetch error:', err);
      }
    };

    fetchData();

    return () => {
      abortController.abort();
    };
  }, [isAuthenticated, siteId]);

  useOnClickOutside(actionsRef, () => setActionsOpen(false), actionsOpen);

  const handleBack = () => {
    navigate(`/${user?.business?.code}/sites`);
  };

  const handleUploadClick = (employee: Employee) => {
    setSelectedEmployee(employee);
    setUploadModalOpen(true);
  };

  const handleUpload = async (employeeId: string, month: string, file: File) => {
    if (!siteId) return;

    try {
      await uploadSingleWorkCard(siteId, employeeId, month, file);
      showToast('כרטיס הנוכחות הועלה בהצלחה', 'success');
      // Optionally refresh the employee list here if needed
    } catch (err: any) {
      const errorMessage = err?.response?.data?.message || 'שגיאה בהעלאת כרטיס הנוכחות';
      showToast(errorMessage, 'error');
      throw err; // Re-throw to let the modal handle it
    }
  };

  const handleOpenSettings = () => {
    setResponsibleEmployeeId(site?.responsible_employee_id || '');
    setSettingsModalOpen(true);
  };

  const handleSaveSettings = async () => {
    if (!siteId) return;
    setIsSavingSettings(true);
    try {
      const payload = {
        responsible_employee_id: responsibleEmployeeId || null,
      };
      const updated = await updateSite(siteId, payload);
      setSite(updated);
      showToast('ההגדרות נשמרו בהצלחה', 'success');
      setSettingsModalOpen(false);
    } catch (err: any) {
      console.error('Failed to update site settings:', err);
      showToast(err?.response?.data?.message || 'שגיאה בעדכון ההגדרות', 'error');
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleDownloadSummaryCsv = async () => {
    if (!siteId || !site) return;
    if (isDownloadingSummary) return;
    setIsDownloadingSummary(true);
    try {
      const blob = await downloadMonthlySummary(siteId, selectedMonth, {
        approved_only: false,
        include_inactive: false,
      });
      downloadBlobFile(blob, `monthly_summary_${site.site_name}_${selectedMonth}.csv`);
    } catch (err: any) {
      console.error('Failed to download summary CSV:', err);
      showToast(err?.response?.data?.message || 'שגיאה בהורדת הסיכום החודשי', 'error');
    } finally {
      setIsDownloadingSummary(false);
    }
  };

  useEffect(() => {
    if (!salaryModalOpen || !isAuthenticated) return;
    let active = true;

    const fetchSalarySites = async () => {
      try {
        const allSites = await getSites({ active: false });
        if (!active) return;
        setSalarySites(allSites);
      } catch (err) {
        if (!active) return;
        console.error('Failed to fetch sites for salary export:', err);
        setSalaryModalError('שגיאה בטעינת רשימת אתרים');
      }
    };

    fetchSalarySites();
    return () => {
      active = false;
    };
  }, [salaryModalOpen, isAuthenticated]);

  const handleOpenSalaryModal = () => {
    setSalaryModalError(null);
    setSalaryExportMonth(selectedMonth);
    setSalaryExportSiteId(siteId || '');
    setSalaryModalOpen(true);
  };

  const handleDownloadSalaryTemplate = async () => {
    if (!salaryExportSiteId) {
      setSalaryModalError('יש לבחור אתר');
      return;
    }
    if (!salaryExportMonth) {
      setSalaryModalError('יש לבחור חודש');
      return;
    }
    if (isDownloadingSalaryTemplate) return;
    setIsDownloadingSalaryTemplate(true);
    setSalaryModalError(null);
    try {
      const selectedSite = salarySites.find((item) => item.id === salaryExportSiteId) || site;
      const blob = await downloadSalaryTemplate(salaryExportSiteId, salaryExportMonth, {
        include_inactive: false,
      });
      downloadBlobFile(
        blob,
        `salary_template_${selectedSite?.site_name || 'site'}_${salaryExportMonth}.xlsx`
      );
      setSalaryModalOpen(false);
    } catch (err: any) {
      console.error('Failed to download salary template:', err);
      showToast(err?.response?.data?.message || '\u05e9\u05d2\u05d9\u05d0\u05d4 \u05d1\u05d4\u05d5\u05e8\u05d3\u05ea \u05ea\u05d1\u05e0\u05d9\u05ea \u05e9\u05db\u05e8', 'error');
    } finally {
      setIsDownloadingSalaryTemplate(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <div className="p-8 text-center text-slate-500">טוען פרטי אתר...</div>
      </div>
    );
  }

  if (error || !site) {
    return (
      <div className="flex flex-col gap-6">
        <button
          onClick={handleBack}
          className="flex items-center gap-2 text-primary hover:text-primary/80 transition-colors w-fit"
        >
          <span className="material-symbols-outlined">arrow_forward</span>
          <span>חזרה לרשימת אתרים</span>
        </button>
        <div className="p-8 text-center text-red-500">{error || 'אתר לא נמצא'}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <ToastContainer />
      {/* Breadcrumb */}
      <button
        onClick={handleBack}
        className="flex items-center gap-2 text-primary hover:text-primary/80 transition-colors w-fit"
      >
        <span className="material-symbols-outlined">arrow_forward</span>
        <span>חזרה לרשימת אתרים</span>
      </button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-[#111518] dark:text-white text-3xl font-bold">{site.site_name}</h2>
          <p className="text-[#617989] dark:text-slate-400 mt-1">קוד אתר: {site.site_code || 'לא הוגדר'}</p>
        </div>
        <div className="relative" ref={actionsRef} dir="rtl">
          <button
            onClick={() => setActionsOpen((prev) => !prev)}
            className="flex items-center gap-2 px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-colors font-medium text-sm"
          >
            <span className="material-symbols-outlined text-lg">more_horiz</span>
            <span>{"\u05e4\u05e2\u05d5\u05dc\u05d5\u05ea \u05d1\u05d0\u05ea\u05e8"}</span>
          </button>

          {actionsOpen && (
            <div className="absolute left-0 mt-2 w-56 max-w-[calc(100vw-2rem)] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl overflow-hidden z-50" dir="rtl">
              <button
                onClick={() => {
                  setActionsOpen(false);
                  handleOpenSettings();
                }}
                className="w-full text-right px-4 py-3 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-colors flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-lg">settings</span>
                <span>{"\u05d4\u05d2\u05d3\u05e8\u05d5\u05ea \u05d0\u05ea\u05e8"}</span>
              </button>
              <button
                onClick={() => {
                  setActionsOpen(false);
                  setExportModalOpen(true);
                }}
                className="w-full text-right px-4 py-3 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-colors flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-lg">download</span>
                <span>{"\u05d4\u05d5\u05e8\u05d3\u05ea \u05db\u05e8\u05d8\u05d9\u05e1\u05d9\u05dd"}</span>
              </button>
              <button
                onClick={() => {
                  setActionsOpen(false);
                  handleDownloadSummaryCsv();
                }}
                className="w-full text-right px-4 py-3 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-colors flex items-center gap-2"
                disabled={isDownloadingSummary}
              >
                <span className="material-symbols-outlined text-lg">table_view</span>
                <span>{isDownloadingSummary ? 'מוריד סיכום (CSV)...' : 'הורדת סיכום (CSV)'}</span>
              </button>
              <button
                onClick={() => {
                  setActionsOpen(false);
                  handleOpenSalaryModal();
                }}
                className="w-full text-right px-4 py-3 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-colors flex items-center gap-2"
                disabled={isDownloadingSalaryTemplate}
              >
                <span className="material-symbols-outlined text-lg">request_quote</span>
                <span>
                  {isDownloadingSalaryTemplate
                    ? '\u05de\u05d5\u05e8\u05d9\u05d3 \u05ea\u05d1\u05e0\u05d9\u05ea \u05e9\u05db\u05e8 \u05dc-wave...'
                    : '\u05d4\u05d5\u05e8\u05d3\u05ea \u05ea\u05d1\u05e0\u05d9\u05ea \u05e9\u05db\u05e8 \u05dc-wave'}
                </span>
              </button>
              <button
                onClick={() => {
                  setActionsOpen(false);
                  setBatchUploadModalOpen(true);
                }}
                className="w-full text-right px-4 py-3 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-colors flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-lg">cloud_upload</span>
                <span>{"\u05d4\u05e2\u05dc\u05d0\u05d4 \u05de\u05e8\u05d5\u05d1\u05d4"}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="flex border-b border-slate-200 dark:border-slate-700">
          <button
            onClick={() => setActiveTab('employees')}
            className={`flex-1 px-6 py-4 font-medium text-sm transition-colors ${
              activeTab === 'employees'
                ? 'text-primary border-b-2 border-primary bg-primary/5'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50'
            }`}
          >
            רשימת עובדים
          </button>
          <button
            onClick={() => setActiveTab('review')}
            className={`flex-1 px-6 py-4 font-medium text-sm transition-colors ${
              activeTab === 'review'
                ? 'text-primary border-b-2 border-primary bg-primary/5'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50'
            }`}
          >
            W.C Review
          </button>
          <button
            onClick={() => setActiveTab('summary')}
            className={`flex-1 px-6 py-4 font-medium text-sm transition-colors ${
              activeTab === 'summary'
                ? 'text-primary border-b-2 border-primary bg-primary/5'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50'
            }`}
          >
            סיכום חודשי
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'employees' && (
          <div>
            {/* Employees Table */}
            <div className="px-6 pt-2 pb-4 border-b border-slate-200 dark:border-slate-700">
              <h2 className="text-lg font-bold">רשימת עובדים באתר</h2>
            </div>

            <AccessLinksManager
              siteId={siteId!}
              employees={employees}
              isLoadingEmployees={isLoadingEmployees}
              defaultEmployeeId={site.responsible_employee_id || null}
            />

        {isLoadingEmployees ? (
          <div className="p-8 text-center text-slate-500">טוען רשימת עובדים...</div>
        ) : employeesError ? (
          <div className="p-8 text-center text-red-500">{employeesError}</div>
        ) : employees.length === 0 ? (
          <div className="p-8 text-center text-slate-500">לא נמצאו עובדים באתר זה</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-400 text-sm">
                  <th className="px-6 py-4 font-medium text-center">העלאה</th>
                  <th className="px-6 py-4 font-medium">שם העובד</th>
                  <th className="px-6 py-4 font-medium">מספר דרכון / ת.ז</th>
                  <th className="px-6 py-4 font-medium">מספר טלפון</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {employees.map((employee) => (
                  <tr key={employee.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex justify-center">
                        <button
                          onClick={() => handleUploadClick(employee)}
                          className="p-2 text-slate-400 hover:text-primary transition-colors rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
                          title="העלאת כרטיס נוכחות"
                        >
                          <span className="material-symbols-outlined text-xl">upload</span>
                        </button>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 flex items-center justify-center font-bold text-xs uppercase">
                          {employee.full_name
                            .split(' ')
                            .map(word => word[0])
                            .join('')
                            .slice(0, 2)}
                        </div>
                        <span className="font-medium">{employee.full_name}</span>
                        {site.responsible_employee_id === employee.id && (
                          <span className="ml-2 inline-flex items-center rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-xs font-semibold">אחראי</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-600 dark:text-slate-400">
                      {employee.passport_id}
                    </td>
                    <td className="px-6 py-4 text-slate-600 dark:text-slate-400">
                      {employee.phone_number}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

            <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between text-sm text-slate-600 dark:text-slate-400">
              <span>מציג {employees.length} עובדים</span>
            </div>
          </div>
        )}

        {activeTab === 'review' && (
          <div className="min-h-[600px]">
            <WorkCardReviewTab
              siteId={siteId!}
              selectedMonth={selectedMonth}
              onMonthChange={setSelectedMonth}
              monthStorageKey={`site_details_month_${siteId}`}
            />
          </div>
        )}

        {activeTab === 'summary' && (
          <div className="min-h-[600px]">
            <MonthlySummaryTab
              siteId={siteId!}
              selectedMonth={selectedMonth}
              onMonthChange={setSelectedMonth}
              monthStorageKey={`site_details_month_${siteId}`}
            />
          </div>
        )}
      </div>


      <Modal
        isOpen={salaryModalOpen}
        onClose={() => setSalaryModalOpen(false)}
        title={"\u05d4\u05d5\u05e8\u05d3\u05ea \u05ea\u05d1\u05e0\u05d9\u05ea \u05e9\u05db\u05e8 \u05dc-wave"}
        maxWidth="sm"
      >
        <div className="flex flex-col gap-4" dir="rtl">
          {salaryModalError && !isDownloadingSalaryTemplate && (
            <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100">
              {salaryModalError}
            </div>
          )}
          {isDownloadingSalaryTemplate ? (
            <div className="p-4 text-sm text-slate-600 dark:text-slate-300">
              {"\u05de\u05db\u05d9\u05df \u05e7\u05d5\u05d1\u05e5 \u05e9\u05db\u05e8..."}
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  {"\u05d0\u05ea\u05e8"}
                </label>
                <select
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  value={salaryExportSiteId}
                  onChange={(event) => setSalaryExportSiteId(event.target.value)}
                >
                  {salarySites.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.site_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">
                  {"\u05d7\u05d5\u05d3\u05e9 \u05dc\u05d9\u05d9\u05e6\u05d5\u05d0"}
                </label>
                <div className="inline-flex">
                  <MonthPicker
                    value={salaryExportMonth}
                    onChange={setSalaryExportMonth}
                    storageKey={`site_salary_export_month_${siteId}`}
                  />
                </div>
              </div>
              <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setSalaryModalOpen(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700 rounded-lg transition-colors font-medium"
                  disabled={isDownloadingSalaryTemplate}
                >
                  {"\u05d1\u05d9\u05d8\u05d5\u05dc"}
                </button>
                <button
                  type="button"
                  onClick={handleDownloadSalaryTemplate}
                  disabled={isDownloadingSalaryTemplate}
                  className="px-6 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg transition-colors font-bold shadow-lg shadow-primary/30 disabled:opacity-50"
                >
                  {"\u05d4\u05d5\u05e8\u05d3 \u05ea\u05d1\u05e0\u05d9\u05ea \u05e9\u05db\u05e8 \u05dc-wave"}
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* Site Settings Modal */}
      <Modal
        isOpen={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
        title="הגדרות אתר"
        maxWidth="sm"
      >
        <div className="flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">עובד אחראי</label>
            <select
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              value={responsibleEmployeeId}
              onChange={(event) => setResponsibleEmployeeId(event.target.value)}
              disabled={isLoadingEmployees}
            >
              <option value="">ללא אחראי</option>
              {employees
                .filter((employee) => employee.is_active)
                .map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.full_name}
                  </option>
                ))}
            </select>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">העובד האחראי יהיה ברירת המחדל ליצירת קישורי גישה להעלאת כרטיסים.</p>
          </div>

          <div className="flex justify-end gap-3">
            <button
              onClick={() => setSettingsModalOpen(false)}
              className="px-4 py-2 text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700 rounded-lg transition-colors font-medium"
              disabled={isSavingSettings}
            >אחראי</button>
            <button
              onClick={handleSaveSettings}
              className="px-6 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg transition-colors font-bold shadow-lg shadow-primary/30 disabled:opacity-50"
              disabled={isSavingSettings}
            >
              {isSavingSettings ? 'שומר...' : 'שמור'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Upload Modal */}
      {selectedEmployee && (
        <UploadWorkCardModal
          isOpen={uploadModalOpen}
          onClose={() => setUploadModalOpen(false)}
          employee={selectedEmployee}
          siteId={siteId!}
          onUpload={handleUpload}
        />
      )}

      {/* Batch Upload Modal */}
      <BatchUploadModal
        isOpen={batchUploadModalOpen}
        onClose={() => setBatchUploadModalOpen(false)}
        siteId={siteId!}
        siteName={site.site_name}
        onUploadComplete={() => {
          showToast('הקבצים הועלו בהצלחה והועברו לעיבוד', 'success');
        }}
      />

      <WorkCardExportModal
        isOpen={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        siteId={siteId!}
        siteName={site.site_name}
        employees={employees}
      />
    </div>
  );
}

