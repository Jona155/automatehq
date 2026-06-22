import { useEffect, useMemo, useState } from 'react';
import type { Employee, WorkCard } from '../types';
import MonthPicker from './MonthPicker';
import Modal from './Modal';
import { downloadWorkCardsExport, getWorkCards } from '../api/workCards';
import { getFirstName } from '../utils/nameUtils';

interface WorkCardExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  siteId: string;
  siteName: string;
  employees: Employee[];
}

const getPreviousMonth = (): string => {
  const now = new Date();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const year = prevMonth.getFullYear();
  const month = String(prevMonth.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

const UNASSIGNED_KEY = 'unassigned';

interface EmployeeGroup {
  key: string;
  name: string;
  passportId: string;
  cards: WorkCard[];
}

const STATUS_META: Record<WorkCard['review_status'], { label: string; className: string }> = {
  APPROVED: { label: 'מאושר', className: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
  NEEDS_REVIEW: { label: 'בבדיקה', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  NEEDS_ASSIGNMENT: { label: 'לא משויך', className: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
  REJECTED: { label: 'נדחה', className: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
};

const formatDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

// Latest APPROVED card, falling back to the latest card overall — mirrors the
// backend's default one-per-employee export selection.
const defaultCardForGroup = (cards: WorkCard[]): WorkCard | undefined => {
  if (cards.length === 0) return undefined;
  return cards.find((card) => card.review_status === 'APPROVED') ?? cards[0];
};

export default function WorkCardExportModal({
  isOpen,
  onClose,
  siteId,
  siteName,
  employees,
}: WorkCardExportModalProps) {
  const [selectedMonth, setSelectedMonth] = useState<string>(getPreviousMonth());
  const [cards, setCards] = useState<WorkCard[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const employeeNameById = useMemo(() => {
    const map = new Map<string, Employee>();
    employees.forEach((employee) => map.set(employee.id, employee));
    return map;
  }, [employees]);

  // Fetch all cards for the site/month whenever the modal opens or month changes.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setSearch('');
    getWorkCards({ site_id: siteId, processing_month: selectedMonth, include_employee: true })
      .then((result) => {
        if (cancelled) return;
        // Newest first so the default selection picks the latest card.
        const sorted = [...result].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        setCards(sorted);
      })
      .catch((err: any) => {
        if (cancelled) return;
        setCards([]);
        setError(err?.response?.data?.message || err?.message || 'שגיאה בטעינת הכרטיסים');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, siteId, selectedMonth]);

  // Group cards by employee (cards are already newest-first).
  const groups = useMemo<EmployeeGroup[]>(() => {
    const byEmployee = new Map<string, WorkCard[]>();
    cards.forEach((card) => {
      const key = card.employee_id ?? UNASSIGNED_KEY;
      const list = byEmployee.get(key);
      if (list) list.push(card);
      else byEmployee.set(key, [card]);
    });

    return Array.from(byEmployee.entries()).map(([key, groupCards]) => {
      const employee = key === UNASSIGNED_KEY ? undefined : groupCards[0].employee ?? employeeNameById.get(key);
      return {
        key,
        name: key === UNASSIGNED_KEY ? 'כרטיסים לא משויכים' : getFirstName(employee?.full_name) || 'עובד לא ידוע',
        passportId: employee?.passport_id || '',
        cards: groupCards,
      };
    });
  }, [cards, employeeNameById]);

  // Default selection: latest approved (else latest) per employee group.
  useEffect(() => {
    if (!isOpen) return;
    const defaults = new Set<string>();
    groups.forEach((group) => {
      const card = defaultCardForGroup(group.cards);
      if (card) defaults.add(card.id);
    });
    setSelectedCardIds(defaults);
    setExpandedGroups(new Set());
  }, [isOpen, groups]);

  const filteredGroups = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return groups;
    return groups.filter(
      (group) =>
        group.name.toLowerCase().includes(query) || group.passportId.toLowerCase().includes(query)
    );
  }, [groups, search]);

  const visibleCardIds = useMemo(
    () => filteredGroups.flatMap((group) => group.cards.map((card) => card.id)),
    [filteredGroups]
  );

  const toggleCard = (cardId: string) => {
    setSelectedCardIds((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  };

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAllVisible = () => setSelectedCardIds(new Set(visibleCardIds));
  const clearSelection = () => setSelectedCardIds(new Set());
  const selectApprovedVisible = () => {
    const approved = new Set<string>();
    filteredGroups.forEach((group) =>
      group.cards.forEach((card) => {
        if (card.review_status === 'APPROVED') approved.add(card.id);
      })
    );
    setSelectedCardIds(approved);
  };

  const canDownload = selectedCardIds.size > 0;

  const handleDownload = async () => {
    if (!canDownload || isDownloading) return;
    setIsDownloading(true);
    setError(null);
    try {
      const blob = await downloadWorkCardsExport({
        site_id: siteId,
        processing_month: selectedMonth,
        card_ids: Array.from(selectedCardIds),
      });

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `work_cards_${siteName}_${selectedMonth}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      const errorMessage = err?.response?.data?.message || err?.message || 'שגיאה בהורדת הקבצים';
      setError(errorMessage);
    } finally {
      setIsDownloading(false);
    }
  };

  const renderCardRow = (card: WorkCard) => {
    const status = STATUS_META[card.review_status];
    return (
      <label
        key={card.id}
        className="flex items-start justify-between gap-3 py-2 pr-2 pl-8 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer"
      >
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${status.className}`}>
              {status.label}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              הועלה {formatDate(card.created_at)}
            </span>
          </div>
          {card.notes && (
            <div className="text-xs text-slate-600 dark:text-slate-400 truncate">
              <span className="material-symbols-outlined align-middle text-sm">comment</span> {card.notes}
            </div>
          )}
        </div>
        <input
          type="checkbox"
          checked={selectedCardIds.has(card.id)}
          onChange={() => toggleCard(card.id)}
          className="mt-1 w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-primary focus:ring-primary shrink-0"
        />
      </label>
    );
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="הורדת כרטיסי עבודה" maxWidth="lg">
      <div className="space-y-6">
        <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-lg">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 flex items-center justify-center">
              <span className="material-symbols-outlined">download</span>
            </div>
            <div>
              <div className="font-bold text-slate-900 dark:text-white">{siteName}</div>
              <div className="text-sm text-slate-600 dark:text-slate-400">
                בחירת כרטיסי עבודה להורדה לפי חודש
              </div>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            חודש עיבוד
          </label>
          <MonthPicker
            value={selectedMonth}
            onChange={setSelectedMonth}
            storageKey={`work_card_export_month_${siteId}`}
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              כרטיסים ({selectedCardIds.size} נבחרו)
            </label>
            <div className="flex items-center gap-2 text-xs">
              <button type="button" className="text-primary hover:underline" onClick={selectAllVisible}>
                בחר הכל
              </button>
              <button type="button" className="text-primary hover:underline" onClick={selectApprovedVisible}>
                מאושרים בלבד
              </button>
              <button type="button" className="text-slate-500 hover:underline" onClick={clearSelection}>
                נקה
              </button>
            </div>
          </div>

          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="חיפוש לפי שם או דרכון"
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm mb-3"
          />

          <div className="max-h-64 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-lg divide-y divide-slate-200 dark:divide-slate-700">
            {isLoading && (
              <div className="p-4 text-center text-slate-500 text-sm">טוען כרטיסים...</div>
            )}

            {!isLoading &&
              filteredGroups.map((group) => {
                const isExpanded = expandedGroups.has(group.key);
                const selectedInGroup = group.cards.filter((card) => selectedCardIds.has(card.id)).length;
                return (
                  <div key={group.key}>
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.key)}
                      className="w-full flex items-center justify-between gap-2 p-3 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="material-symbols-outlined text-base text-slate-400">
                          {isExpanded ? 'expand_more' : 'chevron_left'}
                        </span>
                        <div className="flex flex-col items-start min-w-0">
                          <span className="font-medium truncate">{group.name}</span>
                          {group.passportId && (
                            <span className="text-xs text-slate-500 dark:text-slate-400">
                              {group.passportId}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0">
                        {selectedInGroup}/{group.cards.length} כרטיסים
                      </span>
                    </button>
                    {isExpanded && (
                      <div className="bg-slate-50/60 dark:bg-slate-900/40 divide-y divide-slate-100 dark:divide-slate-800">
                        {group.cards.map(renderCardRow)}
                      </div>
                    )}
                  </div>
                );
              })}

            {!isLoading && filteredGroups.length === 0 && (
              <div className="p-4 text-center text-slate-500 text-sm">לא נמצאו כרטיסים</div>
            )}
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-300 text-sm">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700 rounded-lg transition-colors font-medium"
            disabled={isDownloading}
          >
            ביטול
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={!canDownload || isDownloading}
            className="px-6 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg transition-colors font-bold shadow-lg shadow-primary/30 disabled:opacity-50"
          >
            {isDownloading ? 'מוריד...' : 'הורד'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
