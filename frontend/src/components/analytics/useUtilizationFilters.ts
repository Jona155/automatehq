import { useMemo, useState } from 'react';
import type { Band } from '../../types';
import { displayBandOf, DISPLAY_BAND_ORDER, type DisplayBand } from './bands';
import { nextSort, type BandChip, type SortKey } from './AnalyticsFilterBar';

interface Accessors<T> {
  name: (t: T) => string;
  searchText: (t: T) => string;
  band: (t: T) => Band | null;
  hours: (t: T) => number | null;
  multi?: (t: T) => boolean;
}

// Shared list state (search / band filter / sort / multi-only) + derivations for
// the hours-first lists. "No report" rows (0 worked hours) are split out of the
// ranked list so callers can render them in a separate collapsed group.
export function useUtilizationFilters<T>(items: T[], acc: Accessors<T>) {
  const [query, setQuery] = useState('');
  const [band, setBand] = useState<DisplayBand | 'all'>('all');
  const [sort, setSort] = useState<SortKey>('worst');
  const [multiOnly, setMultiOnly] = useState(false);

  // Tag every item with its display band once. `acc` is treated as stable (its
  // behavior doesn't change across renders), so only `items` drives recompute.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tagged = useMemo(
    () => items.map((item) => ({ item, db: displayBandOf(acc.band(item), acc.hours(item)) })),
    [items],
  );

  const noReport = useMemo(() => tagged.filter((x) => x.db === 'NO_REPORT').map((x) => x.item), [tagged]);
  const reporting = useMemo(() => tagged.filter((x) => x.db !== 'NO_REPORT'), [tagged]);

  const counts = useMemo(() => {
    const c: Record<DisplayBand, number> = { HIGH: 0, MID: 0, LOW: 0, NO_REPORT: 0 };
    tagged.forEach((x) => {
      c[x.db] += 1;
    });
    return c;
  }, [tagged]);

  const bandChips: BandChip[] = DISPLAY_BAND_ORDER.filter((b) => counts[b] > 0).map((b) => ({ key: b, count: counts[b] }));

  const hasMulti = Boolean(acc.multi) && items.some((t) => acc.multi!(t));

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    const rows = reporting.filter((x) => {
      if (q && !acc.searchText(x.item).toLowerCase().includes(q)) return false;
      if (band !== 'all' && x.db !== band) return false;
      if (multiOnly && acc.multi && !acc.multi(x.item)) return false;
      return true;
    });
    const sorted = [...rows].sort((a, b) => {
      if (sort === 'name') return acc.name(a.item).localeCompare(acc.name(b.item), 'he');
      const ha = acc.hours(a.item) ?? 0;
      const hb = acc.hours(b.item) ?? 0;
      return sort === 'best' ? hb - ha : ha - hb;
    });
    return sorted.map((x) => x.item);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reporting, q, band, multiOnly, sort]);

  return {
    query,
    setQuery,
    band,
    setBand,
    sort,
    cycleSort: () => setSort((s) => nextSort(s)),
    multiOnly,
    toggleMulti: () => setMultiOnly((m) => !m),
    filtered,
    noReport,
    bandChips,
    counts,
    total: reporting.length,
    hasMulti,
  };
}
