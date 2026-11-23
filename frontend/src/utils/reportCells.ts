// Value parsing and formula evaluation for the report editor.
//
// These mirror the server (services/sites/report_adjustments_service.py and
// report_model.py) so the editor can validate and recalculate while typing.
// The server stays the authority: it re-validates and recalculates on save.

import type { ReportCellValue, ReportDayValue } from '../api/siteReports';

export const SATURDAY_LABEL = 'שבת';
const OTHER_SITE_LABEL = 'עבד באתר אחר';
const OTHER_SITE_NAMED_PREFIX = 'עבד באתר:';
export const LONG_DAY_HOURS_THRESHOLD = 12;

export type ParsedCell =
  | { ok: true; value: ReportDayValue }
  | { ok: false; message: string };

export function parseCellInput(raw: ReportCellValue, statusLabels: Record<string, string>): ParsedCell {
  if (raw === null || raw === undefined) return { ok: true, value: { hours: null, status: null } };
  let hours: number;
  if (typeof raw === 'number') {
    hours = raw;
  } else {
    const text = String(raw).trim();
    if (!text || text === SATURDAY_LABEL || text === OTHER_SITE_LABEL || text.startsWith(OTHER_SITE_NAMED_PREFIX)) {
      return { ok: true, value: { hours: null, status: null } };
    }
    if (statusLabels[text]) return { ok: true, value: { hours: null, status: text } };
    const code = Object.keys(statusLabels).find((key) => statusLabels[key] === text);
    if (code) return { ok: true, value: { hours: null, status: code } };
    if (!/^-?\d+([.,]\d+)?$/.test(text)) {
      return {
        ok: false,
        message: `ערך לא תקין: יש להזין מספר שעות או סטטוס (${Object.values(statusLabels).join(' / ')})`,
      };
    }
    hours = Number(text.replace(',', '.'));
  }
  if (!Number.isFinite(hours)) return { ok: false, message: 'ערך לא תקין' };
  if (hours < 0 || hours > 24) return { ok: false, message: 'מספר השעות חייב להיות בין 0 ל-24' };
  return { ok: true, value: { hours: Math.round(hours * 100) / 100, status: null } };
}

export function dayValueToDisplay(value: ReportDayValue, statusLabels: Record<string, string>): ReportCellValue {
  if (value.status) return statusLabels[value.status] ?? value.status;
  return value.hours;
}

export function sameDayValue(a: ReportDayValue, b: ReportDayValue): boolean {
  return (a.status ?? null) === (b.status ?? null) && (a.status ? true : (a.hours ?? null) === (b.hours ?? null));
}

// --- formulas ---------------------------------------------------------------

const CELL_REF = /^\$?([A-Z]{1,3})\$?(\d+)$/i;

export function columnLetterToIndex(letters: string): number {
  let index = 0;
  for (const ch of letters.toUpperCase()) index = index * 26 + (ch.charCodeAt(0) - 64);
  return index;
}

export function columnIndexToLetter(index: number): string {
  let letters = '';
  let n = index;
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Evaluates the formula shapes the report templates use — =SUM(...) over
 * ranges / cell lists and a two-operand product. `lookup` returns the current
 * (possibly edited) value of a cell. Unknown formulas evaluate to null.
 */
export function createFormulaEvaluator(
  lookup: (row: number, col: number) => { value: ReportCellValue; formula?: string } | undefined,
) {
  const cache = new Map<string, ReportCellValue>();
  const inProgress = new Set<string>();

  const cellValue = (row: number, col: number): ReportCellValue => {
    const key = `${row}:${col}`;
    if (cache.has(key)) return cache.get(key) ?? null;
    if (inProgress.has(key)) return null;
    const cell = lookup(row, col);
    let value: ReportCellValue = cell ? cell.value : null;
    if (cell?.formula) {
      inProgress.add(key);
      value = evaluate(cell.formula);
      inProgress.delete(key);
    }
    cache.set(key, value);
    return value;
  };

  const numeric = (ref: string): number | null => {
    const match = CELL_REF.exec(ref);
    if (!match) return null;
    const value = cellValue(Number(match[2]), columnLetterToIndex(match[1]));
    return typeof value === 'number' ? value : null;
  };

  function evaluate(formula: string): ReportCellValue {
    const text = formula.replace(/\s+/g, '');
    const sum = /^=SUM\((.+)\)$/i.exec(text);
    if (sum) {
      let total = 0;
      for (const part of sum[1].split(',')) {
        if (part.includes(':')) {
          const [from, to] = part.split(':').map((ref) => CELL_REF.exec(ref));
          if (!from || !to) return null;
          const minCol = columnLetterToIndex(from[1]);
          const maxCol = columnLetterToIndex(to[1]);
          for (let row = Number(from[2]); row <= Number(to[2]); row += 1) {
            for (let col = minCol; col <= maxCol; col += 1) {
              const value = cellValue(row, col);
              if (typeof value === 'number') total += value;
            }
          }
        } else if (CELL_REF.test(part)) {
          total += numeric(part) ?? 0;
        } else {
          return null;
        }
      }
      return round2(total);
    }
    const product = /^=([^*]+)\*([^*]+)$/.exec(text);
    if (product) {
      const operands = [product[1], product[2]].map((token) => {
        if (CELL_REF.test(token)) return numeric(token);
        return /^\d+(\.\d+)?$/.test(token) ? Number(token) : NaN;
      });
      if (operands.some((operand) => operand === null || Number.isNaN(operand))) return null;
      return round2((operands[0] as number) * (operands[1] as number));
    }
    return null;
  }

  return { cellValue, evaluate };
}

export function formatCellValue(value: ReportCellValue, numberFormat?: string): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    if (numberFormat && numberFormat.includes('₪')) {
      return `₪${value.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return String(round2(value));
  }
  return String(value);
}
