import { useEffect, useState } from 'react';
import { getWorkCardFile, getWorkCards } from '../../api/workCards';
import type { WorkCard } from '../../types';

export const REVIEW_STATUS_LABELS: Record<WorkCard['review_status'], string> = {
  APPROVED: 'אושר',
  NEEDS_REVIEW: 'ממתין לסקירה',
  NEEDS_ASSIGNMENT: 'ממתין לשיוך',
  REJECTED: 'נדחה',
};

export const REVIEW_STATUS_CLASSES: Record<WorkCard['review_status'], string> = {
  APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  NEEDS_REVIEW: 'bg-amber-50 text-amber-800 border-amber-200',
  NEEDS_ASSIGNMENT: 'bg-slate-50 text-slate-600 border-slate-200',
  REJECTED: 'bg-red-50 text-red-700 border-red-200',
};

/**
 * The order the report itself picks a card in (hours_matrix_service): approved
 * first, then the newest. The first card is the one the report's hours come from.
 */
export function sortCardsLikeReport(cards: WorkCard[]): WorkCard[] {
  return [...cards].sort((a, b) => {
    const approved = Number(b.review_status === 'APPROVED') - Number(a.review_status === 'APPROVED');
    if (approved) return approved;
    const created = (b.created_at ?? '').localeCompare(a.created_at ?? '');
    if (created) return created;
    return b.id.localeCompare(a.id);
  });
}

export interface CardEmployee {
  id: string;
  full_name: string;
  passport_id: string | null;
}

export interface SiteMonthCards {
  status: 'loading' | 'ready' | 'error';
  byEmployee: Map<string, WorkCard[]>;
  /** Employees with at least one card, by name. */
  employees: CardEmployee[];
}

const EMPTY: SiteMonthCards = { status: 'loading', byEmployee: new Map(), employees: [] };

/** Every work card of a site for a month, grouped per employee in report order. */
export function useSiteMonthCards(siteId: string, month: string, enabled = true): SiteMonthCards {
  const [state, setState] = useState<SiteMonthCards>(EMPTY);

  useEffect(() => {
    if (!enabled || !siteId || !month) return undefined;
    let cancelled = false;
    setState(EMPTY);
    getWorkCards({ site_id: siteId, processing_month: month, include_employee: true })
      .then((cards) => {
        if (cancelled) return;
        const grouped = new Map<string, WorkCard[]>();
        const employees = new Map<string, CardEmployee>();
        for (const card of cards) {
          if (!card.employee_id) continue;
          grouped.set(card.employee_id, [...(grouped.get(card.employee_id) ?? []), card]);
          if (card.employee && !employees.has(card.employee_id)) {
            employees.set(card.employee_id, {
              id: card.employee_id,
              full_name: card.employee.full_name,
              passport_id: card.employee.passport_id ?? null,
            });
          }
        }
        grouped.forEach((list, id) => grouped.set(id, sortCardsLikeReport(list)));
        setState({
          status: 'ready',
          byEmployee: grouped,
          employees: [...employees.values()].sort((a, b) => a.full_name.localeCompare(b.full_name, 'he')),
        });
      })
      .catch(() => {
        if (!cancelled) setState({ ...EMPTY, status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [siteId, month, enabled]);

  return state;
}

export type CardImageState = { status: 'loading' } | { status: 'ready'; src: string } | { status: 'error' };

/**
 * Loads every card image of an employee at once (object URLs: the file
 * endpoint needs the auth header), so the thumbnails and the big viewer share
 * one download per card and switching between cards is instant.
 */
export function useWorkCardImages(cardIds: string[]): Record<string, CardImageState> {
  const [images, setImages] = useState<Record<string, CardImageState>>({});
  const signature = cardIds.join(',');

  useEffect(() => {
    const ids = signature ? signature.split(',') : [];
    let cancelled = false;
    const urls: string[] = [];
    setImages(Object.fromEntries(ids.map((id) => [id, { status: 'loading' } as CardImageState])));
    ids.forEach((id) => {
      getWorkCardFile(id)
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          if (cancelled) {
            URL.revokeObjectURL(url);
            return;
          }
          urls.push(url);
          setImages((prev) => ({ ...prev, [id]: { status: 'ready', src: url } }));
        })
        .catch(() => {
          if (!cancelled) setImages((prev) => ({ ...prev, [id]: { status: 'error' } }));
        });
    });
    return () => {
      cancelled = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [signature]);

  return images;
}

// --- editor <-> viewer tab sync ---

/**
 * The report editor tells a work card viewer in another tab which employee is
 * selected, so the viewer can sit on a second screen and follow along.
 */
export type CardsSyncMessage =
  | {
    type: 'focus';
    siteId: string;
    month: string;
    employee: CardEmployee | null;
  }
  /** Sent by an editor that just opened, so live viewers announce themselves. */
  | { type: 'ping' }
  /** Sent by a viewer asking the editor for the current selection. */
  | { type: 'request-focus' }
  | { type: 'viewer-open'; viewerId: string }
  | { type: 'viewer-closed'; viewerId: string };

export function openCardsChannel(businessCode: string): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined' || !businessCode) return null;
  return new BroadcastChannel(`automatehq:report-cards:${businessCode}`);
}

export const viewerWindowName = (businessCode: string) => `automatehq-report-cards-${businessCode}`;

export function viewerUrl(businessCode: string, siteId: string, month: string, employeeId?: string | null) {
  const params = new URLSearchParams({ month });
  if (employeeId) params.set('employee', employeeId);
  return `/${businessCode}/sites/${siteId}/reports/cards?${params.toString()}`;
}
