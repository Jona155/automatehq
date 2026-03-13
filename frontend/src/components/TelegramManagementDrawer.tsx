import { useState, useEffect } from 'react';
import type { Business } from '../types';
import type { TelegramAdminConfig, TelegramValidation, TelegramLogEntry } from '../types';
import {
  getAdminTelegramConfig,
  updateAdminTelegramConfig,
  deleteAdminTelegramConfig,
  validateTelegramChat,
  getTelegramLogs,
  registerTelegramChat,
  peekTelegramMessages,
  runTelegramDiagnostics,
} from '../api/telegram';
import type { TelegramPeekResult, TelegramDiagnosticsResult } from '../api/telegram';

interface Props {
  business: Business;
  onClose: () => void;
}

const LOG_LIMIT = 20;

export default function TelegramManagementDrawer({ business, onClose }: Props) {
  const [config, setConfig] = useState<TelegramAdminConfig | null>(null);
  const [isConfigLoading, setIsConfigLoading] = useState(true);

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editChatId, setEditChatId] = useState('');
  const [editMonth, setEditMonth] = useState('');
  const [editAdvanceDay, setEditAdvanceDay] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Register (no-config) state
  const [registerChatId, setRegisterChatId] = useState('');
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);

  // Delete state
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Validation state
  const [validation, setValidation] = useState<TelegramValidation | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  // Peek (on-demand fetch) state
  const [peekResult, setPeekResult] = useState<TelegramPeekResult | null>(null);
  const [isPeeking, setIsPeeking] = useState(false);

  // Diagnostics state
  const [diagResult, setDiagResult] = useState<TelegramDiagnosticsResult | null>(null);
  const [isDiagnosing, setIsDiagnosing] = useState(false);

  // Logs state
  const [logs, setLogs] = useState<TelegramLogEntry[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsOffset, setLogsOffset] = useState(0);
  const [isLogsLoading, setIsLogsLoading] = useState(false);

  const loadConfig = async () => {
    setIsConfigLoading(true);
    try {
      const data = await getAdminTelegramConfig(business.id);
      setConfig(data);
    } catch (err) {
      console.error('Failed to load Telegram config:', err);
      setConfig(null);
    } finally {
      setIsConfigLoading(false);
    }
  };

  const loadLogs = async (offset: number) => {
    setIsLogsLoading(true);
    try {
      const data = await getTelegramLogs(business.id, LOG_LIMIT, offset);
      setLogs(data.items);
      setLogsTotal(data.total);
      setLogsOffset(offset);
    } catch (err) {
      console.error('Failed to load Telegram logs:', err);
    } finally {
      setIsLogsLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
    loadLogs(0);
  }, [business.id]);

  const handleStartEdit = () => {
    if (!config) return;
    setEditChatId(String(config.telegram_chat_id));
    setEditMonth(config.current_processing_month ?? '');
    setEditAdvanceDay(config.auto_advance_day != null ? String(config.auto_advance_day) : '');
    setEditError(null);
    setIsEditing(true);
  };

  const handleSaveEdit = async () => {
    if (!config) return;
    const chatIdNum = parseInt(editChatId, 10);
    if (!editChatId.trim() || isNaN(chatIdNum)) {
      setEditError('יש להזין מזהה צ\'אט תקין');
      return;
    }
    if (editMonth && !/^\d{4}-\d{2}-\d{2}$/.test(editMonth)) {
      setEditError('פורמט חודש שגוי (YYYY-MM-DD)');
      return;
    }
    const advDay = editAdvanceDay === '' ? null : parseInt(editAdvanceDay, 10);
    if (advDay !== null && (isNaN(advDay) || advDay < 1 || advDay > 28)) {
      setEditError('יום מעבר חייב להיות בין 1 ל-28');
      return;
    }

    setIsSaving(true);
    setEditError(null);
    try {
      const updated = await updateAdminTelegramConfig(business.id, {
        telegram_chat_id: chatIdNum,
        current_processing_month: editMonth || undefined,
        auto_advance_day: advDay,
      });
      setConfig(updated);
      setIsEditing(false);
      setValidation(null);
    } catch (err: any) {
      setEditError(err.response?.data?.message || 'שגיאה בשמירה');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleActive = async () => {
    if (!config) return;
    try {
      const updated = await updateAdminTelegramConfig(business.id, { is_active: !config.is_active });
      setConfig(updated);
    } catch (err: any) {
      alert(err.response?.data?.message || 'שגיאה בשינוי סטטוס');
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteAdminTelegramConfig(business.id);
      setConfig(null);
      setIsDeleteConfirmOpen(false);
      setValidation(null);
      setLogs([]);
      setLogsTotal(0);
    } catch (err: any) {
      alert(err.response?.data?.message || 'שגיאה במחיקה');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleValidate = async () => {
    setIsValidating(true);
    setValidation(null);
    try {
      const result = await validateTelegramChat(business.id);
      setValidation(result);
    } catch (err: any) {
      setValidation({ valid: false, error: err.response?.data?.message || 'שגיאה בבדיקת חיבור' });
    } finally {
      setIsValidating(false);
    }
  };

  const handleDiagnostics = async () => {
    setIsDiagnosing(true);
    setDiagResult(null);
    try {
      const result = await runTelegramDiagnostics(business.id);
      setDiagResult(result);
    } catch (err: any) {
      alert(err.response?.data?.message || 'שגיאה בהרצת אבחון');
    } finally {
      setIsDiagnosing(false);
    }
  };

  const handlePeek = async () => {
    setIsPeeking(true);
    setPeekResult(null);
    try {
      const result = await peekTelegramMessages(business.id);
      setPeekResult(result);
    } catch (err: any) {
      setPeekResult({ messages: [], current_offset: 0, total_pending_bot_updates: 0, error: err.response?.data?.message || 'שגיאה בשליפת הודעות' });
    } finally {
      setIsPeeking(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const chatIdNum = parseInt(registerChatId, 10);
    if (!registerChatId.trim() || isNaN(chatIdNum)) {
      setRegisterError('יש להזין מזהה צ\'אט תקין (מספר שלם)');
      return;
    }
    setIsRegistering(true);
    setRegisterError(null);
    try {
      await registerTelegramChat(business.id, chatIdNum);
      setRegisterChatId('');
      await loadConfig();
      await loadLogs(0);
    } catch (err: any) {
      setRegisterError(err.response?.data?.message || 'שגיאה בקישור הצ\'אט');
    } finally {
      setIsRegistering(false);
    }
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
  };

  const statusIcon = (status: TelegramLogEntry['status']) => {
    if (status === 'INGESTED') return '✅';
    if (status === 'ERROR') return '❌';
    return '⏭️';
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white dark:bg-slate-800 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <span className="material-symbols-outlined text-xl">send</span>
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">ניהול Telegram</h3>
              <p className="text-sm text-slate-500">{business.name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-all"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {isConfigLoading ? (
            <div className="p-8 text-center text-slate-500">טוען...</div>
          ) : config === null ? (
            /* ── No Config: Register ── */
            <div className="space-y-4">
              <div className="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-200 dark:border-slate-700 text-center">
                <span className="material-symbols-outlined text-3xl text-slate-400 block mb-2">link_off</span>
                <p className="text-slate-600 dark:text-slate-400 text-sm">לא הוגדר צ'אט Telegram לעסק זה</p>
              </div>
              <form onSubmit={handleRegister} className="space-y-3">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  מזהה צ'אט (Chat ID)
                </label>
                {registerError && (
                  <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm rounded-lg border border-red-100 dark:border-red-800">
                    {registerError}
                  </div>
                )}
                <input
                  type="text"
                  dir="ltr"
                  value={registerChatId}
                  onChange={(e) => setRegisterChatId(e.target.value)}
                  className="w-full px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all font-mono"
                  placeholder="-1001234567890"
                  autoComplete="off"
                />
                <p className="text-xs text-slate-500">
                  ניתן למצוא את ה-Chat ID על ידי הוספת @userinfobot לקבוצה ושליחת הודעה
                </p>
                <button
                  type="submit"
                  disabled={isRegistering || !registerChatId.trim()}
                  className="w-full py-2 bg-primary hover:bg-primary/90 text-white rounded-lg transition-colors font-bold shadow-lg shadow-primary/30 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isRegistering && <span className="material-symbols-outlined animate-spin text-base">progress_activity</span>}
                  {isRegistering ? 'מקשר...' : 'קשר צ\'אט'}
                </button>
              </form>
            </div>
          ) : (
            <>
              {/* ── Section 1: Config Status ── */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide">הגדרות</h4>
                  <div className="flex items-center gap-1">
                    {!isEditing && (
                      <>
                        <button
                          onClick={handleStartEdit}
                          className="p-1.5 text-slate-400 hover:text-primary hover:bg-primary/5 rounded-lg transition-all text-sm flex items-center gap-1"
                          title="ערוך"
                        >
                          <span className="material-symbols-outlined text-base">edit</span>
                        </button>
                        <button
                          onClick={handleToggleActive}
                          className={`p-1.5 rounded-lg transition-all text-sm flex items-center gap-1 ${
                            config.is_active
                              ? 'text-slate-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                              : 'text-slate-400 hover:text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20'
                          }`}
                          title={config.is_active ? 'השבת' : 'הפעל'}
                        >
                          <span className="material-symbols-outlined text-base">
                            {config.is_active ? 'pause_circle' : 'play_circle'}
                          </span>
                        </button>
                        <button
                          onClick={() => setIsDeleteConfirmOpen(true)}
                          className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all"
                          title="מחק"
                        >
                          <span className="material-symbols-outlined text-base">delete</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {isDeleteConfirmOpen && (
                  <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg space-y-3">
                    <p className="text-sm text-red-700 dark:text-red-400 font-medium">האם למחוק את הגדרות ה-Telegram? פעולה זו אינה הפיכה.</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setIsDeleteConfirmOpen(false)}
                        className="flex-1 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700 rounded-lg transition-colors font-medium"
                      >
                        ביטול
                      </button>
                      <button
                        onClick={handleDelete}
                        disabled={isDeleting}
                        className="flex-1 py-1.5 text-sm bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors font-bold disabled:opacity-50"
                      >
                        {isDeleting ? 'מוחק...' : 'מחק'}
                      </button>
                    </div>
                  </div>
                )}

                {!isEditing ? (
                  <div className="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-200 dark:border-slate-700 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Chat ID</span>
                      <span className="font-mono text-slate-900 dark:text-white">{config.telegram_chat_id}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">סטטוס</span>
                      <span className={`font-semibold ${config.is_active ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                        {config.is_active ? '🟢 פעיל' : '🔴 מושבת'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">חודש עיבוד</span>
                      <span className="font-mono text-slate-900 dark:text-white">
                        {config.current_processing_month ? config.current_processing_month.slice(0, 7) : '—'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">יום מעבר אוטומטי</span>
                      <span className="text-slate-900 dark:text-white">
                        {config.auto_advance_day != null ? config.auto_advance_day : 'מושבת'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">עודכן</span>
                      <span className="text-slate-900 dark:text-white">{formatDate(config.updated_at)}</span>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-200 dark:border-slate-700 space-y-3">
                    {editError && (
                      <div className="p-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm rounded border border-red-100 dark:border-red-800">
                        {editError}
                      </div>
                    )}
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Chat ID</label>
                      <input
                        type="text"
                        dir="ltr"
                        value={editChatId}
                        onChange={(e) => setEditChatId(e.target.value)}
                        className="w-full px-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">חודש עיבוד (YYYY-MM-DD)</label>
                      <input
                        type="text"
                        dir="ltr"
                        value={editMonth}
                        onChange={(e) => setEditMonth(e.target.value)}
                        className="w-full px-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all font-mono"
                        placeholder="2026-03-01"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">יום מעבר אוטומטי (1–28, ריק = מושבת)</label>
                      <input
                        type="number"
                        min={1}
                        max={28}
                        dir="ltr"
                        value={editAdvanceDay}
                        onChange={(e) => setEditAdvanceDay(e.target.value)}
                        className="w-full px-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none transition-all"
                        placeholder="ריק = מושבת"
                      />
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => setIsEditing(false)}
                        className="flex-1 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700 rounded-lg transition-colors font-medium"
                      >
                        ביטול
                      </button>
                      <button
                        onClick={handleSaveEdit}
                        disabled={isSaving}
                        className="flex-1 py-1.5 text-sm bg-primary hover:bg-primary/90 text-white rounded-lg transition-colors font-bold disabled:opacity-50"
                      >
                        {isSaving ? 'שומר...' : 'שמור'}
                      </button>
                    </div>
                  </div>
                )}
              </section>

              {/* ── Section 2: Validate Connection ── */}

              <section className="space-y-3">
                <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide">בדיקת חיבור</h4>
                <button
                  onClick={handleValidate}
                  disabled={isValidating}
                  className="w-full py-2 border border-primary text-primary hover:bg-primary/5 rounded-lg transition-colors font-medium text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isValidating ? (
                    <>
                      <span className="material-symbols-outlined animate-spin text-base">progress_activity</span>
                      בודק...
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-base">wifi_tethering</span>
                      בדוק חיבור
                    </>
                  )}
                </button>
                {validation && (
                  <div className={`p-3 rounded-lg border text-sm flex items-start gap-2 ${
                    validation.valid
                      ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400'
                      : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'
                  }`}>
                    <span className="material-symbols-outlined text-base flex-shrink-0 mt-0.5">
                      {validation.valid ? 'check_circle' : 'error'}
                    </span>
                    <div>
                      {validation.valid ? (
                        <>
                          <span className="font-semibold">הבוט מחובר בהצלחה</span>
                          {validation.chat_title && <span> — {validation.chat_title}</span>}
                          {validation.chat_type && <span className="text-xs mr-1">({validation.chat_type})</span>}
                        </>
                      ) : (
                        <>
                          <span className="font-semibold">הבוט אינו יכול לגשת לצ'אט.</span>
                          {validation.error && <span className="block text-xs mt-0.5">{validation.error}</span>}
                          <span className="block text-xs mt-0.5">ודא שה-Chat ID נכון והבוט חבר בקבוצה.</span>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </section>

              {/* ── Section 3: Diagnostics ── */}
              <section className="space-y-3">
                <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide">אבחון</h4>
                <button
                  onClick={handleDiagnostics}
                  disabled={isDiagnosing}
                  className="w-full py-2 border border-amber-400 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-lg transition-colors font-medium text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isDiagnosing ? (
                    <>
                      <span className="material-symbols-outlined animate-spin text-base">progress_activity</span>
                      מאבחן...
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-base">bug_report</span>
                      הרץ אבחון מלא
                    </>
                  )}
                </button>

                {diagResult && (
                  <div className="space-y-3">
                    {/* Diagnosis banner */}
                    <div className={`p-3 rounded-lg border text-sm flex items-start gap-2 ${
                      diagResult.diagnosis === 'ok'
                        ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400'
                        : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300'
                    }`}>
                      <span className="material-symbols-outlined text-base flex-shrink-0 mt-0.5">
                        {diagResult.diagnosis === 'ok' ? 'check_circle' : 'warning'}
                      </span>
                      <p className="leading-relaxed">{diagResult.diagnosis_detail}</p>
                    </div>

                    {/* Stats row */}
                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                      {[
                        { label: 'הודעות בתור', value: diagResult.summary.total_updates },
                        { label: 'מהצ\'אט הזה', value: diagResult.summary.from_target_chat },
                        { label: 'תמונות ממתינות', value: diagResult.summary.photos_from_target_chat },
                      ].map(({ label, value }) => (
                        <div key={label} className="p-2 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-200 dark:border-slate-700">
                          <div className="font-bold text-lg text-slate-800 dark:text-slate-200">{value}</div>
                          <div className="text-slate-500">{label}</div>
                        </div>
                      ))}
                    </div>

                    {/* Bot info + offset */}
                    <div className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-200 dark:border-slate-700 space-y-1 text-xs">
                      {diagResult.bot && (
                        <div className="flex justify-between">
                          <span className="text-slate-500">בוט</span>
                          <span className="font-mono text-slate-800 dark:text-slate-200">@{diagResult.bot.username} (#{diagResult.bot.id})</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-slate-500">Offset מאוחסן</span>
                        <span className="font-mono text-slate-800 dark:text-slate-200">{diagResult.stored_offset}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Chat ID מוגדר</span>
                        <span className="font-mono text-slate-800 dark:text-slate-200">{diagResult.target_chat_id}</span>
                      </div>
                    </div>

                    {/* Raw updates table */}
                    {diagResult.updates.length > 0 && (
                      <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                        <div className="px-3 py-2 bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-400">
                          הודעות גולמיות ({diagResult.updates.length})
                        </div>
                        <div className="divide-y divide-slate-100 dark:divide-slate-700/50 max-h-48 overflow-y-auto">
                          {diagResult.updates.map((upd) => (
                            <div
                              key={upd.update_id}
                              className={`px-3 py-2 text-xs flex items-center gap-2 ${
                                upd.is_target_chat
                                  ? 'bg-primary/5'
                                  : 'bg-white dark:bg-slate-900/30'
                              }`}
                            >
                              <span className="flex-shrink-0">
                                {upd.message_type === 'photo' ? '🖼️' : upd.message_type === 'text' ? '💬' : upd.message_type === 'document' ? '📄' : '❓'}
                              </span>
                              <span className="font-mono text-slate-500 flex-shrink-0">#{upd.update_id}</span>
                              <span className={`flex-shrink-0 font-medium ${upd.is_target_chat ? 'text-primary' : 'text-slate-500'}`}>
                                {upd.chat_id}
                              </span>
                              {upd.username && <span className="text-slate-400 truncate">@{upd.username}</span>}
                              {upd.is_target_chat && (
                                <span className="mr-auto text-primary text-xs font-semibold flex-shrink-0">← הצ'אט שלך</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </section>

              {/* ── Section 4: On-Demand Fetch ── */}
              <section className="space-y-3">
                <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide">הודעות ממתינות</h4>
                <button
                  onClick={handlePeek}
                  disabled={isPeeking}
                  className="w-full py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-lg transition-colors font-medium text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isPeeking ? (
                    <>
                      <span className="material-symbols-outlined animate-spin text-base">progress_activity</span>
                      שולף...
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-base">cloud_download</span>
                      שלוף הודעות ממתינות
                    </>
                  )}
                </button>

                {peekResult && (
                  <div className="space-y-2">
                    {peekResult.error ? (
                      <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm rounded-lg">
                        {peekResult.error}
                      </div>
                    ) : peekResult.messages.length === 0 ? (
                      <div className="p-3 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 text-slate-500 text-sm rounded-lg text-center">
                        {peekResult.total_pending_bot_updates === 0
                          ? 'אין הודעות ממתינות לבוט'
                          : `יש ${peekResult.total_pending_bot_updates} הודעות לבוט, אך אף אחת אינה מצ'אט זה`}
                      </div>
                    ) : (
                      <>
                        <p className="text-xs text-slate-500">
                          {peekResult.messages.length} הודעות ממתינות מצ'אט זה
                          {peekResult.total_pending_bot_updates > peekResult.messages.length && (
                            <span className="mr-1">(מתוך {peekResult.total_pending_bot_updates} סה"כ לבוט)</span>
                          )}
                          {' '}— הפולר יעבד אותן בסבב הבא
                        </p>
                        <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden divide-y divide-slate-100 dark:divide-slate-700/50">
                          {peekResult.messages.map((msg) => (
                            <div key={msg.update_id} className="px-4 py-3 text-sm bg-white dark:bg-slate-900/30 flex items-start gap-3">
                              <span className="text-base flex-shrink-0 mt-0.5">
                                {msg.has_photo ? '🖼️' : '💬'}
                              </span>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-medium text-slate-800 dark:text-slate-200">
                                    {msg.has_photo ? 'תמונה' : 'הודעת טקסט'}
                                  </span>
                                  {msg.message_timestamp && (
                                    <span className="text-xs text-slate-400 flex-shrink-0">
                                      {formatDate(new Date(msg.message_timestamp * 1000).toISOString())}
                                    </span>
                                  )}
                                </div>
                                {msg.telegram_username && (
                                  <span className="text-xs text-slate-500">@{msg.telegram_username}</span>
                                )}
                                {msg.caption && (
                                  <p className="text-xs text-slate-500 mt-0.5 truncate">{msg.caption}</p>
                                )}
                                {msg.text && !msg.has_photo && (
                                  <p className="text-xs text-slate-500 mt-0.5 truncate">{msg.text}</p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </section>

              {/* ── Section 4: Ingestion Logs ── */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide">
                    לוג קליטה
                    {logsTotal > 0 && <span className="mr-1 text-slate-400 font-normal normal-case">({logsTotal})</span>}
                  </h4>
                  <button
                    onClick={() => loadLogs(0)}
                    className="p-1.5 text-slate-400 hover:text-primary hover:bg-primary/5 rounded-lg transition-all"
                    title="רענן"
                  >
                    <span className="material-symbols-outlined text-base">refresh</span>
                  </button>
                </div>

                {isLogsLoading ? (
                  <div className="py-6 text-center text-slate-500 text-sm">טוען לוג...</div>
                ) : logs.length === 0 ? (
                  <div className="py-6 text-center text-slate-400 text-sm">
                    <span className="material-symbols-outlined text-2xl block mb-1">inbox</span>
                    לא נמצאו רשומות קליטה עבור צ'אט זה
                  </div>
                ) : (
                  <>
                    <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden divide-y divide-slate-100 dark:divide-slate-700/50">
                      {logs.map((log) => (
                        <div key={log.id} className="px-4 py-3 text-sm bg-white dark:bg-slate-900/30 flex items-start gap-3">
                          <span className="text-base flex-shrink-0 mt-0.5">{statusIcon(log.status)}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className={`font-medium ${
                                log.status === 'INGESTED' ? 'text-green-700 dark:text-green-400' :
                                log.status === 'ERROR' ? 'text-red-600 dark:text-red-400' :
                                'text-slate-500'
                              }`}>
                                {log.status === 'INGESTED' ? 'נקלט' : log.status === 'ERROR' ? 'שגיאה' : 'דולג'}
                              </span>
                              <span className="text-xs text-slate-400 flex-shrink-0">{formatDate(log.processed_at)}</span>
                            </div>
                            {log.telegram_username && (
                              <span className="text-xs text-slate-500">@{log.telegram_username}</span>
                            )}
                            {log.error_message && (
                              <p className="text-xs text-red-500 dark:text-red-400 mt-0.5 truncate">{log.error_message}</p>
                            )}
                            {log.work_card_id && (
                              <p className="text-xs text-primary mt-0.5 font-mono truncate">{log.work_card_id}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Pagination */}
                    {logsTotal > LOG_LIMIT && (
                      <div className="flex items-center justify-between text-sm text-slate-500">
                        <span>{logsOffset + 1}–{Math.min(logsOffset + LOG_LIMIT, logsTotal)} מתוך {logsTotal}</span>
                        <div className="flex gap-1">
                          <button
                            onClick={() => loadLogs(Math.max(0, logsOffset - LOG_LIMIT))}
                            disabled={logsOffset === 0}
                            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          >
                            <span className="material-symbols-outlined text-base">chevron_right</span>
                          </button>
                          <button
                            onClick={() => loadLogs(logsOffset + LOG_LIMIT)}
                            disabled={logsOffset + LOG_LIMIT >= logsTotal}
                            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          >
                            <span className="material-symbols-outlined text-base">chevron_left</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
