import { useState, useEffect } from 'react';
import { getTelegramSettings, updateTelegramSettings } from '../api/telegram';
import type { TelegramConfig } from '../types';

export default function TelegramSettings() {
  const [config, setConfig] = useState<TelegramConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [processingMonth, setProcessingMonth] = useState('');
  const [autoAdvanceEnabled, setAutoAdvanceEnabled] = useState(false);
  const [autoAdvanceDay, setAutoAdvanceDay] = useState<number>(1);

  useEffect(() => {
    setLoading(true);
    getTelegramSettings()
      .then((data) => {
        setConfig(data);
        if (data.current_processing_month) {
          setProcessingMonth(data.current_processing_month.slice(0, 7)); // YYYY-MM
        }
        setAutoAdvanceEnabled(data.auto_advance_day != null);
        setAutoAdvanceDay(data.auto_advance_day ?? 1);
      })
      .catch((err) => {
        setError(err?.response?.data?.message || 'Failed to load Telegram settings');
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setError(null);
    setSuccessMsg(null);
    setSaving(true);
    try {
      const payload: { current_processing_month?: string; auto_advance_day?: number | null } = {};

      if (processingMonth) {
        payload.current_processing_month = `${processingMonth}-01`;
      }

      payload.auto_advance_day = autoAdvanceEnabled ? autoAdvanceDay : null;

      const updated = await updateTelegramSettings(payload);
      setConfig(updated);
      setSuccessMsg('Settings saved successfully');
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string } } };
      setError(axiosErr?.response?.data?.message || 'Failed to save settings');
    } finally {
      setSaving(false);
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
    <div className="max-w-2xl mx-auto py-8 px-4 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">הגדרות Telegram</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-1 text-sm">
          ניהול ערוץ קליטת כרטיסי עבודה דרך בוט Telegram
        </p>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-red-700 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {successMsg && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 text-green-700 dark:text-green-400 text-sm">
          {successMsg}
        </div>
      )}

      {/* Connection status */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-3">
        <h2 className="font-semibold text-slate-800 dark:text-slate-200">סטטוס חיבור</h2>
        {config?.is_configured ? (
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-green-500 inline-block" />
            <span className="text-sm text-slate-700 dark:text-slate-300">
              מחובר — Chat ID:{' '}
              <span className="font-mono font-medium">{config.telegram_chat_id}</span>
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-slate-400 inline-block" />
            <span className="text-sm text-slate-500 dark:text-slate-400">
              לא מוגדר — פנה למנהל המערכת כדי לקשר את הבוט לעסק זה
            </span>
          </div>
        )}
      </section>

      {config?.is_configured && (
        <>
          {/* Processing month */}
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
            <h2 className="font-semibold text-slate-800 dark:text-slate-200">חודש עיבוד נוכחי</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              כרטיסי עבודה שמתקבלים דרך Telegram ישויכו לחודש זה
            </p>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                חודש עיבוד
              </label>
              <input
                type="month"
                value={processingMonth}
                onChange={(e) => setProcessingMonth(e.target.value)}
                className="border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </section>

          {/* Auto-advance */}
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
            <h2 className="font-semibold text-slate-800 dark:text-slate-200">מעבר חודש אוטומטי</h2>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setAutoAdvanceEnabled(!autoAdvanceEnabled)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  autoAdvanceEnabled ? 'bg-primary' : 'bg-slate-300 dark:bg-slate-600'
                }`}
                role="switch"
                aria-checked={autoAdvanceEnabled}
              >
                <span
                  className={`inline-block size-4 rounded-full bg-white shadow transition-transform ${
                    autoAdvanceEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
              <span className="text-sm text-slate-700 dark:text-slate-300">
                {autoAdvanceEnabled ? 'מופעל' : 'כבוי'}
              </span>
            </div>

            {autoAdvanceEnabled && (
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  מעבר אוטומטי ביום
                </label>
                <input
                  type="number"
                  min={1}
                  max={28}
                  value={autoAdvanceDay}
                  onChange={(e) => setAutoAdvanceDay(Math.min(28, Math.max(1, parseInt(e.target.value) || 1)))}
                  className="w-24 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  המערכת תעבור אוטומטית לחודש הבא ביום {autoAdvanceDay} של כל חודש
                </p>
              </div>
            )}
          </section>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 bg-primary text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-60 transition-colors"
            >
              {saving && (
                <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
              )}
              {saving ? 'שומר...' : 'שמור הגדרות'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
