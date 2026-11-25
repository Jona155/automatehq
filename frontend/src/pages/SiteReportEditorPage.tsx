import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  getSiteReport,
  saveSiteReport,
  type ReportCellChange,
  type ReportCellValue,
  type ReportDayValue,
  type ReportModelCell,
  type ReportType,
  type SiteReportPayload,
} from '../api/siteReports';
import { downloadMonthlySummary, downloadSalaryTemplate, getSites } from '../api/sites';
import ReportGrid, { type GridCellView, type GridEdit, type GridSelection } from '../components/reports/ReportGrid';
import ReportCardsPane, { CARDS_PANE_MIN_WIDTH } from '../components/reports/ReportCardsPane';
import CellPopover from '../components/reports/CellPopover';
import {
  openCardsChannel,
  useSiteMonthCards,
  viewerUrl,
  viewerWindowName,
  type CardEmployee,
  type CardsSyncMessage,
} from '../components/reports/workCardViewer';
import LoadingIndicator from '../components/LoadingIndicator';
import Modal from '../components/Modal';
import MonthPicker from '../components/MonthPicker';
import { useAuth } from '../context/AuthContext';
import { useNavigationGuard } from '../hooks/useNavigationGuard';
import { useToast } from '../hooks/useToast';
import type { Site } from '../types';
import { downloadBlobFile } from '../utils/fileDownload';
import { getDefaultMonth } from '../utils/monthUtils';
import {
  LONG_DAY_HOURS_THRESHOLD,
  SATURDAY_LABEL,
  createFormulaEvaluator,
  dayValueToDisplay,
  formatCellValue,
  parseCellInput,
  sameDayValue,
} from '../utils/reportCells';

type CellDraft = { raw: ReportCellValue; force?: boolean } | { reset: true };
type CellDrafts = Record<string, CellDraft>;

const REPORT_LABELS: Record<ReportType, string> = { summary: 'סיכום', salary: 'שכר' };
const cellKey = (employeeId: string, day: number) => `${employeeId}:${day}`;
const posKey = (row: number, col: number) => `${row}:${col}`;
const isReset = (draft: CellDraft): draft is { reset: true } => 'reset' in draft;

const OTHER_SITE_NAMES_KEY = 'report-editor-other-site-names';
/** 'off' when the user chose not to have the edit popover open on every selection. */
const AUTO_POPOVER_KEY = 'report-editor-auto-popover';
function readOtherSiteNamesPreference(): boolean {
  try {
    return localStorage.getItem(OTHER_SITE_NAMES_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Remembers only an explicit close: the pane is open unless the user hid it. */
const CARDS_PANE_KEY = 'report-editor-cards-pane';
const CARDS_WIDTH_KEY = 'report-editor-cards-width';
const DEFAULT_CARDS_WIDTH = 420;

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable — the choice lasts for this visit
  }
}

function readCardsWidth(): number {
  const stored = Number(readStored(CARDS_WIDTH_KEY));
  return Number.isFinite(stored) && stored >= CARDS_PANE_MIN_WIDTH ? stored : DEFAULT_CARDS_WIDTH;
}

function describeDayValue(value: ReportDayValue, statusLabels: Record<string, string>) {
  const display = dayValueToDisplay(value, statusLabels);
  return display === null ? 'ריק' : String(display);
}

export default function SiteReportEditorPage() {
  const { siteId = '', businessCode = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast, ToastContainer } = useToast();

  const reportType: ReportType = searchParams.get('type') === 'salary' ? 'salary' : 'summary';
  const monthParam = searchParams.get('month');
  const month = monthParam && /^\d{4}-\d{2}$/.test(monthParam)
    ? monthParam
    : getDefaultMonth(user?.business?.default_month_cutoff_day);

  const [payload, setPayload] = useState<SiteReportPayload | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const [reloadTick, setReloadTick] = useState(0);

  const [cellDrafts, setCellDrafts] = useState<CellDrafts>({});
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<{ past: CellDrafts[]; future: CellDrafts[] }>({ past: [], future: [] });
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveFailure, setSaveFailure] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [selection, setSelection] = useState<GridSelection | null>(null);
  const [pendingLeave, setPendingLeave] = useState<{ run: () => void } | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [showOtherSiteNames, setShowOtherSiteNames] = useState(readOtherSiteNamesPreference);
  const showOtherSiteNamesRef = useRef(showOtherSiteNames);
  showOtherSiteNamesRef.current = showOtherSiteNames;
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [cardsOpen, setCardsOpen] = useState(() => readStored(CARDS_PANE_KEY) !== 'closed');
  const [cardsWidth, setCardsWidth] = useState(readCardsWidth);
  /** Viewer tabs currently open (they announce themselves on the sync channel). */
  const [viewerIds, setViewerIds] = useState<string[]>([]);
  /** The employee the card pane / viewer tab shows: the last one selected in the sheet. */
  const [cardsEmployee, setCardsEmployee] = useState<CardEmployee | null>(null);

  const cellDraftsRef = useRef(cellDrafts);
  cellDraftsRef.current = cellDrafts;

  const resetDraftState = useCallback(() => {
    setCellDrafts({});
    setNoteDrafts({});
    setHistory({ past: [], future: [] });
    setServerErrors({});
    setSaveFailure(null);
    setIsStale(false);
  }, []);

  // --- loading ---

  useEffect(() => {
    let cancelled = false;
    setLoadState('loading');
    setPayload(null);
    setSelection(null);
    resetDraftState();
    getSiteReport(siteId, reportType, month, { showOtherSiteNames: showOtherSiteNamesRef.current })
      .then((data) => {
        if (cancelled) return;
        setPayload(data);
        setLoadState('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        const status = err?.response?.status;
        setLoadError(
          status === 404
            ? 'עורך הדוחות אינו זמין, או שהאתר לא נמצא.'
            : err?.response?.data?.message || 'שגיאה בטעינת הדוח',
        );
        setLoadState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [siteId, reportType, month, reloadTick, resetDraftState]);

  useEffect(() => {
    getSites({ active: true }).then(setSites).catch(() => setSites([]));
  }, []);

  // The sidebar entry reopens the site you last worked on.
  useEffect(() => {
    if (!siteId || !businessCode) return;
    try {
      localStorage.setItem(`report-editor-last-site:${businessCode}`, siteId);
    } catch {
      // storage unavailable — the sidebar entry falls back to the first site
    }
  }, [siteId, businessCode]);

  /**
   * Naming the other site only changes how the sheet is drawn, so the report is
   * fetched again without touching unsaved edits.
   */
  const toggleOtherSiteNames = useCallback(async (next: boolean) => {
    setShowOtherSiteNames(next);
    showOtherSiteNamesRef.current = next;
    try {
      localStorage.setItem(OTHER_SITE_NAMES_KEY, String(next));
    } catch {
      // storage unavailable — the choice lasts for this visit
    }
    setIsRefreshing(true);
    try {
      const data = await getSiteReport(siteId, reportType, month, { showOtherSiteNames: next });
      setPayload((current) => (current && current.site.id === data.site.id && current.report_type === data.report_type ? data : current));
    } catch {
      setShowOtherSiteNames(!next);
      showOtherSiteNamesRef.current = !next;
      showToast('שגיאה בטעינת שמות האתרים', 'error');
    } finally {
      setIsRefreshing(false);
    }
  }, [siteId, reportType, month, showToast]);

  // --- derived view ---

  const statusLabels = useMemo(() => payload?.status_labels ?? {}, [payload]);

  const lookups = useMemo(() => {
    const adjustments = new Map<string, SiteReportPayload['adjustments'][number]>();
    const notes = new Map<string, string>();
    const comments = new Map<string, string>();
    const inputCells = new Map<string, ReportModelCell>();
    const employees = new Map<string, string>();
    if (payload) {
      payload.adjustments.forEach((a) => adjustments.set(cellKey(a.employee_id, a.day), a));
      payload.notes.forEach((n) => notes.set(cellKey(n.employee_id, n.day), n.text));
      payload.day_comments.forEach((c) => comments.set(cellKey(c.employee_id, c.day), c.text));
      payload.model.cells.forEach((cell) => {
        if (cell.kind === 'input' && cell.employee_id && cell.day) {
          inputCells.set(cellKey(cell.employee_id, cell.day), cell);
        }
      });
      payload.model.employees.forEach((e) => employees.set(e.id, e.full_name));
    }
    return { adjustments, notes, comments, inputCells, employees };
  }, [payload]);

  /** The saved value of an input cell, as the server reports it. */
  const savedDayValue = useCallback((key: string): ReportDayValue => {
    const adjustment = lookups.adjustments.get(key);
    if (adjustment) return adjustment.value;
    const cell = lookups.inputCells.get(key);
    const parsed = parseCellInput(cell?.value ?? null, statusLabels);
    return parsed.ok ? parsed.value : { hours: null, status: null };
  }, [lookups, statusLabels]);

  const view = useMemo(() => {
    const cells = new Map<string, GridCellView>();
    const errors: Record<string, string> = {};
    if (!payload) return { cells, errors };

    const effective = new Map<string, { value: ReportCellValue; formula?: string }>();
    const draftFill = new Map<string, string | undefined>();

    for (const cell of payload.model.cells) {
      let value = cell.value;
      if (cell.kind === 'input' && cell.employee_id && cell.day) {
        const key = cellKey(cell.employee_id, cell.day);
        const draft = cellDrafts[key];
        if (draft) {
          let dayValue: ReportDayValue | null = null;
          if (isReset(draft)) {
            dayValue = lookups.adjustments.get(key)?.source ?? savedDayValue(key);
          } else {
            const parsed = parseCellInput(draft.raw, statusLabels);
            if (parsed.ok) dayValue = parsed.value;
            else {
              errors[key] = parsed.message;
              value = draft.raw;
            }
          }
          if (dayValue) {
            value = dayValueToDisplay(dayValue, statusLabels);
            draftFill.set(
              posKey(cell.row, cell.col),
              dayValue.hours !== null && dayValue.hours > LONG_DAY_HOURS_THRESHOLD ? '#D9D9D9' : undefined,
            );
          }
        }
        if (serverErrors[key] && !errors[key]) errors[key] = serverErrors[key];
      }
      effective.set(posKey(cell.row, cell.col), { value, formula: cell.formula });
    }

    const evaluator = createFormulaEvaluator((row, col) => effective.get(posKey(row, col)));

    for (const cell of payload.model.cells) {
      const pos = posKey(cell.row, cell.col);
      const key = cell.kind === 'input' && cell.employee_id && cell.day ? cellKey(cell.employee_id, cell.day) : null;
      const draft = key ? cellDrafts[key] : undefined;
      const value = cell.formula ? evaluator.cellValue(cell.row, cell.col) : effective.get(pos)?.value ?? null;
      const adjustment = key ? lookups.adjustments.get(key) : undefined;
      const noteDraft = key ? noteDrafts[key] : undefined;
      cells.set(pos, {
        row: cell.row,
        col: cell.col,
        text: formatCellValue(value, cell.number_format),
        kind: cell.kind,
        editable: cell.kind === 'input',
        fill: draft ? draftFill.get(pos) : cell.fill,
        bold: cell.bold,
        hasNote: noteDraft === undefined
          ? Boolean(cell.note)
          : Boolean(noteDraft || (key && lookups.comments.get(key))),
        adjusted: Boolean(adjustment) && !(draft && isReset(draft)),
        conflict: Boolean(adjustment?.conflict) && !draft,
        dirty: Boolean(draft) || noteDraft !== undefined,
        error: key ? errors[key] : undefined,
      });
    }
    return { cells, errors };
  }, [payload, cellDrafts, noteDrafts, serverErrors, lookups, statusLabels, savedDayValue]);

  const isDirty = Object.keys(cellDrafts).length > 0 || Object.keys(noteDrafts).length > 0;
  const errorKeys = Object.keys(view.errors);
  const conflictKeys = useMemo(
    () => (payload ? payload.adjustments.filter((a) => a.conflict).map((a) => cellKey(a.employee_id, a.day)) : []),
    [payload],
  );

  const saveStatus: 'saved' | 'dirty' | 'saving' | 'failed' = isSaving
    ? 'saving'
    : saveFailure && isDirty
      ? 'failed'
      : isDirty
        ? 'dirty'
        : 'saved';

  // --- editing ---

  const applyCellDrafts = useCallback((update: (drafts: CellDrafts) => CellDrafts) => {
    const current = cellDraftsRef.current;
    const next = update(current);
    if (next === current) return;
    setHistory((h) => ({ past: [...h.past.slice(-199), current], future: [] }));
    setCellDrafts(next);
    setSaveFailure(null);
  }, []);

  const setCellRaw = useCallback((changes: { key: string; raw: ReportCellValue; force?: boolean }[]) => {
    applyCellDrafts((drafts) => {
      const next = { ...drafts };
      let touched = false;
      for (const change of changes) {
        const parsed = parseCellInput(change.raw, statusLabels);
        const unchanged = parsed.ok && !change.force && sameDayValue(parsed.value, savedDayValue(change.key));
        if (unchanged) {
          if (next[change.key]) {
            delete next[change.key];
            touched = true;
          }
        } else {
          next[change.key] = { raw: change.raw, force: change.force };
          touched = true;
        }
      }
      return touched ? next : drafts;
    });
    setServerErrors((prev) => {
      if (!changes.some((c) => prev[c.key])) return prev;
      const next = { ...prev };
      changes.forEach((c) => delete next[c.key]);
      return next;
    });
  }, [applyCellDrafts, savedDayValue, statusLabels]);

  const handleGridEdit = useCallback((edits: GridEdit[]) => {
    if (!payload) return;
    const byPos = new Map(payload.model.cells.map((c) => [posKey(c.row, c.col), c]));
    const changes = edits.flatMap((edit) => {
      const cell = byPos.get(posKey(edit.row, edit.col));
      if (!cell || cell.kind !== 'input' || !cell.employee_id || !cell.day) return [];
      return [{ key: cellKey(cell.employee_id, cell.day), raw: edit.raw.trim() === '' ? null : edit.raw.trim() }];
    });
    if (changes.length) setCellRaw(changes);
  }, [payload, setCellRaw]);

  /** Back to the source value: saved adjustments are reset, unsaved drafts dropped (one undo step). */
  const resetCells = useCallback((keys: string[]) => {
    applyCellDrafts((drafts) => {
      const next = { ...drafts };
      for (const key of keys) {
        if (lookups.adjustments.has(key)) next[key] = { reset: true };
        else delete next[key];
      }
      return next;
    });
  }, [applyCellDrafts, lookups]);
  const resetCell = useCallback((key: string) => resetCells([key]), [resetCells]);

  const undo = useCallback(() => {
    setHistory((h) => {
      if (!h.past.length) return h;
      const previous = h.past[h.past.length - 1];
      setCellDrafts(previous);
      return { past: h.past.slice(0, -1), future: [cellDraftsRef.current, ...h.future] };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory((h) => {
      if (!h.future.length) return h;
      const next = h.future[0];
      setCellDrafts(next);
      return { past: [...h.past, cellDraftsRef.current], future: h.future.slice(1) };
    });
  }, []);

  const setNote = useCallback((key: string, text: string) => {
    setNoteDrafts((prev) => {
      const next = { ...prev };
      if (text.trim() === (lookups.notes.get(key) ?? '')) delete next[key];
      else next[key] = text;
      return next;
    });
    setSaveFailure(null);
  }, [lookups]);

  // --- saving / downloading ---

  const save = useCallback(async (): Promise<boolean> => {
    if (!payload) return false;
    if (!isDirty) return true;
    if (errorKeys.length) {
      setSaveFailure('יש לתקן את התאים המסומנים באדום לפני השמירה.');
      return false;
    }
    const split = (key: string) => {
      const index = key.lastIndexOf(':');
      return { employee_id: key.slice(0, index), day: Number(key.slice(index + 1)) };
    };
    const cells: ReportCellChange[] = Object.entries(cellDrafts).map(([key, draft]) => (
      isReset(draft) ? { ...split(key), reset: true } : { ...split(key), value: draft.raw }
    ));
    const notes = Object.entries(noteDrafts).map(([key, text]) => ({ ...split(key), text: text.trim() }));

    setIsSaving(true);
    setSaveFailure(null);
    try {
      const next = await saveSiteReport(siteId, reportType, month, {
        base_revision: payload.revision, cells, notes, show_other_site_names: showOtherSiteNamesRef.current,
      });
      setPayload(next);
      resetDraftState();
      return true;
    } catch (err: any) {
      const status = err?.response?.status;
      const data = err?.response?.data;
      if (status === 409) {
        setIsStale(true);
        setSaveFailure('הדוח עודכן על ידי משתמש אחר. השינויים שלך נשמרו כטיוטה במסך זה ולא נכתבו.');
      } else if (status === 422 && Array.isArray(data?.data?.errors)) {
        const mapped: Record<string, string> = {};
        for (const item of data.data.errors) {
          if (item.employee_id && item.day) mapped[cellKey(item.employee_id, item.day)] = item.message;
        }
        setServerErrors(mapped);
        setSaveFailure(data?.message || 'חלק מהערכים אינם תקינים. דבר לא נשמר.');
      } else {
        setSaveFailure(data?.message || 'השמירה נכשלה. הטיוטה נשמרה במסך — אפשר לנסות שוב.');
      }
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [payload, isDirty, errorKeys.length, cellDrafts, noteDrafts, siteId, reportType, month, resetDraftState]);

  const download = useCallback(async () => {
    if (!payload) return;
    // Never hand out a file that claims to contain changes that were not saved.
    if (isDirty && !(await save())) return;
    setIsDownloading(true);
    try {
      const includeInactive = payload.load_options.include_inactive;
      const blob = reportType === 'summary'
        ? await downloadMonthlySummary(siteId, month, {
          approved_only: false,
          include_inactive: includeInactive,
          // The file names the other site exactly when the preview does.
          show_other_site_names: showOtherSiteNamesRef.current,
        })
        : await downloadSalaryTemplate(siteId, month, { include_inactive: includeInactive });
      const prefix = reportType === 'summary' ? 'monthly_summary' : 'salary_template';
      downloadBlobFile(blob, `${prefix}_${payload.site.name}_${month}.xlsx`);
    } catch {
      showToast('שגיאה בהורדת הדוח', 'error');
    } finally {
      setIsDownloading(false);
    }
  }, [payload, isDirty, save, reportType, siteId, month, showToast]);

  // --- leaving with unsaved changes ---

  const runUnguarded = useNavigationGuard(isDirty, (proceed) => setPendingLeave({ run: proceed }));

  const requestLeave = useCallback((action: () => void) => {
    if (isDirty) setPendingLeave({ run: () => runUnguarded(action) });
    else action();
  }, [isDirty, runUnguarded]);

  const updateParams = (next: { type?: ReportType; month?: string }) => {
    requestLeave(() => setSearchParams({ type: next.type ?? reportType, month: next.month ?? month }));
  };

  const changeSite = (nextSiteId: string) => {
    if (!nextSiteId || nextSiteId === siteId) return;
    requestLeave(() => navigate(`/${businessCode}/sites/${nextSiteId}/reports?type=${reportType}&month=${month}`));
  };

  const goBack = () => requestLeave(() => navigate(`/${businessCode}/sites/${siteId}`));

  const confirmLeave = async (choice: 'save' | 'discard') => {
    const pending = pendingLeave;
    if (!pending) return;
    if (choice === 'save') {
      const ok = await save();
      setPendingLeave(null);
      if (!ok) return;
    } else {
      setPendingLeave(null);
      resetDraftState();
    }
    pending.run();
  };

  // --- selection details ---

  const selectedModelCell = useMemo(() => {
    if (!payload || !selection) return null;
    return payload.model.cells.find((c) => c.row === selection.focus.row && c.col === selection.focus.col) ?? null;
  }, [payload, selection]);

  const selectedKey = selectedModelCell?.kind === 'input' && selectedModelCell.employee_id && selectedModelCell.day
    ? cellKey(selectedModelCell.employee_id, selectedModelCell.day)
    : null;

  const jumpTo = (key: string) => {
    const cell = lookups.inputCells.get(key);
    if (cell) setSelection({ anchor: { row: cell.row, col: cell.col }, focus: { row: cell.row, col: cell.col } });
  };

  const statusChip = {
    saved: { label: 'נשמר', icon: 'check_circle', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    dirty: { label: 'שינויים שלא נשמרו', icon: 'edit', className: 'bg-amber-50 text-amber-800 border-amber-200' },
    saving: { label: 'שומר…', icon: 'progress_activity', className: 'bg-sky-50 text-sky-700 border-sky-200' },
    failed: { label: 'השמירה נכשלה', icon: 'error', className: 'bg-red-50 text-red-700 border-red-200' },
  }[saveStatus];

  const [year, monthNumber] = month.split('-');
  const selectedAdjustment = selectedKey ? lookups.adjustments.get(selectedKey) : undefined;
  const selectedDraft = selectedKey ? cellDrafts[selectedKey] : undefined;
  const selectedComment = selectedKey ? lookups.comments.get(selectedKey) : undefined;
  const selectedNote = selectedKey ? noteDrafts[selectedKey] ?? lookups.notes.get(selectedKey) ?? '' : '';
  const selectedError = selectedKey ? view.errors[selectedKey] : undefined;

  // Value bar: the full content of the selected cell, however narrow its column.
  const selectedView = selection ? view.cells.get(posKey(selection.focus.row, selection.focus.col)) : undefined;
  // Header and total cells belong to an employee's column (Summary) or row (Salary) too.
  const selectedEmployee = !payload || !selection
    ? undefined
    : selectedModelCell?.employee_id
      ? payload.model.employees.find((e) => e.id === selectedModelCell.employee_id)
      : payload.model.employees.find((e) => (
        payload.model.orientation === 'employees_as_columns' ? e.col === selection.focus.col : e.row === selection.focus.row
      ));
  const selectedOtherSite = selectedModelCell?.employee_id && selectedModelCell.day
    ? payload?.model.other_site_labels?.[selectedModelCell.employee_id]?.[String(selectedModelCell.day)]
    : undefined;
  const selectedRangeSize = selection
    ? (Math.abs(selection.anchor.row - selection.focus.row) + 1) * (Math.abs(selection.anchor.col - selection.focus.col) + 1)
    : 0;

  // --- cell popover (edits the selected cell, or every editable cell of a range) ---

  const selectionRange = useMemo(() => (selection ? {
    minRow: Math.min(selection.anchor.row, selection.focus.row),
    maxRow: Math.max(selection.anchor.row, selection.focus.row),
    minCol: Math.min(selection.anchor.col, selection.focus.col),
    maxCol: Math.max(selection.anchor.col, selection.focus.col),
  } : null), [selection]);

  /** Day cells the popover acts on. In a range, Saturdays are passed over, as the fill does. */
  const popoverTargets = useMemo(() => {
    if (!payload || !selectionRange) return [] as string[];
    const keys: string[] = [];
    for (const cell of payload.model.cells) {
      if (cell.kind !== 'input' || !cell.employee_id || !cell.day) continue;
      if (cell.row < selectionRange.minRow || cell.row > selectionRange.maxRow) continue;
      if (cell.col < selectionRange.minCol || cell.col > selectionRange.maxCol) continue;
      keys.push(cellKey(cell.employee_id, cell.day));
    }
    if (keys.length <= 1) return keys;
    return keys.filter((key) => {
      const cell = lookups.inputCells.get(key);
      return !cell || view.cells.get(posKey(cell.row, cell.col))?.text !== SATURDAY_LABEL;
    });
  }, [payload, selectionRange, lookups, view]);

  const isMultiTarget = popoverTargets.length > 1;
  const resettableTargets = popoverTargets.filter((key) => lookups.adjustments.has(key) || cellDrafts[key]);
  const targetEmployeeNames = useMemo(() => {
    const ids = new Set(popoverTargets.map((key) => key.slice(0, key.lastIndexOf(':'))));
    return [...ids].map((id) => lookups.employees.get(id) ?? '');
  }, [popoverTargets, lookups]);

  const [popoverClosed, setPopoverClosed] = useState(false);
  const [autoPopover, setAutoPopover] = useState(() => readStored(AUTO_POPOVER_KEY) !== 'off');
  /** With the automatic popover off, the "עריכה" button opens it for the current selection. */
  const [popoverRequested, setPopoverRequested] = useState(false);
  const toggleAutoPopover = (next: boolean) => {
    setAutoPopover(next);
    writeStored(AUTO_POPOVER_KEY, next ? 'on' : 'off');
  };
  /**
   * A mouse drag in the sheet (fill handle, selecting a range) must reach the
   * cells under the pointer, and the popover sits right where the drag heads.
   * So it steps aside until the button is released.
   */
  const [gridDragging, setGridDragging] = useState(false);
  useEffect(() => {
    if (!gridDragging) return undefined;
    const stop = () => setGridDragging(false);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('blur', stop);
    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('blur', stop);
    };
  }, [gridDragging]);
  const [popoverValue, setPopoverValue] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const selectionSignature = selection
    ? `${selection.anchor.row}:${selection.anchor.col}:${selection.focus.row}:${selection.focus.col}`
    : '';
  // Every new selection brings the popover back, empty.
  useEffect(() => {
    setPopoverClosed(false);
    setPopoverValue('');
    setNoteOpen(false);
    setPopoverRequested(false);
  }, [selectionSignature]);

  const gridHostRef = useRef<HTMLDivElement | null>(null);
  const gridElement = () => gridHostRef.current?.querySelector<HTMLElement>('[data-testid="report-grid"]') ?? null;
  /** Hand the keyboard back to the sheet after a popover action. */
  const refocusGrid = () => gridElement()?.focus();

  const applyToTargets = (raw: ReportCellValue) => {
    if (!popoverTargets.length) return;
    setCellRaw(popoverTargets.map((key) => ({ key, raw })));
    refocusGrid();
  };

  const applyPopoverValue = () => {
    const text = popoverValue.trim();
    if (!text) return;
    applyToTargets(text);
    setPopoverValue('');
  };

  const closePopover = () => {
    setPopoverClosed(true);
    refocusGrid();
  };

  const showPopover = loadState === 'ready' && Boolean(payload) && popoverTargets.length > 0 && (autoPopover || popoverRequested) && !popoverClosed && !gridDragging && !pendingLeave;

  // --- work card images (side pane + viewer tab) ---

  // Cells that belong to no employee (titles, totals row) keep the last employee in view.
  useEffect(() => {
    if (selectedEmployee && selectedEmployee.id !== cardsEmployee?.id) {
      setCardsEmployee({ id: selectedEmployee.id, full_name: selectedEmployee.full_name, passport_id: selectedEmployee.passport_id });
    }
  }, [selectedEmployee, cardsEmployee?.id]);

  // A different site or month starts with nobody in view.
  useEffect(() => {
    setCardsEmployee(null);
  }, [siteId, month]);

  const cards = useSiteMonthCards(siteId, month, cardsOpen);

  const cardsFocusRef = useRef<CardsSyncMessage>({ type: 'focus', siteId, month, employee: null });
  cardsFocusRef.current = { type: 'focus', siteId, month, employee: cardsEmployee };
  const cardsChannelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    const channel = openCardsChannel(businessCode);
    cardsChannelRef.current = channel;
    if (!channel) return undefined;
    channel.onmessage = (event: MessageEvent<CardsSyncMessage>) => {
      const message = event.data;
      if (message.type === 'request-focus') channel.postMessage(cardsFocusRef.current);
      else if (message.type === 'viewer-open') setViewerIds((ids) => (ids.includes(message.viewerId) ? ids : [...ids, message.viewerId]));
      else if (message.type === 'viewer-closed') setViewerIds((ids) => ids.filter((id) => id !== message.viewerId));
    };
    channel.postMessage({ type: 'ping' } satisfies CardsSyncMessage);
    return () => {
      channel.close();
      cardsChannelRef.current = null;
    };
  }, [businessCode]);

  useEffect(() => {
    cardsChannelRef.current?.postMessage(cardsFocusRef.current);
  }, [siteId, month, cardsEmployee]);

  const toggleCards = () => {
    setCardsOpen((open) => {
      writeStored(CARDS_PANE_KEY, open ? 'closed' : 'open');
      return !open;
    });
  };


  const handleCardsWidth = useCallback((width: number, done: boolean) => {
    setCardsWidth(width);
    if (done) writeStored(CARDS_WIDTH_KEY, String(width));
  }, []);

  const popOutHref = viewerUrl(businessCode, siteId, month, cardsEmployee?.id);
  const popOutTarget = viewerWindowName(businessCode);
  const viewerConnected = viewerIds.length > 0;

  return (
    <div className="h-full min-h-0 flex flex-col" dir="rtl" data-testid="report-editor">
      <ToastContainer />

      {/* Header: context + report selection + save/download */}
      <div className="shrink-0 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* Context: back + site */}
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={goBack}
            title="חזרה לאתר"
            className="shrink-0 w-9 h-9 grid place-items-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500"
          >
            <span className="material-symbols-outlined">arrow_forward</span>
          </button>
          <div className="min-w-0">
            <div className="text-[11px] leading-4 text-slate-500 dark:text-slate-400">דוחות חודשיים</div>
            {/* Visible label sized to the name; the native select sits invisibly on top */}
            <label className="relative flex items-center gap-1 max-w-[18rem] rounded-md -mx-1 px-1 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer">
              <span className="truncate text-base font-bold leading-6 text-slate-900 dark:text-white">
                {sites.find((s) => s.id === siteId)?.site_name ?? payload?.site.name ?? '…'}
              </span>
              <span className="material-symbols-outlined shrink-0 text-[18px] text-slate-400">expand_more</span>
              <select
                aria-label="אתר"
                value={siteId}
                onChange={(event) => changeSite(event.target.value)}
                className="absolute inset-0 w-full opacity-0 cursor-pointer"
              >
                {!sites.some((s) => s.id === siteId) && <option value={siteId}>{payload?.site.name ?? '…'}</option>}
                {sites.map((s) => <option key={s.id} value={s.id}>{s.site_name}</option>)}
              </select>
            </label>
          </div>
        </div>

        <div className="hidden md:block w-px h-8 bg-slate-200 dark:bg-slate-700" />

        {/* Report selection: month + type */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="shrink-0 whitespace-nowrap">
            <MonthPicker value={month} onChange={(value) => updateParams({ month: value })} />
          </div>
          <div role="tablist" aria-label="סוג דוח" className="inline-flex h-11 items-center rounded-xl border border-slate-200 dark:border-slate-700 p-1 bg-slate-50 dark:bg-slate-900">
            {(['salary', 'summary'] as ReportType[]).map((type) => (
              <button
                key={type}
                role="tab"
                aria-selected={reportType === type}
                data-testid={`report-type-${type}`}
                onClick={() => type !== reportType && updateParams({ type })}
                className={`h-9 px-4 text-sm font-semibold rounded-lg transition-colors ${
                  reportType === type
                    ? 'bg-white dark:bg-slate-700 text-primary shadow-sm'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                {REPORT_LABELS[type]}
              </button>
            ))}
          </div>
        </div>

        {/* Actions (pushed to the far end; stays there when the header wraps) */}
        <div className="ms-auto flex items-center gap-2 shrink-0">
          <span
            data-testid="save-status"
            data-status={saveStatus}
            className={`inline-flex items-center gap-1 px-2.5 h-7 rounded-full border text-xs font-semibold whitespace-nowrap ${statusChip.className}`}
          >
            <span className={`material-symbols-outlined text-[16px] ${saveStatus === 'saving' ? 'animate-spin' : ''}`}>{statusChip.icon}</span>
            {statusChip.label}
          </span>

          <div className="inline-flex items-center">
            <button onClick={undo} disabled={!history.past.length} title="בטל (Ctrl+Z)" className="w-9 h-9 grid place-items-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 disabled:hover:bg-transparent text-slate-600 dark:text-slate-300">
              <span className="material-symbols-outlined text-[20px]">undo</span>
            </button>
            <button onClick={redo} disabled={!history.future.length} title="בצע שוב (Ctrl+Y)" className="w-9 h-9 grid place-items-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 disabled:hover:bg-transparent text-slate-600 dark:text-slate-300">
              <span className="material-symbols-outlined text-[20px]">redo</span>
            </button>
          </div>

          <div className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-700">
            <button
              type="button"
              data-testid="cards-toggle"
              aria-pressed={cardsOpen}
              onClick={toggleCards}
              title={cardsOpen ? 'הסתרת כרטיסי העבודה' : 'הצגת כרטיס העבודה של העובד הנבחר לצד הדוח'}
              className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-s-lg text-sm font-semibold whitespace-nowrap ${
                cardsOpen
                  ? 'bg-primary/10 text-primary'
                  : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">photo_library</span>
              כרטיסי עבודה
            </button>
            <a
              href={popOutHref}
              target={popOutTarget}
              data-testid="cards-popout"
              title={viewerConnected
                ? 'כרטיסי העבודה פתוחים בכרטיסייה נפרדת ועוקבים אחרי התא הנבחר'
                : 'פתיחת כרטיסי העבודה בכרטיסייה נפרדת — אפשר לגרור אותה למסך אחר'}
              className="relative w-9 h-9 grid place-items-center rounded-e-lg border-s border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              <span className="material-symbols-outlined text-[18px]">open_in_new</span>
              {viewerConnected && (
                <span data-testid="cards-viewer-connected" className="absolute top-1.5 left-1.5 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-slate-800" />
              )}
            </a>
          </div>

          <button
            data-testid="download-button"
            onClick={() => { void download(); }}
            disabled={isDownloading || isSaving || loadState !== 'ready'}
            title="הורדת הדוח כקובץ Excel"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 whitespace-nowrap"
          >
            <span className={`material-symbols-outlined text-[18px] ${isDownloading ? 'animate-spin' : ''}`}>{isDownloading ? 'progress_activity' : 'download'}</span>
            {isDirty ? 'שמירה והורדה' : 'הורדה'}
            <span className="text-[10px] font-bold text-slate-400 border border-slate-200 dark:border-slate-600 rounded px-1 leading-4">XLSX</span>
          </button>

          <button
            data-testid="save-button"
            onClick={() => { void save(); }}
            disabled={!isDirty || isSaving || loadState !== 'ready'}
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-sm font-semibold whitespace-nowrap bg-primary text-white hover:bg-primary/90 disabled:bg-slate-100 disabled:text-slate-400 dark:disabled:bg-slate-700 dark:disabled:text-slate-500 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-[18px]">save</span>
            {saveStatus === 'failed' ? 'נסה לשמור שוב' : 'שמירה'}
          </button>
        </div>
      </div>

      {/* Banners */}
      {loadState === 'ready' && payload && (
        <div className="shrink-0 px-4 pt-3 space-y-2 empty:hidden">
          {saveFailure && (
            <div data-testid="save-failure" className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 text-red-800 px-3 py-2 text-sm">
              <span className="material-symbols-outlined text-lg">error</span>
              <span className="flex-1">{saveFailure}</span>
              {isStale && (
                <button onClick={() => setReloadTick((t) => t + 1)} className="font-semibold underline">
                  טען גרסה עדכנית (הטיוטה תימחק)
                </button>
              )}
              {errorKeys.length > 0 && (
                <button onClick={() => jumpTo(errorKeys[0])} className="font-semibold underline">הצג תא שגוי</button>
              )}
            </div>
          )}
          {conflictKeys.length > 0 && (
            <div className="flex items-center gap-3 rounded-lg border border-orange-200 bg-orange-50 text-orange-900 px-3 py-2 text-sm">
              <span className="material-symbols-outlined text-lg">sync_problem</span>
              <span className="flex-1">
                ב-{conflictKeys.length} תאים נתוני המקור השתנו אחרי שנשמר תיקון. התיקון השמור עדיין בתוקף — יש לבדוק ולאשר.
              </span>
              <button onClick={() => jumpTo(conflictKeys[0])} className="font-semibold underline">עבור לתא</button>
            </div>
          )}
          {payload.orphan_adjustments.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 text-slate-700 px-3 py-2 text-sm">
              {payload.orphan_adjustments.length} תיקונים שמורים שייכים לעובדים שאינם מופיעים עוד בדוח זה, ולכן לא הוחלו.
            </div>
          )}
          {payload.has_unapproved_cards && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 text-slate-600 px-3 py-2 text-sm">
              הדוח כולל גם כרטיסי עבודה שטרם אושרו, בדיוק כמו בקובץ המיוצא.
            </div>
          )}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 min-h-0 flex gap-4 p-4">
        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          {loadState === 'loading' && (
            <div className="flex-1 grid place-items-center" data-testid="report-loading">
              <LoadingIndicator title="טוען את הדוח…" subtitle="" />
            </div>
          )}
          {loadState === 'error' && (
            <div className="flex-1 grid place-items-center" data-testid="report-error">
              <div className="text-center space-y-3">
                <span className="material-symbols-outlined text-4xl text-red-500">error</span>
                <p className="text-slate-700 dark:text-slate-200 font-semibold">{loadError}</p>
                <button onClick={() => setReloadTick((t) => t + 1)} className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold">
                  נסה שוב
                </button>
              </div>
            </div>
          )}
          {loadState === 'ready' && payload && payload.employee_count === 0 && (
            <div className="flex-1 grid place-items-center" data-testid="report-empty">
              <div className="text-center space-y-2 text-slate-500 dark:text-slate-400">
                <span className="material-symbols-outlined text-4xl">table_view</span>
                <p className="font-semibold">אין עובדים בדוח {REPORT_LABELS[reportType]} של האתר לחודש {monthNumber}/{year}.</p>
              </div>
            </div>
          )}
          {loadState === 'ready' && payload && payload.employee_count > 0 && (
            <>
              <div className="shrink-0 flex flex-wrap items-center gap-x-4 gap-y-1 pb-2 text-xs text-slate-600 dark:text-slate-300">
                <span className="font-semibold">{payload.model.sheet_title}</span>
                <span className="inline-flex items-center gap-1"><i className="w-3 h-3 rounded-sm border border-slate-300 bg-white" /> ניתן לעריכה</span>
                <span className="inline-flex items-center gap-1"><i className="w-3 h-3 rounded-sm border border-slate-300 bg-indigo-100" /> מחושב</span>
                <span className="inline-flex items-center gap-1"><i className="w-3 h-3 rounded-sm border border-slate-300 bg-slate-100" /> מוגן</span>
                <span className="inline-flex items-center gap-1"><i className="w-3 h-3 rounded-sm border border-slate-300 bg-amber-100" /> טרם נשמר</span>
                <span className="inline-flex items-center gap-1"><i className="w-2 h-2 rounded-full bg-sky-500" /> תוקן בדוח</span>
                <span className="inline-flex items-center gap-1"><i className="w-0 h-0 border-t-[7px] border-t-rose-500 border-r-[7px] border-r-transparent" /> הערה</span>
                <label
                  className="ms-auto inline-flex items-center gap-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 font-medium cursor-pointer"
                  title="כשהאפשרות כבויה, חלונית העריכה לא נפתחת בכל בחירה. אפשר לפתוח אותה בכפתור 'עריכה' שליד הערך."
                >
                  <input
                    type="checkbox"
                    data-testid="auto-popover-toggle"
                    className="accent-sky-600"
                    checked={autoPopover}
                    onChange={(event) => toggleAutoPopover(event.target.checked)}
                  />
                  חלונית עריכה ליד התא
                </label>
                {reportType === 'summary' && (
                  <label
                    className={`inline-flex items-center gap-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 font-medium ${payload.has_other_site_days ? 'cursor-pointer' : 'opacity-50'}`}
                    title={payload.has_other_site_days
                      ? 'מציג את שם האתר האחר בתצוגה ובקובץ שיורד מכאן'
                      : 'אין בדוח זה עובדים שעבדו באתר אחר בחודש זה'}
                  >
                    <input
                      type="checkbox"
                      data-testid="other-site-names-toggle"
                      className="accent-sky-600"
                      checked={showOtherSiteNames}
                      disabled={!payload.has_other_site_days || isRefreshing}
                      onChange={(event) => { void toggleOtherSiteNames(event.target.checked); }}
                    />
                    הצג שם האתר האחר
                    {isRefreshing && <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>}
                  </label>
                )}
              </div>
              <div
                data-testid="value-bar"
                className="shrink-0 mb-2 flex items-start gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm min-h-[2.25rem]"
              >
                {!selection && <span className="text-slate-400">בחרו תא כדי לראות את הערך המלא שלו</span>}
                {selection && (
                  <>
                    <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400 pt-0.5 max-w-[45%]">
                      {selectedEmployee
                        ? `${selectedEmployee.full_name}${selectedEmployee.passport_id ? ` · ${selectedEmployee.passport_id}` : ''}${selectedModelCell?.day ? ` · ${selectedModelCell.day}.${monthNumber}.${year}` : ''}`
                        : selectedModelCell?.kind === 'calculated' ? 'תא מחושב' : 'תא מוגן'}
                    </span>
                    <span className="w-px self-stretch bg-slate-200 dark:bg-slate-700" />
                    <span data-testid="value-bar-text" className="flex-1 min-w-0 font-semibold text-slate-900 dark:text-white whitespace-pre-wrap break-words">
                      {selectedView?.text || <span className="font-normal text-slate-400">ריק</span>}
                    </span>
                    {selectedOtherSite && selectedOtherSite !== selectedView?.text && (
                      <span className="shrink-0 rounded-md bg-[#DDEBF7] text-slate-700 px-2 py-0.5 text-xs">{selectedOtherSite}</span>
                    )}
                    {selectedRangeSize > 1 && (
                      <span className="shrink-0 text-xs text-slate-400 pt-0.5">{selectedRangeSize} תאים נבחרו</span>
                    )}
                    {!autoPopover && popoverTargets.length > 0 && !showPopover && (
                      <button
                        type="button"
                        data-testid="open-popover"
                        onClick={() => { setPopoverClosed(false); setPopoverRequested(true); }}
                        title="פתיחת חלונית העריכה לתאים שנבחרו (סטטוס, הערה לדוח, איפוס)"
                        className="shrink-0 -my-0.5 inline-flex items-center gap-1 h-6 px-2 rounded-md border border-slate-200 dark:border-slate-600 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                      >
                        <span className="material-symbols-outlined text-[16px]">edit_note</span>
                        עריכה
                      </button>
                    )}
                  </>
                )}
              </div>
              <div
                ref={gridHostRef}
                className="flex-1 min-h-0"
                // Esc on the sheet closes the popover (an Esc that cancels typing in a cell stops before here).
                onKeyDown={(event) => { if (event.key === 'Escape') setPopoverClosed(true); }}
                onPointerDownCapture={(event) => { if (event.button === 0) setGridDragging(true); }}
              >
                <ReportGrid
                  rowCount={payload.model.row_count}
                  colCount={payload.model.col_count}
                  cells={view.cells}
                  colWidths={payload.model.col_widths}
                  stickyRows={reportType === 'summary' ? 2 : 1}
                  fullWidthFromRow={payload.model.instruction_row}
                  selection={selection}
                  onSelectionChange={setSelection}
                  onEdit={handleGridEdit}
                  onUndo={undo}
                  onRedo={redo}
                  onNotice={(message) => showToast(message, 'info')}
                  storageKey={`report-editor-widths:${reportType}:${siteId}`}
                  autoFitKey={`${payload.site.id}|${reportType}|${payload.processing_month}|${payload.revision}|${payload.show_other_site_names}`}
                  fillSkipText={SATURDAY_LABEL}
                />
              </div>
            </>
          )}
        </div>

        {/* Work card of the selected employee */}
        {cardsOpen && loadState === 'ready' && payload && payload.employee_count > 0 && (
          <ReportCardsPane
            key={`${siteId}|${month}`}
            employee={cardsEmployee}
            cards={cards}
            width={cardsWidth}
            onWidthChange={handleCardsWidth}
            popOutHref={popOutHref}
            popOutTarget={popOutTarget}
            onClose={toggleCards}
          />
        )}

      </div>


      {showPopover && selectionRange && (
        <CellPopover grid={gridElement()} anchor={selectionRange} onClose={closePopover}>
          <div className="flex items-start gap-2 border-b border-slate-200 dark:border-slate-700 px-3 py-2">
            <div className="flex-1 min-w-0">
              {isMultiTarget ? (
                <>
                  <div data-testid="cell-popover-title" className="font-bold text-slate-900 dark:text-white">{popoverTargets.length} תאים</div>
                  <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                    {targetEmployeeNames.length === 1 ? targetEmployeeNames[0] : `${targetEmployeeNames.length} עובדים`}
                    {selectedRangeSize > popoverTargets.length ? ' · תאים מוגנים ושבתות לא ישתנו' : ''}
                  </div>
                </>
              ) : selectedKey && selectedModelCell ? (
                <>
                  <div data-testid="cell-popover-title" className="truncate font-bold text-slate-900 dark:text-white">
                    {lookups.employees.get(selectedModelCell.employee_id as string)}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{selectedModelCell.day}.{monthNumber}.{year}</div>
                </>
              ) : (
                <div data-testid="cell-popover-title" className="font-bold text-slate-900 dark:text-white">תא אחד</div>
              )}
            </div>
            <button
              type="button"
              onClick={closePopover}
              title="סגירה (Esc) — תיפתח שוב בבחירה הבאה"
              data-testid="cell-popover-close"
              className="shrink-0 w-7 h-7 grid place-items-center rounded-md text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>

          <div className="p-3 space-y-3">
            {!isMultiTarget && selectedError && (
              <div data-testid="cell-error" className="rounded-md bg-red-50 border border-red-200 text-red-800 px-2.5 py-1.5 text-xs">{selectedError}</div>
            )}

            <form
              className="flex items-center gap-2"
              onSubmit={(event) => { event.preventDefault(); applyPopoverValue(); }}
            >
              <input
                data-testid="cell-popover-value"
                dir="auto"
                value={popoverValue}
                onChange={(event) => setPopoverValue(event.target.value)}
                placeholder={isMultiTarget ? 'שעות לכל התאים, למשל 8.5' : `שעות${selectedView?.text ? ` (כעת: ${selectedView.text})` : ', למשל 8.5'}`}
                className="flex-1 min-w-0 h-8 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <button
                type="submit"
                disabled={!popoverValue.trim()}
                className="h-8 px-3 rounded-md bg-primary text-white text-xs font-semibold disabled:bg-slate-100 disabled:text-slate-400 dark:disabled:bg-slate-700"
              >
                {isMultiTarget ? 'החל על הכל' : 'החל'}
              </button>
            </form>

            <div className="flex flex-wrap gap-1.5">
              {Object.entries(statusLabels).map(([code, label]) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => applyToTargets(code)}
                  className="px-2 py-1 rounded-md border border-slate-200 dark:border-slate-600 text-xs hover:bg-slate-50 dark:hover:bg-slate-700"
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => applyToTargets(null)}
                className="px-2 py-1 rounded-md border border-slate-200 dark:border-slate-600 text-xs hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                ריק
              </button>
            </div>

            {isMultiTarget && resettableTargets.length > 0 && (
              <button type="button" onClick={() => { resetCells(resettableTargets); refocusGrid(); }} className="text-xs font-semibold text-slate-600 dark:text-slate-300 underline">
                איפוס {resettableTargets.length} תאים לערך המקור
              </button>
            )}

            {!isMultiTarget && selectedKey && (
              <>
                {selectedAdjustment && (
                  <div className="rounded-md bg-sky-50 border border-sky-200 text-sky-900 px-2.5 py-1.5 text-xs space-y-0.5">
                    <div>תוקן בדוח. ערך המקור: <b>{describeDayValue(selectedAdjustment.source, statusLabels)}</b></div>
                    {selectedAdjustment.updated_by_name && (
                      <div className="text-sky-800">
                        עודכן על ידי {selectedAdjustment.updated_by_name}
                        {selectedAdjustment.updated_at ? ` · ${new Date(selectedAdjustment.updated_at).toLocaleString('he-IL')}` : ''}
                      </div>
                    )}
                  </div>
                )}

                {selectedAdjustment?.conflict && !selectedDraft && (
                  <div className="rounded-md bg-orange-50 border border-orange-200 text-orange-900 px-2.5 py-1.5 text-xs space-y-1.5">
                    <div>נתוני המקור השתנו אחרי שנשמר התיקון.</div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setCellRaw([{ key: selectedKey, raw: dayValueToDisplay(selectedAdjustment.value, {}) ?? null, force: true }])}
                        className="px-2 py-1 rounded-md bg-white border border-orange-300 font-semibold"
                      >
                        השאר את התיקון
                      </button>
                      <button type="button" onClick={() => resetCell(selectedKey)} className="px-2 py-1 rounded-md bg-white border border-orange-300 font-semibold">
                        השתמש בערך המקור
                      </button>
                    </div>
                  </div>
                )}

                {(selectedAdjustment || selectedDraft) && (
                  <button type="button" onClick={() => { resetCell(selectedKey); refocusGrid(); }} className="text-xs font-semibold text-slate-600 dark:text-slate-300 underline">
                    {selectedAdjustment ? 'איפוס לערך המקור' : 'ביטול השינוי בתא'}
                  </button>
                )}

                {selectedComment && (
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">הערה מסקירת הכרטיס (מופיעה בשני הדוחות)</div>
                    <div className="rounded-md bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs whitespace-pre-wrap text-slate-700 dark:text-slate-200">
                      {selectedComment}
                    </div>
                  </div>
                )}

                {noteOpen || selectedNote ? (
                  <div className="space-y-1">
                    <label htmlFor="report-note" className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                      הערה לדוח {REPORT_LABELS[reportType]} · נכללת בקובץ המיוצא
                    </label>
                    <textarea
                      id="report-note"
                      data-testid="report-note"
                      autoFocus={noteOpen && !selectedNote}
                      value={selectedNote}
                      onChange={(event) => setNote(selectedKey, event.target.value)}
                      rows={3}
                      maxLength={2000}
                      placeholder="הערה שתופיע לנמען על התא הזה"
                      className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                    {selectedNote && (
                      <button type="button" onClick={() => setNote(selectedKey, '')} className="text-xs font-semibold text-red-600 underline">
                        הסרת ההערה
                      </button>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    data-testid="add-report-note"
                    onClick={() => setNoteOpen(true)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-primary"
                  >
                    <span className="material-symbols-outlined text-[16px]">add_comment</span>
                    הוספת הערה לדוח
                  </button>
                )}
              </>
            )}
          </div>
        </CellPopover>
      )}

      <Modal isOpen={Boolean(pendingLeave)} onClose={() => setPendingLeave(null)} title="יש שינויים שלא נשמרו">
        <div className="p-6 space-y-5" dir="rtl">
          <p className="text-slate-700 dark:text-slate-200">
            לפני שממשיכים: לשמור את השינויים בדוח, לבטל אותם, או להישאר ולהמשיך לערוך?
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <button data-testid="leave-stay" onClick={() => setPendingLeave(null)} className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-600 text-sm font-semibold">
              הישאר
            </button>
            <button data-testid="leave-discard" onClick={() => { void confirmLeave('discard'); }} className="px-4 py-2 rounded-lg border border-red-200 text-red-700 text-sm font-semibold">
              בטל שינויים
            </button>
            <button data-testid="leave-save" onClick={() => { void confirmLeave('save'); }} disabled={isSaving} className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-50">
              שמור
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
