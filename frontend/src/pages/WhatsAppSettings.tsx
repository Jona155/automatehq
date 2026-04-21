import { useEffect, useState } from 'react';
import {
  getWhatsAppConfig,
  getWhatsAppGroups,
  getWhatsAppStatus,
  linkWhatsAppGroup,
  unlinkWhatsAppGroup,
  type WhatsAppConfig,
  type WhatsAppGroup,
  type WhatsAppStatus,
} from '../api/whatsapp';

export default function WhatsAppSettings() {
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [config, setConfig] = useState<WhatsAppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [picking, setPicking] = useState(false);
  const [groups, setGroups] = useState<WhatsAppGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [selectedChatId, setSelectedChatId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

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
      } else {
        setStatus(null);
        setStatusError(errorMessage(statusRes.reason) || 'לא ניתן להתחבר ל-WhatsApp Listener');
      }

      if (configRes.status === 'fulfilled') setConfig(configRes.value);
      else setError(errorMessage(configRes.reason) || 'Failed to load WhatsApp config');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openPicker = async () => {
    setPicking(true);
    setSelectedChatId('');
    setModalError(null);
    setGroupsLoading(true);
    try {
      const all = await getWhatsAppGroups();
      setGroups(all);
    } catch (err: unknown) {
      setModalError(errorMessage(err) || 'Failed to fetch WhatsApp groups');
      setGroups([]);
    } finally {
      setGroupsLoading(false);
    }
  };

  const closeModal = () => {
    setPicking(false);
    setGroups([]);
    setSelectedChatId('');
    setModalError(null);
  };

  const handleLink = async () => {
    if (!selectedChatId) return;
    setSubmitting(true);
    setModalError(null);
    try {
      const next = await linkWhatsAppGroup(selectedChatId);
      setConfig(next);
      closeModal();
    } catch (err: unknown) {
      setModalError(errorMessage(err) || 'Failed to link WhatsApp group');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUnlink = async () => {
    if (!confirm('לבטל את הקישור של קבוצת WhatsApp? כרטיסי עבודה שכבר נקלטו יישמרו.')) return;
    try {
      await unlinkWhatsAppGroup();
      setConfig(null);
    } catch (err: unknown) {
      setError(errorMessage(err) || 'Failed to unlink WhatsApp group');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="material-symbols-outlined animate-spin text-primary text-4xl">progress_activity</span>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-8 px-4 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">הגדרות WhatsApp</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-1 text-sm">
          קליטת תמונות כרטיסי עבודה מקבוצת WhatsApp יחידה. שיוך לעובד ולאתר מתבצע אוטומטית על-ידי מנוע החילוץ.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-red-700 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Listener status */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-2">
        <h2 className="font-semibold text-slate-800 dark:text-slate-200">סטטוס חיבור</h2>
        <StatusRow status={status} error={statusError} />
      </section>

      {/* Linked group */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
        <h2 className="font-semibold text-slate-800 dark:text-slate-200">קבוצת קליטה</h2>

        {config ? (
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                {config.chat_name || config.chat_id}
              </div>
              <div className="text-xs font-mono text-slate-500 dark:text-slate-400 truncate mt-0.5">
                {config.chat_id}
              </div>
              {config.last_seen_timestamp && (
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  הודעה אחרונה שנראתה: {new Date(config.last_seen_timestamp).toLocaleString('he-IL')}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={handleUnlink}
              className="shrink-0 text-sm px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
              בטל קישור
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              לא קושרה קבוצה. קשר קבוצה כדי להתחיל לקלוט תמונות.
            </p>
            <button
              type="button"
              onClick={openPicker}
              disabled={!status?.connected}
              className="shrink-0 text-sm px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title={!status?.connected ? 'ה-Listener לא מחובר' : undefined}
            >
              בחר קבוצה
            </button>
          </div>
        )}
      </section>

      {picking && (
        <PickerModal
          groups={groups}
          loading={groupsLoading}
          selected={selectedChatId}
          onSelect={setSelectedChatId}
          onSubmit={handleLink}
          onClose={closeModal}
          submitting={submitting}
          error={modalError}
        />
      )}
    </div>
  );
}

function StatusRow({ status, error }: { status: WhatsAppStatus | null; error: string | null }) {
  if (error) {
    return (
      <div className="flex items-center gap-2">
        <span className="size-2.5 rounded-full bg-red-500 inline-block" />
        <span className="text-sm text-red-600 dark:text-red-400">{error}</span>
      </div>
    );
  }
  if (!status) return null;
  if (status.connected) {
    return (
      <div className="flex items-center gap-2">
        <span className="size-2.5 rounded-full bg-green-500 inline-block" />
        <span className="text-sm text-slate-700 dark:text-slate-300">Listener מחובר ל-WhatsApp</span>
      </div>
    );
  }
  if (status.hasAuth) {
    return (
      <div className="flex items-center gap-2">
        <span className="size-2.5 rounded-full bg-amber-500 inline-block" />
        <span className="text-sm text-slate-700 dark:text-slate-300">
          Listener פעיל אך לא מחובר — נסה שוב בעוד רגע
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <span className="size-2.5 rounded-full bg-slate-400 inline-block" />
      <span className="text-sm text-slate-500 dark:text-slate-400">
        Listener לא מקושר לטלפון — פתח את לוח הבקרה של ה-Listener וסרוק QR
      </span>
    </div>
  );
}

function PickerModal({
  groups,
  loading,
  selected,
  onSelect,
  onSubmit,
  onClose,
  submitting,
  error,
}: {
  groups: WhatsAppGroup[];
  loading: boolean;
  selected: string;
  onSelect: (id: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  submitting: boolean;
  error: string | null;
}) {
  const [search, setSearch] = useState('');
  const filtered = groups.filter((g) =>
    g.chat_name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl max-w-md w-full max-h-[80vh] flex flex-col">
        <div className="p-6 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">בחר קבוצת WhatsApp</h3>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-xs text-amber-800 dark:text-amber-300">
            <strong>שים לב:</strong> הקליטה מתחילה מרגע הקישור. הודעות שנשלחו לקבוצה לפני קישור זה לא ייקלטו.
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <span className="material-symbols-outlined animate-spin text-primary text-3xl">progress_activity</span>
            </div>
          ) : groups.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400 py-4 text-center">
              לא נמצאו קבוצות WhatsApp זמינות.
            </p>
          ) : (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                קבוצה ({groups.length} זמינות)
              </label>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="חפש קבוצה..."
                autoFocus
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm"
              />
              <div className="max-h-52 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-lg divide-y divide-slate-100 dark:divide-slate-700">
                {filtered.length === 0 ? (
                  <div className="p-4 text-center text-slate-500 text-sm">לא נמצאו קבוצות</div>
                ) : (
                  filtered.map((g) => (
                    <button
                      key={g.chat_id}
                      type="button"
                      onClick={() => onSelect(g.chat_id)}
                      className={`w-full text-right px-4 py-2.5 transition-colors flex items-center justify-between gap-2 ${
                        selected === g.chat_id
                          ? 'bg-primary/10 dark:bg-primary/20'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-900 dark:text-white truncate">{g.chat_name}</div>
                        <div className="text-xs font-mono text-slate-400 dark:text-slate-500 truncate">{g.chat_id}</div>
                      </div>
                      {selected === g.chat_id && (
                        <span className="material-symbols-outlined text-primary text-[18px] shrink-0">check</span>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-400">
              {error}
            </div>
          )}
        </div>

        <div className="p-6 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
          >
            ביטול
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!selected || submitting}
            className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-60 transition-colors"
          >
            {submitting && (
              <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
            )}
            {submitting ? 'מקשר...' : 'קשר'}
          </button>
        </div>
      </div>
    </div>
  );
}

function errorMessage(err: unknown): string | null {
  const axiosErr = err as { response?: { data?: { message?: string; error?: string } }; message?: string };
  return (
    axiosErr?.response?.data?.message ||
    axiosErr?.response?.data?.error ||
    axiosErr?.message ||
    null
  );
}
