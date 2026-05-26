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
  type: 'unknown_employee' | 'tariff_mismatch' | 'invalid_day' | 'unrecognized_value' | 'structure';
  message: string;
  passport?: string;
  day?: number;
  value?: string;
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
