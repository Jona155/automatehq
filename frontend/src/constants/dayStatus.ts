export const DAY_STATUS_LABELS: Record<string, string> = {
  VACATION: 'חופשה',
  SICK: 'מחלה',
  INTERNATIONAL_VISA: 'ויזה בינלאומית',
  HOLIDAY: 'חג',
  WORK_ACCIDENT: 'תאונת עבודה',
};

// Generic marker for days an employee worked at a different site. Deliberately
// never names the other site (reports go to contractors).
export const OTHER_SITE_LABEL = 'עבד באתר אחר';
