import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { WorkCard, DayEntry, WorkCardExtraction, Employee } from '../types';
import { getWorkCards, getWorkCardFile, getDayEntries, updateDayEntries, approveWorkCard, deleteWorkCard, triggerExtraction, getExtraction, updateWorkCard } from '../api/workCards';
import { getEmployees } from '../api/employees';
import MonthPicker from './MonthPicker';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../context/AuthContext';
import Modal from './Modal';

interface WorkCardReviewTabProps {
  siteId: string;
  selectedMonth: string;
  onMonthChange: (value: string) => void;
  monthStorageKey: string;
}

// Get number of days in a month
const getDaysInMonth = (yearMonth: string): number => {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(year, month, 0).getDate();
};

// Calculate hours between two times (HH:MM format)
const calculateHours = (from: string | null, to: string | null): number | null => {
  if (!from || !to) return null;
  
  const [fromHour, fromMin] = from.split(':').map(Number);
  const [toHour, toMin] = to.split(':').map(Number);
  
  let totalMinutes = (toHour * 60 + toMin) - (fromHour * 60 + fromMin);
  
  // Handle overnight shifts (e.g., 22:00 to 06:00)
  if (totalMinutes < 0) {
    totalMinutes += 24 * 60;
  }
  
  return Math.round((totalMinutes / 60) * 100) / 100; // Round to 2 decimals
};

interface DayEntryRow {
  day_of_month: number;
  from_time: string;
  to_time: string;
  total_hours: string;
  isDirty: boolean;
}

export default function WorkCardReviewTab({ siteId, selectedMonth, onMonthChange, monthStorageKey }: WorkCardReviewTabProps) {
  const [workCards, setWorkCards] = useState<WorkCard[]>([]);
  const [selectedCard, setSelectedCard] = useState<WorkCard | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [dayEntries, setDayEntries] = useState<DayEntryRow[]>([]);
  const [isLoadingCards, setIsLoadingCards] = useState(false);
  const [isLoadingImage, setIsLoadingImage] = useState(false);
  const [isLoadingEntries, setIsLoadingEntries] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extraction, setExtraction] = useState<WorkCardExtraction | null>(null);
  const [extractionsByCardId, setExtractionsByCardId] = useState<Record<string, WorkCardExtraction | null>>({});
  const [isTriggering, setIsTriggering] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoadingEmployees, setIsLoadingEmployees] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const requestedExtractionsRef = useRef<Set<string>>(new Set());
  const selectedCardIdRef = useRef<string | null>(null);
  const { showToast, ToastContainer } = useToast();
  const { user } = useAuth();

  // Separate cards into assigned and unassigned
  const { assignedCards, unassignedCards } = useMemo(() => {
    const assigned = workCards.filter(card => card.employee_id !== null);
    const unassigned = workCards.filter(card => card.employee_id === null);
    return { assignedCards: assigned, unassignedCards: unassigned };
  }, [workCards]);

  // Check for identity mismatch between extracted passport and assigned employee
  const hasIdentityMismatch = useMemo(() => {
    if (!selectedCard?.employee?.passport_id || !extraction?.extracted_passport_id) {
      return false;
    }
    return selectedCard.employee.passport_id.trim() !== extraction.extracted_passport_id.trim();
  }, [selectedCard?.employee?.passport_id, extraction?.extracted_passport_id]);

  useEffect(() => {
    selectedCardIdRef.current = selectedCard?.id ?? null;
  }, [selectedCard?.id]);

  const fetchWorkCards = useCallback(async () => {
    setIsLoadingCards(true);
    setError(null);
    try {
      const cards = await getWorkCards({
        site_id: siteId,
        processing_month: selectedMonth,
        include_employee: true,
      });
      setWorkCards(cards);
      // Clear selection when month changes
      setSelectedCard(null);
      setImageUrl(null);
      setDayEntries([]);
      setExtraction(null);
      setExtractionsByCardId({});
      requestedExtractionsRef.current = new Set();
    } catch (err) {
      console.error('Failed to fetch work cards:', err);
      setError('????? ?????? ?????? ??????');
    } finally {
      setIsLoadingCards(false);
    }
  }, [siteId, selectedMonth]);

  // Fetch work cards when month changes
  useEffect(() => {
    if (siteId && selectedMonth) {
      fetchWorkCards();
    }
  }, [siteId, selectedMonth, fetchWorkCards]);

  // Preload extraction info per card so the sidebar doesn't show "mixed" data
  useEffect(() => {
    if (!unassignedCards.length) return;

    let cancelled = false;

    const idsToFetch = unassignedCards
      .map(card => card.id)
      .filter(id => !(id in extractionsByCardId) && !requestedExtractionsRef.current.has(id));

    if (!idsToFetch.length) return;

    idsToFetch.forEach(id => requestedExtractionsRef.current.add(id));

    (async () => {
      const results = await Promise.allSettled(idsToFetch.map(id => getExtraction(id)));
      if (cancelled) return;

      setExtractionsByCardId(prev => {
        const next = { ...prev };
        results.forEach((res, idx) => {
          const cardId = idsToFetch[idx];
          next[cardId] = res.status === 'fulfilled' ? res.value : null;
        });
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [unassignedCards, extractionsByCardId]);

  // Fetch employees for assignment modal
  useEffect(() => {
    if (!siteId) return;

    const fetchEmployees = async () => {
      setIsLoadingEmployees(true);
      try {
        const employeesList = await getEmployees({ site_id: siteId, active: true });
        setEmployees(employeesList);
      } catch (err) {
        console.error('Failed to fetch employees:', err);
      } finally {
        setIsLoadingEmployees(false);
      }
    };

    fetchEmployees();
  }, [siteId]);

  // Initialize empty day entries for the selected month
  const initializeDayEntries = useCallback((existingEntries: DayEntry[]) => {
    const daysInMonth = getDaysInMonth(selectedMonth);
    const entriesMap = new Map<number, DayEntry>();
    
    existingEntries.forEach(entry => {
      entriesMap.set(entry.day_of_month, entry);
    });

    const rows: DayEntryRow[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const existing = entriesMap.get(day);
      rows.push({
        day_of_month: day,
        from_time: existing?.from_time || '',
        to_time: existing?.to_time || '',
        total_hours: existing?.total_hours?.toString() || '',
        isDirty: false,
      });
    }
    setDayEntries(rows);
  }, [selectedMonth]);

  // Revoke object URLs to avoid leaking memory when switching cards
  useEffect(() => {
    return () => {
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    };
  }, [imageUrl]);

  // Fetch image and day entries when card is selected
  useEffect(() => {
    if (!selectedCard) return;

    let cancelled = false;
    const cardId = selectedCard.id;

    // Clear previous UI while loading the next card
    setImageUrl(null);

    const fetchCardDetails = async () => {
      setIsLoadingImage(true);
      setIsLoadingEntries(true);

      try {
        const [blob, entries] = await Promise.all([
          getWorkCardFile(cardId),
          getDayEntries(cardId),
        ]);

        if (cancelled || selectedCardIdRef.current !== cardId) return;

        const url = URL.createObjectURL(blob);
        setImageUrl(url);

        initializeDayEntries(entries);
      } catch (err) {
        console.error('Failed to fetch card details:', err);
        showToast('שגיאה בטעינת פרטי הכרטיס', 'error');
      } finally {
        if (!cancelled && selectedCardIdRef.current === cardId) {
          setIsLoadingImage(false);
          setIsLoadingEntries(false);
        }
      }
    };

    fetchCardDetails();

    return () => {
      cancelled = true;
    };
  }, [selectedCard?.id, initializeDayEntries, showToast]);

  // Fetch extraction status when card is selected
  useEffect(() => {
    if (!selectedCard) {
      setExtraction(null);
      return;
    }

    let cancelled = false;
    const cardId = selectedCard.id;

    // Clear previous card extraction immediately to avoid UI mixing between cards
    setExtraction(null);

    const fetchExtraction = async () => {
      try {
        const extractionData = await getExtraction(cardId);
        if (cancelled || selectedCardIdRef.current !== cardId) return;
        setExtraction(extractionData);
        setExtractionsByCardId(prev => ({ ...prev, [cardId]: extractionData }));
      } catch {
        if (cancelled || selectedCardIdRef.current !== cardId) return;
        // No extraction found - that's OK
        setExtraction(null);
        setExtractionsByCardId(prev => ({ ...prev, [cardId]: null }));
      }
    };

    fetchExtraction();

    return () => {
      cancelled = true;
    };
  }, [selectedCard?.id]);

  // Poll extraction status when PENDING or RUNNING
  useEffect(() => {
    // Clear any existing polling
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }

    // Start polling if extraction is in progress
    if (!extraction || !selectedCard || (extraction.status !== 'PENDING' && extraction.status !== 'RUNNING')) {
      return;
    }

    const cardId = selectedCard.id;

    pollingRef.current = setInterval(async () => {
      try {
        const extractionData = await getExtraction(cardId);

        // If the user switched cards while we were polling, ignore these results
        if (selectedCardIdRef.current !== cardId) return;

        setExtraction(extractionData);
        setExtractionsByCardId(prev => ({ ...prev, [cardId]: extractionData }));

        // If extraction completed, refresh day entries
        if (extractionData.status === 'DONE') {
          // Stop polling immediately to avoid duplicate toasts/updates
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }

          const entries = await getDayEntries(cardId);
          if (selectedCardIdRef.current !== cardId) return;
          initializeDayEntries(entries);

          // Refresh cards to reflect auto-assignment after extraction
          try {
            const cards = await getWorkCards({
              site_id: siteId,
              processing_month: selectedMonth,
              include_employee: true,
            });
            if (selectedCardIdRef.current !== cardId) return;
            setWorkCards(cards);
            const refreshed = cards.find(c => c.id === cardId) || null;
            if (refreshed) {
              setSelectedCard(prev => (prev?.id === cardId ? refreshed : prev));
            }
          } catch (refreshErr) {
            console.error('Failed to refresh work cards after extraction:', refreshErr);
          }
            showToast('חילוץ הנתונים הסתיים בהצלחה', 'success');
        } else if (extractionData.status === 'FAILED') {
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
            showToast(`חילוץ נכשל: ${extractionData.last_error || 'שגיאה לא ידועה'}`, 'error');
        }
      } catch (err) {
        console.error('Failed to poll extraction status:', err);
      }
    }, 3000); // Poll every 3 seconds

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [extraction?.status, selectedCard?.id, initializeDayEntries, showToast, siteId, selectedMonth]);

  // Trigger extraction
  const handleTriggerExtraction = async () => {
    if (!selectedCard) return;

    setIsTriggering(true);
    try {
      const cardId = selectedCard.id;
      const extractionData = await triggerExtraction(cardId);
      setExtraction(extractionData);
      setExtractionsByCardId(prev => ({ ...prev, [cardId]: extractionData }));
      showToast('חילוץ נתונים הופעל', 'info');
    } catch (err) {
      console.error('Failed to trigger extraction:', err);
      showToast('שגיאה בהפעלת חילוץ', 'error');
    } finally {
      setIsTriggering(false);
    }
  };

  // Handle entry field change
  const handleEntryChange = (dayIndex: number, field: 'from_time' | 'to_time' | 'total_hours', value: string) => {
    setDayEntries(prev => {
      const updated = [...prev];
      updated[dayIndex] = {
        ...updated[dayIndex],
        [field]: value,
        isDirty: true,
      };

      // Auto-calculate total_hours when from/to change
      if (field === 'from_time' || field === 'to_time') {
        const fromTime = field === 'from_time' ? value : updated[dayIndex].from_time;
        const toTime = field === 'to_time' ? value : updated[dayIndex].to_time;
        const calculatedHours = calculateHours(fromTime || null, toTime || null);
        if (calculatedHours !== null) {
          updated[dayIndex].total_hours = calculatedHours.toString();
        }
      }

      return updated;
    });
  };

  // Save day entries
  const handleSave = async () => {
    if (!selectedCard) return;

    const dirtyEntries = dayEntries.filter(e => e.isDirty && (e.from_time || e.to_time || e.total_hours));
    
    if (dirtyEntries.length === 0) {
      showToast('אין שינויים לשמירה', 'info');
      return;
    }

    setIsSaving(true);
    try {
      const entries = dirtyEntries.map(e => ({
        day_of_month: e.day_of_month,
        from_time: e.from_time || null,
        to_time: e.to_time || null,
        total_hours: e.total_hours ? parseFloat(e.total_hours) : null,
      }));

      await updateDayEntries(selectedCard.id, { entries });
      
      // Mark entries as not dirty
      setDayEntries(prev => prev.map(e => ({ ...e, isDirty: false })));
      
      showToast('הנתונים נשמרו בהצלחה', 'success');
    } catch (err) {
      console.error('Failed to save day entries:', err);
      showToast('שגיאה בשמירת הנתונים', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleApprove = async () => {
    if (!selectedCard || !user) return;
    try {
      await approveWorkCard(selectedCard.id, user.id);
      showToast('הכרטיס אושר בהצלחה', 'success');
      
      // Update local state
      setWorkCards(prev => prev.map(c => 
        c.id === selectedCard.id ? { ...c, review_status: 'APPROVED' } : c
      ));
      setSelectedCard(prev => prev ? { ...prev, review_status: 'APPROVED' } : null);
    } catch (err) {
      console.error('Failed to approve card:', err);
      showToast('שגיאה באישור הכרטיס', 'error');
    }
  };

  const handleReject = async () => {
    if (!selectedCard) return;
    try {
      await deleteWorkCard(selectedCard.id);
      showToast('הכרטיס נדחה ונמחק בהצלחה', 'success');
      
      // Remove from list
      setWorkCards(prev => prev.filter(c => c.id !== selectedCard.id));
      setSelectedCard(null);
      setImageUrl(null);
      setDayEntries([]);
      setShowRejectModal(false);
    } catch (err) {
      console.error('Failed to reject card:', err);
      showToast('שגיאה בדחיית הכרטיס', 'error');
    }
  };

  // Assign an employee to an unassigned work card
  const handleAssignEmployee = async (employeeId: string) => {
    if (!selectedCard) return;
    setIsAssigning(true);
    try {
      const updatedCard = await updateWorkCard(selectedCard.id, { employee_id: employeeId });
      
      // Find the employee to update local state
      const employee = employees.find(e => e.id === employeeId);
      
      // Update local state with the assigned employee
      const cardWithEmployee = { ...updatedCard, employee };
      setWorkCards(prev => prev.map(c => 
        c.id === selectedCard.id ? cardWithEmployee : c
      ));
      setSelectedCard(cardWithEmployee);
      setShowAssignModal(false);
      showToast('העובד שויך בהצלחה', 'success');
    } catch (err) {
      console.error('Failed to assign employee:', err);
      showToast('שגיאה בשיוך העובד', 'error');
    } finally {
      setIsAssigning(false);
    }
  };

  // Check if there are unsaved changes
  const hasUnsavedChanges = dayEntries.some(e => e.isDirty);

  return (
    <div className="flex flex-col h-full">
      <ToastContainer />
      
      {/* Header with Month Picker */}
      <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
        <h2 className="text-lg font-bold">סקירת כרטיסי עבודה</h2>
        <MonthPicker
          value={selectedMonth}
          onChange={onMonthChange}
          storageKey={monthStorageKey}
        />
      </div>

      {/* Main Content */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar - Work Cards List */}
        <div className="w-80 border-l border-slate-200 dark:border-slate-700 flex flex-col bg-slate-50 dark:bg-slate-900/50">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
            <span className="text-sm text-slate-600 dark:text-slate-400">
              {workCards.length} כרטיסים
            </span>
          </div>

          {isLoadingCards ? (
            <div className="flex-1 flex items-center justify-center">
              <span className="material-symbols-outlined text-2xl text-slate-400 animate-spin">progress_activity</span>
            </div>
          ) : error ? (
            <div className="p-4 text-center text-red-500">{error}</div>
          ) : workCards.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-4">
              <span className="material-symbols-outlined text-4xl text-slate-300 dark:text-slate-600 mb-2">folder_open</span>
              <p className="text-sm text-slate-500 dark:text-slate-400">אין כרטיסי עבודה לחודש זה</p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              {/* Unassigned Cards Section */}
              {unassignedCards.length > 0 && (
                <div>
                  <div className="px-4 py-2 bg-orange-50 dark:bg-orange-900/20 border-b border-orange-200 dark:border-orange-800 sticky top-0 z-10">
                    <div className="flex items-center gap-2 text-orange-700 dark:text-orange-400">
                      <span className="material-symbols-outlined text-sm">warning</span>
                      <span className="text-xs font-semibold">ממתינים לשיוך ({unassignedCards.length})</span>
                    </div>
                  </div>
                  {unassignedCards.map((card) => (
                    <button
                      key={card.id}
                      onClick={() => setSelectedCard(card)}
                      className={`w-full px-4 py-3 text-right border-b border-orange-200 dark:border-orange-800 hover:bg-orange-50 dark:hover:bg-orange-900/30 transition-colors bg-orange-50/50 dark:bg-orange-900/10 ${
                        selectedCard?.id === card.id
                          ? 'bg-primary/10 border-r-4 border-r-primary'
                          : ''
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-900/40 text-orange-600 flex items-center justify-center font-bold text-xs uppercase shrink-0">
                          <span className="material-symbols-outlined text-lg">help</span>
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium text-slate-900 dark:text-white truncate">
                            {extractionsByCardId[card.id]?.extracted_employee_name || 'עובד לא מזוהה'}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-400">
                              ממתין לשיוך
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Assigned Cards Section */}
              {assignedCards.length > 0 && (
                <div>
                  {unassignedCards.length > 0 && (
                    <div className="px-4 py-2 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-10">
                      <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">כרטיסים משויכים ({assignedCards.length})</span>
                    </div>
                  )}
                  {assignedCards.map((card) => (
                    <button
                      key={card.id}
                      onClick={() => setSelectedCard(card)}
                      className={`w-full px-4 py-3 text-right border-b border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ${
                        selectedCard?.id === card.id
                          ? 'bg-primary/10 border-r-4 border-r-primary'
                          : ''
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 flex items-center justify-center font-bold text-xs uppercase shrink-0">
                          {card.employee?.full_name
                            ? card.employee.full_name
                                .split(' ')
                                .map((word) => word[0])
                                .join('')
                                .slice(0, 2)
                            : '??'}
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium text-slate-900 dark:text-white truncate">
                            {card.employee?.full_name || 'עובד לא ידוע'}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                              card.review_status === 'APPROVED'
                                ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-400'
                                : card.review_status === 'NEEDS_REVIEW'
                                ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-400'
                                : 'bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-400'
                            }`}>
                              {card.review_status === 'APPROVED' ? 'מאושר' :
                               card.review_status === 'NEEDS_REVIEW' ? 'ממתין לסקירה' :
                               card.review_status === 'NEEDS_ASSIGNMENT' ? 'ממתין לשיוך' :
                               card.review_status}
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Main Area - Image and Day Entries */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {!selectedCard ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
              <span className="material-symbols-outlined text-6xl text-slate-300 dark:text-slate-600 mb-4">touch_app</span>
              <h3 className="text-lg font-medium text-slate-600 dark:text-slate-400 mb-2">בחר כרטיס עבודה</h3>
              <p className="text-sm text-slate-500 dark:text-slate-500">בחר כרטיס מהרשימה משמאל לצפייה ועריכה</p>
            </div>
          ) : (
            <div className="flex-1 flex min-h-0 overflow-hidden">
              {/* Image Panel */}
              <div className="w-1/2 border-l border-slate-200 dark:border-slate-700 flex flex-col bg-slate-100 dark:bg-slate-900">
                <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                  <h4 className="font-medium text-slate-900 dark:text-white flex items-center gap-2">
                    <span className="material-symbols-outlined text-lg">image</span>
                    תמונת כרטיס
                  </h4>
                </div>
                <div className="flex-1 overflow-auto p-4 flex items-start justify-center">
                  {isLoadingImage ? (
                    <div className="flex items-center justify-center h-full">
                      <span className="material-symbols-outlined text-3xl text-slate-400 animate-spin">progress_activity</span>
                    </div>
                  ) : imageUrl ? (
                    <img
                      src={imageUrl}
                      alt="Work Card"
                      className="max-w-full h-auto rounded-lg shadow-lg"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-slate-400">
                      <span className="material-symbols-outlined text-4xl mb-2">broken_image</span>
                      <span className="text-sm">לא ניתן לטעון את התמונה</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Day Entries Panel */}
              <div className="w-1/2 flex flex-col min-h-0">
                <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex flex-col gap-3">
                  {/* Row 1: Title + Extraction area */}
                  <div className="flex items-center justify-between gap-4">
                    <h4 className="font-medium text-slate-900 dark:text-white flex items-center gap-2 shrink-0">
                      <span className="material-symbols-outlined text-lg">table_chart</span>
                      שעות עבודה
                    </h4>
                    {/* Extraction controls - separate area with spacing */}
                    <div className="flex items-center gap-3 min-w-0">
                      <button
                        onClick={handleTriggerExtraction}
                        disabled={isTriggering || extraction?.status === 'PENDING' || extraction?.status === 'RUNNING'}
                        className="px-4 py-2 bg-purple-50 text-purple-600 rounded-lg hover:bg-purple-100 transition-colors font-medium text-sm flex items-center gap-2 border border-purple-200 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                        title="חלץ נתונים מהתמונה"
                      >
                        {isTriggering || extraction?.status === 'PENDING' || extraction?.status === 'RUNNING' ? (
                          <>
                            <span className="material-symbols-outlined text-lg animate-spin">progress_activity</span>
                            <span>מחלץ...</span>
                          </>
                        ) : (
                          <>
                            <span className="material-symbols-outlined text-lg">auto_fix_high</span>
                            <span>חלץ נתונים</span>
                          </>
                        )}
                      </button>
                      {/* Extraction Status Badge - only when extraction exists */}
                      {extraction && (
                        <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium gap-1 shrink-0 ${
                          extraction.status === 'DONE'
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-400'
                            : extraction.status === 'FAILED'
                            ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-400'
                            : extraction.status === 'RUNNING'
                            ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-400'
                            : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-400'
                        }`}>
                          {(extraction.status === 'PENDING' || extraction.status === 'RUNNING') && (
                            <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                          )}
                          {extraction.status === 'DONE' && <span className="material-symbols-outlined text-sm">check_circle</span>}
                          {extraction.status === 'FAILED' && <span className="material-symbols-outlined text-sm">error</span>}
                          {extraction.status === 'PENDING' ? 'ממתין לחילוץ' :
                           extraction.status === 'RUNNING' ? 'מחלץ...' :
                           extraction.status === 'DONE' ? 'חולץ' :
                           'חילוץ נכשל'}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Identity Mismatch Warning */}
                  {hasIdentityMismatch && (
                    <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                      <span className="material-symbols-outlined text-amber-600 dark:text-amber-400">warning</span>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                          אי-התאמה בזיהוי
                        </p>
                        <p className="text-xs text-amber-700 dark:text-amber-400">
                          ת.ז/דרכון בכרטיס: <strong>{extraction?.extracted_passport_id}</strong> | 
                          ת.ז/דרכון עובד: <strong>{selectedCard.employee?.passport_id}</strong>
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Unassigned Card - Assignment Section */}
                  {!selectedCard.employee_id && (
                    <div className="flex items-center gap-2 p-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg">
                      <span className="material-symbols-outlined text-orange-600 dark:text-orange-400">person_add</span>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-orange-800 dark:text-orange-300">
                          כרטיס לא משויך לעובד
                        </p>
                        {extraction?.extracted_passport_id && (
                          <p className="text-xs text-orange-700 dark:text-orange-400">
                            ת.ז/דרכון מזוהה: <strong>{extraction.extracted_passport_id}</strong>
                            {extraction.extracted_employee_name && (
                              <> | שם מזוהה: <strong>{extraction.extracted_employee_name}</strong></>
                            )}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => setShowAssignModal(true)}
                        className="px-3 py-1.5 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors font-medium text-sm flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-sm">link</span>
                        <span>שייך עובד</span>
                      </button>
                    </div>
                  )}

                  {/* Row 2: Save + Approve/Reject (icon-only) */}
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={handleSave}
                      disabled={isSaving || !hasUnsavedChanges}
                      className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      {isSaving ? (
                        <>
                          <span className="material-symbols-outlined text-lg animate-spin">progress_activity</span>
                          <span>שומר...</span>
                        </>
                      ) : (
                        <>
                          <span className="material-symbols-outlined text-lg">save</span>
                          <span>שמור</span>
                        </>
                      )}
                    </button>
                    <div className="w-px h-6 bg-slate-200 dark:bg-slate-700" />
                    <button
                      onClick={handleApprove}
                      disabled={selectedCard.review_status === 'APPROVED' || !selectedCard.employee_id}
                      className={`w-9 h-9 rounded-lg transition-colors flex items-center justify-center border ${
                        selectedCard.review_status === 'APPROVED'
                          ? 'bg-green-50 text-green-600 border-green-200 cursor-default'
                          : !selectedCard.employee_id
                          ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                          : 'bg-green-600 text-white hover:bg-green-700 border-transparent'
                      }`}
                      title={!selectedCard.employee_id ? 'יש לשייך עובד תחילה' : 'אשר כרטיס'}
                    >
                      <span className="material-symbols-outlined text-lg">check</span>
                    </button>
                    <button
                      onClick={() => setShowRejectModal(true)}
                      className="w-9 h-9 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors flex items-center justify-center border border-red-200"
                      title="דחה כרטיס (מחק)"
                    >
                      <span className="material-symbols-outlined text-lg">close</span>
                    </button>
                  </div>
                </div>

                {isLoadingEntries ? (
                  <div className="flex-1 flex items-center justify-center">
                    <span className="material-symbols-outlined text-3xl text-slate-400 animate-spin">progress_activity</span>
                  </div>
                ) : (
                  <div className="flex-1 overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800 z-10">
                        <tr className="text-slate-600 dark:text-slate-400">
                          <th className="px-3 py-2 text-center font-medium border-b border-slate-200 dark:border-slate-700 w-16">יום</th>
                          <th className="px-3 py-2 text-center font-medium border-b border-slate-200 dark:border-slate-700">כניסה</th>
                          <th className="px-3 py-2 text-center font-medium border-b border-slate-200 dark:border-slate-700">יציאה</th>
                          <th className="px-3 py-2 text-center font-medium border-b border-slate-200 dark:border-slate-700">סה"כ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dayEntries.map((entry, index) => (
                          <tr
                            key={entry.day_of_month}
                            className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${
                              entry.isDirty ? 'bg-yellow-50 dark:bg-yellow-900/10' : ''
                            }`}
                          >
                            <td className="px-3 py-2 text-center font-medium text-slate-900 dark:text-white border-b border-slate-100 dark:border-slate-700">
                              {entry.day_of_month}
                            </td>
                            <td className="px-2 py-1 border-b border-slate-100 dark:border-slate-700">
                              <input
                                type="time"
                                value={entry.from_time}
                                onChange={(e) => handleEntryChange(index, 'from_time', e.target.value)}
                                className="w-full px-2 py-1 text-center bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                              />
                            </td>
                            <td className="px-2 py-1 border-b border-slate-100 dark:border-slate-700">
                              <input
                                type="time"
                                value={entry.to_time}
                                onChange={(e) => handleEntryChange(index, 'to_time', e.target.value)}
                                className="w-full px-2 py-1 text-center bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                              />
                            </td>
                            <td className="px-2 py-1 border-b border-slate-100 dark:border-slate-700">
                              <input
                                type="number"
                                step="0.25"
                                min="0"
                                max="24"
                                value={entry.total_hours}
                                onChange={(e) => handleEntryChange(index, 'total_hours', e.target.value)}
                                className="w-full px-2 py-1 text-center bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                                placeholder="0"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      <Modal
        isOpen={showRejectModal}
        onClose={() => setShowRejectModal(false)}
        title="דחיית כרטיס עבודה"
        maxWidth="sm"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3 text-amber-600 bg-amber-50 p-4 rounded-lg border border-amber-100">
            <span className="material-symbols-outlined text-2xl">warning</span>
            <p className="text-sm font-medium">פעולה זו היא בלתי הפיכה!</p>
          </div>
          <p className="text-slate-600 dark:text-slate-300">
            האם אתה בטוח שברצונך לדחות את כרטיס העבודה? פעולה זו תמחק את הכרטיס ואת כל הנתונים הקשורים אליו מהמערכת.
          </p>
          <div className="flex justify-end gap-3 pt-4">
            <button
              onClick={() => setShowRejectModal(false)}
              className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg transition-colors font-medium text-sm"
            >
              ביטול
            </button>
            <button
              onClick={handleReject}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium text-sm flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-lg">delete</span>
              <span>דחה ומחק</span>
            </button>
          </div>
        </div>
      </Modal>

      {/* Assign Employee Modal */}
      <Modal
        isOpen={showAssignModal}
        onClose={() => setShowAssignModal(false)}
        title="שיוך עובד לכרטיס"
        maxWidth="md"
      >
        <div className="space-y-4">
          {/* Extraction Info */}
          {extraction && (extraction.extracted_passport_id || extraction.extracted_employee_name) && (
            <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <p className="text-sm font-medium text-blue-800 dark:text-blue-300 mb-1">
                פרטים מזוהים מהכרטיס:
              </p>
              <div className="text-xs text-blue-700 dark:text-blue-400 space-y-1">
                {extraction.extracted_employee_name && (
                  <p>שם: <strong>{extraction.extracted_employee_name}</strong></p>
                )}
                {extraction.extracted_passport_id && (
                  <p>ת.ז/דרכון: <strong>{extraction.extracted_passport_id}</strong></p>
                )}
              </div>
            </div>
          )}

          {/* Employee List */}
          <div className="border border-slate-200 dark:border-slate-700 rounded-lg max-h-80 overflow-y-auto">
            {isLoadingEmployees ? (
              <div className="p-8 text-center">
                <span className="material-symbols-outlined text-2xl text-slate-400 animate-spin">progress_activity</span>
              </div>
            ) : employees.length === 0 ? (
              <div className="p-8 text-center text-slate-500">
                <span className="material-symbols-outlined text-3xl mb-2">person_off</span>
                <p>לא נמצאו עובדים באתר זה</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-700">
                {employees.map((employee) => {
                  const isMatch = extraction?.extracted_passport_id && 
                    employee.passport_id?.trim() === extraction.extracted_passport_id.trim();
                  return (
                    <button
                      key={employee.id}
                      onClick={() => handleAssignEmployee(employee.id)}
                      disabled={isAssigning}
                      className={`w-full px-4 py-3 text-right hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-3 disabled:opacity-50 ${
                        isMatch ? 'bg-green-50 dark:bg-green-900/20' : ''
                      }`}
                    >
                      <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 flex items-center justify-center font-bold text-xs uppercase shrink-0">
                        {employee.full_name
                          .split(' ')
                          .map((word) => word[0])
                          .join('')
                          .slice(0, 2)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-slate-900 dark:text-white truncate flex items-center gap-2">
                          {employee.full_name}
                          {isMatch && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-400">
                              התאמה!
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          ת.ז/דרכון: {employee.passport_id || 'לא הוזן'}
                        </div>
                      </div>
                      <span className="material-symbols-outlined text-slate-400">chevron_left</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Cancel Button */}
          <div className="flex justify-end">
            <button
              onClick={() => setShowAssignModal(false)}
              disabled={isAssigning}
              className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg transition-colors font-medium text-sm disabled:opacity-50"
            >
              ביטול
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
