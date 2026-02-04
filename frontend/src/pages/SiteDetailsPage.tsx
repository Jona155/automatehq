import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Site, Employee } from '../types';
import { getSite } from '../api/sites';
import { getEmployees } from '../api/employees';
import { uploadSingleWorkCard } from '../api/workCards';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../hooks/useToast';
import UploadWorkCardModal from '../components/UploadWorkCardModal';
import BatchUploadModal from '../components/BatchUploadModal';
import WorkCardReviewTab from '../components/WorkCardReviewTab';
import MonthlySummaryTab from '../components/MonthlySummaryTab';

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
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('employees');
  const [selectedMonth, setSelectedMonth] = useState<string>(() => getPreviousMonth());
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
        <button
          onClick={() => setBatchUploadModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium text-sm"
        >
          <span className="material-symbols-outlined text-lg">cloud_upload</span>
          <span>העלאה מרובה</span>
        </button>
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
    </div>
  );
}
