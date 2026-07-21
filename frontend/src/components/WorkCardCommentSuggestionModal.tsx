import { useMemo, useState } from 'react';
import Modal from './Modal';
import ImageZoomViewer from './ImageZoomViewer';
import type { GroupImage } from './WorkCardReviewTab';

interface WorkCardCommentSuggestionModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Image-bearing cards for the employee-month group (hasFile === true). */
  images: GroupImage[];
  /** Optional per-card site name, used as a label so the user knows which card is which. */
  siteNameByCardId?: Record<string, string>;
  /** Seed drafts from each card's current `notes`. */
  initialComments: Record<string, string>;
  isSaving: boolean;
  onSaveAndApprove: (comments: Record<string, string>) => void;
  onApproveWithoutComment: () => void;
}

// Suggests adding a comment to the relevant work card image(s) when the reviewer
// approves an employee-month whose hours span more than one site. The reviewer can
// switch between images, type a comment per image, and save them all at once — or
// approve without commenting. Comments are optional; approval always proceeds.
export default function WorkCardCommentSuggestionModal({
  isOpen,
  onClose,
  images,
  siteNameByCardId,
  initialComments,
  isSaving,
  onSaveAndApprove,
  onApproveWithoutComment,
}: WorkCardCommentSuggestionModalProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  // Drafts are keyed by cardId so switching images preserves unsaved text.
  const [drafts, setDrafts] = useState<Record<string, string>>(() => ({ ...initialComments }));

  const safeIndex = Math.min(selectedIndex, Math.max(images.length - 1, 0));
  const activeImage = images[safeIndex];
  const activeCardId = activeImage?.cardId;

  const commentedCount = useMemo(
    () => images.filter((img) => (drafts[img.cardId] ?? '').trim().length > 0).length,
    [images, drafts],
  );

  if (!activeImage) return null;

  const activeLabel =
    (siteNameByCardId && activeCardId ? siteNameByCardId[activeCardId] : undefined) ||
    activeImage.filename ||
    `כרטיס ${safeIndex + 1}`;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="הוספת הערות לכרטיסי העבודה" maxWidth="4xl">
      <div dir="rtl" className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          שעות העובד מחולקות בין יותר מאתר אחד. מומלץ להוסיף הערה לכרטיס/ים הרלוונטיים כדי לתעד
          את חלוקת השעות. ניתן לעבור בין התמונות ולהוסיף הערה לכל אחת מהן.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Image side */}
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm text-slate-500 dark:text-slate-400">
              <span className="font-medium text-slate-700 dark:text-slate-200">{activeLabel}</span>
              <span>
                {safeIndex + 1} / {images.length}
              </span>
            </div>

            <ImageZoomViewer
              // Key on the card so switching images resets zoom/rotate/pan.
              key={activeCardId}
              src={activeImage.url}
              alt={activeLabel}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 h-[28rem]"
            />

            {/* Thumbnail strip when there is more than one image */}
            {images.length > 1 && (
              <div className="flex flex-wrap gap-2">
                {images.map((img, index) => {
                  const hasComment = (drafts[img.cardId] ?? '').trim().length > 0;
                  const isActive = index === safeIndex;
                  return (
                    <button
                      key={img.cardId}
                      type="button"
                      onClick={() => setSelectedIndex(index)}
                      className={`relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2 transition-colors ${
                        isActive
                          ? 'border-indigo-500'
                          : 'border-slate-200 dark:border-slate-700 hover:border-slate-400'
                      }`}
                      title={
                        (siteNameByCardId && siteNameByCardId[img.cardId]) ||
                        img.filename ||
                        `כרטיס ${index + 1}`
                      }
                    >
                      {img.url ? (
                        <img src={img.url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-slate-300">
                          <span className="material-symbols-outlined text-base">image</span>
                        </span>
                      )}
                      {hasComment && (
                        <span className="absolute -top-1 -left-1 flex h-4 w-4 items-center justify-center rounded-full bg-indigo-500 text-white">
                          <span className="material-symbols-outlined text-[10px] leading-none">
                            check
                          </span>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Comment side */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
              הערה לכרטיס: {activeLabel}
            </label>
            <textarea
              value={activeCardId ? drafts[activeCardId] ?? '' : ''}
              onChange={(e) => {
                if (!activeCardId) return;
                const value = e.target.value;
                setDrafts((prev) => ({ ...prev, [activeCardId]: value }));
              }}
              rows={10}
              placeholder="לדוגמה: עבד באתר X בימים 1-10 ובאתר Y ביתר החודש"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              dir="rtl"
            />
            <p className="text-xs text-slate-400">
              {commentedCount > 0
                ? `${commentedCount} כרטיסים עם הערה`
                : 'לא הוזנו הערות (ניתן לאשר גם ללא הערה)'}
            </p>
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
          <button
            type="button"
            onClick={onApproveWithoutComment}
            disabled={isSaving}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
          >
            אשר ללא הערה
          </button>
          <button
            type="button"
            onClick={() => onSaveAndApprove(drafts)}
            disabled={isSaving}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 transition-colors disabled:opacity-50"
          >
            {isSaving && (
              <span className="material-symbols-outlined animate-spin text-base">
                progress_activity
              </span>
            )}
            שמור ואשר
          </button>
        </div>
      </div>
    </Modal>
  );
}
