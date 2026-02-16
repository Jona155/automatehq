import { useState, useEffect, useCallback, useRef, useMemo, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
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

// Normalize backend/API time strings to HH:MM for HTML time inputs and save payloads
const normalizeTimeToHourMinute = (timeValue: string | null | undefined): string => {
  if (!timeValue) return '';
  const match = timeValue.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return timeValue;
  const hours = match[1].padStart(2, '0');
  const minutes = match[2];
  return `${hours}:${minutes}`;
};

type ReviewMode = 'queue' | 'focus';

interface DayEntryRow {
  day_of_month: number;
  from_time: string;
  to_time: string;
  total_hours: string;
  latest_from_time: string;
  latest_to_time: string;
  latest_total_hours: string;
  previousEntry: DayEntry['previous_entry'];
  isDirty: boolean;
  isLocked: boolean;
  hasConflict: boolean;
  conflictType: 'WITH_APPROVED' | 'WITH_PENDING' | null;
  lockedFromPrevious: boolean;
  resolvedApprovedConflict: 'KEEP_PREVIOUS' | 'USE_LATEST' | null;
}

interface DayImageZone {
  day: number;
  confidence: number | null;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
}

const normalizeDayZone = (raw: unknown): DayImageZone | null => {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const dayValue = source.day ?? source.day_of_month;
  const day = typeof dayValue === 'number' ? dayValue : Number(dayValue);
  if (!Number.isFinite(day)) return null;

  const confidenceValue = source.confidence;
  const confidence = typeof confidenceValue === 'number' ? confidenceValue : null;

  const bboxSource = source.bbox;
  if (!bboxSource || typeof bboxSource !== 'object') {
    return { day, confidence, bbox: null };
  }

  const bboxData = bboxSource as Record<string, unknown>;
  const x = Number(bboxData.x ?? bboxData.left);
  const y = Number(bboxData.y ?? bboxData.top);
  const width = Number(bboxData.width ?? bboxData.w);
  const height = Number(bboxData.height ?? bboxData.h);

  if (![x, y, width, height].every(Number.isFinite)) {
    return { day, confidence, bbox: null };
  }

  return {
    day,
    confidence,
    bbox: { x, y, width, height },
  };
};

const useDayImageZoneMapping = (extraction: WorkCardExtraction | null) => {
  return useMemo(() => {
    if (!extraction) {
      return {
        zoneByDay: new Map<number, DayImageZone>(),
        getZoneForDay: (_day: number) => null as DayImageZone | null,
      };
    }

    const extractionWithFutureData = extraction as WorkCardExtraction & Record<string, unknown>;
    const rawZones = extractionWithFutureData.day_mappings ?? extractionWithFutureData.day_coordinates;
    const zonesList = Array.isArray(rawZones) ? rawZones : [];
    const zoneByDay = new Map<number, DayImageZone>();

    zonesList.forEach((rawZone) => {
      const normalized = normalizeDayZone(rawZone);
      if (normalized) {
        zoneByDay.set(normalized.day, normalized);
      }
    });

    return {
      zoneByDay,
      getZoneForDay: (day: number) => zoneByDay.get(day) ?? null,
    };
  }, [extraction]);
};

function WorkCardReviewTab({ siteId, selectedMonth, onMonthChange, monthStorageKey }: WorkCardReviewTabProps) {
  const AUTO_ADVANCE_STORAGE_KEY = 'workCardReview:autoAdvance';
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
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [approvedConflictDecisions, setApprovedConflictDecisions] = useState<Record<number, 'KEEP_PREVIOUS' | 'USE_LATEST'>>({});
  const [draftConflictDecisions, setDraftConflictDecisions] = useState<Record<number, 'KEEP_PREVIOUS' | 'USE_LATEST'>>({});
  const [error, setError] = useState<string | null>(null);
  const [extraction, setExtraction] = useState<WorkCardExtraction | null>(null);
  const [extractionsByCardId, setExtractionsByCardId] = useState<Record<string, WorkCardExtraction | null>>({});
  const [isTriggering, setIsTriggering] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoadingEmployees, setIsLoadingEmployees] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);
  const [cardSearch, setCardSearch] = useState('');
  const [listFilter, setListFilter] = useState<'all' | 'unassigned' | 'assigned'>('all');
  const [layoutMode, setLayoutMode] = useState<'balanced' | 'focusImage' | 'focusTable'>('balanced');
  const [reviewMode, setReviewMode] = useState<ReviewMode>('queue');
  const [showDetailsDrawer, setShowDetailsDrawer] = useState(false);
  const [showDirtyOnly, setShowDirtyOnly] = useState(false);
  const [jumpToDay, setJumpToDay] = useState('');
  const [activeDay, setActiveDay] = useState<number | null>(null);
  const [imageScale, setImageScale] = useState(1);
  const [imageRotation, setImageRotation] = useState(0);
  const [imageOffset, setImageOffset] = useState({ x: 0, y: 0 });
  const [isPanningImage, setIsPanningImage] = useState(false);
  const [highlightedImageDay, setHighlightedImageDay] = useState<number | null>(null);
  const [panStart, setPanStart] = useState<{ x: number; y: number; originX: number; originY: number } | null>(null);
  const [autoAdvance, setAutoAdvance] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const storedValue = window.localStorage.getItem(AUTO_ADVANCE_STORAGE_KEY);
    return storedValue === null ? true : storedValue === 'true';
  });
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const requestedExtractionsRef = useRef<Set<string>>(new Set());
  const selectedCardIdRef = useRef<string | null>(null);
  const imageViewportRef = useRef<HTMLDivElement | null>(null);
  const imageElementRef = useRef<HTMLImageElement | null>(null);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map());
  const { showToast, ToastContainer } = useToast();
  const { user } = useAuth();
  const filterCards = useCallback((cards: WorkCard[]) => {
    const search = cardSearch.trim().toLowerCase();

    const matchesCard = (card: WorkCard, extractionData?: WorkCardExtraction | null) => {
      if (!search) return true;
      const name = card.employee?.full_name?.toLowerCase() || '';
      const passport = card.employee?.passport_id?.toLowerCase() || '';
      const extractedName = extractionData?.extracted_employee_name?.toLowerCase() || '';
      const extractedPassport = extractionData?.extracted_passport_id?.toLowerCase() || '';
      return (
        name.includes(search) ||
        passport.includes(search) ||
        extractedName.includes(search) ||
        extractedPassport.includes(search) ||
        String(card.id).toLowerCase().includes(search)
      );
    };

    const filteredAssigned = cards.filter(card => card.employee_id !== null).filter(card => matchesCard(card));
    const filteredUnassigned = cards.filter(card => card.employee_id === null).filter(card =>
      matchesCard(card, extractionsByCardId[card.id] ?? null)
    );

    return {
      assigned: listFilter === 'unassigned' ? [] : filteredAssigned,
      unassigned: listFilter === 'assigned' ? [] : filteredUnassigned,
    };
  }, [extractionsByCardId, cardSearch, listFilter]);

  const unassignedCards = useMemo(
    () => workCards.filter(card => card.employee_id === null),
    [workCards]
  );

  const filteredCards = useMemo(() => filterCards(workCards), [filterCards, workCards]);

  const visibleCards = useMemo(
    () => [...filteredCards.unassigned, ...filteredCards.assigned],
    [filteredCards.unassigned, filteredCards.assigned]
  );

  const selectedVisibleIndex = useMemo(
    () => (selectedCard ? visibleCards.findIndex((card) => card.id === selectedCard.id) : -1),
    [selectedCard, visibleCards]
  );

  const isFocusMode = layoutMode !== 'balanced';

  const totalHours = useMemo(() => {
    return dayEntries.reduce((sum, entry) => {
      const value = parseFloat(entry.total_hours);
      return Number.isFinite(value) ? sum + value : sum;
    }, 0);
  }, [dayEntries]);

  const displayedEntries = useMemo(() => {
    const rows = dayEntries.map((entry, index) => ({ entry, index }));
    return showDirtyOnly ? rows.filter(row => row.entry.isDirty) : rows;
  }, [dayEntries, showDirtyOnly]);

  const { zoneByDay, getZoneForDay } = useDayImageZoneMapping(extraction);

  const jumpDayNumber = useMemo(() => {
    const trimmed = jumpToDay.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }, [jumpToDay]);

  const jumpDayValidationMessage = useMemo(() => {
    if (!jumpToDay.trim()) return '';
    if (jumpDayNumber === null || !Number.isInteger(jumpDayNumber)) {
      return 'יש להזין מספר יום תקין';
    }
    if (jumpDayNumber < 1 || jumpDayNumber > dayEntries.length) {
      return `היום חייב להיות בין 1 ל-${dayEntries.length}`;
    }
    return '';
  }, [jumpToDay, jumpDayNumber, dayEntries.length]);

  const filteredDisplayedEntries = useMemo(() => {
    if (!jumpToDay.trim() || jumpDayValidationMessage) return displayedEntries;
    if (jumpDayNumber === null) return displayedEntries;
    return displayedEntries.filter(({ entry }) => entry.day_of_month === jumpDayNumber);
  }, [displayedEntries, jumpToDay, jumpDayValidationMessage, jumpDayNumber]);

  const conflictingEntries = useMemo(
    () => dayEntries.filter((entry) => entry.conflictType === 'WITH_APPROVED' || entry.conflictType === 'WITH_PENDING'),
    [dayEntries]
  );

  const approvedConflictDays = useMemo(
    () =>
      dayEntries
        .filter((entry) => entry.conflictType === 'WITH_APPROVED')
        .map((entry) => entry.day_of_month),
    [dayEntries]
  );

  const conflictDays = useMemo(
    () => conflictingEntries.map((entry) => entry.day_of_month),
    [conflictingEntries]
  );

  const unresolvedConflictDays = useMemo(
    () => conflictDays.filter((day) => !approvedConflictDecisions[day]),
    [conflictDays, approvedConflictDecisions]
  );

  const unresolvedConflictCount = unresolvedConflictDays.length;

  const conflictCount = conflictDays.length;

  const approvedConflictCount = approvedConflictDays.length;
  const pendingConflictCount = conflictCount - approvedConflictCount;

  // Check for identity mismatch between extracted passport and assigned employee
  const hasIdentityMismatch = useMemo(() => {
    if (!selectedCard?.employee?.passport_id || !extraction?.extracted_passport_id) {
      return false;
    }
    return selectedCard.employee.passport_id.trim() !== extraction.extracted_passport_id.trim();
  }, [selectedCard?.employee?.passport_id, extraction?.extracted_passport_id]);

  useEffect(() => {
    setShowDirtyOnly(false);
  }, [selectedCard?.id]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(AUTO_ADVANCE_STORAGE_KEY, String(autoAdvance));
  }, [autoAdvance]);

  useEffect(() => {
    if (!selectedCard) return;
    if (visibleCards.some((card) => card.id === selectedCard.id)) return;
    setSelectedCard(visibleCards[0] ?? null);
  }, [selectedCard, visibleCards]);

  const navigateToCard = useCallback((offset: -1 | 1) => {
    if (!visibleCards.length) return;
    const baseIndex = selectedVisibleIndex >= 0 ? selectedVisibleIndex : 0;
    const nextIndex = baseIndex + offset;
    if (nextIndex < 0 || nextIndex >= visibleCards.length) return;
    setSelectedCard(visibleCards[nextIndex]);
  }, [selectedVisibleIndex, visibleCards]);

  const navigateToNextPending = useCallback(() => {
    if (!visibleCards.length) return;
    const startIndex = selectedVisibleIndex >= 0 ? selectedVisibleIndex + 1 : 0;
    const nextPending = visibleCards.find((card, index) => index >= startIndex && card.review_status !== 'APPROVED');
    if (nextPending) {
      setSelectedCard(nextPending);
    }
  }, [selectedVisibleIndex, visibleCards]);

  const hasNextPending = useMemo(() => {
    if (!visibleCards.length) return false;
    const startIndex = selectedVisibleIndex >= 0 ? selectedVisibleIndex + 1 : 0;
    return visibleCards.some((card, index) => index >= startIndex && card.review_status !== 'APPROVED');
  }, [selectedVisibleIndex, visibleCards]);

  const getNextCardAfterReviewAction = useCallback((cards: WorkCard[], currentCardId: string) => {
    const nextFilteredCards = filterCards(cards);
    const nextVisibleCards = [...nextFilteredCards.unassigned, ...nextFilteredCards.assigned];
    const currentIndex = nextVisibleCards.findIndex((card) => card.id === currentCardId);
    const firstPendingAfterCurrent = nextVisibleCards.find(
      (card, index) => index > currentIndex && card.review_status !== 'APPROVED'
    );
    if (firstPendingAfterCurrent) return firstPendingAfterCurrent;
    if (currentIndex >= 0 && currentIndex + 1 < nextVisibleCards.length) {
      return nextVisibleCards[currentIndex + 1];
    }
    if (currentIndex > 0) {
      return nextVisibleCards[currentIndex - 1];
    }
    return nextVisibleCards[0] ?? null;
  }, [filterCards]);

  useEffect(() => {
    if (!isFocusMode || !selectedCard) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      const key = event.key.toLowerCase();
      if (event.key === 'ArrowUp' || key === 'k') {
        event.preventDefault();
        navigateToCard(-1);
      } else if (event.key === 'ArrowDown' || key === 'j') {
        event.preventDefault();
        navigateToCard(1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFocusMode, selectedCard, navigateToCard]);

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
      setError('שגיאה בטעינת הכרטיסים');
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
      const normalizedFrom = normalizeTimeToHourMinute(existing?.from_time);
      const normalizedTo = normalizeTimeToHourMinute(existing?.to_time);
      rows.push({
        day_of_month: day,
        from_time: normalizedFrom,
        to_time: normalizedTo,
        total_hours: existing?.total_hours?.toString() || '',
        latest_from_time: normalizedFrom,
        latest_to_time: normalizedTo,
        latest_total_hours: existing?.total_hours?.toString() || '',
        previousEntry: existing?.previous_entry || null,
        isDirty: false,
        isLocked: !!existing?.is_locked,
        hasConflict: !!existing?.has_conflict,
        conflictType: existing?.conflict_type || null,
        lockedFromPrevious: !!existing?.locked_from_previous,
        resolvedApprovedConflict: null,
      });
    }
    setDayEntries(rows);
    setApprovedConflictDecisions({});
    setDraftConflictDecisions({});
    setShowConflictModal(false);
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
    selectedCardIdRef.current = cardId;

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
    selectedCardIdRef.current = cardId;

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
      if (updated[dayIndex].isLocked) {
        return prev;
      }
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

  const resetImageTransform = useCallback(() => {
    setImageScale(1);
    setImageRotation(0);
    setImageOffset({ x: 0, y: 0 });
  }, []);

  const zoomImage = useCallback((direction: 'in' | 'out') => {
    setImageScale((prev) => {
      const next = direction === 'in' ? prev + 0.2 : prev - 0.2;
      return Math.min(4, Math.max(0.5, Number(next.toFixed(2))));
    });
  }, []);

  const rotateImage = useCallback(() => {
    setImageRotation((prev) => (prev + 90) % 360);
  }, []);

  const fitImage = useCallback(() => {
    setImageScale(1);
    setImageOffset({ x: 0, y: 0 });
  }, []);

  const registerRowRef = useCallback((day: number, element: HTMLTableRowElement | null) => {
    if (!element) {
      rowRefs.current.delete(day);
      return;
    }
    rowRefs.current.set(day, element);
  }, []);

  const keepRowVisible = useCallback((day: number) => {
    const row = rowRefs.current.get(day);
    const container = tableScrollRef.current;
    if (!row || !container) return;

    const rowTop = row.offsetTop;
    const rowBottom = rowTop + row.offsetHeight;
    const viewTop = container.scrollTop;
    const viewBottom = viewTop + container.clientHeight;

    if (rowTop < viewTop) {
      container.scrollTo({ top: Math.max(rowTop - 36, 0), behavior: 'smooth' });
    } else if (rowBottom > viewBottom) {
      container.scrollTo({ top: rowBottom - container.clientHeight + 36, behavior: 'smooth' });
    }
  }, []);

  const activateDay = useCallback((day: number) => {
    setActiveDay(day);
    setHighlightedImageDay(day);
    keepRowVisible(day);
  }, [keepRowVisible]);

  const handleJumpToDay = useCallback(() => {
    if (jumpDayValidationMessage || jumpDayNumber === null) return;

    const existingDay = dayEntries.some((entry) => entry.day_of_month === jumpDayNumber);
    if (!existingDay) return;

    activateDay(jumpDayNumber);
    const row = rowRefs.current.get(jumpDayNumber);
    const input = row?.querySelector('input:not([disabled])') as HTMLInputElement | null;
    input?.focus();
  }, [jumpDayValidationMessage, jumpDayNumber, dayEntries, activateDay]);

  const handleImageWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    const shouldZoom = event.ctrlKey || event.metaKey || imageScale > 1;
    if (!shouldZoom) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setImageScale((prev) => {
      const next = prev + (event.deltaY < 0 ? 0.1 : -0.1);
      return Math.min(4, Math.max(0.5, Number(next.toFixed(2))));
    });
  }, [imageScale]);

  const handleImagePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!imageUrl || event.button !== 0 || imageScale <= 1) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsPanningImage(true);
    setPanStart({ x: event.clientX, y: event.clientY, originX: imageOffset.x, originY: imageOffset.y });
  }, [imageUrl, imageOffset.x, imageOffset.y, imageScale]);

  const handleImagePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!panStart) return;
    event.preventDefault();
    const deltaX = event.clientX - panStart.x;
    const deltaY = event.clientY - panStart.y;
    setImageOffset({ x: panStart.originX + deltaX, y: panStart.originY + deltaY });
  }, [panStart]);

  const handleImagePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    event.stopPropagation();
    setIsPanningImage(false);
    setPanStart(null);
  }, []);

  // Save day entries
  const handleSave = async () => {
    if (!selectedCard) return;

    const dirtyEntries = dayEntries.filter(
      e => !e.isLocked && e.isDirty && (e.from_time || e.to_time || e.total_hours)
    );
    
    if (dirtyEntries.length === 0) {
      showToast('אין שינויים לשמירה', 'info');
      return;
    }

    setIsSaving(true);
    try {
      const entries = dirtyEntries.map(e => ({
        day_of_month: e.day_of_month,
        from_time: normalizeTimeToHourMinute(e.from_time) || null,
        to_time: normalizeTimeToHourMinute(e.to_time) || null,
        total_hours: e.total_hours ? parseFloat(e.total_hours) : null,
      }));

      await updateDayEntries(selectedCard.id, { entries });
      const refreshedEntries = await getDayEntries(selectedCard.id);
      initializeDayEntries(refreshedEntries);
      
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

    if (hasUnsavedChanges) {
      showToast('יש לשמור שינויים לפני אישור הכרטיס', 'info');
      return;
    }

    if (conflictCount > 0 && unresolvedConflictCount > 0) {
      openConflictModal();
      showToast('יש לעבור על ההתנגשויות ולהחיל החלטות לפני אישור', 'info');
      return;
    }
    try {
      if (approvedConflictDays.length > 0) {
        const overrideDays = approvedConflictDays.filter((day) => approvedConflictDecisions[day] === 'USE_LATEST');
        if (overrideDays.length > 0) {
          await approveWorkCard(selectedCard.id, user.id, {
            override_conflict_days: overrideDays,
            confirm_override_approved: true,
          });
        } else {
          await approveWorkCard(selectedCard.id, user.id);
        }
      } else {
        await approveWorkCard(selectedCard.id, user.id);
      }
      showToast('הכרטיס אושר בהצלחה', 'success');

      // Update local state
      const approvedCardId = selectedCard.id;
      const nextCards = workCards.map(c =>
        c.id === approvedCardId ? { ...c, review_status: 'APPROVED' as const } : c
      );
      setWorkCards(nextCards);
      if (autoAdvance) {
        const nextCard = getNextCardAfterReviewAction(nextCards, approvedCardId);
        setSelectedCard(nextCard);
      } else {
        setSelectedCard(prev => prev ? { ...prev, review_status: 'APPROVED' } : null);
        const refreshedEntries = await getDayEntries(approvedCardId);
        initializeDayEntries(refreshedEntries);
      }
    } catch (err) {
      console.error('Failed to approve card:', err);
      showToast('שגיאה באישור הכרטיס', 'error');
    }
  };

  const formatConflictValue = (
    from: string | null | undefined,
    to: string | null | undefined,
    total: string | number | null | undefined
  ) => {
    const fromDisplay = from || '--:--';
    const toDisplay = to || '--:--';
    const totalDisplay = total === '' || total === null || typeof total === 'undefined' ? '--' : String(total);
    return `${fromDisplay} - ${toDisplay} (${totalDisplay} ש')`;
  };

  const openConflictModal = () => {
    const initialDecisions: Record<number, 'KEEP_PREVIOUS' | 'USE_LATEST'> = { ...approvedConflictDecisions };
    for (const row of dayEntries) {
      if ((row.conflictType === 'WITH_APPROVED' || row.conflictType === 'WITH_PENDING') && row.resolvedApprovedConflict) {
        initialDecisions[row.day_of_month] = row.resolvedApprovedConflict;
      }
      if ((row.conflictType === 'WITH_APPROVED' || row.conflictType === 'WITH_PENDING') && !initialDecisions[row.day_of_month]) {
        initialDecisions[row.day_of_month] = row.conflictType === 'WITH_APPROVED' ? 'KEEP_PREVIOUS' : 'USE_LATEST';
      }
    }
    setDraftConflictDecisions(initialDecisions);
    setShowConflictModal(true);
  };

  const applyConflictDecisions = () => {
    const unresolvedDays = conflictDays.filter((day) => !draftConflictDecisions[day]);
    if (unresolvedDays.length > 0) {
      showToast(`יש לבחור החלטה לכל ההתנגשויות (נותרו ${unresolvedDays.length})`, 'error');
      return;
    }

    setApprovedConflictDecisions(draftConflictDecisions);
    setDayEntries((prev) =>
      prev.map((entry) => {
        if (entry.conflictType !== 'WITH_APPROVED' && entry.conflictType !== 'WITH_PENDING') return entry;

        const decision = draftConflictDecisions[entry.day_of_month];
        if (!decision) return entry;

        if (decision === 'KEEP_PREVIOUS' && entry.previousEntry) {
          const nextFrom = normalizeTimeToHourMinute(entry.previousEntry.from_time);
          const nextTo = normalizeTimeToHourMinute(entry.previousEntry.to_time);
          const nextTotal = entry.previousEntry.total_hours?.toString() || '';
          const changed = entry.from_time !== nextFrom || entry.to_time !== nextTo || entry.total_hours !== nextTotal;
          return {
            ...entry,
            from_time: nextFrom,
            to_time: nextTo,
            total_hours: nextTotal,
            hasConflict: false,
            conflictType: entry.conflictType,
            isLocked: entry.conflictType === 'WITH_APPROVED',
            isDirty: entry.conflictType === 'WITH_PENDING' ? changed : false,
            resolvedApprovedConflict: decision,
          };
        }

        return {
          ...entry,
          from_time: entry.latest_from_time,
          to_time: entry.latest_to_time,
          total_hours: entry.latest_total_hours,
          hasConflict: false,
          conflictType: entry.conflictType,
          isLocked: entry.conflictType === 'WITH_APPROVED',
          isDirty: false,
          resolvedApprovedConflict: decision,
        };
      })
    );

    setShowConflictModal(false);
    showToast('החלטות ההתנגשות הוחלו על הטבלה. אם בחרת בערכים קודמים בהתנגשות לא מאושרת, יש לשמור לפני אישור.', 'success');
  };

  const handleReject = async () => {
    if (!selectedCard) return;
    try {
      const rejectedCardId = selectedCard.id;
      await deleteWorkCard(rejectedCardId);
      showToast('הכרטיס נדחה ונמחק בהצלחה', 'success');
      
      // Remove from list
      const nextCards = workCards.filter(c => c.id !== rejectedCardId);
      setWorkCards(nextCards);
      if (autoAdvance) {
        const nextCard = getNextCardAfterReviewAction(nextCards, rejectedCardId);
        setSelectedCard(nextCard);
      } else {
        setSelectedCard(null);
      }
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

  const imagePanelWidth =
    layoutMode === 'focusImage'
      ? 'w-full lg:w-2/3'
      : layoutMode === 'focusTable'
      ? 'w-full lg:w-1/3'
      : 'w-full lg:w-1/2';
  const tablePanelWidth =
    layoutMode === 'focusTable'
      ? 'w-full lg:w-2/3'
      : layoutMode === 'focusImage'
      ? 'w-full lg:w-1/3'
      : 'w-full lg:w-1/2';

  return (
    <div className="flex flex-col h-full">
      <ToastContainer />
      
      {/* Header with Month Picker */}
      <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold">סקירת כרטיסי עבודה</h2>
          <div className="flex items-center gap-1 rounded-full border border-slate-200 dark:border-slate-700 p-1 bg-slate-100 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setReviewMode('queue')}
              className={`px-3 py-1 text-xs rounded-full transition-colors ${
                reviewMode === 'queue'
                  ? 'bg-primary text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              תור
            </button>
            <button
              type="button"
              onClick={() => setReviewMode('focus')}
              disabled={!selectedCard}
              className={`px-3 py-1 text-xs rounded-full transition-colors ${
                reviewMode === 'focus'
                  ? 'bg-primary text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              } disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              פוקוס
            </button>
          </div>
        </div>
        <MonthPicker
          value={selectedMonth}
          onChange={onMonthChange}
          storageKey={monthStorageKey}
        />
      </div>

      {/* Main Content */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar - Work Cards List */}
        <div className={`${reviewMode === 'focus' ? 'hidden' : 'w-80'} border-l border-slate-200 dark:border-slate-700 flex flex-col bg-slate-50 dark:bg-slate-900/50`}>
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-600 dark:text-slate-400">
                {workCards.length} כרטיסים
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-500">
                {filteredCards.assigned.length + filteredCards.unassigned.length} מוצגים
              </span>
            </div>
            <div className="relative">
              <span className="material-symbols-outlined text-base text-slate-400 absolute right-3 top-2.5">search</span>
              <input
                value={cardSearch}
                onChange={(e) => setCardSearch(e.target.value)}
                placeholder="חיפוש עובד / ת.ז / מזהה..."
                className="w-full pr-9 pl-8 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              {cardSearch && (
                <button
                  onClick={() => setCardSearch("")}
                  className="absolute left-2 top-2 text-slate-400 hover:text-slate-600"
                  title="נקה חיפוש"
                >
                  <span className="material-symbols-outlined text-base">close</span>
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {(["all", "unassigned", "assigned"] as const).map((filter) => (
                <button
                  key={filter}
                  onClick={() => setListFilter(filter)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    listFilter === filter
                      ? 'bg-primary text-white border-primary'
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  {filter === 'all' ? 'הכל' : filter === 'unassigned' ? 'לא משויך' : 'משויך'}
                </button>
              ))}
            </div>
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
              {filteredCards.unassigned.length > 0 && (
                <div>
                  <div className="px-4 py-2 bg-orange-50 dark:bg-orange-900/20 border-b border-orange-200 dark:border-orange-800 sticky top-0 z-10">
                    <div className="flex items-center gap-2 text-orange-700 dark:text-orange-400">
                      <span className="material-symbols-outlined text-sm">warning</span>
                      <span className="text-xs font-semibold">ממתינים לשיוך ({filteredCards.unassigned.length})</span>
                    </div>
                  </div>
                  {filteredCards.unassigned.map((card) => (
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
              {filteredCards.assigned.length > 0 && (
                <div>
                  {filteredCards.unassigned.length > 0 && (
                    <div className="px-4 py-2 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-10">
                      <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">כרטיסים משויכים ({filteredCards.assigned.length})</span>
                    </div>
                  )}
                  {filteredCards.assigned.map((card) => (
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
              {filteredCards.assigned.length === 0 && filteredCards.unassigned.length === 0 && (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
                  <span className="material-symbols-outlined text-4xl text-slate-300 dark:text-slate-600 mb-2">manage_search</span>
                  <p className="text-sm text-slate-500 dark:text-slate-400">אין תוצאות לחיפוש/סינון</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Main Area - Image and Day Entries */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {!selectedCard ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
              <span className="material-symbols-outlined text-6xl text-slate-300 dark:text-slate-600 mb-4">playlist_play</span>
              <h3 className="text-lg font-medium text-slate-600 dark:text-slate-400 mb-2">מצב תור פעיל</h3>
              <p className="text-sm text-slate-500 dark:text-slate-500 max-w-md">
                השתמשו בחיפוש, סינון וסטטוסים לניהול הרשימה. בחירת כרטיס תעביר אוטומטית למצב פוקוס לסקירה מעמיקה.
              </p>
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-200 flex items-center justify-center font-bold text-xs uppercase shrink-0">
                      {selectedCard.employee?.full_name
                        ? selectedCard.employee.full_name
                            .split(' ')
                            .map((word) => word[0])
                            .join('')
                            .slice(0, 2)
                        : <span className="material-symbols-outlined text-base">badge</span>}
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 dark:text-white truncate">
                        {selectedCard.employee?.full_name || 'כרטיס לא משויך'}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-3">
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      <>
                        <button
                          onClick={() => navigateToCard(-1)}
                          disabled={selectedVisibleIndex <= 0}
                          className="w-9 h-9 rounded-lg border border-slate-200 dark:border-slate-700 inline-flex items-center justify-center text-slate-600 dark:text-slate-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-800"
                          title="עובד קודם"
                          aria-label="עובד קודם"
                        >
                          <span className="material-symbols-outlined text-base">chevron_right</span>
                        </button>
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                          {selectedVisibleIndex >= 0 ? selectedVisibleIndex + 1 : 0} / {visibleCards.length}
                        </span>
                        <button
                          onClick={() => navigateToCard(1)}
                          disabled={selectedVisibleIndex === -1 || selectedVisibleIndex >= visibleCards.length - 1}
                          className="w-9 h-9 rounded-lg border border-slate-200 dark:border-slate-700 inline-flex items-center justify-center text-slate-600 dark:text-slate-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-800"
                          title="עובד הבא"
                          aria-label="עובד הבא"
                        >
                          <span className="material-symbols-outlined text-base">chevron_left</span>
                        </button>
                        <button
                          onClick={navigateToNextPending}
                          disabled={!hasNextPending}
                          className="px-3 py-2 rounded-lg border border-indigo-200 dark:border-indigo-700 text-xs font-medium text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 disabled:opacity-50 disabled:cursor-not-allowed"
                          title="דלג לכרטיס הבא שממתין לסקירה"
                        >
                          הבא ממתין
                        </button>
                      </>

                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                        selectedCard.review_status === 'APPROVED'
                          ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-400'
                          : selectedCard.review_status === 'NEEDS_REVIEW'
                          ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-400'
                          : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                      }`}>
                        {selectedCard.review_status === 'APPROVED' ? 'מאושר' :
                         selectedCard.review_status === 'NEEDS_REVIEW' ? 'ממתין לסקירה' :
                         selectedCard.review_status === 'NEEDS_ASSIGNMENT' ? 'ממתין לשיוך' :
                         selectedCard.review_status}
                      </span>
                      {hasUnsavedChanges && (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">שינויים לא נשמרו</span>
                      )}
                      <button
                        type="button"
                        onClick={() => setShowDetailsDrawer((prev) => !prev)}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-sm">info</span>
                        <span>{showDetailsDrawer ? 'הסתר פרטים' : 'פרטי כרטיס'}</span>
                      </button>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                        <input
                          type="checkbox"
                          checked={autoAdvance}
                          onChange={(e) => setAutoAdvance(e.target.checked)}
                          className="rounded border-slate-300 text-primary focus:ring-primary/40"
                        />
                        מעבר אוטומטי אחרי אישור/דחייה
                      </label>

                      <div className="flex items-center gap-1 rounded-full border border-slate-200 dark:border-slate-700 p-1 bg-white dark:bg-slate-800">
                        <button
                          onClick={() => setLayoutMode('focusImage')}
                          className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                            layoutMode === 'focusImage' ? 'bg-primary text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700'
                          }`}
                          title="מיקוד תמונה"
                        >
                          <span className="material-symbols-outlined text-base">image</span>
                        </button>
                        <button
                          onClick={() => setLayoutMode('balanced')}
                          className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                            layoutMode === 'balanced' ? 'bg-primary text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700'
                          }`}
                          title="תצוגה מאוזנת"
                        >
                          <span className="material-symbols-outlined text-base">dashboard_customize</span>
                        </button>
                        <button
                          onClick={() => setLayoutMode('focusTable')}
                          className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                            layoutMode === 'focusTable' ? 'bg-primary text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700'
                          }`}
                          title="מיקוד טבלה"
                        >
                          <span className="material-symbols-outlined text-base">table_chart</span>
                        </button>
                      </div>

                      {!selectedCard.employee_id && (
                        <button
                          onClick={() => setShowAssignModal(true)}
                          className="px-3 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors font-medium text-xs flex items-center gap-1"
                        >
                          <span className="material-symbols-outlined text-sm">link</span>
                          <span>שיוך עובד</span>
                        </button>
                      )}

                      {conflictCount > 0 && (
                        <button
                          type="button"
                          onClick={openConflictModal}
                          className="px-3 py-2 rounded-lg border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 transition-colors font-medium text-xs flex items-center gap-1"
                        >
                          <span className="material-symbols-outlined text-base">warning</span>
                          <span>התנגשויות ({unresolvedConflictCount > 0 ? unresolvedConflictCount : conflictCount})</span>
                        </button>
                      )}
                      <button
                        onClick={handleSave}
                        disabled={isSaving || !hasUnsavedChanges}
                        className="px-3 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors font-medium text-xs disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                      >
                        {isSaving ? (
                          <>
                            <span className="material-symbols-outlined text-base animate-spin">progress_activity</span>
                            <span>שומר...</span>
                          </>
                        ) : (
                          <>
                            <span className="material-symbols-outlined text-base">save</span>
                            <span>שמור</span>
                          </>
                        )}
                      </button>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleApprove}
                          disabled={selectedCard.review_status === 'APPROVED' || !selectedCard.employee_id}
                          className={`px-3 py-2 rounded-lg transition-colors font-medium text-xs flex items-center gap-1 border ${
                            selectedCard.review_status === 'APPROVED'
                              ? 'bg-green-50 text-green-600 border-green-200 cursor-default'
                              : !selectedCard.employee_id
                              ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                              : 'bg-green-600 text-white hover:bg-green-700 border-transparent'
                          }`}
                          title={!selectedCard.employee_id ? 'יש לשייך עובד תחילה' : 'אשר כרטיס'}
                        >
                          <span className="material-symbols-outlined text-base">check</span>
                          <span>אשר</span>
                        </button>
                        <button
                          onClick={() => setShowRejectModal(true)}
                          className="px-3 py-2 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors font-medium text-xs flex items-center gap-1 border border-red-200"
                          title="דחה כרטיס (מחק)"
                        >
                          <span className="material-symbols-outlined text-base">close</span>
                          <span>דחה</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              {showDetailsDrawer && (
                <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                    <button
                      type="button"
                      onClick={handleTriggerExtraction}
                      disabled={
                        isTriggering ||
                        extraction?.status === 'PENDING' ||
                        extraction?.status === 'RUNNING' ||
                        extraction?.status === 'DONE'
                      }
                      className={`px-2.5 py-1 rounded-full border transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed ${
                        extraction?.status === 'DONE'
                          ? 'bg-green-50 text-green-700 border-green-200'
                          : 'bg-purple-50 text-purple-600 border-purple-200 hover:bg-purple-100'
                      }`}
                      title={
                        extraction?.status === 'DONE'
                          ? 'נתונים חולצו'
                          : 'חלץ נתונים מהתמונה'
                      }
                    >
                      {isTriggering || extraction?.status === 'PENDING' || extraction?.status === 'RUNNING'
                        ? 'מחלץ...'
                        : extraction?.status === 'DONE'
                        ? 'חולץ'
                        : 'חלץ נתונים'}
                    </button>
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full font-medium ${
                      selectedCard.review_status === 'APPROVED'
                        ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-400'
                        : selectedCard.review_status === 'NEEDS_REVIEW'
                        ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-400'
                        : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                    }`}>
                      {selectedCard.review_status === 'APPROVED'
                        ? 'מאושר'
                        : selectedCard.review_status === 'NEEDS_REVIEW'
                        ? 'ממתין לסקירה'
                        : selectedCard.review_status === 'NEEDS_ASSIGNMENT'
                        ? 'ממתין לשיוך'
                        : selectedCard.review_status}
                    </span>
                    <span>מזהה: {String(selectedCard.id).slice(0, 8)}</span>
                    {selectedCard.employee?.passport_id && <span>ת.ז: {selectedCard.employee.passport_id}</span>}
                    {!selectedCard.employee?.passport_id && extraction?.extracted_passport_id && (
                      <span>ת.ז מזוהה: {extraction.extracted_passport_id}</span>
                    )}
                  </div>
                </div>
              )}
              <div className="flex-1 flex min-h-0 overflow-hidden flex-col lg:flex-row">
                {/* Image Panel */}
                <div className={`${imagePanelWidth} lg:border-l border-slate-200 dark:border-slate-700 flex flex-col bg-slate-100 dark:bg-slate-900 min-h-0`}>
                  <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                    <h4 className="font-medium text-slate-900 dark:text-white flex items-center gap-2">
                      <span className="material-symbols-outlined text-lg">image</span>
                      תמונת כרטיס
                    </h4>
                  </div>
                  <div className="relative flex-1 min-h-0">
                    <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 z-20">
                      <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-slate-900/80 text-white shadow-lg px-2 py-1 backdrop-blur-sm">
                        <button
                          type="button"
                          onClick={() => zoomImage('out')}
                          className="w-8 h-8 inline-flex items-center justify-center rounded-full hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                          aria-label="הקטן תמונה"
                          title="הקטנה"
                        >
                          <span className="material-symbols-outlined text-base">zoom_out</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => zoomImage('in')}
                          className="w-8 h-8 inline-flex items-center justify-center rounded-full hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                          aria-label="הגדל תמונה"
                          title="הגדלה"
                        >
                          <span className="material-symbols-outlined text-base">zoom_in</span>
                        </button>
                        <button
                          type="button"
                          onClick={fitImage}
                          className="px-2 h-8 inline-flex items-center justify-center rounded-full hover:bg-white/20 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                          aria-label="התאם תמונה למסך"
                          title="התאם למסך"
                        >
                          התאם
                        </button>
                        <button
                          type="button"
                          onClick={rotateImage}
                          className="w-8 h-8 inline-flex items-center justify-center rounded-full hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                          aria-label="סובב תמונה"
                          title="סיבוב"
                        >
                          <span className="material-symbols-outlined text-base">rotate_90_degrees_ccw</span>
                        </button>
                        <button
                          type="button"
                          onClick={resetImageTransform}
                          className="px-2 h-8 inline-flex items-center justify-center rounded-full hover:bg-white/20 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                          aria-label="אפס תצוגת תמונה"
                          title="איפוס"
                        >
                          אפס
                        </button>
                      </div>
                    </div>

                    <div
                      ref={imageViewportRef}
                      className={`h-full overflow-hidden p-4 overscroll-contain ${imageScale > 1 ? (isPanningImage ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'}`}
                      onWheel={handleImageWheel}
                      onPointerDown={handleImagePointerDown}
                      onPointerMove={handleImagePointerMove}
                      onPointerUp={handleImagePointerUp}
                      onPointerCancel={handleImagePointerUp}
                      role="region"
                      aria-label="תצוגת תמונת כרטיס עם זום והזזה"
                      tabIndex={0}
                      style={{ touchAction: imageScale > 1 ? 'none' : 'pan-y' }}
                    >
                      {isLoadingImage ? (
                        <div className="flex items-center justify-center h-full">
                          <span className="material-symbols-outlined text-3xl text-slate-400 animate-spin">progress_activity</span>
                        </div>
                      ) : imageUrl ? (
                        <div className="relative h-full w-full flex items-center justify-center overflow-hidden">
                          <img
                            ref={imageElementRef}
                            src={imageUrl}
                            alt="Work Card"
                            draggable={false}
                            className="max-w-full h-auto rounded-lg shadow-lg select-none"
                            style={{
                              transform: `translate(${imageOffset.x}px, ${imageOffset.y}px) scale(${imageScale}) rotate(${imageRotation}deg)`,
                              transformOrigin: 'center center',
                              transition: isPanningImage ? 'none' : 'transform 120ms ease-out',
                            }}
                          />
                          {highlightedImageDay !== null && getZoneForDay(highlightedImageDay)?.bbox && (
                            <div
                              className="absolute border-2 border-primary bg-primary/15 rounded-md pointer-events-none"
                              style={{
                                left: `${getZoneForDay(highlightedImageDay)?.bbox?.x ?? 0}%`,
                                top: `${getZoneForDay(highlightedImageDay)?.bbox?.y ?? 0}%`,
                                width: `${getZoneForDay(highlightedImageDay)?.bbox?.width ?? 0}%`,
                                height: `${getZoneForDay(highlightedImageDay)?.bbox?.height ?? 0}%`,
                              }}
                              aria-hidden="true"
                            />
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full text-slate-400">
                          <span className="material-symbols-outlined text-4xl mb-2">broken_image</span>
                          <span className="text-sm">לא ניתן לטעון את התמונה</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Day Entries Panel */}
                <div className={`${tablePanelWidth} flex flex-col min-h-0 border-t border-slate-200 dark:border-slate-700 lg:border-t-0`}>
                  <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between gap-4">
                    <h4 className="font-medium text-slate-900 dark:text-white flex items-center gap-2 shrink-0">
                      <span className="material-symbols-outlined text-lg">table_chart</span>
                      שעות עבודה
                    </h4>
                    <div className="flex items-center gap-3 flex-wrap justify-end">
                      <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                        <input
                          type="checkbox"
                          checked={showDirtyOnly}
                          onChange={(e) => setShowDirtyOnly(e.target.checked)}
                          className="rounded border-slate-300 text-primary focus:ring-primary/40"
                        />
                        שינויים בלבד
                      </label>
                      <div className="text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-full">
                        סה"כ {totalHours.toFixed(2)} שעות
                      </div>
                      <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300" htmlFor="jump-to-day-input">
                        עבור ליום
                        <input
                          id="jump-to-day-input"
                          type="number"
                          min={1}
                          max={dayEntries.length || 31}
                          value={jumpToDay}
                          onChange={(e) => setJumpToDay(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleJumpToDay();
                            }
                          }}
                          className="w-20 px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/50"
                          aria-label="קפיצה ליום"
                          aria-invalid={Boolean(jumpDayValidationMessage)}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={handleJumpToDay}
                        disabled={Boolean(jumpDayValidationMessage) || !jumpToDay.trim()}
                        className="px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-600 text-xs hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
                        aria-label="בצע קפיצה ליום"
                      >
                        קפוץ
                      </button>
                      {conflictCount > 0 && (
                        <button
                          type="button"
                          onClick={openConflictModal}
                          className="text-xs text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/30 px-2 py-1 rounded-full hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
                        >
                          {conflictCount} התנגשויות{unresolvedConflictCount > 0 ? ` (${unresolvedConflictCount} דורשות החלטה)` : ''}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="px-4 pt-3 space-y-3">
                    {jumpDayValidationMessage && (
                      <p className="text-xs text-amber-700 dark:text-amber-300" role="status">{jumpDayValidationMessage}</p>
                    )}
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
                  </div>

                  {isLoadingEntries ? (
                    <div className="flex-1 flex items-center justify-center">
                      <span className="material-symbols-outlined text-3xl text-slate-400 animate-spin">progress_activity</span>
                    </div>
                  ) : filteredDisplayedEntries.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
                      <span className="material-symbols-outlined text-4xl text-slate-300 dark:text-slate-600 mb-2">table_rows</span>
                      <p className="text-sm text-slate-500 dark:text-slate-400">אין שורות להצגה</p>
                    </div>
                  ) : (
                    <div ref={tableScrollRef} className="flex-1 overflow-auto" role="region" aria-label="טבלת שעות עבודה">
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
                          {filteredDisplayedEntries.map(({ entry, index }) => {
                            const isActive = activeDay === entry.day_of_month;
                            const zone = zoneByDay.get(entry.day_of_month);
                            return (
                              <tr
                                key={entry.day_of_month}
                                ref={(el) => registerRowRef(entry.day_of_month, el)}
                                className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${
                                  isActive
                                    ? 'ring-2 ring-inset ring-primary/60 bg-primary/5 dark:bg-primary/10'
                                    : entry.isLocked
                                    ? 'bg-slate-100 dark:bg-slate-800/40'
                                    : entry.hasConflict
                                    ? 'bg-red-50 dark:bg-red-900/10'
                                    : entry.isDirty
                                    ? 'bg-yellow-50 dark:bg-yellow-900/10'
                                    : ''
                                }`}
                              >
                                <td className="px-3 py-2 text-center font-medium text-slate-900 dark:text-white border-b border-slate-100 dark:border-slate-700">
                                  <div className="flex items-center justify-center gap-1">
                                    <button
                                      type="button"
                                      className="font-medium underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 rounded"
                                      onClick={() => activateDay(entry.day_of_month)}
                                      aria-label={`בחר יום ${entry.day_of_month}`}
                                    >
                                      {entry.day_of_month}
                                    </button>
                                    {typeof zone?.confidence === 'number' && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300" title={`Confidence ${Math.round(zone.confidence * 100)}%`}>
                                        {Math.round(zone.confidence * 100)}%
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="px-2 py-1 border-b border-slate-100 dark:border-slate-700">
                                  <input
                                    type="time"
                                    value={entry.from_time}
                                    onChange={(e) => handleEntryChange(index, 'from_time', e.target.value)}
                                    onFocus={() => activateDay(entry.day_of_month)}
                                    disabled={entry.isLocked}
                                    className="w-full px-2 py-1 text-center bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus:border-primary"
                                    aria-label={`שעת כניסה יום ${entry.day_of_month}`}
                                  />
                                </td>
                                <td className="px-2 py-1 border-b border-slate-100 dark:border-slate-700">
                                  <input
                                    type="time"
                                    value={entry.to_time}
                                    onChange={(e) => handleEntryChange(index, 'to_time', e.target.value)}
                                    onFocus={() => activateDay(entry.day_of_month)}
                                    disabled={entry.isLocked}
                                    className="w-full px-2 py-1 text-center bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus:border-primary"
                                    aria-label={`שעת יציאה יום ${entry.day_of_month}`}
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
                                    onFocus={() => activateDay(entry.day_of_month)}
                                    disabled={entry.isLocked}
                                    className="w-full px-2 py-1 text-center bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus:border-primary"
                                    placeholder="0"
                                    aria-label={`סך שעות יום ${entry.day_of_month}`}
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
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

      <Modal
        isOpen={showConflictModal}
        onClose={() => setShowConflictModal(false)}
        title="פתרון התנגשויות"
        maxWidth="xl"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20">
            <span className="material-symbols-outlined text-amber-700 dark:text-amber-300">rule</span>
            <div className="text-sm text-amber-800 dark:text-amber-200 space-y-1">
              <p>עברו על כל יום עם התנגשות ובחרו איזה ערך יישמר.</p>
              <p>ברירת מחדל: מול נתון מאושר נשמר הקודם, מול נתון לא מאושר נשמר החדש.</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-full">
              {approvedConflictCount} מול מאושר | {pendingConflictCount} מול לא מאושר
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const allLatest: Record<number, 'KEEP_PREVIOUS' | 'USE_LATEST'> = { ...draftConflictDecisions };
                  conflictDays.forEach((day) => {
                    allLatest[day] = 'USE_LATEST';
                  });
                  setDraftConflictDecisions(allLatest);
                }}
                className={`px-2.5 py-1.5 text-xs rounded border transition-colors ${
                  conflictDays.every((day) => draftConflictDecisions[day] === 'USE_LATEST')
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}
              >
                בחר חדש לכולם
              </button>
              <button
                type="button"
                onClick={() => {
                  const allPrevious: Record<number, 'KEEP_PREVIOUS' | 'USE_LATEST'> = { ...draftConflictDecisions };
                  conflictDays.forEach((day) => {
                    allPrevious[day] = 'KEEP_PREVIOUS';
                  });
                  setDraftConflictDecisions(allPrevious);
                }}
                className={`px-2.5 py-1.5 text-xs rounded border transition-colors ${
                  conflictDays.every((day) => draftConflictDecisions[day] === 'KEEP_PREVIOUS')
                    ? 'bg-slate-800 text-white border-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100'
                    : 'border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}
              >
                בחר קודם לכולם
              </button>
            </div>
          </div>

          {conflictingEntries.length === 0 ? (
            <div className="text-sm text-slate-500 dark:text-slate-400">לא נמצאו התנגשויות בכרטיס זה.</div>
          ) : (
            <div className="border border-slate-200 dark:border-slate-700 rounded-lg divide-y divide-slate-200 dark:divide-slate-700 max-h-[50vh] overflow-y-auto">
              {conflictingEntries.map((entry) => {
                const draftDecision = draftConflictDecisions[entry.day_of_month];
                return (
                  <div key={entry.day_of_month} className="p-3 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-slate-900 dark:text-white">
                        יום {entry.day_of_month}
                      </div>
                      <span
                        className={`text-[11px] px-2 py-1 rounded-full ${
                          entry.conflictType === 'WITH_APPROVED'
                            ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                        }`}
                      >
                        {entry.conflictType === 'WITH_APPROVED' ? 'התנגשות מול נתון מאושר' : 'התנגשות מול נתון קודם'}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <div className="p-2 rounded bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700">
                        <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">ערך קודם</div>
                        <div className="text-sm text-slate-800 dark:text-slate-200">
                          {formatConflictValue(
                            entry.previousEntry?.from_time,
                            entry.previousEntry?.to_time,
                            entry.previousEntry?.total_hours
                          )}
                        </div>
                      </div>
                      <div className="p-2 rounded bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700">
                        <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">ערך חדש</div>
                        <div className="text-sm text-slate-800 dark:text-slate-200">
                          {formatConflictValue(entry.latest_from_time, entry.latest_to_time, entry.latest_total_hours)}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setDraftConflictDecisions((prev) => ({ ...prev, [entry.day_of_month]: 'KEEP_PREVIOUS' }))
                        }
                        className={`px-2.5 py-1.5 text-xs rounded border ${
                          draftDecision === 'KEEP_PREVIOUS'
                            ? 'bg-slate-800 text-white border-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100'
                            : 'border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700'
                        }`}
                      >
                        שמור את הקודם
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setDraftConflictDecisions((prev) => ({ ...prev, [entry.day_of_month]: 'USE_LATEST' }))
                        }
                        className={`px-2.5 py-1.5 text-xs rounded border ${
                          draftDecision === 'USE_LATEST'
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700'
                        }`}
                      >
                        שמור את החדש
                      </button>
                      {!draftDecision && (
                        <span className="text-xs text-red-600 dark:text-red-300">נדרשת בחירה</span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {entry.conflictType === 'WITH_APPROVED'
                        ? 'השפעה: בחירה ב"חדש" תדרוס נתון שאושר בעבר.'
                        : 'השפעה: בחירה ב"קודם" תעדכן את הטבלה לערך קודם. כדי שהבחירה תישמר בשרת יש לבצע שמירה לפני אישור.'}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setShowConflictModal(false)}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 text-sm"
            >
              ביטול
            </button>
            <button
              type="button"
              onClick={applyConflictDecisions}
              className="px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary/90 text-sm"
            >
              החל החלטות
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

export default WorkCardReviewTab;
