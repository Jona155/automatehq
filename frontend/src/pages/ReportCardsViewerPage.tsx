import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { getSite } from '../api/sites';
import EmployeeCardsView from '../components/reports/EmployeeCardsView';
import SearchableSelect from '../components/SearchableSelect';
import {
  openCardsChannel,
  useSiteMonthCards,
  viewerUrl,
  type CardEmployee,
  type CardsSyncMessage,
} from '../components/reports/workCardViewer';

const FOLLOW_KEY = 'report-cards-viewer-follow';

function readFollowPreference() {
  try {
    return localStorage.getItem(FOLLOW_KEY) !== 'false';
  } catch {
    return true;
  }
}

/**
 * Work card images of a site's month in a tab of their own, so they can be
 * dragged to a second screen. While "follow" is on, the tab shows whichever
 * employee is selected in the report editor (any open editor tab of this
 * business), switching site and month along with it.
 */
export default function ReportCardsViewerPage() {
  const { businessCode = '', siteId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const month = searchParams.get('month') ?? '';
  const employeeId = searchParams.get('employee');

  const cards = useSiteMonthCards(siteId, month);
  const [siteName, setSiteName] = useState('');
  const [follow, setFollow] = useState(readFollowPreference);
  const followRef = useRef(follow);
  followRef.current = follow;
  /** The editor may follow an employee who has no card here; it sends the name along. */
  const [announced, setAnnounced] = useState<CardEmployee | null>(null);
  const [editorSeen, setEditorSeen] = useState(false);
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSiteName('');
    getSite(siteId).then((site) => { if (!cancelled) setSiteName(site.site_name); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [siteId]);

  const show = useCallback((target: { siteId: string; month: string; employeeId: string | null }) => {
    navigate(viewerUrl(businessCode, target.siteId, target.month, target.employeeId), { replace: true });
  }, [businessCode, navigate]);

  // --- sync with the editor ---

  const routeRef = useRef({ siteId, month, employeeId });
  routeRef.current = { siteId, month, employeeId };

  useEffect(() => {
    const channel = openCardsChannel(businessCode);
    channelRef.current = channel;
    if (!channel) return undefined;
    const viewerId = Math.random().toString(36).slice(2);
    channel.onmessage = (event: MessageEvent<CardsSyncMessage>) => {
      const message = event.data;
      if (message.type === 'ping') {
        channel.postMessage({ type: 'viewer-open', viewerId } satisfies CardsSyncMessage);
      } else if (message.type === 'focus') {
        setEditorSeen(true);
        if (!followRef.current) return;
        setAnnounced(message.employee);
        const current = routeRef.current;
        const nextEmployee = message.employee?.id ?? current.employeeId;
        if (message.siteId !== current.siteId || message.month !== current.month || nextEmployee !== current.employeeId) {
          show({ siteId: message.siteId, month: message.month, employeeId: nextEmployee });
        }
      }
    };
    channel.postMessage({ type: 'viewer-open', viewerId } satisfies CardsSyncMessage);
    channel.postMessage({ type: 'request-focus' } satisfies CardsSyncMessage);
    const announceClosed = () => channel.postMessage({ type: 'viewer-closed', viewerId } satisfies CardsSyncMessage);
    window.addEventListener('pagehide', announceClosed);
    return () => {
      announceClosed();
      window.removeEventListener('pagehide', announceClosed);
      channel.close();
      channelRef.current = null;
    };
  }, [businessCode, show]);

  const setFollowing = (next: boolean) => {
    setFollow(next);
    followRef.current = next;
    try {
      localStorage.setItem(FOLLOW_KEY, String(next));
    } catch {
      // storage unavailable — the choice lasts for this visit
    }
    if (next) channelRef.current?.postMessage({ type: 'request-focus' } satisfies CardsSyncMessage);
  };

  // --- employee choice ---

  const employees = cards.employees;
  const current: CardEmployee | null = useMemo(() => {
    if (!employeeId) return null;
    return employees.find((e) => e.id === employeeId) ?? (announced?.id === employeeId ? announced : null);
  }, [employeeId, employees, announced]);

  // Nothing chosen yet (opened directly, or the editor has no selection): start at the first employee.
  useEffect(() => {
    if (!employeeId && cards.status === 'ready' && employees.length && !(follow && editorSeen)) {
      show({ siteId, month, employeeId: employees[0].id });
    }
  }, [employeeId, cards.status, employees, follow, editorSeen, show, siteId, month]);

  /** Picking an employee by hand stops following the editor. */
  const pick = useCallback((id: string) => {
    if (!id || id === employeeId) return;
    if (followRef.current) setFollowing(false);
    show({ siteId, month, employeeId: id });
  }, [employeeId, show, siteId, month]); // eslint-disable-line react-hooks/exhaustive-deps

  const position = employees.findIndex((e) => e.id === employeeId);
  const step = useCallback((delta: number) => {
    if (!employees.length) return;
    const from = position === -1 ? (delta > 0 ? -1 : employees.length) : position;
    const next = employees[from + delta];
    if (next) pick(next.id);
  }, [employees, position, pick]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [role="listbox"]')) return;
      if (event.key === 'PageDown') { event.preventDefault(); step(1); }
      if (event.key === 'PageUp') { event.preventDefault(); step(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step]);

  const [year, monthNumber] = month.split('-');
  useEffect(() => {
    document.title = `${current ? `${current.full_name} · ` : ''}כרטיסי עבודה${siteName ? ` · ${siteName}` : ''}`;
  }, [current, siteName]);

  const options = useMemo(() => {
    const list = employees.map((e) => ({ value: e.id, label: e.passport_id ? `${e.full_name} · ${e.passport_id}` : e.full_name }));
    if (current && !employees.some((e) => e.id === current.id)) {
      list.unshift({ value: current.id, label: `${current.full_name} (ללא כרטיס)` });
    }
    return list;
  }, [employees, current]);

  if (!/^\d{4}-\d{2}$/.test(month)) {
    return (
      <div dir="rtl" className="h-screen grid place-items-center bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-300">
        קישור לא תקין לכרטיסי עבודה.
      </div>
    );
  }

  return (
    <div dir="rtl" className="h-screen flex flex-col bg-slate-50 dark:bg-slate-900" data-testid="cards-viewer">
      <header className="shrink-0 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2.5">
        <div className="min-w-0">
          <div className="text-[11px] leading-4 text-slate-500 dark:text-slate-400">
            כרטיסי עבודה · {monthNumber}/{year}
          </div>
          <div className="truncate text-base font-bold text-slate-900 dark:text-white">{siteName || '…'}</div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => step(-1)}
            disabled={position <= 0}
            title="העובד הקודם (PageUp)"
            className="w-9 h-9 grid place-items-center rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30"
          >
            <span className="material-symbols-outlined">chevron_right</span>
          </button>
          <SearchableSelect
            options={options}
            value={employeeId ?? ''}
            onChange={pick}
            placeholder={cards.status === 'loading' ? 'טוען…' : 'בחרו עובד'}
            searchPlaceholder="חיפוש עובד…"
            ariaLabel="עובד"
            className="w-72 h-9"
          />
          <button
            type="button"
            onClick={() => step(1)}
            disabled={position === -1 ? !employees.length : position >= employees.length - 1}
            title="העובד הבא (PageDown)"
            className="w-9 h-9 grid place-items-center rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30"
          >
            <span className="material-symbols-outlined">chevron_left</span>
          </button>
          {position !== -1 && (
            <span className="text-xs text-slate-400 tabular-nums">{position + 1}/{employees.length}</span>
          )}
        </div>

        <label
          data-testid="cards-viewer-follow"
          title="כשהאפשרות פעילה, התצוגה עוברת לעובד שנבחר בעורך הדוחות"
          className={`ms-auto inline-flex items-center gap-2 h-8 px-3 rounded-full border text-xs font-semibold cursor-pointer select-none ${
            follow
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300'
          }`}
        >
          <input
            type="checkbox"
            className="accent-emerald-600"
            checked={follow}
            onChange={(event) => setFollowing(event.target.checked)}
          />
          {follow && <span className={`w-2 h-2 rounded-full ${editorSeen ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />}
          {follow ? (editorSeen ? 'עוקב אחרי הדוח' : 'עוקב אחרי הדוח · ממתין לבחירה בעורך') : 'מעקב אחרי הדוח כבוי'}
        </label>
      </header>

      <main className="flex-1 min-h-0 p-3">
        <div className="h-full flex flex-col rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
          {current || cards.status !== 'ready' ? (
            <>
              {current && (
                <div className="shrink-0 px-3 pt-2 font-bold text-slate-900 dark:text-white">
                  {current.full_name}
                  {current.passport_id && <span className="font-normal text-xs text-slate-500 dark:text-slate-400"> · {current.passport_id}</span>}
                </div>
              )}
              <EmployeeCardsView
                cards={employeeId ? cards.byEmployee.get(employeeId) ?? [] : []}
                loading={cards.status === 'loading'}
                error={cards.status === 'error'}
                className="flex-1 min-h-0"
              />
            </>
          ) : (
            <div className="flex-1 grid place-items-center text-sm text-slate-500 dark:text-slate-400">
              {employees.length ? 'בחרו עובד' : 'אין כרטיסי עבודה לאתר בחודש זה.'}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
