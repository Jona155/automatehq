import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  disconnectWhatsApp,
  getWhatsAppConfig,
  getWhatsAppGroups,
  getWhatsAppQR,
  getWhatsAppStatus,
  linkWhatsAppGroup,
  unlinkWhatsAppGroup,
  type WhatsAppConfig,
  type WhatsAppGroup,
  type WhatsAppStatus,
} from '../api/whatsapp';

const POLL_INTERVAL_MS = 2000;

type Tone = 'ok' | 'warn' | 'err' | 'neutral';

export default function WhatsAppSettings() {
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [config, setConfig] = useState<WhatsAppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDisconnectGroup, setConfirmDisconnectGroup] = useState(false);
  const [confirmDisconnectDevice, setConfirmDisconnectDevice] = useState(false);

  const wasConnectedRef = useRef(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [statusRes, configRes] = await Promise.allSettled([
        getWhatsAppStatus(),
        getWhatsAppConfig(),
      ]);

      if (statusRes.status === 'fulfilled') {
        setStatus(statusRes.value);
        setStatusError(null);
        wasConnectedRef.current = statusRes.value.connected;
      } else {
        setStatus(null);
        setStatusError(errorMessage(statusRes.reason) || 'לא ניתן להתחבר ל-WhatsApp Listener');
      }

      if (configRes.status === 'fulfilled') setConfig(configRes.value);
      else setError(errorMessage(configRes.reason) || 'טעינת הגדרות WhatsApp נכשלה');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (loading) return;
    if (status?.connected) return;

    let cancelled = false;

    const tick = async () => {
      try {
        const next = await getWhatsAppStatus();
        if (cancelled) return;
        setStatus(next);
        setStatusError(null);

        if (next.waitingForQR) {
          try {
            const qr = await getWhatsAppQR();
            if (!cancelled) setQrDataUrl(qr.qrDataUrl);
          } catch {
            // keep last QR on transient fetch errors
          }
        } else {
          setQrDataUrl(null);
        }

        if (next.connected && !wasConnectedRef.current) {
          wasConnectedRef.current = true;
          try {
            const cfg = await getWhatsAppConfig();
            if (!cancelled) setConfig(cfg);
          } catch (err) {
            if (!cancelled) setError(errorMessage(err) || 'טעינת הגדרות WhatsApp נכשלה');
          }
        } else {
          wasConnectedRef.current = next.connected;
        }
      } catch (err) {
        if (cancelled) return;
        setStatusError(errorMessage(err) || 'לא ניתן להתחבר ל-WhatsApp Listener');
      }
    };

    tick();
    const id = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [loading, status?.connected]);

  const handleLink = async (chatId: string) => {
    const next = await linkWhatsAppGroup(chatId);
    setConfig(next);
  };

  const handleUnlinkGroup = async () => {
    setConfirmDisconnectGroup(false);
    try {
      await unlinkWhatsAppGroup();
      setConfig(null);
    } catch (err) {
      setError(errorMessage(err) || 'ניתוק הקבוצה נכשל');
    }
  };

  const handleDisconnectDevice = async () => {
    setConfirmDisconnectDevice(false);
    setDisconnecting(true);
    setError(null);
    try {
      await disconnectWhatsApp();
      wasConnectedRef.current = false;
      setStatus({ connected: false, hasAuth: false, waitingForQR: false });
      setQrDataUrl(null);
    } catch (err) {
      setError(errorMessage(err) || 'ניתוק המכשיר נכשל');
    } finally {
      setDisconnecting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-full bg-slate-50 flex items-center justify-center">
        <span className="material-symbols-outlined animate-spin text-slate-400 text-4xl">progress_activity</span>
      </div>
    );
  }

  const isConnected = !!status?.connected;

  return (
    <div className="min-h-full bg-slate-50">
      <div className="max-w-[780px] mx-auto px-7 py-9 pb-20 space-y-4">
        <PageHeader
          title="הגדרות WhatsApp"
          sub="קליטת הודעות מקבוצת עבודה נבחרת ב-WhatsApp ישירות לתוך AutoHQ. לאחר חיבור, הודעות מסונכרנות אוטומטית על־פי ההגדרות כאן."
        />

        {error && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-3.5 text-sm text-rose-700 flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">error</span>
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-600">
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
        )}

        {statusError ? (
          <ListenerUnreachableCard message={statusError} onRetry={load} />
        ) : (
          <ConnectionCard
            status={status}
            config={config}
            onDisconnectDevice={() => setConfirmDisconnectDevice(true)}
            disconnecting={disconnecting}
          />
        )}

        {!statusError && isConnected && (
          <CaptureGroupCard
            config={config}
            onLink={handleLink}
            onDisconnectGroup={() => setConfirmDisconnectGroup(true)}
          />
        )}

        {!statusError && !isConnected && status && (
          <QRCard status={status} qrDataUrl={qrDataUrl} />
        )}
      </div>

      <ConfirmModal
        open={confirmDisconnectGroup}
        onClose={() => setConfirmDisconnectGroup(false)}
        onConfirm={handleUnlinkGroup}
        title="לבטל את קישור הקבוצה?"
        icon="link_off"
        confirmLabel="בטל קישור"
      >
        ההאזנה לקבוצה תיפסק מיידית וכל ההודעות הנכנסות לא יסונכרנו יותר.
        ההיסטוריה שכבר נקלטה תישאר ללא שינוי.
      </ConfirmModal>

      <ConfirmModal
        open={confirmDisconnectDevice}
        onClose={() => setConfirmDisconnectDevice(false)}
        onConfirm={handleDisconnectDevice}
        title="לנתק את מכשיר ה-WhatsApp?"
        icon="phonelink_off"
        confirmLabel="נתק מכשיר"
      >
        החיבור של Listener למכשיר יתנתק ויהיה צורך לסרוק קוד QR חדש כדי להמשיך לקלוט הודעות.
        הקישור לקבוצה יישמר ויחזור לפעול אוטומטית לאחר סריקה מחדש.
      </ConfirmModal>
    </div>
  );
}

// --------------------------------------------------------------------------
// Page header
// --------------------------------------------------------------------------

function PageHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-4">
      <h1 className="text-[22px] font-semibold text-slate-900 tracking-[-0.01em] leading-tight">{title}</h1>
      {sub && <p className="mt-2 text-[13.5px] text-slate-500 leading-[1.55] max-w-[620px]">{sub}</p>}
    </div>
  );
}

// --------------------------------------------------------------------------
// Card primitives
// --------------------------------------------------------------------------

function Card({
  children,
  tone = 'default',
  allowOverflow = false,
}: {
  children: ReactNode;
  tone?: 'default' | 'error';
  allowOverflow?: boolean;
}) {
  const cls =
    tone === 'error'
      ? 'bg-rose-50/30 border-rose-100'
      : 'bg-white border-slate-200';
  return (
    <div
      className={`rounded-xl border ${cls} shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${
        allowOverflow ? '' : 'overflow-hidden'
      }`}
    >
      {children}
    </div>
  );
}

function CardHeader({
  icon,
  iconTone = 'accent',
  title,
  sub,
  action,
}: {
  icon: string;
  iconTone?: Tone | 'accent';
  title: string;
  sub?: string;
  action?: ReactNode;
}) {
  const tones: Record<string, string> = {
    accent: 'bg-indigo-50 text-indigo-600',
    ok: 'bg-emerald-50 text-emerald-700',
    warn: 'bg-amber-50 text-amber-700',
    err: 'bg-rose-50 text-rose-700',
    neutral: 'bg-slate-100 text-slate-600',
  };
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-slate-200">
      <div className="flex items-center gap-3 min-w-0">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${tones[iconTone]}`}>
          <span className="material-symbols-outlined text-[18px]">{icon}</span>
        </div>
        <div className="min-w-0">
          <div className="text-[14.5px] font-semibold text-slate-900 tracking-[-0.005em]">{title}</div>
          {sub && <div className="text-[12.5px] text-slate-500 mt-0.5">{sub}</div>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

function StatusRow({
  label,
  value,
  tone = 'neutral',
  valueIcon,
  pulse,
}: {
  label: string;
  value: ReactNode;
  tone?: Tone;
  valueIcon?: string;
  pulse?: boolean;
}) {
  const toneFg: Record<Tone, string> = {
    ok: 'text-emerald-700',
    warn: 'text-amber-700',
    err: 'text-rose-700',
    neutral: 'text-slate-700',
  };
  const toneDot: Record<Tone, string> = {
    ok: 'bg-emerald-500',
    warn: 'bg-amber-500',
    err: 'bg-rose-500',
    neutral: 'bg-slate-400',
  };
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3.5">
      <div className="text-[13px] text-slate-500 font-medium">{label}</div>
      <div className={`flex items-center gap-2 text-[13.5px] font-medium ${toneFg[tone]}`}>
        {tone !== 'neutral' && (
          <span
            className={`w-2 h-2 rounded-full ${toneDot[tone]} ${pulse ? 'shadow-[0_0_0_3px_rgb(245_158_11_/_0.2)] animate-pulse' : ''}`}
          />
        )}
        {valueIcon && <span className="material-symbols-outlined text-[15px] text-slate-400">{valueIcon}</span>}
        <span className="tabular-nums">{value}</span>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Connection card
// --------------------------------------------------------------------------

function ConnectionCard({
  status,
  config,
  onDisconnectDevice,
  disconnecting,
}: {
  status: WhatsAppStatus | null;
  config: WhatsAppConfig | null;
  onDisconnectDevice: () => void;
  disconnecting: boolean;
}) {
  if (!status) {
    return (
      <Card>
        <CardHeader icon="link" title="סטטוס חיבור" sub="סטטוס ההאזנה הנוכחית של AutoHQ ל-WhatsApp" iconTone="neutral" />
        <StatusRow label="סטטוס" value="טוען…" tone="neutral" />
      </Card>
    );
  }

  const { connected, hasAuth, waitingForQR } = status;

  let tone: Tone = 'neutral';
  let label = 'לא מחובר';
  let headerTone: Tone | 'accent' = 'neutral';
  let pulse = false;

  if (connected) {
    tone = 'ok';
    label = 'מחובר ל-WhatsApp Listener';
    headerTone = 'ok';
  } else if (waitingForQR) {
    tone = 'warn';
    label = 'ממתין לחיבור · סריקת QR';
    headerTone = 'warn';
    pulse = true;
  } else if (hasAuth) {
    tone = 'warn';
    label = 'מתחבר מחדש…';
    headerTone = 'warn';
    pulse = true;
  } else {
    tone = 'neutral';
    label = 'מאתחל חיבור…';
    headerTone = 'neutral';
  }

  return (
    <Card>
      <CardHeader
        icon="link"
        iconTone={headerTone}
        title="סטטוס חיבור"
        sub="סטטוס ההאזנה הנוכחית של AutoHQ ל-WhatsApp"
        action={
          connected && (
            <button
              type="button"
              onClick={onDisconnectDevice}
              disabled={disconnecting}
              className="h-8 px-3 text-[12.5px] font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-60 inline-flex items-center gap-1.5 transition-colors"
            >
              {disconnecting ? (
                <span className="material-symbols-outlined animate-spin text-[14px]">progress_activity</span>
              ) : (
                <span className="material-symbols-outlined text-[14px]">phonelink_off</span>
              )}
              {disconnecting ? 'מנתק…' : 'נתק מכשיר'}
            </button>
          )
        }
      />
      <StatusRow label="סטטוס" value={label} tone={tone} pulse={pulse} />
      {connected && config?.last_seen_timestamp && (
        <>
          <div className="border-t border-slate-100" />
          <StatusRow
            label="הודעה אחרונה שנקלטה"
            value={relativeTime(config.last_seen_timestamp)}
            tone="neutral"
            valueIcon="schedule"
          />
        </>
      )}
      {connected && !config && (
        <>
          <div className="border-t border-slate-100" />
          <StatusRow label="קבוצה מקושרת" value="לא נבחרה קבוצה" tone="neutral" />
        </>
      )}
    </Card>
  );
}

// --------------------------------------------------------------------------
// Capture group card
// --------------------------------------------------------------------------

function CaptureGroupCard({
  config,
  onLink,
  onDisconnectGroup,
}: {
  config: WhatsAppConfig | null;
  onLink: (chatId: string) => Promise<void>;
  onDisconnectGroup: () => void;
}) {
  const isLinked = !!config;
  const [groups, setGroups] = useState<WhatsAppGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fetched, setFetched] = useState(false);

  const loadGroups = async () => {
    setGroupsLoading(true);
    setGroupsError(null);
    try {
      const list = await getWhatsAppGroups();
      setGroups(list);
      setFetched(true);
    } catch (err) {
      setGroupsError(errorMessage(err) || 'טעינת קבוצות WhatsApp נכשלה');
    } finally {
      setGroupsLoading(false);
    }
  };

  useEffect(() => {
    if (!isLinked && !fetched) {
      loadGroups();
    }
  }, [isLinked, fetched]);

  const linkedGroup = useMemo<WhatsAppGroup | null>(() => {
    if (!config) return null;
    return {
      chat_id: config.chat_id,
      chat_name: config.chat_name || config.chat_id,
      is_linked_to_me: true,
    };
  }, [config]);

  const selectedMeta = useMemo(() => {
    const g = groups.find((x) => x.chat_id === selected);
    return g;
  }, [groups, selected]);

  const handleLink = async () => {
    if (!selected) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onLink(selected);
      setSelected('');
    } catch (err) {
      setSubmitError(errorMessage(err) || 'קישור הקבוצה נכשל');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card allowOverflow>
      <CardHeader
        icon="groups"
        title="קבוצת קליטה"
        sub="הקבוצה ש-AutoHQ יאזין לה ויסנכרן ממנה הודעות"
      />
      <div className="px-5 py-5">
        {isLinked && linkedGroup ? (
          <LinkedGroupPanel
            group={linkedGroup}
            config={config!}
            onDisconnectGroup={onDisconnectGroup}
          />
        ) : (
          <UnlinkedGroupPicker
            groups={groups}
            loading={groupsLoading}
            error={groupsError}
            onRetry={loadGroups}
            selected={selected}
            onSelect={setSelected}
            onLink={handleLink}
            submitting={submitting}
            submitError={submitError}
            selectedMeta={selectedMeta}
          />
        )}
      </div>
    </Card>
  );
}

function LinkedGroupPanel({
  group,
  config,
  onDisconnectGroup,
}: {
  group: WhatsAppGroup;
  config: WhatsAppConfig;
  onDisconnectGroup: () => void;
}) {
  const initial = (group.chat_name || '?').trim().charAt(0) || '?';
  return (
    <>
      <label className="block text-[12.5px] font-medium text-slate-700 mb-2">
        קבוצה מקושרת
      </label>
      <div className="flex items-center gap-3 px-3 h-11 bg-slate-50 border border-slate-200 rounded-lg">
        <div className="w-7 h-7 rounded-md bg-indigo-500 text-white text-[13px] font-semibold grid place-items-center shrink-0">
          {initial}
        </div>
        <div className="flex-1 min-w-0 text-[13.5px] text-slate-900 font-medium truncate">
          {group.chat_name || group.chat_id}
        </div>
        <span className="inline-flex items-center gap-1 text-[11.5px] text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          מקושרת
        </span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-4 px-4 py-3.5 bg-slate-50/70 border border-slate-200 rounded-lg">
        <Stat label="סנכרון אחרון" value={config.last_seen_timestamp ? relativeTime(config.last_seen_timestamp) : '—'} />
        <Stat
          label="חודש פעיל"
          value={config.current_processing_month ? formatMonth(config.current_processing_month) : '—'}
        />
        <Stat label="מזהה קבוצה" value={group.chat_id} mono />
      </div>

      <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between gap-3">
        <div className="text-[12.5px] text-slate-500 leading-[1.5]">
          שינוי הקבוצה לא ישפיע על היסטוריית הודעות שכבר נקלטו.
        </div>
        <button
          type="button"
          onClick={onDisconnectGroup}
          className="h-8 px-3 text-[12.5px] font-medium text-rose-600 bg-white border border-rose-200 rounded-lg hover:bg-rose-50 inline-flex items-center gap-1.5 transition-colors shrink-0"
        >
          <span className="material-symbols-outlined text-[14px]">link_off</span>
          בטל קישור
        </button>
      </div>
    </>
  );
}

function UnlinkedGroupPicker({
  groups,
  loading,
  error,
  onRetry,
  selected,
  onSelect,
  onLink,
  submitting,
  submitError,
  selectedMeta,
}: {
  groups: WhatsAppGroup[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  selected: string;
  onSelect: (chatId: string) => void;
  onLink: () => void;
  submitting: boolean;
  submitError: string | null;
  selectedMeta: WhatsAppGroup | undefined;
}) {
  return (
    <>
      <label className="block text-[12.5px] font-medium text-slate-700 mb-2">
        בחרו קבוצה <span className="text-rose-500">*</span>
      </label>
      <GroupDropdown
        groups={groups}
        loading={loading}
        error={error}
        onRetry={onRetry}
        value={selected}
        onChange={onSelect}
        placeholder="בחרו קבוצה מרשימת השיחות שלכם…"
      />

      {selectedMeta && (
        <div className="mt-3 px-3.5 py-3 bg-slate-50 border border-slate-200 rounded-lg">
          <div className="text-[11px] font-medium uppercase tracking-[0.03em] text-slate-500 mb-1">מזהה קבוצה</div>
          <div className="text-[12px] text-slate-700 font-mono truncate">{selectedMeta.chat_id}</div>
        </div>
      )}

      {submitError && (
        <div className="mt-3 px-3 py-2 bg-rose-50 border border-rose-200 rounded-lg text-[12.5px] text-rose-700">
          {submitError}
        </div>
      )}

      <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-[12px] text-amber-700 bg-amber-50 rounded-md px-2.5 py-1">
          <span className="material-symbols-outlined text-[14px]">info</span>
          <span>הקליטה מתחילה מרגע הקישור. הודעות קודמות לא ייקלטו.</span>
        </div>
        <button
          type="button"
          onClick={onLink}
          disabled={!selected || submitting}
          className="h-9 px-4 text-[13px] font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg inline-flex items-center gap-1.5 transition-colors shrink-0"
        >
          {submitting && <span className="material-symbols-outlined animate-spin text-[15px]">progress_activity</span>}
          {submitting ? 'מקשר…' : 'קשר קבוצה'}
        </button>
      </div>
    </>
  );
}

function Stat({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium uppercase tracking-[0.03em] text-slate-500 mb-1">{label}</div>
      <div
        className={`text-[13px] text-slate-800 font-medium truncate ${mono ? 'font-mono text-[12px] text-slate-600' : 'tabular-nums'}`}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Dropdown
// --------------------------------------------------------------------------

function GroupDropdown({
  groups,
  loading,
  error,
  onRetry,
  value,
  onChange,
  placeholder,
}: {
  groups: WhatsAppGroup[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  value: string;
  onChange: (chatId: string) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selected = groups.find((g) => g.chat_id === value);
  const filtered = groups.filter((g) =>
    (g.chat_name || g.chat_id).toLowerCase().includes(search.toLowerCase())
  );

  if (error && !loading) {
    return (
      <div className="flex items-center justify-between gap-3 px-3 py-2.5 bg-rose-50 border border-rose-200 rounded-lg text-[13px] text-rose-700">
        <span>{error}</span>
        <button onClick={onRetry} className="text-[12.5px] font-medium text-rose-700 hover:text-rose-900 underline">
          נסה שוב
        </button>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={loading}
        className={`w-full h-10 px-3 flex items-center gap-2.5 bg-white border rounded-lg text-[13.5px] transition-all ${
          open
            ? 'border-indigo-500 shadow-[0_0_0_3px_rgba(99,102,241,0.18)]'
            : 'border-slate-300 hover:border-slate-400'
        } disabled:bg-slate-50 disabled:cursor-not-allowed`}
      >
        <span className="material-symbols-outlined text-[18px] text-slate-400">groups</span>
        <span className={`flex-1 text-start truncate ${selected ? 'text-slate-900 font-medium' : 'text-slate-400'}`}>
          {loading ? 'טוען קבוצות…' : selected ? selected.chat_name || selected.chat_id : placeholder}
        </span>
        <span
          className={`material-symbols-outlined text-[18px] text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          expand_more
        </span>
      </button>

      {open && (
        <div className="absolute top-[calc(100%+6px)] start-0 end-0 z-50 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
          <div className="p-2 border-b border-slate-100">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="חיפוש קבוצה…"
              autoFocus
              className="w-full h-8 px-2.5 text-[13px] bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div className="p-1.5 max-h-[280px] overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-[13px] text-slate-400">
                {groups.length === 0 ? 'לא נמצאו קבוצות WhatsApp' : 'אין תוצאות'}
              </div>
            ) : (
              filtered.map((g) => {
                const initial = (g.chat_name || '?').trim().charAt(0) || '?';
                const isSelected = g.chat_id === value;
                return (
                  <button
                    key={g.chat_id}
                    type="button"
                    onClick={() => {
                      onChange(g.chat_id);
                      setOpen(false);
                      setSearch('');
                    }}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-start transition-colors ${
                      isSelected ? 'bg-indigo-50' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="w-7 h-7 rounded-md bg-indigo-500 text-white text-[12px] font-semibold grid place-items-center shrink-0">
                      {initial}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13.5px] font-medium text-slate-900 truncate">
                        {g.chat_name || g.chat_id}
                      </div>
                      <div className="text-[11.5px] text-slate-400 font-mono truncate">{g.chat_id}</div>
                    </div>
                    {g.is_linked_to_me && (
                      <span className="text-[11px] text-emerald-700 bg-emerald-50 rounded-full px-1.5 py-0.5 shrink-0">
                        מקושרת
                      </span>
                    )}
                    {isSelected && (
                      <span className="material-symbols-outlined text-[16px] text-indigo-600 shrink-0">check</span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// QR card
// --------------------------------------------------------------------------

function QRCard({
  status,
  qrDataUrl,
}: {
  status: WhatsAppStatus;
  qrDataUrl: string | null;
}) {
  const showQR = status.waitingForQR && qrDataUrl;
  return (
    <Card>
      <CardHeader
        icon="qr_code_2"
        title="חיבור ל-WhatsApp"
        sub="סרקו את הקוד באמצעות WhatsApp בטלפון הנייד"
      />
      <div className="grid grid-cols-[auto_1fr] gap-8 px-5 py-7">
        <div className="p-3 bg-white border border-slate-200 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          {showQR ? (
            <img src={qrDataUrl} alt="QR לסריקה" className="w-[200px] h-[200px] object-contain" />
          ) : (
            <div className="w-[200px] h-[200px] flex flex-col items-center justify-center gap-2 bg-slate-50 rounded-lg">
              <span className="material-symbols-outlined animate-spin text-slate-400 text-4xl">progress_activity</span>
              <div className="text-[12px] text-slate-500 text-center px-3">
                {status.waitingForQR
                  ? 'מייצר קוד QR…'
                  : status.hasAuth
                  ? 'מתחבר מחדש…'
                  : 'מאתחל חיבור…'}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col">
          <ol className="m-0 p-0 list-none">
            {[
              'פתחו את WhatsApp בטלפון הנייד',
              'גשו להגדרות ← מכשירים מקושרים',
              'לחצו על "קישור מכשיר" וסרקו את הקוד',
            ].map((txt, i) => (
              <li
                key={i}
                className={`flex items-start gap-3 py-2.5 ${i < 2 ? 'border-b border-dashed border-slate-200' : ''}`}
              >
                <div className="w-[22px] h-[22px] rounded-full bg-indigo-50 text-indigo-600 grid place-items-center text-[12px] font-semibold shrink-0 tabular-nums">
                  {i + 1}
                </div>
                <div className="text-[13.5px] text-slate-900 leading-[1.55] pt-0.5">{txt}</div>
              </li>
            ))}
          </ol>

          <div className="mt-4 flex items-center gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-[12px] text-amber-800">
            <span className="material-symbols-outlined text-[15px]">info</span>
            <span className="flex-1">לאחר החיבור, AutoHQ עשויה לשלוח הודעות מחשבון WhatsApp המקושר (למשל אישורי קליטה וסיכומים חודשיים).</span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 px-5 py-3.5 bg-slate-50/70 border-t border-slate-200">
        <div className="flex items-center gap-1.5 text-[12px] text-slate-500">
          <span className="material-symbols-outlined text-[14px]">autorenew</span>
          הקוד מתרענן אוטומטית כל ~20 שניות
        </div>
      </div>
    </Card>
  );
}

// --------------------------------------------------------------------------
// Listener unreachable
// --------------------------------------------------------------------------

function ListenerUnreachableCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card tone="error">
      <div className="flex items-start gap-3.5 px-5 py-5">
        <div className="w-9 h-9 rounded-lg bg-rose-100 text-rose-600 grid place-items-center shrink-0">
          <span className="material-symbols-outlined text-[18px]">error</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14.5px] font-semibold text-slate-900 mb-1">לא ניתן להגיע ל-WhatsApp Listener</div>
          <div className="text-[13px] text-slate-600 leading-[1.6] mb-3.5">{message}</div>
          <div className="flex gap-2">
            <button
              onClick={onRetry}
              className="h-9 px-3.5 text-[13px] font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg inline-flex items-center gap-1.5 transition-colors"
            >
              <span className="material-symbols-outlined text-[14px]">refresh</span>
              נסה שוב
            </button>
          </div>
        </div>
      </div>
    </Card>
  );
}

// --------------------------------------------------------------------------
// Confirm modal
// --------------------------------------------------------------------------

function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  icon,
  confirmLabel,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  icon: string;
  confirmLabel: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[2000] grid place-items-center p-6 bg-slate-900/45 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[440px] bg-white rounded-2xl shadow-2xl overflow-hidden"
      >
        <div className="px-6 pt-6">
          <div className="w-11 h-11 rounded-xl bg-rose-50 text-rose-600 grid place-items-center mb-3.5">
            <span className="material-symbols-outlined text-[22px]">{icon}</span>
          </div>
          <div className="text-[17px] font-semibold text-slate-900 tracking-[-0.01em]">{title}</div>
          <div className="mt-2 text-[13.5px] text-slate-600 leading-[1.6] pb-5">{children}</div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3.5 bg-slate-50 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-3.5 text-[13px] font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            ביטול
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="h-9 px-3.5 text-[13px] font-medium text-white bg-rose-600 hover:bg-rose-700 border border-rose-600 rounded-lg inline-flex items-center gap-1.5 transition-colors"
          >
            <span className="material-symbols-outlined text-[14px]">link_off</span>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function errorMessage(err: unknown): string | null {
  const axiosErr = err as { response?: { data?: { message?: string; error?: string } }; message?: string };
  return (
    axiosErr?.response?.data?.message ||
    axiosErr?.response?.data?.error ||
    axiosErr?.message ||
    null
  );
}

function relativeTime(iso: string): string {
  const now = Date.now();
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diffSec = Math.round((now - t) / 1000);
  if (diffSec < 60) return 'ממש עכשיו';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `לפני ${diffMin} דקות`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `לפני ${diffHr} שעות`;
  const diffDays = Math.round(diffHr / 24);
  if (diffDays < 30) return `לפני ${diffDays} ימים`;
  return new Date(iso).toLocaleDateString('he-IL');
}

function formatMonth(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
}
