import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Site, EmployeeUploadStatus } from '../types';
import { getSite } from '../api/sites';
import { useAuth } from '../context/AuthContext';
import MonthPicker from '../components/MonthPicker';
import { getEmployeeUploadStatus } from '../api/workCards';
import SummaryStats, { type SummaryStatsData } from '../components/site-details/SummaryStats';
import EmployeesTab from '../components/site-details/EmployeesTab';
import ReviewTab from '../components/site-details/ReviewTab';
import MatrixTab from '../components/site-details/MatrixTab';

type TabType = 'employees' | 'review' | 'matrix';

export default function SiteDetailsPage() {
  const { siteId } = useParams<{ siteId: string }>();
  const [site, setSite] = useState<Site | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('employees');
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [summaryStats, setSummaryStats] = useState<SummaryStatsData>({
    uploaded: 0,
    pending: 0,
    failed: 0,
    approved: 0,
  });
  const navigate = useNavigate();
  const { user } = useAuth();

  // Employees tab state (shared for stats)
  const [employeeStatuses, setEmployeeStatuses] = useState<EmployeeUploadStatus[]>([]);
  const [isLoadingEmployees, setIsLoadingEmployees] = useState(false);

  // Navigation state
  const [initialCardId, setInitialCardId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    const fetchSite = async () => {
      if (!siteId) return;
      
      setIsLoading(true);
      try {
        const data = await getSite(siteId);
        setSite(data);
        setError(null);
      } catch (err) {
        console.error('Failed to fetch site:', err);
        setError('שגיאה בטעינת פרטי האתר');
      } finally {
        setIsLoading(false);
      }
    };

    fetchSite();
  }, [siteId]);

  // Fetch employee statuses when month changes
  useEffect(() => {
    if (selectedMonth && siteId) {
      fetchEmployeeStatuses();
    }
  }, [selectedMonth, siteId]);

  // Auto-dismiss toast after 3 seconds
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const fetchEmployeeStatuses = async () => {
    if (!siteId || !selectedMonth) return;
    
    setIsLoadingEmployees(true);
    try {
      const statuses = await getEmployeeUploadStatus(siteId, selectedMonth);
      setEmployeeStatuses(statuses);
      
      // Update summary stats
      const stats = statuses.reduce((acc, status) => {
        if (status.status === 'APPROVED') acc.approved++;
        else if (status.status === 'PENDING') acc.pending++;
        else if (status.status === 'FAILED') acc.failed++;
        else if (status.status !== 'NO_UPLOAD') acc.uploaded++;
        return acc;
      }, { uploaded: 0, pending: 0, failed: 0, approved: 0 });
      
      setSummaryStats(stats);
    } catch (err) {
      console.error('Failed to fetch employee statuses:', err);
      showToast('שגיאה בטעינת רשימת עובדים', 'error');
    } finally {
      setIsLoadingEmployees(false);
    }
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
  };

  const handleBack = () => {
    navigate(`/${user?.business?.code}/sites`);
  };

  const handleMonthChange = (month: string) => {
    setSelectedMonth(month);
  };

  const handleViewCard = (cardId: string) => {
    setInitialCardId(cardId);
    setActiveTab('review');
  };

  const handleExportCSV = () => {
    // TODO: Implement CSV export
    console.log('Export CSV for:', selectedMonth);
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

        <div className="flex items-center gap-3">
          <MonthPicker value={selectedMonth} onChange={handleMonthChange} storageKey={`site_${siteId}_month`} />
          
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
          >
            <span className="material-symbols-outlined">download</span>
            <span className="font-medium">ייצוא CSV</span>
          </button>
        </div>
      </div>

      {/* Summary Stats */}
      <SummaryStats stats={summaryStats} />

      {/* Tab Navigation */}
      <div className="border-b border-slate-200 dark:border-slate-700">
        <div className="flex gap-6">
          <button
            onClick={() => setActiveTab('employees')}
            className={`px-4 py-3 font-medium border-b-2 transition-colors ${
              activeTab === 'employees'
                ? 'border-primary text-primary'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            עובדים והעלאות
          </button>
          <button
            onClick={() => setActiveTab('review')}
            className={`px-4 py-3 font-medium border-b-2 transition-colors ${
              activeTab === 'review'
                ? 'border-primary text-primary'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            בדיקה ואישור
          </button>
          <button
            onClick={() => setActiveTab('matrix')}
            className={`px-4 py-3 font-medium border-b-2 transition-colors ${
              activeTab === 'matrix'
                ? 'border-primary text-primary'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            מטריצת שעות
          </button>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'employees' && siteId && (
        <EmployeesTab
          siteId={siteId}
          selectedMonth={selectedMonth}
          employeeStatuses={employeeStatuses}
          isLoading={isLoadingEmployees}
          onRefresh={fetchEmployeeStatuses}
          onViewCard={handleViewCard}
          showToast={showToast}
        />
      )}

      {activeTab === 'review' && siteId && (
        <ReviewTab
          siteId={siteId}
          selectedMonth={selectedMonth}
          initialCardId={initialCardId}
          onApproveSuccess={fetchEmployeeStatuses}
          showToast={showToast}
        />
      )}

      {activeTab === 'matrix' && siteId && (
        <MatrixTab
          siteId={siteId}
          selectedMonth={selectedMonth}
          showToast={showToast}
        />
      )}

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-fade-in">
          <div className={`px-6 py-3 rounded-lg shadow-lg flex items-center gap-3 ${
            toast.type === 'success' 
              ? 'bg-green-600 text-white' 
              : 'bg-red-600 text-white'
          }`}>
            <span className="material-symbols-outlined">
              {toast.type === 'success' ? 'check_circle' : 'error'}
            </span>
            <span className="font-medium">{toast.message}</span>
          </div>
        </div>
      )}
    </div>
  );
}
