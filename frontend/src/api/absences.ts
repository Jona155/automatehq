import client from './client';

const normalizeMonth = (month: string): string =>
  /^\d{4}-\d{2}$/.test(month) ? `${month}-01` : month;

export type AbsenceCardStatus = 'APPROVED' | 'PENDING';

export interface AbsenceRow {
  employee_id: string;
  full_name: string;
  passport_id: string | null;
  external_employee_id: string | null;
  site_id: string | null;
  site_name: string | null;
  sick_days: number[];
  empty_days: number[];
  sick_count: number;
  empty_count: number;
  missed_total: number;
  /** The employee's own ignored days for the month (on top of the month-wide ones). */
  ignored_days: number[];
  card_status: AbsenceCardStatus;
  card_ids: string[];
  review_card_id: string;
  review_site_id: string | null;
  /** Set only on rows in `excluded_rows`. */
  exclusion_reason?: string | null;
}

export interface AbsencesSummary {
  employees: number;
  sick_days: number;
  empty_days: number;
  excluded: number;
  /** Employees whose cards have no day rows yet (extraction pending / monthly total only). */
  skipped_no_day_data: number;
}

export interface AbsenceEmployeeOverride {
  employee_id: string;
  full_name: string;
  site_name: string | null;
  ignored_days: number[];
}

export interface AbsencesResponse {
  month: string;
  settings: { ignored_days: number[] };
  /** Last day-of-month that is counted (0 for a future month). */
  cutoff_day: number;
  workdays: number[];
  workdays_counted: number;
  summary: AbsencesSummary;
  rows: AbsenceRow[];
  excluded_rows: AbsenceRow[];
  /** Every in-scope employee with their own ignored days, even if they have no absences left. */
  employee_overrides: AbsenceEmployeeOverride[];
}

export const getAbsences = async (month: string): Promise<AbsencesResponse> => {
  const response = await client.get<{ data: AbsencesResponse }>('/absences', {
    params: { month: normalizeMonth(month) },
  });
  return response.data.data;
};

export const saveAbsenceSettings = async (
  month: string,
  ignoredDays: number[],
): Promise<{ ignored_days: number[] }> => {
  const response = await client.put<{ data: { ignored_days: number[] } }>('/absences/settings', {
    processing_month: normalizeMonth(month),
    ignored_days: ignoredDays,
  });
  return response.data.data;
};

export const saveEmployeeAbsenceDays = async (
  month: string,
  employeeId: string,
  ignoredDays: number[],
): Promise<{ employee_id: string; ignored_days: number[] }> => {
  const response = await client.put<{ data: { employee_id: string; ignored_days: number[] } }>(
    '/absences/employee-days',
    {
      processing_month: normalizeMonth(month),
      employee_id: employeeId,
      ignored_days: ignoredDays,
    },
  );
  return response.data.data;
};

export const setAbsenceExclusions = async (
  month: string,
  employeeIds: string[],
  excluded: boolean,
  reason?: string,
): Promise<{ updated: number; excluded: boolean }> => {
  const response = await client.post<{ data: { updated: number; excluded: boolean } }>(
    '/absences/exclusions',
    {
      processing_month: normalizeMonth(month),
      employee_ids: employeeIds,
      excluded,
      reason: reason || undefined,
    },
  );
  return response.data.data;
};

export const downloadAbsencesReport = async (month: string): Promise<Blob> => {
  const response = await client.get('/absences/export', {
    params: { month: normalizeMonth(month) },
    responseType: 'blob',
  });
  return response.data;
};
