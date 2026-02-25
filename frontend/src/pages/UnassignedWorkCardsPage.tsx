import { useState, useEffect, useMemo } from 'react';
import type { Employee } from '../types';
import { getUnassignedWorkCards, updateWorkCard, type UnassignedWorkCard } from '../api/workCards';
import { getEmployees } from '../api/employees';
import { useAuth } from '../context/AuthContext';
import MonthPicker from '../components/MonthPicker';
import Modal from '../components/Modal';

// ── Edit distance & diff utilities ────────────────────────────────────────────

type EditOp =
  | { type: 'match'; char: string }
  | { type: 'substitute'; extracted: string; candidate: string }
  | { type: 'delete'; char: string }   // in extracted, missing from candidate
  | { type: 'insert'; char: string };  // in candidate, added vs extracted

function computeEditDpAndOps(a: string, b: string): { dist: number; ops: EditOp[] } {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const ops: EditOp[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.push({ type: 'match', char: a[i - 1] });
      i--; j--;
    } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      ops.push({ type: 'substitute', extracted: a[i - 1], candidate: b[j - 1] });
      i--; j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      ops.push({ type: 'delete', char: a[i - 1] });
      i--;
    } else {
      ops.push({ type: 'insert', char: b[j - 1] });
      j--;
    }
  }
  return { dist: dp[m][n], ops: ops.reverse() };
}

interface PassportSuggestion {
  employee: Employee;
  editDistance: number;
  score: number;
  confidence: 'high' | 'medium' | 'low';
  ops: EditOp[];
}

// Thresholds for "recommend", "caution", "ambiguous"
// Using combined edit distance + normalized score to guard against
// short-string false positives (e.g. "12" vs "13" = dist 1, score 0.5 — too short)
const THRESHOLDS: Record<'high' | 'medium' | 'low', { maxDist: number; minScore: number }> = {
  high:   { maxDist: 1, minScore: 0.80 },
  medium: { maxDist: 2, minScore: 0.65 },
  low:    { maxDist: 3, minScore: 0.50 },
};

function computePassportSuggestions(
  extractedId: string | null | undefined,
  employees: Employee[],
): PassportSuggestion[] {
  if (!extractedId?.trim()) return [];
  const a = extractedId.replace(/\s/g, '');
  if (a.length < 4) return []; // too short to be meaningful

  const results: PassportSuggestion[] = [];

  for (const emp of employees) {
    if (!emp.passport_id) continue;
    const b = emp.passport_id.replace(/\s/g, '');
    if (b.length < 4) continue;

    const { dist, ops } = computeEditDpAndOps(a, b);
    const score = 1 - dist / Math.max(a.length, b.length);

    let confidence: 'high' | 'medium' | 'low' | null = null;
    if (dist <= THRESHOLDS.high.maxDist && score >= THRESHOLDS.high.minScore) {
      confidence = 'high';
    } else if (dist <= THRESHOLDS.medium.maxDist && score >= THRESHOLDS.medium.minScore) {
      confidence = 'medium';
    } else if (dist <= THRESHOLDS.low.maxDist && score >= THRESHOLDS.low.minScore) {
      confidence = 'low';
    }

    if (!confidence) continue;

    results.push({ employee: emp, editDistance: dist, score, confidence, ops });
  }

  return results
    .sort((x, y) => x.editDistance - y.editDistance || y.score - x.score)
    .slice(0, 5);
}

// ── PassportDiff component ────────────────────────────────────────────────────
// Shows two aligned lines (extracted / candidate) with color-coded char differences.

function PassportDiff({ ops, extractedLabel = 'מחולץ', candidateLabel = 'מועמד' }: {
  ops: EditOp[];
  extractedLabel?: string;
  candidateLabel?: string;
}) {
  const extractedLine: { char: string; type: string }[] = [];
  const candidateLine: { char: string; type: string }[] = [];

  for (const op of ops) {
    if (op.type === 'match') {
      extractedLine.push({ char: op.char, type: 'match' });
      candidateLine.push({ char: op.char, type: 'match' });
    } else if (op.type === 'substitute') {
      extractedLine.push({ char: op.extracted, type: 'substitute-from' });
      candidateLine.push({ char: op.candidate, type: 'substitute-to' });
    } else if (op.type === 'delete') {
      extractedLine.push({ char: op.char, type: 'delete' });
      candidateLine.push({ char: '·', type: 'gap' });
    } else {
      extractedLine.push({ char: '·', type: 'gap' });
      candidateLine.push({ char: op.char, type: 'insert' });
    }
  }

  const charCls = (type: string) => {
    switch (type) {
      case 'match':          return 'text-slate-500 dark:text-slate-400';
      case 'substitute-from': return 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded px-px';
      case 'substitute-to':  return 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 rounded px-px font-semibold';
      case 'delete':         return 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 line-through rounded px-px';
      case 'insert':         return 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 rounded px-px font-semibold';
      case 'gap':            return 'text-slate-300 dark:text-slate-600 select-none';
      default:               return '';
    }
  };

  return (
    <div className="font-mono text-xs space-y-1 mt-1" dir="ltr">
      <div className="flex items-center gap-1.5">
        <span className="text-slate-400 dark:text-slate-500 w-12 shrink-0 text-left">{extractedLabel}:</span>
        <span className="flex gap-px">
          {extractedLine.map((c, idx) => (
            <span key={idx} className={charCls(c.type)}>{c.char}</span>
          ))}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-slate-400 dark:text-slate-500 w-12 shrink-0 text-left">{candidateLabel}:</span>
        <span className="flex gap-px">
          {candidateLine.map((c, idx) => (
            <span key={idx} className={charCls(c.type)}>{c.char}</span>
          ))}
        </span>
      </div>
    </div>
  );
}

// ── ConfidenceBadge component ─────────────────────────────────────────────────

function ConfidenceBadge({ confidence, dist }: { confidence: 'high' | 'medium' | 'low'; dist: number }) {
  const cfg = {
    high:   { label: 'התאמה גבוהה', cls: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' },
    medium: { label: 'התאמה סבירה', cls: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' },
    low:    { label: 'בדוק ידנית',  cls: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400' },
  }[confidence];
  const distLabel = dist === 0 ? 'זהה' : `${dist} שינוי${dist > 1 ? 'ים' : ''}`;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.cls}`}>
      {cfg.label}
      <span className="opacity-60">({distLabel})</span>
    </span>
  );
}

// ── SuggestionItem component ──────────────────────────────────────────────────

function SuggestionItem({
  suggestion,
  isSelected,
  onSelect,
}: {
  suggestion: PassportSuggestion;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const isExact = suggestion.editDistance === 0;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-right rounded-lg border p-3 transition-colors text-left ${
        isSelected
          ? 'border-primary bg-primary/5 dark:bg-primary/10'
          : 'border-slate-200 dark:border-slate-700 hover:border-primary/40 hover:bg-slate-50 dark:hover:bg-slate-800/60'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
          {isSelected && (
            <span className="material-symbols-outlined text-primary text-lg leading-none">check_circle</span>
          )}
          <ConfidenceBadge confidence={suggestion.confidence} dist={suggestion.editDistance} />
        </div>
        <div className="flex-1 min-w-0 text-right" dir="rtl">
          <div className="text-sm font-medium text-slate-900 dark:text-white">{suggestion.employee.full_name}</div>
          {isExact ? (
            <div className="text-xs text-green-600 dark:text-green-400 mt-0.5 font-mono">
              {suggestion.employee.passport_id} — ת.ז. זהה לחלוטין
            </div>
          ) : (
            <PassportDiff ops={suggestion.ops} />
          )}
        </div>
      </div>
    </button>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const getCurrentMonth = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

const formatMonth = (isoDate: string): string => {
  const [year, month] = isoDate.split('-');
  const d = new Date(parseInt(year), parseInt(month) - 1, 1);
  return d.toLocaleDateString('he-IL', { year: 'numeric', month: 'long' });
};

const PAGE_SIZE = 20;

// ── Page component ────────────────────────────────────────────────────────────

export default function UnassignedWorkCardsPage() {
  const { isAuthenticated } = useAuth();

  const [cards, setCards] = useState<UnassignedWorkCard[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentMonth());
  const [searchQuery, setSearchQuery] = useState('');

  // Assign modal state
  const [assignCard, setAssignCard] = useState<UnassignedWorkCard | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [isAssigning, setIsAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);
  const [showManualSearch, setShowManualSearch] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const fetchCards = async (page: number) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await getUnassignedWorkCards({
        month: `${selectedMonth}-01`,
        page,
        page_size: PAGE_SIZE,
      });
      setCards(result.items);
      setTotal(result.total);
    } catch (err) {
      console.error('Failed to fetch unassigned cards:', err);
      setError('שגיאה בטעינת הנתונים');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchCards(currentPage);
  }, [isAuthenticated, selectedMonth, currentPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedMonth]);

  useEffect(() => {
    if (!isAuthenticated) return;
    getEmployees({ active: true })
      .then(setEmployees)
      .catch((err) => console.error('Failed to fetch employees:', err));
  }, [isAuthenticated]);

  // Compute passport suggestions for all currently displayed cards
  const suggestionsByCardId = useMemo(() => {
    if (!employees.length) return {} as Record<string, PassportSuggestion[]>;
    const map: Record<string, PassportSuggestion[]> = {};
    for (const card of cards) {
      if (card.extraction?.status === 'DONE' && card.extraction.extracted_passport_id) {
        map[card.id] = computePassportSuggestions(card.extraction.extracted_passport_id, employees);
      }
    }
    return map;
  }, [cards, employees]);

  // Suggestions for the card currently open in the assign modal
  const modalSuggestions = useMemo(
    () => (assignCard ? (suggestionsByCardId[assignCard.id] ?? []) : []),
    [assignCard, suggestionsByCardId],
  );

  const filteredCards = useMemo(() => {
    if (!searchQuery.trim()) return cards;
    const q = searchQuery.toLowerCase();
    return cards.filter(
      (c) =>
        (c.extraction?.extracted_employee_name ?? '').toLowerCase().includes(q) ||
        (c.extraction?.extracted_passport_id ?? '').toLowerCase().includes(q) ||
        (c.original_filename ?? '').toLowerCase().includes(q),
    );
  }, [cards, searchQuery]);

  const filteredEmployees = useMemo(() => {
    if (!employeeSearch.trim()) return employees;
    const q = employeeSearch.toLowerCase();
    return employees.filter(
      (e) =>
        (e.full_name ?? '').toLowerCase().includes(q) ||
        (e.passport_id ?? '').toLowerCase().includes(q),
    );
  }, [employees, employeeSearch]);

  const handleOpenAssign = (card: UnassignedWorkCard) => {
    setAssignCard(card);
    setSelectedEmployeeId('');
    setEmployeeSearch('');
    setAssignError(null);
    setShowAllSuggestions(false);
    setShowManualSearch(false);
  };

  const handleConfirmAssign = async () => {
    if (!assignCard || !selectedEmployeeId) return;
    setIsAssigning(true);
    setAssignError(null);
    try {
      await updateWorkCard(assignCard.id, { employee_id: selectedEmployeeId });
      setAssignCard(null);
      fetchCards(currentPage);
    } catch (err: any) {
      setAssignError(err?.response?.data?.message || 'שגיאה בשיוך העובד');
    } finally {
      setIsAssigning(false);
    }
  };

  const getExtractionStatusLabel = (status?: string) => {
    switch (status) {
      case 'PENDING': return { label: 'ממתין', cls: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' };
      case 'RUNNING': return { label: 'מעבד',  cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' };
      case 'DONE':    return { label: 'הושלם', cls: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' };
      case 'FAILED':  return { label: 'נכשל',  cls: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' };
      default:        return { label: 'לא ידוע', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' };
    }
  };

  // Derive top confidence for a list of suggestions (for table badges)
  const topConfidence = (sugs: PassportSuggestion[] | undefined) => {
    if (!sugs?.length) return null;
    return sugs[0].confidence;
  };

  const confidenceDotCls: Record<'high' | 'medium' | 'low', string> = {
    high:   'text-green-600 dark:text-green-400',
    medium: 'text-yellow-600 dark:text-yellow-500',
    low:    'text-orange-500 dark:text-orange-400',
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-2">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-[#111518] dark:text-white text-3xl font-bold">כרטיסים לא משויכים</h2>
            {!isLoading && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                {total} כרטיסים
              </span>
            )}
          </div>
          <p className="text-[#617989] dark:text-slate-400 mt-1">
            כרטיסי עבודה שהועלו ללא אתר או עובד — ממתינים לשיוך ידני
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-white dark:bg-[#1a2a35] rounded-xl shadow-xl border border-slate-200/50 dark:border-slate-700/50 p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              חודש
            </label>
            <MonthPicker value={selectedMonth} onChange={setSelectedMonth} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              חיפוש
            </label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all text-sm"
              placeholder="חפש לפי שם, ת.ז. או שם קובץ..."
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-[#1a2a35] rounded-xl shadow-xl border border-slate-200/50 dark:border-slate-700/50 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-slate-500">טוען נתונים...</div>
        ) : error ? (
          <div className="p-8 text-center text-red-500">{error}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                  <th className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200">שם שחולץ</th>
                  <th className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200">ת.ז. שחולצה</th>
                  <th className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200">חודש</th>
                  <th className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200">קובץ</th>
                  <th className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200">סטטוס חילוץ</th>
                  <th className="px-6 py-4 text-sm font-bold text-[#111518] dark:text-slate-200">פעולה</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                {filteredCards.map((card) => {
                  const { label, cls } = getExtractionStatusLabel(card.extraction?.status);
                  const sugs = suggestionsByCardId[card.id];
                  const topConf = topConfidence(sugs);
                  return (
                    <tr
                      key={card.id}
                      className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors"
                    >
                      <td className="px-6 py-4">
                        <span className="text-[#111518] dark:text-white font-medium">
                          {card.extraction?.extracted_employee_name ?? '—'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-[#111518] dark:text-white font-mono text-sm">
                          {card.extraction?.extracted_passport_id ?? '—'}
                        </span>
                        {/* Suggestion hint below passport */}
                        {topConf && sugs && sugs.length > 0 && (
                          <div className={`flex items-center gap-1 mt-0.5 text-xs ${confidenceDotCls[topConf]}`}>
                            <span className="material-symbols-outlined text-[13px] leading-none">auto_awesome</span>
                            <span>
                              {sugs.length} התאמ{sugs.length === 1 ? 'ה' : 'ות'} אפשרי{sugs.length === 1 ? 'ת' : 'ות'}
                            </span>
                          </div>
                        )}
                        {card.extraction?.status === 'DONE' && !card.extraction.extracted_passport_id && (
                          <div className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">ת.ז. לא חולצה</div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-[#617989] dark:text-slate-400 text-sm">
                          {formatMonth(card.processing_month)}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-[#617989] dark:text-slate-400 text-sm truncate max-w-[180px] block">
                          {card.original_filename ?? '—'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${cls}`}>
                          {label}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => handleOpenAssign(card)}
                          className="px-3 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors font-medium"
                        >
                          שייך עובד
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {filteredCards.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-500">
                      {searchQuery ? 'לא נמצאו כרטיסים התואמים את החיפוש' : 'אין כרטיסים לא משויכים לחודש זה'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {total > 0 && (
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 px-6 py-4 border-t border-slate-100 dark:border-slate-700/50 bg-slate-50/60 dark:bg-slate-900/40">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(1)}
                    disabled={currentPage === 1}
                    className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    ראשון
                  </button>
                  <button
                    onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    הקודם
                  </button>
                  <button
                    onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    הבא
                  </button>
                  <button
                    onClick={() => setCurrentPage(totalPages)}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    אחרון
                  </button>
                </div>
                <div className="text-sm text-slate-600 dark:text-slate-400">
                  עמוד {currentPage} מתוך {totalPages}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Assign Employee Modal */}
      <Modal
        isOpen={!!assignCard}
        onClose={() => setAssignCard(null)}
        title="שיוך עובד לכרטיס עבודה"
        maxWidth="sm"
      >
        <div className="flex flex-col gap-4" dir="rtl">
          {/* Card info */}
          {assignCard && (
            <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg text-sm">
              <div className="font-medium text-slate-700 dark:text-slate-300">
                שם שחולץ: {assignCard.extraction?.extracted_employee_name ?? '—'}
              </div>
              <div className="text-slate-500 dark:text-slate-400 font-mono text-xs mt-0.5">
                ת.ז.: {assignCard.extraction?.extracted_passport_id ?? '—'}
              </div>
            </div>
          )}

          {/* ── System recommendations ── */}
          {modalSuggestions.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[16px] text-primary">auto_awesome</span>
                <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  המלצות מערכת
                </h4>
                {modalSuggestions.length > 3 && (
                  <span className="text-xs text-slate-400 dark:text-slate-500 mr-auto">
                    {modalSuggestions.length} התאמות
                  </span>
                )}
              </div>

              <div className="space-y-2">
                {modalSuggestions.slice(0, showAllSuggestions ? undefined : 3).map((s) => (
                  <SuggestionItem
                    key={s.employee.id}
                    suggestion={s}
                    isSelected={selectedEmployeeId === s.employee.id}
                    onSelect={() => setSelectedEmployeeId(s.employee.id)}
                  />
                ))}
              </div>

              {modalSuggestions.length > 3 && (
                <button
                  type="button"
                  onClick={() => setShowAllSuggestions((v) => !v)}
                  className="text-xs text-primary hover:underline"
                >
                  {showAllSuggestions
                    ? 'הצג פחות'
                    : `הצג עוד ${modalSuggestions.length - 3} המלצות`}
                </button>
              )}

              {/* Legend */}
              <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 text-xs text-slate-400 dark:text-slate-500 border-t border-slate-100 dark:border-slate-700/50">
                <span>
                  <span className="bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 rounded px-px font-mono text-xs">X</span>
                  {' '}תו שונה
                </span>
                <span>
                  <span className="bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 rounded px-px font-mono text-xs">X</span>
                  {' '}תו נוסף
                </span>
                <span>
                  <span className="bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 line-through rounded px-px font-mono text-xs">X</span>
                  {' '}תו חסר
                </span>
              </div>

              {/* Toggle manual search */}
              <button
                type="button"
                onClick={() => setShowManualSearch((v) => !v)}
                className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
              >
                <span className={`material-symbols-outlined text-[14px] transition-transform ${showManualSearch ? 'rotate-90' : ''}`}>
                  chevron_left
                </span>
                {showManualSearch ? 'הסתר חיפוש ידני' : 'חיפוש ידני לפי שם / ת.ז.'}
              </button>
            </div>
          )}

          {/* ── Manual search (shown always when no suggestions, or toggled when there are) ── */}
          {(modalSuggestions.length === 0 || showManualSearch) && (
            <>
              {modalSuggestions.length === 0 && (
                <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[14px]">info</span>
                  {assignCard?.extraction?.status === 'DONE' && assignCard?.extraction?.extracted_passport_id
                    ? 'לא נמצאו התאמות לפי ת.ז. — חפש ידנית'
                    : 'לא ניתן לחשב המלצות אוטומטיות — חפש ידנית'}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  חיפוש עובד
                </label>
                <input
                  type="text"
                  value={employeeSearch}
                  onChange={(e) => setEmployeeSearch(e.target.value)}
                  placeholder="חפש לפי שם או ת.ז..."
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all text-sm"
                  autoFocus={modalSuggestions.length === 0}
                />
              </div>

              <div className="max-h-48 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-lg divide-y divide-slate-100 dark:divide-slate-700">
                {filteredEmployees.length === 0 ? (
                  <div className="p-4 text-center text-slate-500 text-sm">לא נמצאו עובדים</div>
                ) : (
                  filteredEmployees.slice(0, 50).map((emp) => (
                    <button
                      key={emp.id}
                      type="button"
                      onClick={() => setSelectedEmployeeId(emp.id)}
                      className={`w-full text-right px-4 py-2.5 transition-colors flex items-center justify-between gap-2 ${
                        selectedEmployeeId === emp.id
                          ? 'bg-primary/10 dark:bg-primary/20'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      <div>
                        <div className="text-sm font-medium text-slate-900 dark:text-white">{emp.full_name}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">{emp.passport_id}</div>
                      </div>
                      {selectedEmployeeId === emp.id && (
                        <span className="material-symbols-outlined text-primary text-lg shrink-0">check_circle</span>
                      )}
                    </button>
                  ))
                )}
              </div>
            </>
          )}

          {assignError && (
            <div className="text-sm text-red-600 dark:text-red-400">{assignError}</div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              onClick={handleConfirmAssign}
              disabled={!selectedEmployeeId || isAssigning}
              className="flex-1 px-4 py-2.5 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isAssigning ? 'משייך...' : 'אשר שיוך'}
            </button>
            <button
              onClick={() => setAssignCard(null)}
              disabled={isAssigning}
              className="px-4 py-2.5 bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors font-medium disabled:opacity-50"
            >
              ביטול
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
