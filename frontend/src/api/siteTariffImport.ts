import client from './client';
import type { SiteTariffImportRow, SiteTariffImportSummary } from '../types';

export interface SiteTariffImportPreviewResponse {
  summary: SiteTariffImportSummary;
  rows: SiteTariffImportRow[];
}

export interface SiteTariffImportApplyResponse {
  summary: SiteTariffImportSummary;
  rows: SiteTariffImportRow[];
  applied: Array<{ site_id: string; site_name: string; old_tariff: number | null; new_tariff: number }>;
}

export const previewSiteTariffImport = async (file: File) => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await client.post<{ data: SiteTariffImportPreviewResponse }>(
    '/sites/tariff-import/preview',
    formData,
    {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    }
  );

  return response.data.data;
};

export const applySiteTariffImport = async (rows: SiteTariffImportRow[]) => {
  const response = await client.post<{ data: SiteTariffImportApplyResponse }>(
    '/sites/tariff-import/apply',
    { rows }
  );

  return response.data.data;
};
