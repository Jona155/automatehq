import client from './client';
import type { EmployeeImportRow, EmployeeImportSummary } from '../types';

export interface EmployeeImportPreviewResponse {
  summary: EmployeeImportSummary;
  rows: EmployeeImportRow[];
  meta?: Record<string, unknown>;
}

export interface EmployeeImportApplyResponse {
  summary: EmployeeImportSummary;
  rows: EmployeeImportRow[];
  applied: Array<{ action: 'create' | 'update'; employee: any; row_number: number | null }>;
}

export const previewEmployeeImport = async (file: File) => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await client.post<{ data: EmployeeImportPreviewResponse }>(
    '/employee-imports/preview',
    formData,
    {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    }
  );

  return response.data.data;
};

export const applyEmployeeImport = async (rows: EmployeeImportRow[]) => {
  const response = await client.post<{ data: EmployeeImportApplyResponse }>(
    '/employee-imports/apply',
    { rows }
  );

  return response.data.data;
};
