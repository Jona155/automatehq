import client from './client';

export interface HoursImportEmployeeSummary {
  passport: string;
  name: string;
  work_card_id: string;
  entries_changed: number;
}

export interface HoursImportSuccess {
  updated_cards: number;
  updated_entries: number;
  employees: HoursImportEmployeeSummary[];
}

export interface HoursImportValidationError {
  type:
    | 'unknown_employee'
    | 'tariff_mismatch'
    | 'invalid_day'
    | 'unrecognized_value'
    | 'structure'
    | 'unmatched_sheet'
    | 'hours_conflict';
  message: string;
  passport?: string;
  day?: number;
  value?: string;
  site?: string;
  sheet?: string;
}

export interface BatchHoursImportSiteSummary {
  site_name: string;
  site_code: string | null;
  updated_entries: number;
  employees: { passport: string; name: string }[];
}

export interface BatchHoursImportSuccess {
  updated_cards: number;
  updated_entries: number;
  sites: BatchHoursImportSiteSummary[];
  skipped_sites: { site_name: string; site_code: string | null }[];
}

export const importHoursFromExcel = async (
  siteId: string,
  month: string,
  file: File,
): Promise<HoursImportSuccess> => {
  const formData = new FormData();
  formData.append('file', file);
  const response = await client.post<{ data: HoursImportSuccess }>(
    `/sites/${siteId}/hours-import?month=${month}`,
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return response.data.data;
};

export const importHoursBatchFromExcel = async (
  month: string,
  file: File,
): Promise<BatchHoursImportSuccess> => {
  const formData = new FormData();
  formData.append('file', file);
  const response = await client.post<{ data: BatchHoursImportSuccess }>(
    `/sites/summary/hours-import-batch?month=${month}`,
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return response.data.data;
};
