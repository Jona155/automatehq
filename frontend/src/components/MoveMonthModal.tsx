import { useEffect, useMemo, useState } from 'react';
import Modal from './Modal';
import { moveWorkCardMonth, type MoveMonthSummary } from '../api/workCards';

interface MoveMonthModalProps {
  isOpen: boolean;
  onClose: () => void;
  cardId: string | null;
  /** The card's current month, 'YYYY-MM' or a full ISO date. */
  currentMonth: string | null;
  /** Shown in the dialog so the user knows which card is moving. */
  cardLabel?: string | null;
  onMoved: (cardId: string, targetMonth: string, summary: MoveMonthSummary) => void;
}

const toYearMonth = (value: string): string => value.slice(0, 7);

const shiftMonth = (value: string, delta: number): string => {
  const [year, month] = value.split('-').map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

export const formatMonthHe = (value: string): string => {
  const [year, month] = toYearMonth(value).split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('he-IL', { year: 'numeric', month: 'long' });
};

const ERROR_MESSAGES: Record<string, string> = {
  CARD_APPROVED: 'כרטיס מאושר לא ניתן להעברה. יש לבטל את האישור תחילה.',
  CARD_PROCESSING: 'הכרטיס עדיין בעיבוד. נסו שוב בעוד רגע.',
  DUPLICATE_IN_TARGET: 'אותה תמונה כבר קיימת בחודש היעד.',
  SAME_MONTH: 'הכרטיס כבר משויך לחודש זה.',
};

export default function MoveMonthModal({ isOpen, onClose, cardId, currentMonth, cardLabel, onMoved }: MoveMonthModalProps) {
  const current = currentMonth ? toYearMonth(currentMonth) : null;

  // The two months before and after the card's month. The usual case is a card
  // that landed one month too early, so the following month is preselected
  // unless that would be in the future.
  const options = useMemo(
    () => (current ? [-2, -1, 1, 2].map((delta) => shiftMonth(current, delta)) : []),
    [current],
  );
  const defaultTarget = useMemo(() => {
    if (!current) return '';
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const next = shiftMonth(current, 1);
    return next <= thisMonth ? next : shiftMonth(current, -1);
  }, [current]);

  const [target, setTarget] = useState(defaultTarget);
  const [isMoving, setIsMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setTarget(defaultTarget);
      setError(null);
    }
  }, [isOpen, defaultTarget, cardId]);

  const handleMove = async () => {
    if (!cardId || !target || isMoving) return;
    setIsMoving(true);
    setError(null);
    try {
      const result = await moveWorkCardMonth(cardId, target);
      onMoved(cardId, target, result.move);
    } catch (err: any) {
      const code = err?.response?.data?.error;
      setError(ERROR_MESSAGES[code] || 'שגיאה בהעברת הכרטיס');
    } finally {
      setIsMoving(false);
    }
  };

  const handleClose = () => {
    if (!isMoving) onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="העברת כרטיס לחודש אחר" maxWidth="sm">
      <div className="space-y-4">
        {current && (
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {cardLabel ? (
              <>
                הכרטיס של <span className="font-medium text-slate-900 dark:text-white">{cardLabel}</span> משויך כעת ל
              </>
            ) : (
              <>הכרטיס משויך כעת ל</>
            )}
            <span className="font-medium text-slate-900 dark:text-white">{formatMonthHe(current)}</span>. לאיזה חודש להעביר?
          </p>
        )}

        <div className="grid grid-cols-2 gap-2">
          {options.map((month) => (
            <button
              key={month}
              type="button"
              onClick={() => setTarget(month)}
              disabled={isMoving}
              aria-pressed={target === month}
              className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                target === month
                  ? 'bg-primary text-white border-primary'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-700'
              }`}
            >
              {formatMonthHe(month)}
            </button>
          ))}
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400">
          שעות שהוזנו ידנית יישמרו. שעות שחולצו אוטומטית ייבנו מחדש מול הכרטיסים של חודש היעד.
        </p>

        {error && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg p-3 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={handleClose}
            disabled={isMoving}
            className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg transition-colors font-medium text-sm dark:text-slate-300 dark:hover:bg-slate-700"
          >
            ביטול
          </button>
          <button
            onClick={handleMove}
            disabled={isMoving || !target}
            className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors font-medium text-sm flex items-center gap-2 disabled:opacity-60"
          >
            <span className={`material-symbols-outlined text-lg ${isMoving ? 'animate-spin' : ''}`}>
              {isMoving ? 'progress_activity' : 'event_repeat'}
            </span>
            <span>{isMoving ? 'מעביר...' : target ? `העבר ל${formatMonthHe(target)}` : 'העבר'}</span>
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Toast text after a successful move. */
export const moveMonthToastMessage = (targetMonth: string, summary: MoveMonthSummary): string => {
  let message = `הכרטיס הועבר ל${formatMonthHe(targetMonth)}`;
  if (summary.days_skipped_protected > 0) {
    message += ` · ${summary.days_skipped_protected} ימים לא נכתבו כי כבר אושרו בחודש היעד`;
  }
  if (summary.source_month_has_approved_card) {
    message += ' · בחודש המקור יש כרטיס מאושר לעובד, מומלץ לבדוק אותו';
  }
  return message;
};
