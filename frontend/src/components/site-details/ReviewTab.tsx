import { useState, useEffect } from 'react';
import type { WorkCard, DayEntry } from '../../types';
import { 
  getWorkCards, 
  getWorkCardFile, 
  getDayEntries, 
  updateDayEntries, 
  approveWorkCard 
} from '../../api/workCards';
import { useAuth } from '../../context/AuthContext';

interface ReviewTabProps {
  siteId: string;
  selectedMonth: string;
  initialCardId: string | null;
  onApproveSuccess: () => Promise<void>;
  showToast: (message: string, type: 'success' | 'error') => void;
}

export default function ReviewTab({
  siteId,
  selectedMonth,
  initialCardId,
  onApproveSuccess,
  showToast
}: ReviewTabProps) {
  const { user } = useAuth();

  // State
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

  // Fetch review cards on mount or when month changes
  useEffect(() => {
    if (siteId && selectedMonth) {
      fetchReviewCards();
    }
  }, [siteId, selectedMonth]);

  // Handle initial card selection
  useEffect(() => {
    if (initialCardId && reviewCards.length > 0) {
      const card = reviewCards.find(c => c.id === initialCardId);
      if (card) {
        setSelectedCard(card);
        // If the card is approved, we might want to switch filter to show it
        if (card.review_status === 'APPROVED') {
          setReviewStatusFilter('APPROVED');
        } else {
           setReviewStatusFilter('NEEDS_REVIEW');
        }
      }
    } else if (reviewCards.length > 0 && !selectedCard && !initialCardId) {
       // Auto select first card if no initial selection
       // But only if we have filtered cards? 
       // The original logic was:
       // if (assignedCards.length > 0 && !selectedCard) { setSelectedCard(assignedCards[0]); }
       // This was inside fetchReviewCards.
    }
  }, [initialCardId, reviewCards]);

  // Filter review cards
  useEffect(() => {
    let filtered = reviewCards;

    // Filter by status
    if (reviewStatusFilter !== 'all') {
      filtered = filtered.filter(card => card.review_status === reviewStatusFilter);
    }

    // Filter by search query
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

    return () => {
      if (selectedCardImage) {
        URL.revokeObjectURL(selectedCardImage);
      }
    };
  }, [selectedCard]);

  const fetchReviewCards = async () => {
    setIsLoadingReview(true);
    try {
      const cards = await getWorkCards({
        site_id: siteId,
        processing_month: selectedMonth,
      });
      // Only show cards with assigned employees
      const assignedCards = cards.filter(card => card.employee_id !== null);
      setReviewCards(assignedCards);

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/f58507d7-2586-4617-8b51-be91d6ef2bc8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ReviewTab.tsx:fetchReviewCards',message:'Fetched review cards counts',data:{siteId,selectedMonth,total:cards.length,assigned:assignedCards.length,needsReview:assignedCards.filter(c=>c.review_status==="NEEDS_REVIEW").length,approved:assignedCards.filter(c=>c.review_status==="APPROVED").length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H4'})}).catch(()=>{});
      // #endregion

      // Initial selection logic if not provided by prop
      if (assignedCards.length > 0 && !selectedCard && !initialCardId) {
         // Prefer NEEDS_REVIEW cards
         const needsReview = assignedCards.find(c => c.review_status === 'NEEDS_REVIEW');
         setSelectedCard(needsReview || assignedCards[0]);
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
    return Math.round((diffMinutes / 60) * 100) / 100;
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

    await handleSaveDayEntries();

    try {
      await approveWorkCard(selectedCard.id, user.id);
      showToast('הכרטיס אושר בהצלחה', 'success');
      
      await onApproveSuccess();
      await fetchReviewCards();
      
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

  const getStatusBadge = (status: string) => {
    const badges: Record<string, { label: string; color: string }> = {
      'APPROVED': { label: 'אושר', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
      'EXTRACTED': { label: 'ממתין לבדיקה', color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' },
      'NEEDS_REVIEW': { label: 'ממתין לבדיקה', color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' },
    };
    
    // Default fallback
    const badge = badges[status] || { label: status, color: 'bg-slate-100 text-slate-600' };

    return (
      <span className={`px-3 py-1 rounded-full text-xs font-medium ${badge.color}`}>
        {badge.label}
      </span>
    );
  };

  return (
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
                  {getStatusBadge(card.review_status)}
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
  );
}
