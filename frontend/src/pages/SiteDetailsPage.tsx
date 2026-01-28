import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Site, EmployeeUploadStatus, WorkCard, Employee, DayEntry, MatrixData } from '../types';
import { getSite } from '../api/sites';
import { useAuth } from '../context/AuthContext';
import MonthPicker from '../components/MonthPicker';
import { 
  getEmployeeUploadStatus, 
  uploadSingleWorkCard, 
  uploadBatchWorkCards,
  getWorkCards,
  updateWorkCard,
  getWorkCardFile,
  getDayEntries,
  updateDayEntries,
  approveWorkCard,
  getHoursMatrix
} from '../api/workCards';
import { getEmployees } from '../api/employees';

type TabType = 'employees' | 'review' | 'matrix';

interface SummaryStats {
  uploaded: number;
  pending: number;
  failed: number;
  approved: number;
}

interface UploadingEmployee {
  employeeId: string;
  isUploading: boolean;
}

export default function SiteDetailsPage() {
  const { siteId } = useParams<{ siteId: string }>();
  const [site, setSite] = useState<Site | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('employees');
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [summaryStats, setSummaryStats] = useState<SummaryStats>({
    uploaded: 0,
    pending: 0,
    failed: 0,
    approved: 0,
  });
  const navigate = useNavigate();
  const { user } = useAuth();

  // Employees tab state
  const [employeeStatuses, setEmployeeStatuses] = useState<EmployeeUploadStatus[]>([]);
  const [isLoadingEmployees, setIsLoadingEmployees] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [uploadingEmployees, setUploadingEmployees] = useState<Map<string, boolean>>(new Map());
  const fileInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  // Unknown uploads state
  const [unknownUploads, setUnknownUploads] = useState<WorkCard[]>([]);
  const [isUnknownExpanded, setIsUnknownExpanded] = useState(false);
  const [siteEmployees, setSiteEmployees] = useState<Employee[]>([]);
  const [isBulkUploading, setIsBulkUploading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const bulkFileInputRef = useRef<HTMLInputElement>(null);

  // Review tab state
  const [reviewCards, setReviewCards] = useState<WorkCard[]>([]);
  const [filteredReviewCards, setFilteredReviewCards] = useState<WorkCard[]>([]);
  const [reviewSearchQuery, setReviewSearchQuery] = useState('');
  const [reviewStatusFilter, setReviewStatusFilter] = useState<'NEEDS_REVIEW' | 'APPROVED' | 'all'>('NEEDS_REVIEW');
  const [selectedCard, setSelectedCard] = useState<WorkCard | null>(null);
  const [selectedCardImage, setSelectedCardImage] = useState<string | null>(null);
  const [dayEntries, setDayEntries] = useState<DayEntry[]>([]);
  const [isLoadingReview, setIsLoadingReview] = useState(false);
  const [isLoadingImage, setIsLoadingImage] = useState(false);
  const [isSavingDayEntries, setIsSavingDayEntries] = useState(false);
  const [imageZoom, setImageZoom] = useState(1);
  const [imageRotation, setImageRotation] = useState(0);
  const [validationErrors, setValidationErrors] = useState<Record<number, string>>({});

  // Matrix tab state
  const [matrixData, setMatrixData] = useState<MatrixData | null>(null);
  const [matrixApprovedOnly, setMatrixApprovedOnly] = useState(true);
  const [matrixIncludeInactive, setMatrixIncludeInactive] = useState(false);
  const [isLoadingMatrix, setIsLoadingMatrix] = useState(false);

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

  // Fetch employee statuses and unknown uploads when month changes
  useEffect(() => {
    if (selectedMonth && siteId) {
      fetchEmployeeStatuses();
      fetchUnknownUploads();
      fetchSiteEmployees();
    }
  }, [selectedMonth, siteId]);

  // Fetch review cards when month changes or tab switches to review
  useEffect(() => {
    if (selectedMonth && siteId && activeTab === 'review') {
      fetchReviewCards();
    }
  }, [selectedMonth, siteId, activeTab]);

  // Fetch matrix data when month changes or tab switches to matrix
  useEffect(() => {
    if (selectedMonth && siteId && activeTab === 'matrix') {
      fetchMatrixData();
    }
  }, [selectedMonth, siteId, activeTab, matrixApprovedOnly, matrixIncludeInactive]);

  // Auto-collapse unknown uploads if empty
  useEffect(() => {
    if (unknownUploads.length === 0) {
      setIsUnknownExpanded(false);
    }
  }, [unknownUploads.length]);

  // Filter review cards based on search and status
  useEffect(() => {
    let filtered = reviewCards;

    // Filter by status
    if (reviewStatusFilter !== 'all') {
      filtered = filtered.filter(card => card.review_status === reviewStatusFilter);
    }

    // Filter by search query (employee name or passport ID)
    if (reviewSearchQuery) {
      filtered = filtered.filter(card => {
        const employee = card.employee;
        if (!employee) return false;
        return (
          employee.full_name.toLowerCase().includes(reviewSearchQuery.toLowerCase()) ||
          employee.passport_id.includes(reviewSearchQuery)
        );
      });
    }

    setFilteredReviewCards(filtered);
  }, [reviewCards, reviewSearchQuery, reviewStatusFilter]);

  // Load selected card details
  useEffect(() => {
    if (selectedCard) {
      loadCardDetails(selectedCard.id);
    } else {
      setSelectedCardImage(null);
      setDayEntries([]);
    }

    // Cleanup image URL on unmount or card change
    return () => {
      if (selectedCardImage) {
        URL.revokeObjectURL(selectedCardImage);
      }
    };
  }, [selectedCard]);

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

  const fetchUnknownUploads = async () => {
    if (!siteId || !selectedMonth) return;
    
    try {
      const allCards = await getWorkCards({ 
        site_id: siteId, 
        processing_month: selectedMonth 
      });
      const unknown = allCards.filter(card => !card.employee_id);
      setUnknownUploads(unknown);
    } catch (err) {
      console.error('Failed to fetch unknown uploads:', err);
    }
  };

  const fetchSiteEmployees = async () => {
    if (!siteId) return;
    
    try {
      const employees = await getEmployees({ site_id: siteId, active: true });
      setSiteEmployees(employees);
    } catch (err) {
      console.error('Failed to fetch site employees:', err);
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

  const handleSingleUploadClick = (employeeId: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,.pdf';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file && siteId && selectedMonth) {
        await handleSingleUpload(employeeId, file);
      }
    };
    input.click();
  };

  const handleSingleUpload = async (employeeId: string, file: File) => {
    if (!siteId || !selectedMonth) return;

    setUploadingEmployees(prev => new Map(prev).set(employeeId, true));
    
    try {
      await uploadSingleWorkCard(siteId, employeeId, selectedMonth, file);
      showToast('הקובץ הועלה בהצלחה', 'success');
      await fetchEmployeeStatuses();
      await fetchUnknownUploads();
    } catch (err) {
      console.error('Failed to upload file:', err);
      showToast('שגיאה בהעלאת הקובץ', 'error');
    } finally {
      setUploadingEmployees(prev => {
        const next = new Map(prev);
        next.delete(employeeId);
        return next;
      });
    }
  };

  const handleBulkUpload = () => {
    bulkFileInputRef.current?.click();
  };

  const handleBulkUploadFiles = async (files: FileList) => {
    if (!siteId || !selectedMonth || files.length === 0) return;

    setIsBulkUploading(true);
    
    try {
      const filesArray = Array.from(files);
      const result = await uploadBatchWorkCards(siteId, selectedMonth, filesArray);
      
      const successCount = result.uploaded.length;
      const failedCount = result.failed.length;
      
      if (successCount > 0) {
        showToast(`הועלו ${successCount} קבצים בהצלחה`, 'success');
      }
      if (failedCount > 0) {
        showToast(`${failedCount} קבצים נכשלו`, 'error');
      }
      
      await fetchEmployeeStatuses();
      await fetchUnknownUploads();
    } catch (err) {
      console.error('Failed to upload batch:', err);
      showToast('שגיאה בהעלאה מרובה', 'error');
    } finally {
      setIsBulkUploading(false);
      if (bulkFileInputRef.current) {
        bulkFileInputRef.current.value = '';
      }
    }
  };

  const handleAssignEmployee = async (cardId: string, employeeId: string) => {
    try {
      await updateWorkCard(cardId, { employee_id: employeeId });
      showToast('העובד שויך בהצלחה', 'success');
      await fetchEmployeeStatuses();
      await fetchUnknownUploads();
    } catch (err) {
      console.error('Failed to assign employee:', err);
      showToast('שגיאה בשיוך העובד', 'error');
    }
  };

  const handleViewCard = (cardId: string) => {
    setActiveTab('review');
    // Find and select the card
    const card = reviewCards.find(c => c.id === cardId);
    if (card) {
      setSelectedCard(card);
    } else {
      // Card not loaded yet, will load on tab switch
      setTimeout(() => {
        const foundCard = reviewCards.find(c => c.id === cardId);
        if (foundCard) setSelectedCard(foundCard);
      }, 500);
    }
  };

  const handleExportCSV = () => {
    // TODO: Implement CSV export
    console.log('Export CSV for:', selectedMonth);
  };

  // Review tab functions
  const fetchReviewCards = async () => {
    if (!siteId || !selectedMonth) return;

    setIsLoadingReview(true);
    try {
      const cards = await getWorkCards({
        site_id: siteId,
        processing_month: selectedMonth,
      });
      // Only show cards with assigned employees
      const assignedCards = cards.filter(card => card.employee_id !== null);
      setReviewCards(assignedCards);

      // Auto-select first card if none selected
      if (assignedCards.length > 0 && !selectedCard) {
        setSelectedCard(assignedCards[0]);
      }
    } catch (err) {
      console.error('Failed to fetch review cards:', err);
      showToast('שגיאה בטעינת כרטיסים לסקירה', 'error');
    } finally {
      setIsLoadingReview(false);
    }
  };

  const loadCardDetails = async (cardId: string) => {
    setIsLoadingImage(true);
    try {
      // Load image
      const blob = await getWorkCardFile(cardId);
      const imageUrl = URL.createObjectURL(blob);
      setSelectedCardImage(imageUrl);

      // Load day entries
      const entries = await getDayEntries(cardId);
      setDayEntries(entries);
      setValidationErrors({});
    } catch (err) {
      console.error('Failed to load card details:', err);
      showToast('שגיאה בטעינת פרטי כרטיס', 'error');
    } finally {
      setIsLoadingImage(false);
    }
  };

  const handleDayEntryChange = (dayOfMonth: number, field: 'from_time' | 'to_time', value: string) => {
    setDayEntries(prev => {
      const existing = prev.find(e => e.day_of_month === dayOfMonth);
      if (existing) {
        return prev.map(e =>
          e.day_of_month === dayOfMonth
            ? { ...e, [field]: value || null }
            : e
        );
      } else {
        // Create new entry
        return [...prev, {
          id: `temp-${dayOfMonth}`,
          work_card_id: selectedCard!.id,
          day_of_month: dayOfMonth,
          from_time: field === 'from_time' ? value : null,
          to_time: field === 'to_time' ? value : null,
          total_hours: null,
          updated_by_user_id: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }];
      }
    });

    // Clear validation error for this day
    setValidationErrors(prev => {
      const next = { ...prev };
      delete next[dayOfMonth];
      return next;
    });
  };

  const validateDayEntries = () => {
    const errors: Record<number, string> = {};
    const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;

    dayEntries.forEach(entry => {
      if (entry.from_time && !timeRegex.test(entry.from_time)) {
        errors[entry.day_of_month] = 'פורמט שעה שגוי (HH:MM)';
      }
      if (entry.to_time && !timeRegex.test(entry.to_time)) {
        errors[entry.day_of_month] = 'פורמט שעה שגוי (HH:MM)';
      }
    });

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const calculateTotalHours = (fromTime: string | null, toTime: string | null): number | null => {
    if (!fromTime || !toTime) return null;

    const [fromHours, fromMinutes] = fromTime.split(':').map(Number);
    const [toHours, toMinutes] = toTime.split(':').map(Number);

    const fromTotalMinutes = fromHours * 60 + fromMinutes;
    const toTotalMinutes = toHours * 60 + toMinutes;

    const diffMinutes = toTotalMinutes - fromTotalMinutes;
    return Math.round((diffMinutes / 60) * 100) / 100; // Round to 2 decimals
  };

  const handleSaveDayEntries = async () => {
    if (!selectedCard) return;

    if (!validateDayEntries()) {
      showToast('יש לתקן שגיאות ולידציה לפני שמירה', 'error');
      return;
    }

    setIsSavingDayEntries(true);
    try {
      const entriesToSave = dayEntries.map(entry => ({
        day_of_month: entry.day_of_month,
        from_time: entry.from_time,
        to_time: entry.to_time,
        total_hours: calculateTotalHours(entry.from_time, entry.to_time),
      }));

      await updateDayEntries(selectedCard.id, { entries: entriesToSave });
      showToast('נתוני שעות נשמרו בהצלחה', 'success');
    } catch (err) {
      console.error('Failed to save day entries:', err);
      showToast('שגיאה בשמירת נתוני שעות', 'error');
    } finally {
      setIsSavingDayEntries(false);
    }
  };

  const handleApproveCard = async () => {
    if (!selectedCard || !user) return;

    // First save day entries
    await handleSaveDayEntries();

    try {
      await approveWorkCard(selectedCard.id, user.id);
      showToast('הכרטיס אושר בהצלחה', 'success');
      
      // Refresh data
      await fetchReviewCards();
      await fetchEmployeeStatuses();
      
      // Move to next card
      handleNextCard();
    } catch (err) {
      console.error('Failed to approve card:', err);
      showToast('שגיאה באישור כרטיס', 'error');
    }
  };

  const handlePreviousCard = () => {
    if (!selectedCard) return;
    const currentIndex = filteredReviewCards.findIndex(c => c.id === selectedCard.id);
    if (currentIndex > 0) {
      setSelectedCard(filteredReviewCards[currentIndex - 1]);
      setImageZoom(1);
      setImageRotation(0);
    }
  };

  const handleNextCard = () => {
    if (!selectedCard) return;
    const currentIndex = filteredReviewCards.findIndex(c => c.id === selectedCard.id);
    if (currentIndex < filteredReviewCards.length - 1) {
      setSelectedCard(filteredReviewCards[currentIndex + 1]);
      setImageZoom(1);
      setImageRotation(0);
    }
  };

  // Matrix tab functions
  const fetchMatrixData = async () => {
    if (!siteId || !selectedMonth) return;

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

  const getStatusBadge = (status: EmployeeUploadStatus['status']) => {
    const badges = {
      NO_UPLOAD: { label: 'ללא העלאה', color: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' },
      PENDING: { label: 'ממתין', color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' },
      EXTRACTED: { label: 'חולץ', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
      APPROVED: { label: 'אושר', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
      FAILED: { label: 'נכשל', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
    };
    
    const badge = badges[status];
    return (
      <span className={`px-3 py-1 rounded-full text-xs font-medium ${badge.color}`}>
        {badge.label}
      </span>
    );
  };

  const filteredEmployeeStatuses = employeeStatuses.filter(({ employee }) =>
    employee.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    employee.passport_id.includes(searchQuery)
  );

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
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
            onClick={handleBulkUpload}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
          >
            <span className="material-symbols-outlined">upload_file</span>
            <span className="font-medium">העלאה מרובה</span>
          </button>

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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-blue-600 dark:text-blue-400">upload</span>
            </div>
            <div>
              <p className="text-sm text-slate-600 dark:text-slate-400">הועלו</p>
              <p className="text-2xl font-bold text-slate-900 dark:text-white">{summaryStats.uploaded}</p>
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
              <p className="text-2xl font-bold text-slate-900 dark:text-white">{summaryStats.pending}</p>
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
              <p className="text-2xl font-bold text-slate-900 dark:text-white">{summaryStats.failed}</p>
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
              <p className="text-2xl font-bold text-slate-900 dark:text-white">{summaryStats.approved}</p>
            </div>
          </div>
        </div>
      </div>

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
      {activeTab === 'employees' && (
        <div className="space-y-6">
          {/* Employee List */}
          <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
              <h2 className="text-lg font-bold">רשימת עובדים</h2>
              <div className="flex items-center gap-4">
                <div className="relative">
                  <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-lg">search</span>
                  <input
                    className="pr-10 pl-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm w-64 focus:ring-2 focus:ring-primary focus:border-transparent"
                    placeholder="חיפוש לפי שם או ת.ז..."
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {isLoadingEmployees ? (
              <div className="p-8 text-center text-slate-500">טוען רשימת עובדים...</div>
            ) : filteredEmployeeStatuses.length === 0 ? (
              <div className="p-8 text-center text-slate-500">לא נמצאו עובדים</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-right">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-400 text-sm">
                      <th className="px-6 py-4 font-medium">שם העובד</th>
                      <th className="px-6 py-4 font-medium">מספר דרכון / ת.ז</th>
                      <th className="px-6 py-4 font-medium">סטטוס חודשי</th>
                      <th className="px-6 py-4 font-medium text-left">פעולות</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {filteredEmployeeStatuses.map(({ employee, status, work_card_id }) => {
                      const isUploading = uploadingEmployees.get(employee.id);
                      const initials = getInitials(employee.full_name);
                      
                      return (
                        <tr key={employee.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors">
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 flex items-center justify-center font-bold text-xs uppercase">
                                {initials}
                              </div>
                              <span className="font-medium">{employee.full_name}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-slate-600 dark:text-slate-400">
                            {employee.passport_id}
                          </td>
                          <td className="px-6 py-4">
                            {getStatusBadge(status)}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={() => handleSingleUploadClick(employee.id)}
                                disabled={isUploading}
                                className="p-2 text-slate-400 hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                title="העלאת מסמך"
                              >
                                {isUploading ? (
                                  <span className="material-symbols-outlined text-xl animate-spin">progress_activity</span>
                                ) : (
                                  <span className="material-symbols-outlined text-xl">upload</span>
                                )}
                              </button>
                              {work_card_id && (
                                <button
                                  onClick={() => handleViewCard(work_card_id)}
                                  className="p-2 text-slate-400 hover:text-primary transition-colors"
                                  title="צפייה בכרטיס"
                                >
                                  <span className="material-symbols-outlined text-xl">visibility</span>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between text-sm text-slate-600 dark:text-slate-400">
              <span>מציג {filteredEmployeeStatuses.length} עובדים</span>
            </div>
          </div>

          {/* Unknown Uploads Section */}
          <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
            <button
              className="w-full flex items-center justify-between p-4 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              onClick={() => setIsUnknownExpanded(!isUnknownExpanded)}
            >
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-amber-600 dark:text-amber-400">warning</span>
                <span className="font-bold">העלאות שלא שויכו ({unknownUploads.length})</span>
                {unknownUploads.length > 0 && (
                  <span className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 px-2 py-0.5 rounded">
                    נדרשת פעולה
                  </span>
                )}
              </div>
              <span 
                className={`material-symbols-outlined transition-transform duration-200 ${
                  isUnknownExpanded ? 'rotate-180' : ''
                }`}
              >
                expand_more
              </span>
            </button>

            {isUnknownExpanded && unknownUploads.length > 0 && (
              <div className="p-6 border-t border-slate-200 dark:border-slate-700 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {unknownUploads.map((card) => (
                  <UnknownUploadCard
                    key={card.id}
                    card={card}
                    employees={siteEmployees}
                    onAssign={(employeeId) => handleAssignEmployee(card.id, employeeId)}
                  />
                ))}
                
                {/* Add more files card */}
                <div className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl flex flex-col items-center justify-center p-6 text-slate-400 hover:text-primary hover:border-primary transition-all cursor-pointer">
                  <input
                    ref={bulkFileInputRef}
                    type="file"
                    multiple
                    accept="image/*,.pdf"
                    className="hidden"
                    onChange={(e) => e.target.files && handleBulkUploadFiles(e.target.files)}
                  />
                  <button
                    onClick={handleBulkUpload}
                    disabled={isBulkUploading}
                    className="flex flex-col items-center disabled:opacity-50"
                  >
                    {isBulkUploading ? (
                      <>
                        <span className="material-symbols-outlined text-4xl mb-2 animate-spin">progress_activity</span>
                        <span className="text-sm font-medium text-center">מעלה קבצים...</span>
                      </>
                    ) : (
                      <>
                        <span className="material-symbols-outlined text-4xl mb-2">add_circle</span>
                        <span className="text-sm font-medium text-center">העלה קבצים נוספים ללא שיוך</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'review' && (
        <div className="flex gap-6 h-[calc(100vh-450px)]">
          {/* Left Panel - Cards List */}
          <div className="w-1/3 flex flex-col bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-700 space-y-4">
              <div className="relative">
                <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-lg">search</span>
                <input
                  className="w-full pr-10 pl-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-primary focus:border-transparent"
                  placeholder="חיפוש לפי שם עובד..."
                  type="text"
                  value={reviewSearchQuery}
                  onChange={(e) => setReviewSearchQuery(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setReviewStatusFilter('NEEDS_REVIEW')}
                  className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
                    reviewStatusFilter === 'NEEDS_REVIEW'
                      ? 'bg-primary text-white shadow-sm'
                      : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  צריך סקירה ({reviewCards.filter(c => c.review_status === 'NEEDS_REVIEW').length})
                </button>
                <button
                  onClick={() => setReviewStatusFilter('APPROVED')}
                  className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
                    reviewStatusFilter === 'APPROVED'
                      ? 'bg-primary text-white shadow-sm'
                      : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  אושר ({reviewCards.filter(c => c.review_status === 'APPROVED').length})
                </button>
                <button
                  onClick={() => setReviewStatusFilter('all')}
                  className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
                    reviewStatusFilter === 'all'
                      ? 'bg-primary text-white shadow-sm'
                      : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  הכל ({reviewCards.length})
                </button>
              </div>
            </div>

            {isLoadingReview ? (
              <div className="flex-1 flex items-center justify-center">
                <span className="material-symbols-outlined text-3xl text-slate-400 animate-spin">progress_activity</span>
              </div>
            ) : filteredReviewCards.length === 0 ? (
              <div className="flex-1 flex items-center justify-center p-6 text-center text-slate-500">
                לא נמצאו כרטיסים
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {filteredReviewCards.map(card => (
                  <button
                    key={card.id}
                    onClick={() => setSelectedCard(card)}
                    className={`w-full p-4 rounded-xl border-2 transition-all text-right ${
                      selectedCard?.id === card.id
                        ? 'border-primary bg-primary/5 shadow-sm ring-4 ring-primary/10'
                        : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <span className="font-bold text-slate-800 dark:text-slate-100">
                        {card.employee?.full_name || 'לא משויך'}
                      </span>
                      {getStatusBadge(card.review_status === 'APPROVED' ? 'APPROVED' : 'EXTRACTED')}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1">
                      <div className="flex items-center gap-1">
                        <span className="material-symbols-outlined text-sm">calendar_today</span>
                        {new Date(card.processing_month).toLocaleDateString('he-IL', { year: 'numeric', month: '2-digit' })}
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="material-symbols-outlined text-sm">fingerprint</span>
                        {card.employee?.passport_id || 'N/A'}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right Panel - Card Details */}
          {selectedCard ? (
            <div className="flex-1 flex flex-col bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
              {/* Top Bar */}
              <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                <div className="text-left">
                  <div className="text-sm font-bold mb-2">{selectedCard.employee?.full_name}</div>
                </div>
                <div className="flex items-center gap-6">
                  <div className="text-center">
                    <div className="text-xs text-slate-500 dark:text-slate-400">סה"כ שעות</div>
                    <div className="text-lg font-bold">
                      {dayEntries.reduce((sum, e) => sum + (calculateTotalHours(e.from_time, e.to_time) || 0), 0).toFixed(1)}
                    </div>
                  </div>
                  <div className="h-8 w-px bg-slate-200 dark:bg-slate-800"></div>
                  <div className="text-center">
                    <div className="text-xs text-slate-500 dark:text-slate-400">ימי עבודה</div>
                    <div className="text-lg font-bold">
                      {dayEntries.filter(e => e.from_time && e.to_time).length}
                    </div>
                  </div>
                </div>
              </div>

              {/* Split Screen */}
              <div className="flex-1 flex overflow-hidden">
                {/* Image Viewer */}
                <div className="w-1/2 p-6 overflow-hidden flex flex-col border-l border-slate-200 dark:border-slate-700">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-bold flex items-center gap-2">
                      <span className="material-symbols-outlined text-primary">image</span>
                      תמונת כרטיס עבודה
                    </h3>
                    <div className="flex gap-1">
                      <button
                        onClick={() => setImageZoom(prev => Math.min(prev + 0.25, 3))}
                        className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors"
                        title="זום +"
                      >
                        <span className="material-symbols-outlined text-sm">zoom_in</span>
                      </button>
                      <button
                        onClick={() => setImageZoom(prev => Math.max(prev - 0.25, 0.5))}
                        className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors"
                        title="זום -"
                      >
                        <span className="material-symbols-outlined text-sm">zoom_out</span>
                      </button>
                      <button
                        onClick={() => setImageRotation(prev => (prev + 90) % 360)}
                        className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors"
                        title="סיבוב"
                      >
                        <span className="material-symbols-outlined text-sm">rotate_right</span>
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 bg-slate-100 dark:bg-slate-950 rounded-lg border border-slate-200 dark:border-slate-800 overflow-auto flex items-center justify-center p-4">
                    {isLoadingImage ? (
                      <span className="material-symbols-outlined text-4xl text-slate-400 animate-spin">progress_activity</span>
                    ) : selectedCardImage ? (
                      <img
                        src={selectedCardImage}
                        alt="Work Card"
                        className="max-w-full shadow-2xl rounded transition-transform"
                        style={{
                          transform: `scale(${imageZoom}) rotate(${imageRotation}deg)`,
                        }}
                      />
                    ) : (
                      <span className="material-symbols-outlined text-4xl text-slate-400">image_not_supported</span>
                    )}
                  </div>
                </div>

                {/* Day Entries Editor */}
                <div className="w-1/2 p-6 flex flex-col">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-bold flex items-center gap-2">
                      <span className="material-symbols-outlined text-primary">edit_note</span>
                      עריכת נתוני שעות
                    </h3>
                    {Object.keys(validationErrors).length === 0 && dayEntries.length > 0 && (
                      <span className="text-[10px] text-green-500 font-bold bg-green-50 dark:bg-green-900/20 px-2 py-1 rounded">
                        <span className="material-symbols-outlined text-xs align-middle ml-1">check_circle</span>
                        ולידציה תקינה
                      </span>
                    )}
                  </div>
                  <div className="flex-1 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden flex flex-col bg-white dark:bg-slate-950">
                    <div className="grid grid-cols-4 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-xs font-bold py-2 text-center sticky top-0">
                      <div>יום</div>
                      <div>מ-</div>
                      <div>עד-</div>
                      <div>סה"כ</div>
                    </div>
                    <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                      {Array.from({ length: 31 }, (_, i) => i + 1).map(day => {
                        const entry = dayEntries.find(e => e.day_of_month === day);
                        const hasError = validationErrors[day];
                        const totalHours = entry ? calculateTotalHours(entry.from_time, entry.to_time) : null;

                        return (
                          <div
                            key={day}
                            className={`grid grid-cols-4 py-1 items-center text-center text-sm ${
                              hasError ? 'bg-red-50 dark:bg-red-900/10' : ''
                            }`}
                          >
                            <div className="font-medium">{day}</div>
                            <div className="px-2">
                              <input
                                className={`w-full h-8 text-xs text-center rounded border focus:ring-primary p-0 ${
                                  hasError
                                    ? 'border-red-300 dark:border-red-900 dark:bg-slate-900 focus:ring-red-500'
                                    : 'border-slate-200 dark:border-slate-700 dark:bg-slate-900'
                                }`}
                                type="text"
                                placeholder="HH:MM"
                                value={entry?.from_time || ''}
                                onChange={(e) => handleDayEntryChange(day, 'from_time', e.target.value)}
                              />
                            </div>
                            <div className="px-2">
                              <input
                                className={`w-full h-8 text-xs text-center rounded border focus:ring-primary p-0 ${
                                  hasError
                                    ? 'border-red-300 dark:border-red-900 dark:bg-slate-900 focus:ring-red-500'
                                    : 'border-slate-200 dark:border-slate-700 dark:bg-slate-900'
                                }`}
                                type="text"
                                placeholder="HH:MM"
                                value={entry?.to_time || ''}
                                onChange={(e) => handleDayEntryChange(day, 'to_time', e.target.value)}
                              />
                            </div>
                            <div className={hasError ? 'text-red-500 font-bold' : 'text-slate-500 font-mono'}>
                              {hasError ? '!' : totalHours !== null ? totalHours.toFixed(1) : '-'}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="p-6 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-950">
                <div className="flex gap-2">
                  <button
                    onClick={handlePreviousCard}
                    disabled={filteredReviewCards.findIndex(c => c.id === selectedCard.id) === 0}
                    className="px-4 py-2 border border-slate-300 dark:border-slate-700 rounded-lg flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span className="material-symbols-outlined text-sm">chevron_right</span>
                    הקודם
                  </button>
                  <button
                    onClick={handleNextCard}
                    disabled={filteredReviewCards.findIndex(c => c.id === selectedCard.id) === filteredReviewCards.length - 1}
                    className="px-4 py-2 border border-slate-300 dark:border-slate-700 rounded-lg flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    הבא
                    <span className="material-symbols-outlined text-sm">chevron_left</span>
                  </button>
                </div>
                <div className="flex gap-4">
                  <button
                    onClick={handleSaveDayEntries}
                    disabled={isSavingDayEntries}
                    className="px-6 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {isSavingDayEntries ? 'שומר...' : 'שמור טיוטה'}
                  </button>
                  <button
                    onClick={handleApproveCard}
                    disabled={isSavingDayEntries || selectedCard.review_status === 'APPROVED'}
                    className="px-8 py-2 bg-primary text-white font-bold rounded-lg shadow-lg shadow-primary/20 hover:bg-blue-600 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span className="material-symbols-outlined">verified</span>
                    {selectedCard.review_status === 'APPROVED' ? 'כבר אושר' : 'אשר וסיים'}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
              <div className="text-center text-slate-500">
                <span className="material-symbols-outlined text-5xl mb-4">rate_review</span>
                <p>בחר כרטיס מהרשימה לסקירה</p>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'matrix' && (
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

// Unknown Upload Card Component
interface UnknownUploadCardProps {
  card: WorkCard;
  employees: Employee[];
  onAssign: (employeeId: string) => void;
}

function UnknownUploadCard({ card, employees, onAssign }: UnknownUploadCardProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoadingImage, setIsLoadingImage] = useState(true);
  const [showImageModal, setShowImageModal] = useState(false);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');

  useEffect(() => {
    const loadImage = async () => {
      try {
        const blob = await getWorkCardFile(card.id);
        const url = URL.createObjectURL(blob);
        setImageUrl(url);
      } catch (err) {
        console.error('Failed to load image:', err);
      } finally {
        setIsLoadingImage(false);
      }
    };

    loadImage();

    return () => {
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    };
  }, [card.id]);

  const handleAssign = () => {
    if (selectedEmployeeId) {
      onAssign(selectedEmployeeId);
      setSelectedEmployeeId('');
    }
  };

  return (
    <>
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm group">
        <div 
          className="h-40 bg-slate-200 dark:bg-slate-700 relative flex items-center justify-center overflow-hidden cursor-pointer"
          onClick={() => setShowImageModal(true)}
        >
          {isLoadingImage ? (
            <span className="material-symbols-outlined text-3xl text-slate-400 animate-spin">progress_activity</span>
          ) : imageUrl ? (
            <>
              <img
                src={imageUrl}
                alt="Work Card"
                className="w-full h-full object-cover opacity-80"
              />
              <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <button className="bg-white text-slate-900 px-3 py-1.5 rounded-lg text-xs font-bold shadow-lg">
                  צפייה מוגדלת
                </button>
              </div>
            </>
          ) : (
            <span className="material-symbols-outlined text-3xl text-slate-400">image_not_supported</span>
          )}
        </div>
        
        <div className="p-4">
          <div className="mb-3">
            <div className="text-xs text-slate-500 dark:text-slate-400">תאריך העלאה</div>
            <div className="text-sm font-medium">
              {new Date(card.created_at).toLocaleString('he-IL', { 
                year: 'numeric', 
                month: '2-digit', 
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
              })}
            </div>
          </div>
          
          <div className="space-y-2">
            <select
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-primary focus:border-transparent"
              value={selectedEmployeeId}
              onChange={(e) => setSelectedEmployeeId(e.target.value)}
            >
              <option value="">בחר עובד</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.full_name} - {emp.passport_id}
                </option>
              ))}
            </select>
            
            <button
              onClick={handleAssign}
              disabled={!selectedEmployeeId}
              className="w-full px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              שיוך לעובד
            </button>
          </div>
        </div>
      </div>

      {/* Image Modal */}
      {showImageModal && imageUrl && (
        <div 
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-6"
          onClick={() => setShowImageModal(false)}
        >
          <div className="relative max-w-5xl max-h-full" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setShowImageModal(false)}
              className="absolute -top-12 left-0 text-white hover:text-slate-300 transition-colors"
            >
              <span className="material-symbols-outlined text-3xl">close</span>
            </button>
            <img
              src={imageUrl}
              alt="Work Card"
              className="max-w-full max-h-[90vh] object-contain rounded-lg"
            />
          </div>
        </div>
      )}
    </>
  );
}
