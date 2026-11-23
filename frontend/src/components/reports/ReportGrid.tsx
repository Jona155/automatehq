import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClipboardEvent, KeyboardEvent } from 'react';
import type { ReportCellKind } from '../../api/siteReports';

export interface GridCellView {
  row: number;
  col: number;
  text: string;
  kind: ReportCellKind;
  editable: boolean;
  fill?: string;
  bold?: boolean;
  hasNote?: boolean;
  adjusted?: boolean;
  dirty?: boolean;
  conflict?: boolean;
  error?: string;
}

export interface GridPosition {
  row: number;
  col: number;
}

export interface GridSelection {
  anchor: GridPosition;
  focus: GridPosition;
}

export interface GridEdit {
  row: number;
  col: number;
  raw: string;
}

interface ReportGridProps {
  rowCount: number;
  colCount: number;
  cells: Map<string, GridCellView>;
  colWidths: Record<string, number>;
  /** Number of leading rows that stay visible while scrolling. */
  stickyRows: number;
  /** Rows rendered as one cell spanning the sheet (free-text blocks). */
  fullWidthFromRow?: number;
  selection: GridSelection | null;
  onSelectionChange: (selection: GridSelection) => void;
  onEdit: (edits: GridEdit[]) => void;
  onUndo: () => void;
  onRedo: () => void;
  onNotice: (message: string) => void;
  /** Where the user's own column widths are remembered (browser storage). */
  storageKey?: string;
  /** Changes when a different sheet is loaded, so columns are fitted again. */
  autoFitKey?: string;
  /** Placeholder text of cells a fill should leave alone (e.g. Saturdays). */
  fillSkipText?: string;
}

interface CellRange {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
}

const ROW_HEIGHT = 30;
const MIN_COL_WIDTH = 48;
const MAX_COL_WIDTH = 640;
const AUTO_FIT_CAP = 240;
const posKey = (row: number, col: number) => `${row}:${col}`;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const mod = (value: number, size: number) => ((value % size) + size) % size;
const inRangeOf = (range: CellRange | null, row: number, col: number) =>
  Boolean(range && row >= range.minRow && row <= range.maxRow && col >= range.minCol && col <= range.maxCol);
const sameRange = (a: CellRange, b: CellRange) =>
  a.minRow === b.minRow && a.maxRow === b.maxRow && a.minCol === b.minCol && a.maxCol === b.maxCol;

function columnWidthPx(width: number | undefined, isFirst: boolean) {
  // Excel column widths are in character units.
  const px = width ? Math.round(width * 7 + 5) : 72;
  return clamp(px, isFirst ? 96 : 72, 220);
}

/** Pixel width that shows `length` characters of 13px text on one line. */
const textWidthPx = (length: number) => Math.ceil(length * 8.6) + 24;

function readStoredWidths(storageKey: string | undefined): Record<number, number> {
  if (!storageKey) return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    const result: Record<number, number> = {};
    Object.entries(parsed ?? {}).forEach(([col, width]) => {
      if (typeof width === 'number' && Number.isFinite(width)) result[Number(col)] = clamp(width, MIN_COL_WIDTH, MAX_COL_WIDTH);
    });
    return result;
  } catch {
    return {};
  }
}

function storeWidths(storageKey: string | undefined, widths: Record<number, number>) {
  if (!storageKey) return;
  try {
    if (Object.keys(widths).length) localStorage.setItem(storageKey, JSON.stringify(widths));
    else localStorage.removeItem(storageKey);
  } catch {
    // storage unavailable — widths simply last for this visit
  }
}

interface RowProps {
  row: number;
  colCount: number;
  cells: Map<string, GridCellView>;
  stickyTop: number | null;
  range: CellRange | null;
  /** Cells a fill-handle drag would cover, while dragging. */
  preview: CellRange | null;
  /** Column of this row that carries the fill handle, if any. */
  handleCol: number | null;
  /** The top row carries the column resize grips. */
  resizable: boolean;
  focus: GridPosition | null;
  editing: { row: number; col: number; text: string } | null;
  firstColWidth: number;
  onCellMouseDown: (row: number, col: number, shift: boolean) => void;
  onCellMouseEnter: (row: number, col: number, buttons: number) => void;
  onCellDoubleClick: (row: number, col: number) => void;
  onEditingChange: (text: string) => void;
  onEditingKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onEditingBlur: () => void;
  onFillStart: () => void;
  onResizeStart: (col: number, clientX: number) => void;
  onAutoFit: (col: number) => void;
}

const GridRow = memo(function GridRow({
  row, colCount, cells, stickyTop, range, preview, handleCol, resizable, focus, editing, firstColWidth,
  onCellMouseDown, onCellMouseEnter, onCellDoubleClick, onEditingChange, onEditingKeyDown, onEditingBlur,
  onFillStart, onResizeStart, onAutoFit,
}: RowProps) {
  const tds = [];
  for (let col = 1; col <= colCount; col += 1) {
    const cell = cells.get(posKey(row, col));
    const kind: ReportCellKind = cell?.kind ?? 'protected';
    const inRange = inRangeOf(range, row, col);
    const inPreview = inRangeOf(preview, row, col) && !inRange;
    const isFocus = Boolean(focus && focus.row === row && focus.col === col);
    const isEditing = Boolean(editing && editing.row === row && editing.col === col);
    const isStickyCol = col === 1;
    const sticky = stickyTop !== null || isStickyCol;

    let background = '#ffffff';
    if (kind === 'protected') background = '#f8fafc';
    if (kind === 'calculated') background = '#eef2ff';
    if (cell?.fill) background = cell.fill;
    if (cell?.dirty) background = '#fef3c7';
    if (cell?.error) background = '#fee2e2';

    const classes = [
      'border-b border-l border-slate-200 px-2 text-[13px] leading-[14px] overflow-hidden select-none align-middle',
      kind === 'input' ? 'text-slate-900 cursor-cell text-center tabular-nums' : 'text-slate-600 cursor-default',
      kind === 'calculated' ? 'font-semibold text-slate-800 text-center tabular-nums' : '',
      cell?.bold ? 'font-semibold' : '',
      sticky ? 'sticky' : 'relative',
      isFocus ? 'outline outline-2 -outline-offset-2 outline-sky-500' : '',
      cell?.error && !isFocus ? 'outline outline-1 -outline-offset-1 outline-red-500' : '',
      inPreview ? 'outline-dashed outline-1 -outline-offset-1 outline-sky-600' : '',
    ].join(' ');

    tds.push(
      <td
        key={col}
        data-pos={posKey(row, col)}
        data-kind={kind}
        data-testid={`report-cell-${row}-${col}`}
        className={classes}
        title={cell?.error || (cell && cell.text.length > 10 ? cell.text : undefined)}
        style={{
          height: ROW_HEIGHT,
          backgroundColor: background,
          boxShadow: inRange && !isFocus
            ? 'inset 0 0 0 9999px rgba(14,165,233,0.14)'
            : inPreview ? 'inset 0 0 0 9999px rgba(14,165,233,0.07)' : undefined,
          top: stickyTop !== null ? stickyTop : undefined,
          right: isStickyCol ? 0 : undefined,
          zIndex: stickyTop !== null && isStickyCol ? 30 : stickyTop !== null ? 20 : isStickyCol ? 10 : undefined,
          scrollMarginTop: ROW_HEIGHT * 2,
          scrollMarginRight: firstColWidth,
        }}
        onMouseDown={(event) => {
          if (event.button !== 0) return;
          onCellMouseDown(row, col, event.shiftKey);
        }}
        onMouseEnter={(event) => onCellMouseEnter(row, col, event.buttons)}
        onDoubleClick={() => onCellDoubleClick(row, col)}
      >
        {isEditing ? (
          <input
            autoFocus
            dir="auto"
            data-testid="report-cell-editor"
            value={editing?.text ?? ''}
            onChange={(event) => onEditingChange(event.target.value)}
            onKeyDown={onEditingKeyDown}
            onBlur={onEditingBlur}
            className="absolute inset-0 w-full h-full px-2 text-center text-[13px] bg-white text-slate-900 outline outline-2 -outline-offset-2 outline-sky-600"
          />
        ) : (
          // Two 14px lines fit the fixed row height, so long text wraps instead of being cut.
          <div className="line-clamp-2 break-words">{cell?.text ?? ''}</div>
        )}
        {cell?.hasNote && (
          <span aria-hidden className="absolute top-0 left-0 w-0 h-0 border-t-[7px] border-t-rose-500 border-r-[7px] border-r-transparent" />
        )}
        {cell?.conflict ? (
          <span aria-hidden className="absolute bottom-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-orange-500" />
        ) : cell?.adjusted ? (
          <span aria-hidden className="absolute bottom-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-sky-500" />
        ) : null}
        {handleCol === col && !isEditing && (
          <span
            data-testid="fill-handle"
            title="גררו כדי למלא תאים סמוכים"
            className="absolute bottom-0 left-0 w-2 h-2 bg-sky-600 border border-white cursor-crosshair"
            style={{ zIndex: 5 }}
            onMouseDown={(event) => {
              if (event.button !== 0) return;
              event.stopPropagation();
              event.preventDefault();
              onFillStart();
            }}
            onDoubleClick={(event) => event.stopPropagation()}
          />
        )}
        {resizable && (
          <span
            data-testid={`col-resize-${col}`}
            title="גררו לשינוי רוחב העמודה · לחיצה כפולה להתאמה לתוכן"
            className="absolute top-0 left-0 h-full w-1.5 cursor-col-resize hover:bg-sky-400/70"
            style={{ zIndex: 6 }}
            onMouseDown={(event) => {
              if (event.button !== 0) return;
              event.stopPropagation();
              event.preventDefault();
              onResizeStart(col, event.clientX);
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
              onAutoFit(col);
            }}
          />
        )}
      </td>,
    );
  }
  return <tr>{tds}</tr>;
});

export default function ReportGrid({
  rowCount, colCount, cells, colWidths, stickyRows, fullWidthFromRow,
  selection, onSelectionChange, onEdit, onUndo, onRedo, onNotice,
  storageKey, autoFitKey, fillSkipText,
}: ReportGridProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [editing, setEditing] = useState<{ row: number; col: number; text: string } | null>(null);
  const editingRef = useRef(editing);
  editingRef.current = editing;

  const lastGridRow = fullWidthFromRow ? fullWidthFromRow - 1 : rowCount;

  const cellsRef = useRef(cells);
  cellsRef.current = cells;

  /** Longest text in a column, in characters (grid rows only). */
  const longestText = useCallback((col: number) => {
    let longest = 0;
    for (let row = 1; row <= lastGridRow; row += 1) {
      const length = cellsRef.current.get(posKey(row, col))?.text.length ?? 0;
      if (length > longest) longest = length;
    }
    return longest;
  }, [lastGridRow]);

  // Default widths: the template's width, widened to fit the content. Fitted
  // once per loaded sheet so columns do not jump while typing.
  const baseWidths = useMemo(() => {
    const result: number[] = [];
    for (let col = 1; col <= colCount; col += 1) {
      const template = columnWidthPx(colWidths[String(col)], col === 1);
      result.push(Math.max(template, Math.min(textWidthPx(longestText(col)), AUTO_FIT_CAP)));
    }
    return result;
  }, [colCount, colWidths, longestText, autoFitKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const [customWidths, setCustomWidths] = useState<Record<number, number>>(() => readStoredWidths(storageKey));
  const customWidthsRef = useRef(customWidths);
  customWidthsRef.current = customWidths;
  useEffect(() => {
    setCustomWidths(readStoredWidths(storageKey));
  }, [storageKey]);

  const widths = useMemo(
    () => baseWidths.map((width, index) => customWidths[index + 1] ?? width),
    [baseWidths, customWidths],
  );
  const widthsRef = useRef(widths);
  widthsRef.current = widths;

  const handleResizeStart = useCallback((col: number, startX: number) => {
    const startWidth = widthsRef.current[col - 1];
    const onMove = (event: MouseEvent) => {
      // Right-to-left sheet: a column grows towards the left.
      const width = clamp(Math.round(startWidth + (startX - event.clientX)), MIN_COL_WIDTH, MAX_COL_WIDTH);
      setCustomWidths((prev) => (prev[col] === width ? prev : { ...prev, [col]: width }));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      storeWidths(storageKey, customWidthsRef.current);
    };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [storageKey]);

  const handleAutoFit = useCallback((col: number) => {
    const width = clamp(textWidthPx(longestText(col)), MIN_COL_WIDTH, MAX_COL_WIDTH);
    const next = { ...customWidthsRef.current, [col]: width };
    customWidthsRef.current = next;
    setCustomWidths(next);
    storeWidths(storageKey, next);
  }, [longestText, storageKey]);

  const range = useMemo<CellRange | null>(() => {
    if (!selection) return null;
    return {
      minRow: Math.min(selection.anchor.row, selection.focus.row),
      maxRow: Math.max(selection.anchor.row, selection.focus.row),
      minCol: Math.min(selection.anchor.col, selection.focus.col),
      maxCol: Math.max(selection.anchor.col, selection.focus.col),
    };
  }, [selection]);

  const focusPos = selection?.focus ?? null;

  useEffect(() => {
    if (!focusPos || !containerRef.current) return;
    const el = containerRef.current.querySelector<HTMLElement>(`[data-pos="${posKey(focusPos.row, focusPos.col)}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [focusPos?.row, focusPos?.col]); // eslint-disable-line react-hooks/exhaustive-deps

  const select = useCallback((row: number, col: number, extend: boolean) => {
    const focus = { row: clamp(row, 1, lastGridRow), col: clamp(col, 1, colCount) };
    onSelectionChange({ anchor: extend && selection ? selection.anchor : focus, focus });
  }, [colCount, lastGridRow, onSelectionChange, selection]);

  // --- fill (drag handle, Ctrl+D, Ctrl+R) ---

  /** Repeats the `source` block over the rest of `target` (which contains it). */
  const applyFill = useCallback((source: CellRange, target: CellRange) => {
    const height = source.maxRow - source.minRow + 1;
    const width = source.maxCol - source.minCol + 1;
    const edits: GridEdit[] = [];
    let skipped = 0;
    for (let r = target.minRow; r <= target.maxRow; r += 1) {
      for (let c = target.minCol; c <= target.maxCol; c += 1) {
        if (inRangeOf(source, r, c)) continue;
        const from = cells.get(posKey(source.minRow + mod(r - source.minRow, height), source.minCol + mod(c - source.minCol, width)));
        const fromText = from?.text ?? '';
        const value = fillSkipText && fromText === fillSkipText ? '' : fromText;
        const cell = cells.get(posKey(r, c));
        if (!cell?.editable) {
          if (value !== '') skipped += 1;
          continue;
        }
        // Saturdays (and the like) are passed over quietly, as nobody means to fill them.
        if (fillSkipText && cell.text === fillSkipText) continue;
        if (cell.text !== value) edits.push({ row: r, col: c, raw: value });
      }
    }
    if (edits.length) onEdit(edits);
    if (skipped) onNotice(`${skipped} תאים מוגנים דולגו במילוי`);
    onSelectionChange({
      anchor: { row: target.minRow, col: target.minCol },
      focus: { row: target.maxRow, col: target.maxCol },
    });
  }, [cells, fillSkipText, onEdit, onNotice, onSelectionChange]);

  const fillWithKeyboard = useCallback((direction: 'down' | 'across') => {
    if (!range) return;
    if (direction === 'down') {
      if (range.maxRow > range.minRow) {
        applyFill({ ...range, maxRow: range.minRow }, range);
      } else if (range.minRow > 1) {
        // A single row copies from the row above, as in Excel.
        applyFill({ ...range, minRow: range.minRow - 1, maxRow: range.minRow - 1 }, { ...range, minRow: range.minRow - 1 });
      }
    } else if (range.maxCol > range.minCol) {
      applyFill({ ...range, maxCol: range.minCol }, range);
    } else if (range.minCol > 1) {
      applyFill({ ...range, minCol: range.minCol - 1, maxCol: range.minCol - 1 }, { ...range, minCol: range.minCol - 1 });
    }
  }, [applyFill, range]);

  const [fillDrag, setFillDrag] = useState<{ source: CellRange; target: CellRange } | null>(null);
  const fillDragRef = useRef(fillDrag);
  fillDragRef.current = fillDrag;
  const applyFillRef = useRef(applyFill);
  applyFillRef.current = applyFill;

  const handleFillStart = useCallback(() => {
    if (!range || editingRef.current) return;
    setFillDrag({ source: range, target: range });
    containerRef.current?.focus();
    const onUp = () => {
      window.removeEventListener('mouseup', onUp);
      const drag = fillDragRef.current;
      setFillDrag(null);
      if (drag && !sameRange(drag.source, drag.target)) applyFillRef.current(drag.source, drag.target);
    };
    window.addEventListener('mouseup', onUp);
  }, [range]);

  /** Extends the dragged fill along whichever axis the pointer moved further. */
  const extendFill = useCallback((row: number, col: number) => {
    const drag = fillDragRef.current;
    if (!drag) return;
    const { source } = drag;
    const r = clamp(row, 1, lastGridRow);
    const dRow = r > source.maxRow ? r - source.maxRow : r < source.minRow ? source.minRow - r : 0;
    const dCol = col > source.maxCol ? col - source.maxCol : col < source.minCol ? source.minCol - col : 0;
    let target = source;
    if (dRow > 0 && dRow >= dCol) {
      target = { ...source, minRow: Math.min(source.minRow, r), maxRow: Math.max(source.maxRow, r) };
    } else if (dCol > 0) {
      target = { ...source, minCol: Math.min(source.minCol, col), maxCol: Math.max(source.maxCol, col) };
    }
    if (!sameRange(target, drag.target)) setFillDrag({ source, target });
  }, [lastGridRow]);

  const startEditing = useCallback((row: number, col: number, initial?: string) => {
    const cell = cells.get(posKey(row, col));
    if (!cell?.editable) return false;
    setEditing({ row, col, text: initial ?? cell.text });
    return true;
  }, [cells]);

  const commitEditing = useCallback(() => {
    const current = editingRef.current;
    if (!current) return;
    editingRef.current = null;
    setEditing(null);
    const cell = cells.get(posKey(current.row, current.col));
    if ((cell?.text ?? '') !== current.text) {
      onEdit([{ row: current.row, col: current.col, raw: current.text }]);
    }
  }, [cells, onEdit]);

  const cancelEditing = useCallback(() => {
    editingRef.current = null;
    setEditing(null);
    containerRef.current?.focus();
  }, []);

  const handleCellMouseDown = useCallback((row: number, col: number, shift: boolean) => {
    if (editingRef.current) commitEditing();
    select(row, col, shift);
    containerRef.current?.focus();
  }, [commitEditing, select]);

  const handleCellMouseEnter = useCallback((row: number, col: number, buttons: number) => {
    if (fillDragRef.current) {
      if (buttons === 1) extendFill(row, col);
      return;
    }
    if (buttons === 1 && selection && !editingRef.current) select(row, col, true);
  }, [extendFill, select, selection]);

  const handleCellDoubleClick = useCallback((row: number, col: number) => {
    startEditing(row, col);
  }, [startEditing]);

  const handleEditingKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    const current = editingRef.current;
    if (!current) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      commitEditing();
      select(current.row + 1, current.col, false);
      containerRef.current?.focus();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      commitEditing();
      select(current.row, current.col + (event.shiftKey ? -1 : 1), false);
      containerRef.current?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancelEditing();
    } else {
      event.stopPropagation();
    }
  }, [cancelEditing, commitEditing, select]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (editingRef.current || !selection) return;
    const { row, col } = selection.focus;
    const hasModifier = event.ctrlKey || event.metaKey;

    if (hasModifier && event.code === 'KeyZ') {
      event.preventDefault();
      if (event.shiftKey) onRedo(); else onUndo();
      return;
    }
    if (hasModifier && event.code === 'KeyY') {
      event.preventDefault();
      onRedo();
      return;
    }
    if (hasModifier && !event.shiftKey && !event.altKey && (event.code === 'KeyD' || event.code === 'KeyR')) {
      // Ctrl+D fills down, Ctrl+R fills across to the following columns.
      event.preventDefault();
      fillWithKeyboard(event.code === 'KeyD' ? 'down' : 'across');
      return;
    }
    if (hasModifier || event.altKey) return;

    // The sheet is right-to-left: column 1 is on the right, so the left arrow
    // moves to the next column.
    const moves: Record<string, [number, number]> = {
      ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, 1], ArrowRight: [0, -1],
    };
    if (moves[event.key]) {
      event.preventDefault();
      select(row + moves[event.key][0], col + moves[event.key][1], event.shiftKey);
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      select(row, col + (event.shiftKey ? -1 : 1), false);
      return;
    }
    if (event.key === 'Enter' || event.key === 'F2') {
      event.preventDefault();
      if (!startEditing(row, col) && event.key === 'Enter') select(row + 1, col, false);
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      if (!range) return;
      const edits: GridEdit[] = [];
      for (let r = range.minRow; r <= range.maxRow; r += 1) {
        for (let c = range.minCol; c <= range.maxCol; c += 1) {
          const cell = cells.get(posKey(r, c));
          if (cell?.editable && cell.text !== '') edits.push({ row: r, col: c, raw: '' });
        }
      }
      if (edits.length) onEdit(edits);
      return;
    }
    if (event.key.length === 1) {
      if (startEditing(row, col, event.key)) event.preventDefault();
    }
  };

  const handleCopy = (event: ClipboardEvent<HTMLDivElement>) => {
    if (editingRef.current || !range) return;
    const lines: string[] = [];
    for (let r = range.minRow; r <= range.maxRow; r += 1) {
      const values: string[] = [];
      for (let c = range.minCol; c <= range.maxCol; c += 1) values.push(cells.get(posKey(r, c))?.text ?? '');
      lines.push(values.join('\t'));
    }
    event.clipboardData.setData('text/plain', lines.join('\n'));
    event.preventDefault();
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (editingRef.current || !range) return;
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain');
    if (text === '') return;
    const rows = text.replace(/\r/g, '').split('\n');
    if (rows.length > 1 && rows[rows.length - 1] === '') rows.pop();
    const matrix = rows.map((line) => line.split('\t'));
    const single = matrix.length === 1 && matrix[0].length === 1;

    const edits: GridEdit[] = [];
    let skipped = 0;
    const place = (r: number, c: number, raw: string) => {
      if (r > lastGridRow || c > colCount) return;
      const cell = cells.get(posKey(r, c));
      if (cell?.editable) {
        if (cell.text !== raw.trim()) edits.push({ row: r, col: c, raw });
      } else if (raw.trim() !== '' && raw.trim() !== (cell?.text ?? '')) {
        skipped += 1;
      }
    };
    if (single) {
      for (let r = range.minRow; r <= range.maxRow; r += 1) {
        for (let c = range.minCol; c <= range.maxCol; c += 1) place(r, c, matrix[0][0]);
      }
    } else {
      matrix.forEach((values, dr) => values.forEach((raw, dc) => place(range.minRow + dr, range.minCol + dc, raw)));
    }
    if (edits.length) onEdit(edits);
    if (skipped) onNotice(`${skipped} תאים מוגנים דולגו בהדבקה`);
  };

  const handleEditingBlur = useCallback(() => commitEditing(), [commitEditing]);
  const handleEditingChange = useCallback((text: string) => {
    setEditing((prev) => (prev ? { ...prev, text } : prev));
  }, []);

  const rows = [];
  for (let row = 1; row <= lastGridRow; row += 1) {
    const rowTouchesSelection = Boolean(range && row >= range.minRow && row <= range.maxRow);
    const preview = fillDrag && row >= fillDrag.target.minRow && row <= fillDrag.target.maxRow ? fillDrag.target : null;
    const showHandle = Boolean(
      range && !fillDrag && !editing && row === range.maxRow
      && cells.get(posKey(range.maxRow, range.maxCol))?.editable,
    );
    rows.push(
      <GridRow
        key={row}
        row={row}
        colCount={colCount}
        cells={cells}
        stickyTop={row <= stickyRows ? (row - 1) * ROW_HEIGHT : null}
        range={rowTouchesSelection ? (fillDrag ? fillDrag.source : range) : null}
        preview={preview}
        handleCol={showHandle && range ? range.maxCol : null}
        resizable={row === 1}
        focus={focusPos && focusPos.row === row ? focusPos : null}
        editing={editing && editing.row === row ? editing : null}
        firstColWidth={widths[0]}
        onCellMouseDown={handleCellMouseDown}
        onCellMouseEnter={handleCellMouseEnter}
        onCellDoubleClick={handleCellDoubleClick}
        onEditingChange={handleEditingChange}
        onEditingKeyDown={handleEditingKeyDown}
        onEditingBlur={handleEditingBlur}
        onFillStart={handleFillStart}
        onResizeStart={handleResizeStart}
        onAutoFit={handleAutoFit}
      />,
    );
  }
  if (fullWidthFromRow) {
    for (let row = fullWidthFromRow; row <= rowCount; row += 1) {
      const text = cells.get(posKey(row, 1))?.text;
      if (!text) continue;
      rows.push(
        <tr key={row}>
          <td
            colSpan={colCount}
            className="border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-500 whitespace-pre-wrap"
          >
            {text}
          </td>
        </tr>,
      );
    }
  }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      dir="rtl"
      role="grid"
      aria-label="גיליון הדוח"
      data-testid="report-grid"
      className="h-full overflow-auto bg-white text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-sky-300 rounded-lg border border-slate-200"
      onKeyDown={handleKeyDown}
      onCopy={handleCopy}
      onPaste={handlePaste}
    >
      <table className="border-separate border-spacing-0" style={{ tableLayout: 'fixed', width: widths.reduce((a, b) => a + b, 0) }}>
        <colgroup>
          {widths.map((width, index) => <col key={index} style={{ width }} />)}
        </colgroup>
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
}
